import { expect, test } from "./fixtures";
import { withoutApp } from "./page-helpers";
import { WEBKIT } from "./tags";

test(
  "keyed rows keep keyboard focus when reordered",
  { tag: WEBKIT },
  async ({ page }) => {
    await withoutApp(page);
    await page.goto("/");
    const retained = await page.evaluate(async () => {
      const { createKeyedList } = await import("/src/ui/dom.ts");
      const root = document.createElement("div");
      document.body.append(root);
      const nodes = new Map<string, HTMLButtonElement>();
      const list = createKeyedList(
        root,
        (id: string) => id,
        (id) => {
          const node = document.createElement("button");
          node.textContent = id;
          nodes.set(id, node);
          return { node };
        },
      );
      list.update(["a", "b", "c"]);
      nodes.get("c")!.focus();
      list.update(["c", "a", "b"]);
      const retained = document.activeElement === nodes.get("c");
      root.remove();
      return retained;
    });
    expect(retained).toBe(true);
  },
);

test("a setup error survives failing cleanup while all resources release", async ({
  page,
}) => {
  await withoutApp(page);
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { mountFeature } = await import("/src/ui/dom.ts");
    const root = document.createElement("div");
    document.body.append(root);
    const setup = new Error("Setup failed");
    let clicks = 0;
    let released = false;
    let original = false;
    let failed = false;
    const cleanupErrors: string[] = [];
    const logError = console.error;
    console.error = (_message, fault: Error) =>
      cleanupErrors.push(fault.message);
    try {
      mountFeature(
        root,
        '<button id="work">Work</button>',
        ({ lifetime, signal }) => {
          document.addEventListener(
            "click",
            () => {
              clicks++;
            },
            { signal },
          );
          lifetime.defer(() => {
            released = true;
          });
          lifetime.defer(() => {
            throw new Error("Cleanup failed");
          });
          throw setup;
        },
      );
    } catch (error) {
      failed = true;
      original = error === setup;
    } finally {
      console.error = logError;
    }
    document.dispatchEvent(new Event("click"));
    const children = root.childElementCount;
    root.remove();
    return { failed, original, released, clicks, children, cleanupErrors };
  });
  expect(result).toEqual({
    failed: true,
    original: true,
    released: true,
    clicks: 0,
    children: 0,
    cleanupErrors: ["Cleanup failed"],
  });
});
