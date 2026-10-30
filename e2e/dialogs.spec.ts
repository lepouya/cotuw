import { expect, test } from "./fixtures";
import { withoutApp } from "./prototype-helpers";
import { WEBKIT } from "./tags";

import type { Page } from "@playwright/test";
import type { createDialogs, MenuView } from "../src/ui/dialogs";

type DialogHarness = {
  ui: ReturnType<typeof createDialogs>;
  options: Parameters<typeof createDialogs>[1];
  host: HTMLElement;
  view: MenuView;
  state: {
    playing: boolean;
    resumes: number;
    dismissals: string[];
    notifications: string[];
    cancellations: number;
    saves: number;
    unlocks: number;
    settings: number;
    subscriptions: number;
  };
  finishSave: (fail?: boolean) => void;
  finishList: (fail?: boolean) => void;
};
declare global {
  interface Window {
    dialogHarness: DialogHarness;
  }
}

async function mountDialogs(page: Page) {
  await withoutApp(page);
  await page.goto("/");
  await page.evaluate(async () => {
    const path: string = "/src/ui/dialogs.ts";
    const { createDialogs } = (await import(
      path
    )) as typeof import("../src/ui/dialogs");
    const state: DialogHarness["state"] = {
      playing: true,
      resumes: 0,
      dismissals: [],
      notifications: [],
      cancellations: 0,
      saves: 0,
      unlocks: 0,
      settings: 0,
      subscriptions: 0,
    };
    const mission = {
      playing: () => state.playing,
      pause: () => {
        state.playing = false;
      },
      resume: () => {
        state.resumes++;
        state.playing = true;
      },
      dismissPopup: (id: string) => {
        state.dismissals.push(id);
      },
    };
    const options: DialogHarness["options"] = {
      version: "test",
      audio: {
        setSettings: () => {
          state.settings++;
        },
        unlock: async () => {
          state.unlocks++;
        },
        onStatus: (listener) => {
          state.subscriptions++;
          listener("waiting");
          return () => {
            state.subscriptions--;
          };
        },
      },
      mission: () => mission,
      focusWorld: () => document.getElementById("game-canvas")!.focus(),
      notify: (message) => {
        state.notifications.push(message);
      },
      cancelLoad: () => {
        state.cancellations++;
      },
      start: () => {},
      restart: () => {},
      showTitle: () => {},
      exitToTitle: async () => {},
      quit: async () => {},
      listSaves: async () => [],
      removeSave: async () => {},
      load: async () => {},
      export: async () => undefined,
      save: () => {
        state.saves++;
        return new Promise<boolean>((resolve, reject) => {
          window.dialogHarness.finishSave = (fail) => {
            if (fail) reject(new Error("Save rejected"));
            else resolve(true);
          };
        });
      },
    };
    const host = document.getElementById("game-dialogs")!;
    const ui = createDialogs(host, options);
    const view: MenuView = {
      mode: "menu",
      title: "Paused",
      description: "Test mission",
      continueLabel: "Resume",
      mission: { saveName: "Test save", canSave: true, canRestart: true },
    };
    window.dialogHarness = {
      ui,
      options,
      host,
      view,
      state,
      finishSave: () => {},
      finishList: () => {},
    };
    document.getElementById("game-canvas")!.focus();
    ui.showMenu(view);
  });
}

test(
  "panel feedback clears when leaving a failed operation",
  { tag: WEBKIT },
  async ({ page }) => {
    await mountDialogs(page);
    await page.locator("#save-mission").click();
    await page.locator("#confirm-save").click();
    await page.evaluate(() => window.dialogHarness.finishSave(true));
    await expect(page.locator("#game-menu-status")).toHaveText("Save rejected");
    await page.locator("#cancel-save").click();
    await expect(page.locator("#game-menu-status")).toHaveText("");
  },
);

