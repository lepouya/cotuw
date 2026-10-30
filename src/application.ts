import { factionName } from "./content/content-pack";
import { LEVEL_SOURCES } from "./content/levels";
import { errorMessage } from "./errors";
import { loadMission, missionIncompatibility } from "./mission-loading";
import { createPlatform } from "./platform";
import { createSaveRules } from "./save-policy";
import { createSaveLibrary, saveCompleteMessage } from "./saves";
import { SIMULATION_TICK_SECONDS } from "./simulation/clock";
import { playerFactionOf } from "./simulation/ownership";
import { createSidebar } from "./ui/sidebar";
import { formatElapsed, topBarState } from "./ui/top-bar";

import type { AudioMixer } from "./audio/mixer";
import type { LoadedMission } from "./mission-loading";
import type { Platform } from "./platform";
import type { SaveRules } from "./save-policy";
import type { SaveKind, SaveLibrary } from "./saves";
import type { GameSession } from "./session";
import type { MissionResult } from "./simulation/objectives";
import type { createDialogs, MenuMode, MenuView } from "./ui/dialogs";
import type { createNotifications } from "./ui/notifications";
import type { createTopBar } from "./ui/top-bar";

/** Each menu's text; modes with a continue label offer continuing play. */
const MENU_VIEWS: Record<
  MenuMode,
  Pick<MenuView, "title" | "description" | "continueLabel">
> = {
  menu: { title: "Paused", description: "", continueLabel: "Resume" },
  defeat: {
    title: "Defeat",
    description: "A mandatory objective failed. The mission is paused.",
  },
  victory: {
    title: "Victory",
    description:
      "All victory objectives are complete. Continue exploring in free play, or restart the mission.",
    continueLabel: "Continue free play",
  },
  loaded: {
    title: "Mission loaded",
    description: "Inspect the saved mission, then resume when ready.",
    continueLabel: "Resume",
  },
  home: {
    title: "Citadels of the Unquiet World",
    description:
      "Choose your expedition, explore the frontier, and clear the wolves from the mountain den.",
  },
  quit: {
    title: "Thanks for playing",
    description: "You can close this browser tab when you’re ready.",
  },
};

const FACTION_LEVELS = {
  arc: "arc-economy-opening",
  circle: "circle-wolf-den",
} as const;

/** A file name made of the save name's letters, digits, and dashes. */
const fileNameFor = (name: string) =>
  `${name.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "mission"}.json`;

/** The application drives these features; it never queries their elements. */
export type ApplicationOptions = {
  canvas: HTMLCanvasElement;
  minimap: HTMLCanvasElement;
  audio: AudioMixer;
  /** Mission UI roots that each mission mounts its features into. */
  roots: { sidebar: HTMLElement; cameraControls: HTMLElement };
  dialogs: Pick<
    ReturnType<typeof createDialogs>,
    "showMenu" | "offerGuide" | "report" | "setBusy" | "resetMission"
  >;
  notifications: Pick<
    ReturnType<typeof createNotifications>,
    "alert" | "clear" | "setFocus"
  >;
  topBar: Pick<ReturnType<typeof createTopBar>, "update">;
  setTitleScreen: (atTitle: boolean) => void;
};

/**
 * Owns the active mission and session, the level registry and restart
 * source, mission replacement, saves, and the validity of pending loads.
 */
