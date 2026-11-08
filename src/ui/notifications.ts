import { createButton, createElement as el, mountFeature } from "./dom";
import type { MissionAlert } from "./mission-alerts";
import type { WorldPosition } from "../simulation/world";
import "./notifications.css";

const TOAST_MILLISECONDS = 6000;
const TOAST_LIMIT = 3;
const HISTORY_LIMIT = 30;

/**
 * Shows alerts as short-lived toasts over the world view and keeps them in the
 * alert history. Plain messages, such as save results, appear only as toasts.
 * Mounts both overlays in `root`; the caller places the returned `toggle`.
 */
export function createNotifications(root: HTMLElement) {
  return mountFeature(root, "", ({ lifetime, signal }) => {
    const toasts = el("div", {
      id: "notifications",
      class: "notifications",
      role: "status",
      "aria-live": "polite",
    });
    const history = el("ol", { id: "alert-history" });
    const historyPanel = el(
      "section",
      {
        id: "alert-history-panel",
        class: "alert-history",
        "aria-label": "Alert history",
        hidden: true,
      },
      el("h2", {}, "Alerts"),
      history,
    );
    const unread = el("span", { id: "alert-unread", class: "alert-unread" });
    const toggle = createButton("⚠ ", {
      id: "alert-toggle",
      "aria-expanded": "false",
      "aria-controls": historyPanel.id,
    });
    toggle.append(unread);
    root.append(historyPanel, toasts);
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
    toggle.addEventListener("click", () => setOpen(!!historyPanel.hidden), {
      signal,
    });
    /** A button that shows the alert's location, when it has one. */
    const entry = (alert: MissionAlert, tag: "div" | "li") => {
      const item = document.createElement(tag);
      item.className = `notification notification-${alert.priority}`;
      const content = document.createElement(
        alert.position ? "button" : "span",
      );
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
    /** Forgets the previous mission's alerts. */
    const clear = () => {
      for (const item of timers.keys()) removeToast(item);
      history.replaceChildren();
      focus = undefined;
      unreadCount = 0;
      setOpen(false);
    };
    lifetime.defer(() => {
      clear();
      toggle.remove();
    });
    setOpen(false);
    return {
      toggle,
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
      clear,
    };
  });
}
