import { AnimatePresence, motion } from "motion/react";
import { Icon } from "../design/icons";
import { t } from "../lib/i18n";
import { useUi } from "../lib/ui";

const ICON = { info: "info", success: "status-completed", error: "status-error" } as const;

export function ToastHost() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className="toast-stack" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((item) => (
          <motion.div
            key={item.id}
            layout
            className={`toast glass-strong blur-md toast--${item.kind}`}
            role={item.kind === "error" ? "alert" : "status"}
            initial={{ opacity: 0, x: 18, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, transition: { duration: 0.16 } }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="toast__icon">
              <Icon name={ICON[item.kind]} size={16} />
            </span>
            <div className="toast__text">
              <div className="toast__title">{item.title}</div>
              {item.body && <div className="toast__body">{item.body}</div>}
            </div>
            {item.action && (
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => {
                  item.action?.run();
                  dismiss(item.id);
                }}
              >
                {item.action.label}
              </button>
            )}
            <button type="button" className="tb-btn toast__close" aria-label={t("Dismiss")} onClick={() => dismiss(item.id)}>
              <Icon name="close" size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
