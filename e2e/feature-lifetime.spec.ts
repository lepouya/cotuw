import { expect, test } from "./fixtures";
import { withoutApp } from "./prototype-helpers";

test("a setup error survives failing cleanup while all resources release", async ({
  page,
}) => {
  await withoutApp(page);
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path: string = "/src/ui/dom.ts";
    const { mountFeature } = (await import(
      path
    )) as typeof import("../src/ui/dom");
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
