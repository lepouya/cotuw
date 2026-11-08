import { beforeEach, expect, test, vi } from "vitest";

import { createApplication } from "../src/application";
import { LEVEL_SOURCES } from "../src/content/levels";
import {
  assembleSkirmish,
  createSessionSimulation,
} from "../src/mission-loading";
import { createPlatform } from "../src/platform";
import { createGameSession } from "../src/session";
import { serializeMission } from "../src/simulation/mission-file";
import { createSidebar } from "../src/ui/sidebar";

import type { ApplicationOptions } from "../src/application";
import type { Platform } from "../src/platform";
import type { GameSession, GameSessionControls } from "../src/session";
import type { SaveInfo } from "../src/simulation/mission-file";

vi.mock("../src/platform", () => ({ createPlatform: vi.fn() }));
vi.mock("../src/session", () => ({ createGameSession: vi.fn() }));
vi.mock("../src/ui/sidebar", () => ({ createSidebar: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createSidebar).mockImplementation(
    () =>
      ({
        controls: {},
        update: vi.fn(),
        showActor: vi.fn(),
        showGoals: vi.fn(),
        dispose: vi.fn(),
      }) as unknown as ReturnType<typeof createSidebar>,
  );
  vi.mocked(createGameSession).mockImplementation(
    async (_canvas, _minimap, controls) => {
      const simulation = createSessionSimulation(controls.mission);
      const session = {
        simulation,
        playing: () => false,
        speed: () => 1,
        faulted: () => false,
        focus: vi.fn(),
        save: (info: SaveInfo) =>
          serializeMission(
            controls.mission.scenario,
            simulation.snapshot(),
            simulation.tickSeconds,
            { save: info },
          ),
        disposeAsync: vi.fn(async () => {
          simulation.dispose();
          controls.onDispose?.();
        }),
      } as unknown as GameSession;
      controls.onReady?.(session);
      return session;
    },
  );
});

async function application() {
  const files = new Map<string, string>();
  const platform: Platform = {
    saves: {
      list: async () => [...files.keys()],
      read: async (id) => files.get(id)!,
      write: vi.fn(async (id, source) => {
        files.set(id, source);
      }),
      remove: async (id) => {
        files.delete(id);
      },
    },
    importFile: vi.fn(async () => LEVEL_SOURCES.get("arc-economy-opening")),
    exportFile: vi.fn(async () => true),
    exit: vi.fn(async () => false),
  };
  vi.mocked(createPlatform).mockResolvedValue(platform);
  const notifications: { focus?: GameSession["focus"] } = {};
  const ui: ApplicationOptions["dialogs"] = {
    showMenu: vi.fn(),
    offerGuide: vi.fn(),
    report: vi.fn(),
    setBusy: vi.fn(),
    resetMission: vi.fn(),
  };
  const app = createApplication({
    canvas: { dataset: {} } as HTMLCanvasElement,
    minimap: {} as HTMLCanvasElement,
    audio: {} as ApplicationOptions["audio"],
    roots: {} as ApplicationOptions["roots"],
    dialogs: ui,
    notifications: {
      alert: vi.fn(),
      clear: vi.fn(() => {
        notifications.focus = undefined;
      }),
      setFocus: vi.fn((focus) => {
        notifications.focus = focus;
      }),
    },
    topBar: { update: vi.fn() },
    setTitleScreen: vi.fn(),
  });
  await app.initialize({});
  await app.load();
  const session = app.session()!;
  return { app, platform, ui, session, files, notifications };
}

test.each([false, true])(
  "departing missions suppress save feedback during teardown (failure: %s)",
  async (fail) => {
    const { app, platform, ui, session } = await application();
    const writing = deferred<void>();
    const disposing = deferred<void>();
    vi.mocked(platform.saves.write).mockReturnValue(writing.promise);
    const dispose = vi.mocked(session.disposeAsync).getMockImplementation()!;
    vi.mocked(session.disposeAsync).mockImplementation(async () => {
      await disposing.promise;
      await dispose();
    });
    const save = app.quicksave();
    const leaving = app.returnToTitle();
    try {
      if (fail) writing.reject(new Error("Disk full"));
      else writing.resolve();
      await save;
      expect(ui.report).not.toHaveBeenCalled();
    } finally {
      disposing.resolve();
      await leaving;
    }
    expect(app.session()).toBeUndefined();
  },
);

test("startup failure clears mission callbacks and notification focus", async () => {
  const { app, platform, ui, notifications } = await application();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const create = vi.mocked(createGameSession).getMockImplementation()!;
  let failedControls!: GameSessionControls;
  vi.mocked(createGameSession).mockImplementationOnce(async (...args) => {
    failedControls = args[2];
    const session = await create(...args);
    // Match a session that cleans up its partial assembly before rejecting.
    await session.disposeAsync();
    throw new Error("Startup failed");
  });
  vi.mocked(platform.importFile).mockResolvedValue(
    LEVEL_SOURCES.get("circle-wolf-den"),
  );
  try {
    await app.load();
    expect(app.session()).toBeUndefined();
    expect(notifications.focus).toBeUndefined();
    const popup = {
      id: "late",
      title: "Late guide",
      text: "Departed mission",
      trigger: { kind: "actor", definitionId: "cultivator" },
    } as const;
    failedControls.onPopup?.(popup);
    expect(ui.offerGuide).not.toHaveBeenCalled();
    expect(ui.showMenu).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: "home" }),
    );
  } finally {
    consoleError.mockRestore();
  }
});

