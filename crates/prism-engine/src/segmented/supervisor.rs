//! The supervisor: spawns and ramps up workers, reacts to server connection limits, applies
//! live commands and decides when the transfer is complete, stopped or failed.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use tokio::sync::mpsc::UnboundedReceiver;
use tokio::task::JoinSet;
use url::Url;

use super::table::WorkerId;
use super::worker::run_worker;
use super::{FetcherFactory, InitialStream, RangeFetcher, SegCtx, WorkerExit};
use crate::error::EngineError;
use crate::job::{Command, StopReason};
use crate::limiter::any_limited;
use crate::progress::DownloadEvent;

/// Supervisor tick (speed meters, ramp-up, limit probing).
const TICK: Duration = Duration::from_millis(250);
/// After a worker gave up, wait this long before spawning replacements.
const GIVE_UP_HOLD: Duration = Duration::from_secs(10);
/// First delay before trying one more connection after a server limit was detected.
const PROBE_UP_FIRST: Duration = Duration::from_secs(20);
/// Probe delay after the server asked us to slow down (`Retry-After`): request-rate limited
/// servers count every extra request, so stay at the working connection count for long.
const RATE_LIMITED_PROBE: Duration = Duration::from_secs(300);
/// Maximum delay between limit probes.
const PROBE_UP_MAX: Duration = Duration::from_secs(300);

/// How the transfer phase ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Outcome {
    Completed,
    Stopped(StopReason),
}

/// Protocol hook for `change_url`.
pub(crate) trait UrlChanger: Send + Sync {
    fn change_url(
        &self,
        url: Url,
    ) -> Pin<Box<dyn Future<Output = Result<(), EngineError>> + Send + '_>>;
}

/// Connection-count parameters.
pub(crate) struct Params {
    /// Connections requested by the user.
    pub requested: usize,
    /// Connections started immediately (ramp-up start).
    pub initial: usize,
    /// Engine cap.
    pub cap: usize,
    /// Whether Turbo Multi-Thread Dynamic Booster is enabled.
    pub turbo: bool,
}

fn spawn_worker<F: RangeFetcher>(
    workers: &mut JoinSet<WorkerExit>,
    ctx: &Arc<SegCtx>,
    next_id: &mut WorkerId,
    fetcher: F,
    initial: Option<InitialStream<F::Stream>>,
) {
    let id = *next_id;
    *next_id += 1;
    ctx.active_workers.fetch_add(1, Ordering::AcqRel);
    workers.spawn(run_worker(ctx.clone(), id, fetcher, initial, ctx.race));
}

/// The first worker's fetcher together with the probe's open stream.
pub(crate) type FirstWorker<FF> = Option<(
    <FF as FetcherFactory>::Fetcher,
    InitialStream<<<FF as FetcherFactory>::Fetcher as RangeFetcher>::Stream>,
)>;

