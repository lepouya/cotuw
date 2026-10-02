import { expect, test } from "@playwright/test";

test("renders and toggles the prototype's multi-tile blocker", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.locator("#game-canvas");
  const toggle = page.locator("#toggle-blocker");
  await expect(canvas).toHaveAttribute("data-tile-placed-actor-ready", "true");
  await expect(canvas).toHaveAttribute("data-tile-placed-actor-count", "1");

  const objectDetails = () =>
    page.evaluate(async () => {
      const harnessPath: string = "/e2e/harness.ts";
      const { EngineStore } = await import(harnessPath);
      const scene = EngineStore.Instances[0].scenes[0];
      const root = scene.getTransformNodeByName(
        "tile-placed-actor-prototype-command-center-0-root",
      );
      return {
        tiles:
          root
            ?.getChildMeshes()
            .filter(({ name }: { name: string }) => name.includes("-tile-"))
            .length ?? 0,
      };
    });

  expect(await objectDetails()).toEqual({ tiles: 4 });
  await expect(toggle).toHaveText("Remove 2×2 blocker");

  await toggle.click();
  await expect(canvas).toHaveAttribute("data-tile-placed-actor-count", "0");
  await expect(canvas).toHaveAttribute(
    "data-tile-placed-actor-command",
    "accepted",
  );
  await expect(toggle).toHaveText("Place 2×2 blocker");

  await toggle.click();
  await expect(canvas).toHaveAttribute("data-tile-placed-actor-count", "1");
  await expect(toggle).toHaveText("Remove 2×2 blocker");
});