export function createApplication({
  canvas,
  minimap,
  audio,
  roots,
  dialogs,
  notifications,
  topBar,
  setTitleScreen,
}: ApplicationOptions) {
  /** Level sources by scenario ID; loading a level file adds or replaces one. */
  const levels = new Map(LEVEL_SOURCES);
  let platform: Platform | undefined;
  let library: SaveLibrary | undefined;
  let session: GameSession | undefined;
  let mission: LoadedMission | undefined;
  let sidebar: ReturnType<typeof createSidebar> | undefined;
  let saveRules: SaveRules | undefined;
  let busy = false;
  /** Advancing it invalidates pending loads. */
  let loadRequest = 0;
  /** Advancing it stops the departing mission's callbacks from publishing. */
  let missionGeneration = 0;

  const elapsed = () =>
    session ? formatElapsed(topBarState(session).elapsedSeconds) : "";
  const missionName = () => mission?.scenario.name ?? "Mission";
  const canSave = () =>
    !!session &&
    !!saveRules?.canSave({
      faulted: session.faulted(),
      result: session.simulation.result,
    });
  const cancelLoad = () => {
    loadRequest++;
  };
  const ready = () => {
    if (!platform || !library)
      throw new Error("The game is still initializing.");
    return { platform, library };
  };
  const saveSource = (name: string) =>
    session!.save({ name, savedAt: new Date().toISOString() });

  function setBusy(value: boolean) {
    busy = value;
    dialogs.setBusy(value);
  }

  /** Runs mission startup or teardown alone, invalidating pending loads. */
  async function exclusive<T>(work: () => Promise<T>) {
    if (busy) return;
    cancelLoad();
    setBusy(true);
    try {
      return await work();
    } finally {
      setBusy(false);
    }
  }

  function menuDescription(mode: MenuMode, result?: MissionResult) {
    const failure =
      result?.kind === "defeat" &&
      mission?.scenario.objectives?.find(({ id }) => id === result.objectiveId);
    if (failure)
      return `Objective failed: ${failure.label}. The mission is paused.`;
    if (mode === "menu") return `${missionName()} · ${elapsed()} elapsed`;
    return MENU_VIEWS[mode].description;
  }

  function showMenu(mode: MenuMode, result?: MissionResult) {
    dialogs.showMenu({
      ...MENU_VIEWS[mode],
      mode,
      description: menuDescription(mode, result),
      mission: session && {
        saveName: `${missionName()} ${elapsed()}`,
        canSave: canSave(),
        canRestart: levels.has(mission?.scenario.id ?? ""),
      },
    });
  }

  function openMenu() {
    if (session) showMenu("menu");
  }

  function showTitle() {
    setTitleScreen(true);
    showMenu("home");
  }

  /** Releases the current mission and everything presented for it. */
  async function releaseMission() {
    const departing = session;
    const departingSidebar = sidebar;
    missionGeneration++;
    session = undefined;
    sidebar = undefined;
    mission = undefined;
    saveRules = undefined;
    try {
      dialogs.resetMission();
    } finally {
      try {
        if (departing) await departing.disposeAsync();
        else departingSidebar?.dispose();
      } finally {
        notifications.clear();
        topBar.update(topBarState(undefined));
      }
    }
  }

  /**
   * Stores the current mission as a save file. Resolves undefined when saving
   * is unavailable or the mission changed before `store` finished.
   */
  async function withSave<T>(
    name: string,
    failure: string,
    store: (source: string) => Promise<T>,
  ) {
    if (busy || !canSave()) return;
    const savedSession = session;
    try {
      const stored = await store(saveSource(name));
      return session === savedSession ? stored : undefined;
    } catch (error) {
      if (session === savedSession)
        throw new Error(`${failure}: ${errorMessage(error)}`);
    }
  }

  /** Resolves false when nothing was saved for the current mission. */
  async function writeSave(kind: SaveKind, name: string) {
    return !!(await withSave(name, "Saving failed", async (source) => {
      await ready().library.write(kind, source);
      return true;
    }));
  }

  /** Saves outside the menu; only the originating mission hears the outcome. */
  async function backgroundSave(kind: SaveKind, name: string) {
    const savedSession = session;
    try {
      if ((await writeSave(kind, name)) && session === savedSession)
        dialogs.report(saveCompleteMessage(kind, name));
    } catch (error) {
      if (session === savedSession) dialogs.report(errorMessage(error));
    }
  }

  /** Replaces the mission, resolving its session unless startup failed. */
  async function launch(next: LoadedMission, loaded: boolean) {
    try {
      await releaseMission();
      const generation = missionGeneration;
      const current = () => generation === missionGeneration;
      setTitleScreen(false);
      delete canvas.dataset.missionResult;
      delete canvas.dataset.terrainReady;
      delete canvas.dataset.simulationFault;
      const { createGameSession } = await import("./session");
      mission = next;
      const rules = createSaveRules(next, SIMULATION_TICK_SECONDS);
      saveRules = rules;
      const playerFaction = playerFactionOf(next.state);
      // Registered before session creation, so a failed start releases it.
      const activeSidebar = createSidebar(roots.sidebar, {
        definitions: next.definitions,
        economy: !!next.state.economy,
        presentations: new Map(Object.entries(next.content.presentation)),
        goals: next.scenario.goals ?? [],
        briefing: next.scenario.briefing,
        playerOwner: next.state.playerOwner,
        playerFaction,
        factionName: factionName(next.content, playerFaction),
        selectActor: (id, additive) => session?.selectActor(id, additive),
      });
      sidebar = activeSidebar;
      session = await createGameSession(canvas, minimap, {
        ...activeSidebar.controls,
        mission: next,
        audio,
        startPaused: loaded,
        onMenu: () => {
          if (current()) openMenu();
        },
        cameraControls: roots.cameraControls,
        onStateChanged: (state) => {
          if (!current()) return;
          activeSidebar.update(state);
          topBar.update(topBarState(session, state));
          const name = rules.onObjectives(state.objectives ?? []);
          if (name) void backgroundSave("auto", name);
        },
        onTick: (tick) => {
          if (!current() || !session) return;
          const name = rules.afterTick(tick, session.simulation.result);
          if (name) void backgroundSave("auto", name);
        },
        onAlerts: (alerts) => {
          if (!current()) return;
          for (const alert of alerts) notifications.alert(alert, elapsed());
        },
        onPopup: (popup) => {
          if (current()) dialogs.offerGuide(popup);
        },
        showActor: activeSidebar.showActor,
        onDispose: activeSidebar.dispose,
        // Results present at startup show once the session is ready.
        onResult: (result) => {
          if (current() && session) showMenu(result.kind, result);
        },
        onReady: (ready) => {
          if (!current()) return;
          session = ready;
          notifications.setFocus(ready.focus);
        },
      });
      return session;
    } catch (error) {
      try {
        await releaseMission();
      } catch (cleanupError) {
        console.error("Mission cleanup failed.", cleanupError);
      }
      console.error("The mission failed to start.", error);
      showTitle();
      dialogs.report("The mission could not start. Try New mission or Load.");
    }
  }

  async function start(next: LoadedMission, loaded = false) {
    const started = await exclusive(() => launch(next, loaded));
    if (!started) return;
    const result = started.simulation.result;
    if (result) showMenu(result.kind, result);
    else if (loaded) showMenu("loaded");
    const name = saveRules?.atStart();
    if (name) void backgroundSave("auto", name);
  }

  /** Starts the mission a read returns, keeping the current one on failure. */
  async function loadFrom(read: () => Promise<string | undefined>) {
    if (busy) return;
    const request = ++loadRequest;
    try {
      const source = await read();
      if (request !== loadRequest || source === undefined) return;
      // Rejects invalid state before releasing the current session.
      const loaded = loadMission(source);
      if (loaded.state.tick === 0 && !loaded.save)
        levels.set(loaded.scenario.id, source);
      await start(loaded, true);
    } catch (error) {
      if (request === loadRequest) throw error;
    }
  }

  function startLevel(id: string) {
    try {
      const source = levels.get(id);
      if (source === undefined)
        throw new RangeError(`This build has no level named "${id}".`);
      void start(loadMission(source));
    } catch (error) {
      // Restart failures keep the open mission menu.
      if (!session) showTitle();
      dialogs.report(`The level could not start: ${errorMessage(error)}`);
    }
  }

  /** Resolves the exported file name, if the export completed. */
  async function exportMission(name: string) {
    const file = fileNameFor(name);
    return withSave(name, "Export failed", async (source) =>
      (await ready().platform.exportFile(file, source)) ? file : undefined,
    );
  }

  /** Waits for requested save writes before exiting. */
  const quit = () =>
    exclusive(async () => {
      try {
        const { platform, library } = ready();
        await library.flush();
        if (!(await platform.exit())) showMenu("quit");
      } catch (error) {
        dialogs.report(`Could not exit: ${errorMessage(error)}`);
      }
    });

  const returnToTitle = () =>
    exclusive(async () => {
      try {
        await releaseMission();
        showTitle();
      } catch (error) {
        showTitle();
        dialogs.report(`Mission cleanup failed: ${errorMessage(error)}`);
      }
    });

  return {
    /** Creates platform services, then opens a level or the title screen. */
    initialize: async (level: string | null) => {
      setBusy(true);
      try {
        platform = await createPlatform();
        library = createSaveLibrary(platform.saves, missionIncompatibility);
        setBusy(false);
        if (level !== null) startLevel(level);
        else showTitle();
      } catch (error) {
        // Stays busy: saves, loads, and exit need the platform.
        showTitle();
        dialogs.report(
          `The game could not initialize: ${errorMessage(error)}. Reload to try again.`,
        );
      }
    },
    /** Platform services are ready for saves, loads, and exit. */
    ready: () => !!library,
    /** The same handle throughout a mission. */
    session: () => session,
    startFaction: (faction: keyof typeof FACTION_LEVELS) => {
      const level = FACTION_LEVELS[faction];
      // A level file loaded earlier must not replace the chosen introduction.
      levels.set(level, LEVEL_SOURCES.get(level)!);
      startLevel(level);
    },
    restart: () => {
      if (mission) startLevel(mission.scenario.id);
    },
    returnToTitle,
    showTitle,
    quit,
    openMenu,
    togglePause: () => {
      if (!session || busy) return;
      if (session.playing()) session.pause();
      else session.resume();
    },
    setSpeed: (speed: number) => session?.setSpeed(speed),
    showObjectives: () => sidebar?.showGoals(),
    cancelLoad,
    listSaves: () => ready().library.list(),
    removeSave: (id: string) => ready().library.remove(id),
    load: (id?: string) => {
      const { platform, library } = ready();
      return loadFrom(() =>
        id === undefined ? platform.importFile() : library.read(id),
      );
    },
    quickload: () => loadFrom(ready().library.readQuicksave),
    save: writeSave,
    quicksave: () => backgroundSave("quick", "Quicksave"),
    export: exportMission,
  };
}

export type Application = ReturnType<typeof createApplication>;
