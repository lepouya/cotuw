import { afterEach, expect, test, vi } from "vitest";
import { createNotifications } from "../src/ui/notifications";

class ElementStub extends EventTarget {
  children: ElementStub[] = [];
  parent?: ElementStub;
  hidden = false;
  className = "";
  textContent = "";
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  classList = {
    contains: (value: string) => this.className.split(" ").includes(value),
  };
  get lastElementChild() {
    return this.children[this.children.length - 1];
  }
  append(...items: ElementStub[]) {
    this.children.push(...items);
    for (const item of items) item.parent = this;
  }
  prepend(...items: ElementStub[]) {
    this.children.unshift(...items);
    for (const item of items) item.parent = this;
  }
  remove() {
    if (this.parent)
      this.parent.children = this.parent.children.filter(
        (item) => item !== this,
      );
    this.parent = undefined;
  }
  replaceChildren() {
    for (const item of this.children) item.remove();
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  click() {
    this.dispatchEvent(new Event("click"));
  }
}
class ButtonStub extends ElementStub {}

function fixture() {
  vi.useFakeTimers();
  vi.stubGlobal("HTMLButtonElement", ButtonStub);
  vi.stubGlobal("document", {
    createElement: (tag: string) =>
      tag === "button" ? new ButtonStub() : new ElementStub(),
  });
  const elements = new Map(
    [
      "notifications",
      "alert-history",
      "alert-history-panel",
      "alert-toggle",
      "alert-unread",
    ].map((id) => [`#${id}`, new ElementStub()]),
  );
  const notifications = createNotifications({
    querySelector: (id: string) => elements.get(id),
  } as unknown as ParentNode);
  return { notifications, element: (id: string) => elements.get(`#${id}`)! };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("history and unread counts stay bounded while toast timers track live entries", () => {
  const { notifications, element } = fixture();
  for (let i = 0; i < 35; i++)
    notifications.alert({ priority: "normal", text: `Ready ${i}` }, "0:00");
  expect(element("alert-history").children).toHaveLength(30);
  expect(element("alert-unread").textContent).toBe("30");
  expect(element("notifications").children).toHaveLength(3);
  expect(vi.getTimerCount()).toBe(3);
  element("alert-toggle").click();
  notifications.alert({ priority: "normal", text: "Seen" }, "0:01");
  expect(element("alert-unread").textContent).toBe("");
  vi.advanceTimersByTime(6000);
  expect(element("notifications").children).toHaveLength(0);
  expect(element("alert-history").children).toHaveLength(30);
  notifications.clear();
});

test("routine toasts do not hide active danger alerts", () => {
  const { notifications, element } = fixture();
  notifications.alert({ priority: "high", text: "Base under attack" }, "0:00");
  for (let i = 0; i < 5; i++) notifications.message(`Ready ${i}`);
  expect(
    element("notifications").children.some((item) =>
      item.children[0]?.textContent.includes("Base under attack"),
    ),
  ).toBe(true);
  notifications.clear();
});

test("clearing a mission releases timers and its camera callback", () => {
  const { notifications, element } = fixture();
  const focus = vi.fn();
  const alert = {
    priority: "high" as const,
    text: "Under attack",
    position: { x: 1, z: 2 },
  };
  notifications.setFocus(focus);
  notifications.alert(alert, "0:00");
  element("notifications").children[0]!.children[0]!.click();
  expect(focus).toHaveBeenCalledWith(alert.position);
  notifications.clear();
  expect(vi.getTimerCount()).toBe(0);
  expect(element("alert-history").children).toHaveLength(0);
  expect(element("alert-toggle").attributes.get("aria-expanded")).toBe("false");
  notifications.alert(alert, "0:01");
  element("notifications").children[0]!.children[0]!.click();
  expect(focus).toHaveBeenCalledTimes(1);
  notifications.clear();
});