test(
  "listing saved missions reports waiting and failure without stale content",
  { tag: WEBKIT },
  async ({ page }) => {
    await mountDialogs(page);
    await page.evaluate(() => {
      const h = window.dialogHarness;
      h.options.listSaves = () =>
        new Promise((resolve, reject) => {
          h.finishList = (fail) => {
            if (fail) reject(new Error("Listing failed"));
            else resolve([]);
          };
        });
    });
    await page.locator("#load-mission").click();
    await expect(page.locator("#save-entries")).toContainText(
      "Loading saved missions",
    );
    await page.evaluate(() => window.dialogHarness.finishList(true));
    await expect(page.locator("#game-menu-status")).toHaveText(
      "Listing failed",
    );
    await expect(page.locator("#save-entries")).toBeEmpty();
  },
);

for (const fail of [false, true]) {
  test(
    `a late ${fail ? "failed" : "successful"} save cannot change a different panel`,
    { tag: WEBKIT },
    async ({ page }) => {
      await mountDialogs(page);
      await page.locator("#save-mission").click();
      await page.locator("#confirm-save").click();
      await expect(page.locator("#confirm-save")).toBeDisabled();
      await expect(page.locator("#cancel-save")).toBeEnabled();
      await page.locator("#cancel-save").click();
      await page.locator("#load-mission").click();
      await expect(page.locator("#save-entries")).toHaveText(
        "No saved missions yet.",
      );
      await page.evaluate(
        (fail) => window.dialogHarness.finishSave(fail),
        fail,
      );
      await expect(page.locator("#load-panel")).toBeVisible();
      await expect(page.locator("#game-menu-status")).toHaveText("");
      expect(
        await page.evaluate(() => window.dialogHarness.state.notifications),
      ).toEqual([]);
    },
  );
}

test(
  "busy updates preserve form values and action restrictions",
  { tag: WEBKIT },
  async ({ page }) => {
    await mountDialogs(page);
    await page.locator("#save-mission").click();
    await page.locator("#save-name").fill("My name survives");
    await page.evaluate(() => {
      const { ui } = window.dialogHarness;
      ui.setBusy(true);
      ui.setBusy(false);
    });
    await expect(page.locator("#save-name")).toHaveValue("My name survives");
    await expect(page.locator("#save-name")).toBeFocused();
    await page.evaluate(() => {
      const { ui, view } = window.dialogHarness;
      ui.showMenu({
        ...view,
        mode: "defeat",
        continueLabel: undefined,
        mission: { ...view.mission!, canSave: false, canRestart: false },
      });
      ui.setBusy(true);
      ui.setBusy(false);
    });
    for (const id of [
      "resume-mission",
      "save-mission",
      "quicksave-mission",
      "restart-mission",
    ])
      await expect(page.locator(`#${id}`)).toBeDisabled();
    await expect(page.locator("#load-mission")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("#game-menu")).toBeVisible();
  },
);

test(
  "results preempt guides without dismissing them or resuming the mission",
  { tag: WEBKIT },
  async ({ page }) => {
    await mountDialogs(page);
    await page.locator("#resume-mission").click();
    await page.evaluate(() => {
      const { ui, view } = window.dialogHarness;
      ui.offerGuide({
        id: "guide",
        title: "Guide",
        text: "Instructions",
        trigger: { kind: "actor", definitionId: "worker" },
      });
      ui.showMenu({
        ...view,
        mode: "victory",
        title: "Victory",
        continueLabel: "Continue free play",
      });
      document.getElementById("dismiss-explanation")!.click();
    });
    await expect(page.locator("dialog[open]")).toHaveCount(1);
    await expect(page.locator("#explanation")).toBeHidden();
    expect(await page.evaluate(() => window.dialogHarness.state)).toMatchObject(
      { playing: false, resumes: 1, dismissals: [] },
    );
    await page.locator("#resume-mission").click();
    await expect(page.locator("#explanation")).toBeVisible();
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => window.dialogHarness.state)).toMatchObject(
      { playing: true, resumes: 3, dismissals: ["guide"] },
    );
  },
);

