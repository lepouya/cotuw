import { factionName } from "./content/content-pack";
import { LEVEL_SOURCES } from "./content/levels";
import { errorMessage } from "./errors";
import { formatElapsed } from "./format-time";
import {
  assembleSkirmish,
  loadLevel,
  loadMission,
  missionIncompatibility,
  missionRestart,
} from "./mission-loading";
import { createPlatform } from "./platform";
import { createSaveRules } from "./save-policy";
import { createSaveLibrary, saveCompleteMessage } from "./saves";
import { SIMULATION_TICK_SECONDS } from "./simulation/clock";
import { missionEnded } from "./simulation/mission-result";
import { DIFFICULTIES } from "./simulation/mission-setup";
import { factionOf } from "./simulation/ownership";
import { presentResult } from "./ui/mission-result";
import { createSidebar } from "./ui/sidebar";

import type { AudioMixer } from "./audio/mixer";
import type { SkirmishChoice } from "./content/skirmish";
import type { LoadedMission } from "./mission-loading";
import type { Platform } from "./platform";
import type { SaveRules } from "./save-policy";
import type { SaveKind, SaveLibrary } from "./saves";
import type { GameSession } from "./session";
import type { Difficulty } from "./simulation/mission-setup";
import type { MissionResult } from "./simulation/mission-result";
import type { CameraControls } from "./ui/camera-controls";
import type { createDialogs, MenuMode, MenuView } from "./ui/dialogs";
import type { SetupFaction } from "./ui/mission-setup";
import type { createNotifications } from "./ui/notifications";
import type { createTopBar } from "./ui/top-bar";

type MenuText = Pick<
  MenuView,
  "title" | "description" | "continueLabel" | "canInspect"
>;