test("invalid loads keep the active session", async () => {
  const { app, platform, session, ui } = await application();
  vi.mocked(platform.importFile).mockResolvedValue("{");
  await expect(app.load()).rejects.toThrow("not valid JSON");
  expect(app.session()).toBe(session);
  expect(session.disposeAsync).not.toHaveBeenCalled();
  expect(ui.showMenu).toHaveBeenLastCalledWith(
    expect.objectContaining({ mode: "loaded" }),
  );
  await app.returnToTitle();
});

test("an incompatible quickload preserves the stored file and active mission", async () => {
  const { app, session, files } = await application();
  const file = JSON.parse(LEVEL_SOURCES.get("arc-economy-opening")!);
  file.version = 1;
  const source = JSON.stringify(file);
  files.set("quicksave", source);
  await expect(app.quickload()).rejects.toThrow("uses version 1;");
  expect(app.session()).toBe(session);
  expect(session.disposeAsync).not.toHaveBeenCalled();
  expect(files.get("quicksave")).toBe(source);
  await app.returnToTitle();
});

test("a dialog reset failure still releases the departing session", async () => {
  const { app, session, ui, notifications } = await application();
  vi.mocked(ui.resetMission).mockImplementationOnce(() => {
    throw new Error("Dialog reset failed");
  });
  await app.returnToTitle();
  expect(session.disposeAsync).toHaveBeenCalledOnce();
  expect(app.session()).toBeUndefined();
  expect(notifications.focus).toBeUndefined();
  expect(ui.showMenu).toHaveBeenLastCalledWith(
    expect.objectContaining({ mode: "home" }),
  );
  expect(ui.report).toHaveBeenLastCalledWith(
    "Mission cleanup failed: Dialog reset failed",
  );
});

const launched = () =>
  vi.mocked(createGameSession).mock.lastCall![2].mission.scenario;

test("restarting keeps the chosen introduction difficulty", async () => {
  const { app } = await application();
  app.startFaction("circle", "hard");
  await vi.waitFor(() => expect(launched().id).toBe("circle-wolf-den"));
  expect(launched().setup).toMatchObject({
    difficulty: "hard",
    enemyOwners: ["wildlife"],
  });
  vi.mocked(createGameSession).mockClear();
  app.restart();
  await vi.waitFor(() => expect(createGameSession).toHaveBeenCalled());
  expect(launched().setup?.difficulty).toBe("hard");
});

test("skirmishes restart from their setup, including after a load", async () => {
  const { app, ui, files } = await application();
  const choice = {
    factions: { west: "circle", east: "arc" },
    playerSlot: "east",
    difficulty: "easy",
  } as const;
  await app.initialize({ skirmish: choice });
  await vi.waitFor(() => expect(launched().id).toBe("skirmish"));
  const setup = launched().setup;
  expect(await app.save("manual", "Opening")).toBe(true);
  const [saved] = [...files.keys()];
  await app.load(saved);
  await vi.waitFor(() =>
    expect(vi.mocked(ui.showMenu).mock.lastCall![0].mission?.canRestart).toBe(
      true,
    ),
  );
  vi.mocked(createGameSession).mockClear();
  app.restart();
  await vi.waitFor(() => expect(createGameSession).toHaveBeenCalled());
  expect(launched().setup).toEqual(setup);
  expect(
    vi.mocked(createGameSession).mock.lastCall![2].mission.state.playerOwner,
  ).toBe("east");
});

test("a skirmish link with an unknown faction reports it at the title", async () => {
  const { app, ui } = await application();
  await app.initialize({
    skirmish: {
      factions: { west: "arc", east: "pirates" },
      playerSlot: "west",
      difficulty: "normal",
    },
  });
  expect(ui.report).toHaveBeenLastCalledWith(
    "The level could not start: Start slot east has no playable faction.",
  );
});

