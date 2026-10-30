import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (...a: unknown[]) => void;
const event = () => {
  const ls: Listener[] = [];
  return { addListener: (l: Listener) => ls.push(l), fire: (...a: unknown[]) => ls.forEach((l) => l(...a)) };
};

class FakePort {
  onMessage = event();
  onDisconnect = event();
  posted: Array<Record<string, unknown>> = [];
  /** How the fake host reacts to a posted message. */
  behavior: (m: Record<string, unknown>, p: FakePort) => void = (m, p) => queueMicrotask(() => p.onMessage.fire({ id: m.id, ok: true, echo: m }));
  postMessage(m: Record<string, unknown>) {
    this.posted.push(m);
    this.behavior(m, this);
  }
  disconnect() {}
  die(message: string) {
    (this as unknown as { error: { message: string } }).error = { message };
    this.onDisconnect.fire(this);
  }
}

let ports: FakePort[] = [];
let nextBehavior: FakePort['behavior'] | null = null;
const chromeMock = {
  runtime: {
    lastError: undefined as undefined | { message: string },
    connectNative: vi.fn(() => {
      const p = new FakePort();
      if (nextBehavior) p.behavior = nextBehavior;
      ports.push(p);
      return p;
    }),
    sendNativeMessage: vi.fn(async (_h: string, m: Record<string, unknown>) => ({ id: m.id, ok: true, oneShot: true })),
  },
};
(globalThis as unknown as { chrome: unknown }).chrome = chromeMock;

const { NativeClient } = await import('../src/background/native');

beforeEach(() => {
  ports = [];
  nextBehavior = null;
  chromeMock.runtime.connectNative.mockClear();
  chromeMock.runtime.sendNativeMessage.mockClear();
});

describe('NativeClient', () => {
  it('sends an envelope with id/type/noLaunch over one long-lived port and correlates replies', async () => {
    const c = new NativeClient('dev.prism.host');
    const [a, b] = await Promise.all([
      c.request({ type: 'status' }, { noLaunch: true }),
      c.request({ type: 'open', page: 'main' }),
    ]);
    expect(chromeMock.runtime.connectNative).toHaveBeenCalledTimes(1);
    expect(chromeMock.runtime.connectNative).toHaveBeenCalledWith('dev.prism.host');
    const [m1, m2] = ports[0]!.posted;
    expect(m1).toMatchObject({ type: 'status', noLaunch: true });
    expect(typeof m1!.id).toBe('string');
    expect(m2).toMatchObject({ type: 'open', page: 'main' });
    expect(m2!.noLaunch).toBeUndefined();
    expect((a as unknown as { echo: unknown }).echo).toEqual(m1);
    expect((b as unknown as { echo: unknown }).echo).toEqual(m2);
  });

  it('turns {ok:false} replies into NativeError with the app code', async () => {
    nextBehavior = (m, p) => queueMicrotask(() => p.onMessage.fire({ id: m.id, ok: false, error: { code: 'app_not_running', message: 'nope' } }));
    const c = new NativeClient();
    const seen: string[] = [];
    c.onResult((ok, err) => seen.push(ok ? 'ok' : err!.code));
    await expect(c.request({ type: 'status' })).rejects.toMatchObject({ code: 'app_not_running', message: 'nope' });
    expect(seen).toEqual(['app_not_running']);
  });

  it('reports a missing host and fails fast afterwards (no process spawn loop)', async () => {
    nextBehavior = (_m, p) => queueMicrotask(() => p.die('Specified native messaging host not found.'));
    const c = new NativeClient();
    await expect(c.request({ type: 'status' })).rejects.toMatchObject({ code: 'host_missing' });
    await expect(c.request({ type: 'status' })).rejects.toMatchObject({ code: 'host_missing' });
    expect(chromeMock.runtime.connectNative).toHaveBeenCalledTimes(1);
    expect(chromeMock.runtime.sendNativeMessage).not.toHaveBeenCalled();
  });

  it('explicit retry clears missing-host backoff and opens a fresh native port', async () => {
    nextBehavior = (_m, p) => queueMicrotask(() => p.die('Specified native messaging host not found.'));
    const c = new NativeClient();
    await expect(c.request({ type: 'status' })).rejects.toMatchObject({ code: 'host_missing' });
    c.retry();
    nextBehavior = null;
    await c.request({ type: 'hello', protocol: 1, version: '2.0.4', browser: 'chromium', userAgent: 'test' });
    expect(chromeMock.runtime.connectNative).toHaveBeenCalledTimes(2);
    expect(ports[1]!.posted[0]).toMatchObject({ type: 'hello' });
  });

  it('falls back to sendNativeMessage when the port dies mid-request, then reconnects', async () => {
    nextBehavior = (_m, p) => queueMicrotask(() => p.die('Native host has exited.'));
    const c = new NativeClient();
    const r = await c.request({ type: 'status' });
    expect((r as unknown as { oneShot: boolean }).oneShot).toBe(true);
    expect(chromeMock.runtime.sendNativeMessage).toHaveBeenCalledTimes(1);
    nextBehavior = null;
    await c.request({ type: 'status' });
    expect(chromeMock.runtime.connectNative).toHaveBeenCalledTimes(2);
  });

  it('times out', async () => {
    nextBehavior = () => {};
    const c = new NativeClient();
    await expect(c.request({ type: 'status' }, { timeoutMs: 30 })).rejects.toMatchObject({ code: 'timeout' });
  });
});