/// Runs the transfer phase until every byte is received, the job is stopped, or it fails.
pub(crate) async fn supervise<FF: FetcherFactory>(
    ctx: Arc<SegCtx>,
    factory: Arc<FF>,
    first: FirstWorker<FF>,
    cmd_rx: &mut UnboundedReceiver<Command>,
    changer: Option<&dyn UrlChanger>,
    params: Params,
) -> Result<Outcome, EngineError> {
    let mut workers: JoinSet<WorkerExit> = JoinSet::new();
    let mut next_id: WorkerId = 0;
    let mut requested = params.requested.clamp(1, params.cap);
    let mut learned = ctx.host_limits.limit(&ctx.host);
    let mut ramp = params.initial.clamp(1, requested);
    let mut hold_until: Option<Instant> = None;
    let mut probe_backoff = PROBE_UP_FIRST;
    let mut probe_up_at = learned.map(|_| Instant::now() + probe_backoff);
    let mut last_error: Option<EngineError> = None;
    let mut fatal: Option<EngineError> = None;
    let mut done = false;
    let mut turbo_next_eval = Instant::now() + Duration::from_secs(3);

    if let Some((fetcher, initial)) = first {
        spawn_worker(&mut workers, &ctx, &mut next_id, fetcher, Some(initial));
    }

    let mut tick = tokio::time::interval(TICK);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        let cap = requested.min(learned.unwrap_or(usize::MAX)).max(1);
        ctx.target.store(cap, Ordering::Release);
        // Ramp-up: the first `initial` connections start immediately; as soon as they all
        // deliver data the remaining ones are opened at once.
        if ramp < cap
            && ctx.connected.load(Ordering::Acquire)
                >= ramp.min(ctx.active_workers.load(Ordering::Acquire)).max(1)
        {
            ramp = cap;
        }

        if !done && ctx.table.all_done() {
            done = true;
            ctx.stop.cancel();
        }
        let stopping = ctx.stop.is_cancelled();
        if !stopping && hold_until.is_none_or(|t| Instant::now() >= t) {
            hold_until = None;
            while ctx.active_workers.load(Ordering::Acquire) < ramp.min(cap)
                && ctx.table.has_work(ctx.race && !any_limited(&ctx.limiters))
            {
                let fetcher = factory.create(next_id);
                spawn_worker(&mut workers, &ctx, &mut next_id, fetcher, None);
            }
        }
        if workers.is_empty() {
            if let Some(e) = fatal {
                return Err(e);
            }
            if done {
                return Ok(Outcome::Completed);
            }
            if stopping {
                return Ok(Outcome::Stopped(
                    ctx.job.stop_reason().unwrap_or(StopReason::Pause),
                ));
            }
            if hold_until.is_none() {
                // Nothing running, nothing could be spawned, data missing: give up.
                return Err(last_error
                    .unwrap_or_else(|| EngineError::internal("no worker could make progress")));
            }
        }

        tokio::select! {
            Some(joined) = workers.join_next() => {
                let exit = joined.unwrap_or_else(|e| WorkerExit::Fatal(EngineError::internal(format!("worker panicked: {e}"))));
                match exit {
                    WorkerExit::Idle | WorkerExit::Retired | WorkerExit::Stopped => {}
                    WorkerExit::Refused { retry_after } => {
                        let working = ctx.connected.load(Ordering::Acquire).max(1);
                        if working < cap {
                            learned = Some(working);
                            ctx.host_limits.record(&ctx.host, working);
                            ctx.job.emit(DownloadEvent::ServerLimitDetected { connections: working as u32 });
                            tracing::info!(host = %ctx.host, connections = working, "server connection limit detected");
                        }
                        // Rate limiting (Retry-After) punishes eager probing: back off longer.
                        if retry_after.is_some() {
                            probe_backoff = probe_backoff.max(RATE_LIMITED_PROBE);
                        }
                        let wait = retry_after.unwrap_or(Duration::ZERO).max(probe_backoff);
                        probe_up_at = Some(Instant::now() + wait);
                        probe_backoff = (probe_backoff * 2).min(PROBE_UP_MAX);
                    }
                    WorkerExit::GaveUp(e) => {
                        tracing::warn!(error = %e, "connection gave up");
                        last_error = Some(e);
                        hold_until = Some(Instant::now() + GIVE_UP_HOLD);
                        if workers.is_empty() && !ctx.table.all_done() {
                            return Err(last_error.take().expect("just set"));
                        }
                    }
                    WorkerExit::Fatal(e) => {
                        if fatal.is_none() {
                            fatal = Some(e);
                        }
                        ctx.stop.cancel();
                    }
                }
            }
            _ = tick.tick() => {
                let now = Instant::now();
                ctx.table.tick(now);
                let connected = ctx.connected.load(Ordering::Acquire);
                ctx.job.update_rates(ctx.table.downloaded(), ctx.table.total(), connected as u32, cap as u32);
                if let Some(e) = ctx.writer.error() {
                    if fatal.is_none() {
                        fatal = Some(e);
                    }
                    ctx.stop.cancel();
                }
                // Periodically try one more connection than the detected limit.
                if let (Some(l), Some(at)) = (learned, probe_up_at)
                    && now >= at
                    && l < requested
                {
                    learned = Some(l + 1);
                    ctx.host_limits.record(&ctx.host, l + 1);
                    probe_up_at = Some(now + probe_backoff);
                }
                // Turbo Multi-Thread Dynamic Booster: scale connections up when the transfer is healthy.
                if params.turbo
                    && requested < params.cap
                    && learned.is_none()
                    && hold_until.is_none()
                    && !any_limited(&ctx.limiters)
                    && now >= turbo_next_eval
                {
                    turbo_next_eval = now + Duration::from_secs(3);
                    let active = ctx.active_workers.load(Ordering::Acquire);
                    let connected = ctx.connected.load(Ordering::Acquire);
                    let remaining = ctx.table.remaining().unwrap_or(0);
                    let min_needed_bytes = (requested as u64 + 4) * (ctx.min_request.max(1024 * 1024));
                    if connected >= active && active >= requested && remaining >= min_needed_bytes {
                        let next_target = (requested + 4).min(params.cap);
                        if next_target > requested {
                            tracing::info!(
                                host = %ctx.host,
                                from = requested,
                                to = next_target,
                                "Turbo Booster: dynamically scaled up connections"
                            );
                            requested = next_target;
                            ramp = requested;
                        }
                    }
                }
            }
            _ = ctx.connected_notify.notified() => {}
            Some(cmd) = cmd_rx.recv() => match cmd {
                Command::SetConnections(n) => {
                    requested = usize::from(n).clamp(1, params.cap);
                    ramp = ramp.max(requested);
                    if learned.is_some_and(|l| l < requested) {
                        probe_up_at = Some(Instant::now());
                    }
                }
                Command::ChangeUrl(url, reply) => {
                    let result = match changer {
                        Some(c) => tokio::select! {
                            r = c.change_url(url.clone()) => r,
                            _ = ctx.stop.cancelled() => Err(EngineError::Cancelled),
                        },
                        None => Err(EngineError::Unsupported { message: "changing the address of this download".into() }),
                    };
                    if result.is_ok() {
                        ctx.job.emit(DownloadEvent::UrlChanged { url });
                    }
                    let _ = reply.send(result);
                }
            },
        }
    }
}
