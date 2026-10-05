import type { MissionAlert } from "./mission-alerts";
import type { WorldPosition } from "../simulation/world";

const TOAST_MILLISECONDS = 6000;
const TOAST_LIMIT = 3;
const HISTORY_LIMIT = 30;

/**
 * Shows alerts as short-lived toasts over the world view and keeps them in the
 * alert history. Plain messages, such as save results, appear only as toasts.
 */
export function createNotifications(root: ParentNode) {
  const element = <T extends HTMLElement>(id: string) =>
    root.querySelector<T>(`#${id}`)!;
  const toasts = element("notifications");
  const history = element("alert-history");
  const historyPanel = element("alert-history-panel");
  const toggle = element<HTMLButtonElement>("alert-toggle");
  const unread = element("alert-unread");
  let focus: ((position: WorldPosition) => void) | undefined;
  let unreadCount = 0;
  const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  const removeToast = (item: HTMLElement) => {
    clearTimeout(timers.get(item));
    timers.delete(item);
    item.remove();
  };
  const showUnread = () => {
    unread.textContent = unreadCount ? String(unreadCount) : "";
    toggle.dataset.unread = String(unreadCount);
    toggle.setAttribute(
      "aria-label",
      unreadCount ? `Alerts, ${unreadCount} unread` : "Alerts",
    );
  };
  const setOpen = (open: boolean) => {
    historyPanel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) unreadCount = 0;
    showUnread();
  };
  toggle.addEventListener("click", () => setOpen(!!historyPanel.hidden));
  /** A button that shows the alert's location, when it has one. */
  const entry = (alert: MissionAlert, tag: "div" | "li") => {
    const item = document.createElement(tag);
    item.className = `notification notification-${alert.priority}`;
    const content = document.createElement(alert.position ? "button" : "span");
    // Shape as well as color marks priority.
    content.textContent = `${alert.priority === "high" ? "⚠" : "•"} ${alert.text}`;
    if (content instanceof HTMLButtonElement) {
      content.type = "button";
      content.title = "Show on map";
      content.addEventListener("click", () => focus?.(alert.position!));
    }
    item.append(content);
    return item;
  };
  const toast = (alert: MissionAlert) => {
    const item = entry(alert, "div");
    toasts.prepend(item);
    timers.set(
      item,
      setTimeout(() => removeToast(item), TOAST_MILLISECONDS),
    );
    while (toasts.children.length > TOAST_LIMIT) {
      // Routine messages must not crowd out an active danger alert.
      const oldestNormal = [...toasts.children]
        .reverse()
        .find((item) => item.classList.contains("notification-normal"));
      removeToast((oldestNormal ?? toasts.lastElementChild) as HTMLElement);
    }
  };
  setOpen(false);
  return {
    /** Points Show on map at the current mission's camera. */
    setFocus: (next?: (position: WorldPosition) => void) => {
      focus = next;
    },
    alert: (alert: MissionAlert, time: string) => {
      toast(alert);
      const item = entry(alert, "li");
      const stamp = document.createElement("small");
      stamp.textContent = time;
      item.prepend(stamp);
      history.prepend(item);
      while (history.children.length > HISTORY_LIMIT)
        history.lastElementChild!.remove();
      if (historyPanel.hidden) {
        unreadCount = Math.min(unreadCount + 1, HISTORY_LIMIT);
        showUnread();
      }
    },
    message: (text: string) => toast({ priority: "normal", text }),
    /** Forgets the previous mission's alerts. */
    clear: () => {
      for (const item of timers.keys()) removeToast(item);
      history.replaceChildren();
      focus = undefined;
      unreadCount = 0;
      setOpen(false);
    },
  };
}