test("an imported skirmish level remains its restart source after loading a save", async () => {
  const { app, platform, files } = await application();
  const imported = assembleSkirmish({
    factions: { west: "circle", east: "arc" },
    playerSlot: "west",
    difficulty: "hard",
  });
  imported.scenario = { ...imported.scenario, name: "Custom battlefield" };
  imported.state.economy!.stockpiles[0].amount = 321;
  vi.mocked(platform.importFile).mockResolvedValue(
    serializeMission(imported.scenario, imported.state, 1 / 60),
  );
  await app.load();
  app.session()!.simulation.tick();
  expect(await app.save("manual", "Custom opening")).toBe(true);
  const saved = [...files].find(([, source]) =>
    source.includes('"Custom opening"'),
  )![0];
  await app.load(saved);
  vi.mocked(createGameSession).mockClear();
  app.restart();
  await vi.waitFor(() => expect(createGameSession).toHaveBeenCalled());
  const restarted = vi.mocked(createGameSession).mock.lastCall![2].mission;
  expect(restarted.scenario.name).toBe("Custom battlefield");
  expect(restarted.scenario.setup).toEqual(imported.scenario.setup);
  expect(restarted.state.tick).toBe(0);
  expect(restarted.state.economy!.stockpiles[0].amount).toBe(321);

  await app.initialize({
    skirmish: {
      factions: { west: "circle", east: "arc" },
      playerSlot: "west",
      difficulty: "easy",
    },
  });
  await vi.waitFor(() => expect(launched().name).toBe("Skirmish"));
  vi.mocked(createGameSession).mockClear();
  app.restart();
  await vi.waitFor(() => expect(createGameSession).toHaveBeenCalled());
  expect(launched().name).toBe("Skirmish");
  expect(launched().setup?.difficulty).toBe("easy");
});

test.each(["custom-skirmish", "skirmish"])(
  "a %s save with custom slots needs a registered level to offer restart",
  async (id) => {
    const { app, platform, ui } = await application();
    const custom = assembleSkirmish({
      factions: { west: "arc", east: "circle" },
      playerSlot: "west",
      difficulty: "easy",
    });
    custom.scenario = { ...custom.scenario, id };
    custom.state.scenarioId = custom.scenario.id;
    vi.mocked(platform.importFile).mockResolvedValue(
      serializeMission(custom.scenario, custom.state, 1 / 60, {
        save: { name: "Custom save", savedAt: "2026-11-06T00:00:00.000Z" },
      })
        .replace(/"west"/g, '"north"')
        .replace(/"east"/g, '"south"'),
    );
    await app.load();
    expect(vi.mocked(ui.showMenu).mock.lastCall![0].mission?.canRestart).toBe(
      false,
    );
    vi.mocked(createGameSession).mockClear();
    app.restart();
    expect(createGameSession).not.toHaveBeenCalled();
  },
);

test("a registered level restarts at a save's difficulty whatever its player", async () => {
  const { app, platform, files } = await application();
  await app.initialize({
    skirmish: {
      factions: { west: "arc", east: "circle" },
      playerSlot: "east",
      difficulty: "easy",
    },
  });
  await vi.waitFor(() => expect(launched().name).toBe("Skirmish"));
  expect(await app.save("manual", "From east")).toBe(true);
  const saved = [...files].find(([, source]) =>
    source.includes('"From east"'),
  )![0];
  const level = assembleSkirmish({
    factions: { west: "arc", east: "circle" },
    playerSlot: "west",
    difficulty: "hard",
  });
  vi.mocked(platform.importFile).mockResolvedValue(
    serializeMission(level.scenario, level.state, 1 / 60),
  );
  await app.load();
  await app.load(saved);
  vi.mocked(createGameSession).mockClear();
  app.restart();
  await vi.waitFor(() => expect(createGameSession).toHaveBeenCalled());
  const { scenario, state } =
    vi.mocked(createGameSession).mock.lastCall![2].mission;
  expect(state.playerOwner).toBe("west");
  expect(scenario.setup).toMatchObject({
    difficulty: "easy",
    enemyOwners: ["east"],
  });
});

const shownDescription = (ui: ApplicationOptions["dialogs"]) =>
  vi.mocked(ui.showMenu).mock.lastCall![0].description;

test("pause, loaded, and result menus name the difficulty", async () => {
  const { app, ui, files } = await application();
  app.startFaction("circle", "hard");
  await vi.waitFor(() => expect(launched().setup?.difficulty).toBe("hard"));
  await vi.waitFor(() => expect(app.session()?.simulation).toBeDefined());
  app.openMenu();
  expect(shownDescription(ui)).toContain("Hard difficulty");
  expect(await app.save("manual", "Hard save")).toBe(true);
  const saved = [...files].find(([, source]) =>
    source.includes('"Hard save"'),
  )![0];
  await app.load(saved);
  await vi.waitFor(() =>
    expect(shownDescription(ui)).toContain("Inspect the saved mission"),
  );
  expect(shownDescription(ui)).toContain("Hard difficulty");
  vi.mocked(createGameSession).mock.lastCall![2].onResult?.({
    kind: "defeat",
    objectiveId: "protect-heartgrove",
    tick: 1,
  });
  expect(vi.mocked(ui.showMenu).mock.lastCall![0].title).toBe("Defeat");
  expect(shownDescription(ui)).toContain("Hard difficulty");
});

test("missions without launch choices name no difficulty", async () => {
  const { app, ui } = await application();
  app.openMenu();
  expect(shownDescription(ui)).not.toContain("difficulty");
});