test(
  "reset and disposal preserve audio ownership and suppress late work",
  { tag: WEBKIT },
  async ({ page }) => {
    await mountDialogs(page);
    await page.locator("#save-mission").click();
    await page.locator("#confirm-save").click();
    const reset = await page.evaluate(async () => {
      const h = window.dialogHarness;
      const audio = h.host.querySelector("#audio-controls");
      h.ui.resetMission();
      h.ui.showMenu(h.view);
      const sameAudio = audio === h.host.querySelector("#audio-controls");
      const beforeDispose = h.state.cancellations;
      h.ui.dispose();
      const afterDispose = h.state.cancellations;
      h.ui.dispose();
      const canceledOnce =
        afterDispose === beforeDispose + 1 &&
        h.state.cancellations === afterDispose;
      const empty = h.host.childElementCount === 0;
      const path: string = "/src/ui/dialogs.ts";
      const { createDialogs } = (await import(
        path
      )) as typeof import("../src/ui/dialogs");
      h.ui = createDialogs(h.host, h.options);
      h.ui.showMenu(h.view);
      h.finishSave(true);
      return {
        sameAudio,
        empty,
        canceledOnce,
        subscriptions: h.state.subscriptions,
      };
    });
    expect(reset).toEqual({
      sameAudio: true,
      empty: true,
      canceledOnce: true,
      subscriptions: 1,
    });
    await expect(page.locator("#game-menu-status")).toHaveText("");
    const before = await page.evaluate(
      () => window.dialogHarness.state.unlocks,
    );
    await page.locator("#audio-sound-mute").click();
    expect(await page.evaluate(() => window.dialogHarness.state.unlocks)).toBe(
      before + 1,
    );
    expect(await page.evaluate(() => window.dialogHarness.state.settings)).toBe(
      3,
    );
    expect(await page.evaluate(() => window.dialogHarness.state.resumes)).toBe(
      0,
    );
  },
);

test(
  "partial audio setup releases global listeners and owned markup",
  { tag: WEBKIT },
  async ({ page }) => {
    await mountDialogs(page);
    const result = await page.evaluate(async () => {
      const h = window.dialogHarness;
      h.ui.dispose();
      const path: string = "/src/ui/dialogs.ts";
      const { createDialogs } = (await import(
        path
      )) as typeof import("../src/ui/dialogs");
      let error = "";
      try {
        createDialogs(h.host, {
          ...h.options,
          audio: {
            ...h.options.audio,
            onStatus: () => {
              throw new Error("Status subscription failed");
            },
          },
        });
      } catch (fault) {
        error = (fault as Error).message;
      }
      return { error, children: h.host.childElementCount };
    });
    expect(result).toEqual({
      error: "Status subscription failed",
      children: 0,
    });
    const before = await page.evaluate(
      () => window.dialogHarness.state.unlocks,
    );
    await page.keyboard.press("Space");
    expect(await page.evaluate(() => window.dialogHarness.state.unlocks)).toBe(
      before,
    );
  },
);

test(
  "continuing play leads the menu and audio settings stay with its actions",
  { tag: WEBKIT },
  async ({ page }) => {
    await mountDialogs(page);
    const audio = page.locator("#menu-audio");
    await expect(audio).toBeVisible();
    for (const [open, back] of [
      ["save-mission", "cancel-save"],
      ["load-mission", "cancel-load"],
    ]) {
      await page.locator(`#${open}`).click();
      await expect(audio).toBeHidden();
      await page.locator(`#${back}`).click();
      await expect(audio).toBeVisible();
    }
    await page.evaluate(() => {
      const { ui, view } = window.dialogHarness;
      ui.resetMission();
      ui.showMenu({ ...view, mode: "loaded", title: "Mission loaded" });
    });
    const resume = page.locator("#resume-mission");
    await expect(resume).toBeFocused();
    await expect(resume).toHaveClass(/primary-action/);
    const width = async (id: string) =>
      (await page.locator(`#${id}`).boundingBox())!.width;
    expect(await width("exit-mission")).toBeCloseTo(
      await width("save-mission"),
      0,
    );
    expect(await width("resume-mission")).toBeGreaterThan(
      2 * (await width("exit-mission")),
    );
  },
);