/** Text for menus without a result; a continue label offers continuing play. */
const MENU_VIEWS: Record<Exclude<MenuMode, "result">, MenuText> = {
  menu: { title: "Paused", description: "", continueLabel: "Resume" },
  loaded: {
    title: "Mission loaded",
    description: "Inspect the saved mission, then resume when ready.",
    continueLabel: "Resume",
    canInspect: true,
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

const FACTION_LEVELS: Record<SetupFaction, string> = {
  arc: "arc-economy-opening",
  circle: "circle-wolf-den",
};

/** A file name made of the save name's letters, digits, and dashes. */
const fileNameFor = (name: string) =>
  `${name.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "mission"}.json`;

/** The application drives these features; it never queries their elements. */
export type ApplicationOptions = {
  canvas: HTMLCanvasElement;
  minimap: HTMLCanvasElement;
  audio: AudioMixer;
  /** Each mission mounts its sidebar into this root. */
  sidebarRoot: HTMLElement;
  cameraControls: Pick<CameraControls, "bind">;
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
  /** Offers each session's AI diagnostics panel, for development links. */
  aiOverlay?: boolean;
};

/**
 * Owns the active mission and session, the level registry and restart
 * source, mission replacement, saves, and the validity of pending loads.
 */
export function createApplication({
  canvas,
  minimap,
  audio,
  sidebarRoot,
  cameraControls,
  dialogs,
  notifications,
  topBar,
  setTitleScreen,
  aiOverlay,
}: ApplicationOptions) {
  /** Level sources by scenario ID; loading a level file adds or replaces one. */
  const levels = new Map(LEVEL_SOURCES);
  let services: { platform: Platform; library: SaveLibrary } | undefined;
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
    session
      ? formatElapsed(
          session.simulation.completedTicks * session.simulation.tickSeconds,
        )
      : "";
  const missionName = () => mission?.scenario.name ?? "Mission";
  const missionSummary = () => {
    const setup = mission?.scenario.setup;
    return [
      missionName(),
      `${elapsed()} elapsed`,
      ...(setup ? [`${DIFFICULTIES[setup.difficulty].name} difficulty`] : []),
    ].join(" · ");
  };
  const canSave = () =>
    !!session &&
    !!saveRules?.canSave({
      faulted: session.faulted(),
      result: session.simulation.result,
    });
  const restartLoader = () =>
    mission && missionRestart(mission, levels.get(mission.scenario.id));
  const cancelLoad = () => {
    loadRequest++;
  };
  const requireServices = () => {
    if (!services) throw new Error("The game is still initializing.");
    return services;
  };

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

  function presentMenu(mode: MenuMode, text: MenuText) {
    dialogs.showMenu({
      ...text,
      mode,
      mission: session && {
        saveName: `${missionName()} ${elapsed()}`,
        canSave: canSave(),
        canRestart: !!restartLoader(),
      },
    });
  }

  function showMenu(mode: keyof typeof MENU_VIEWS) {
    const text = MENU_VIEWS[mode];
    let description = text.description;
    if (mode === "menu") description = missionSummary();
    else if (mode === "loaded")
      description = `${missionSummary()}. ${text.description}`;
    presentMenu(mode, { ...text, description });
  }

  /** Result menus preempt others; reopened ones behave as the pause menu. */
  function showResult(result: MissionResult, mode: MenuMode = "result") {
    const { title, description, continueLabel, canInspect } = presentResult(
      result,
      (id) => mission?.scenario.objectives?.find((o) => o.id === id)?.label,
    );
    presentMenu(mode, {
      title,
      description: `${description} ${missionSummary()}.`,
      continueLabel,
      canInspect,
    });
  }

  function openMenu() {
    if (!session) return;
    const result = session.simulation.result;
    if (result && missionEnded(result)) showResult(result, "menu");
    else showMenu("menu");
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
        topBar.update();
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
    const savedSession = session;
    if (busy || !savedSession || !canSave()) return;
    try {
      const stored = await store(
        savedSession.save({ name, savedAt: new Date().toISOString() }),
      );
      return session === savedSession ? stored : undefined;
    } catch (error) {
      if (session === savedSession)
        throw new Error(`${failure}: ${errorMessage(error)}`);
    }
  }

  /** Resolves false when nothing was saved for the current mission. */
  async function writeSave(kind: SaveKind, name: string) {
    return !!(await withSave(name, "Saving failed", async (source) => {
      await requireServices().library.write(kind, source);
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
      const { createGameSession } = await import("./session");
      mission = next;
      const rules = createSaveRules(next, SIMULATION_TICK_SECONDS);
      saveRules = rules;
      const playerFaction = factionOf(
        next.state.owners,
        next.state.playerOwner,
      );
      // Registered before session creation, so a failed start releases it.
      const activeSidebar = createSidebar(sidebarRoot, {
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
        aiOverlay,
        onMenu: () => {
          if (current()) openMenu();
        },
        cameraControls,
        onStateChanged: (state) => {
          if (!current()) return;
          activeSidebar.update(state);
          topBar.update(state);
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
          if (current() && session) showResult(result);
        },
        onReady: (started) => {
          if (!current()) return;
          session = started;
          notifications.setFocus(started.focus);
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
    if (result) showResult(result);
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

  function startResolved(resolve: () => LoadedMission) {
    try {
      void start(resolve());
    } catch (error) {
      // Restart failures keep the open mission menu.
      if (!session) showTitle();
      dialogs.report(`The level could not start: ${errorMessage(error)}`);
    }
  }

  function startLevel(id: string, difficulty?: Difficulty) {
    startResolved(() => {
      const source = levels.get(id);
      if (source === undefined)
        throw new RangeError(`This build has no level named "${id}".`);
      return loadLevel(source, difficulty);
    });
  }

  const startSkirmish = (choice: SkirmishChoice) =>
    startResolved(() => {
      const assembled = assembleSkirmish(choice);
      // A level file loaded earlier must not replace this skirmish's restart.
      levels.delete(assembled.scenario.id);
      return assembled;
    });

  /** Resolves the exported file name, if the export completed. */
  async function exportMission(name: string) {
    const file = fileNameFor(name);
    return withSave(name, "Export failed", async (source) =>
      (await requireServices().platform.exportFile(file, source))
        ? file
        : undefined,
    );
  }

  /** Waits for requested save writes before exiting. */
  const quit = () =>
    exclusive(async () => {
      try {
        const { platform, library } = requireServices();
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
    /** Creates platform services, then opens a link or the title screen. */
    initialize: async (link: { level?: string; skirmish?: SkirmishChoice }) => {
      setBusy(true);
      try {
        const platform = await createPlatform();
        services = {
          platform,
          library: createSaveLibrary(platform.saves, missionIncompatibility),
        };
        setBusy(false);
        if (link.skirmish) startSkirmish(link.skirmish);
        else if (link.level !== undefined) startLevel(link.level);
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
    ready: () => !!services,
    /** The same handle throughout a mission. */
    session: () => session,
    startFaction: (faction: SetupFaction, difficulty: Difficulty) => {
      const level = FACTION_LEVELS[faction];
      // A level file loaded earlier must not replace the chosen introduction.
      levels.set(level, LEVEL_SOURCES.get(level)!);
      startLevel(level, difficulty);
    },
    restart: () => {
      const resolve = restartLoader();
      if (resolve) startResolved(resolve);
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
    listSaves: () => requireServices().library.list(),
    removeSave: (id: string) => requireServices().library.remove(id),
    load: (id?: string) => {
      const { platform, library } = requireServices();
      return loadFrom(() =>
        id === undefined ? platform.importFile() : library.read(id),
      );
    },
    quickload: () => loadFrom(requireServices().library.readQuicksave),
    save: writeSave,
    quicksave: () => backgroundSave("quick", "Quicksave"),
    export: exportMission,
  };
}
