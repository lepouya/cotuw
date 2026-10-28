import "./styles.css";
import { version } from "../package.json";
import { createAudioMixer } from "./audio/mixer";
import { createDialogs } from "./ui/dialogs";
import type { MenuMode } from "./ui/dialogs";
import { factionName } from "./content/content-pack";
import { LEVEL_SOURCES } from "./content/levels";
import { createPlatform } from "./platform";
import { isTextEntry, worldInputAvailable } from "./render/input-focus";
import { loadMission } from "./mission-loading";
import { createSaveLibrary, saveCompleteMessage } from "./saves";
import { createSidebar } from "./ui/sidebar";
import { createNotifications } from "./ui/notifications";
import { createTopBar, formatElapsed, topBarState } from "./ui/top-bar";
import { errorMessage } from "./errors";

import type { Platform } from "./platform";
import type { GameSession } from "./session";
import type { LoadedMission } from "./mission-loading";
import type { SaveKind, SaveLibrary } from "./saves";
import type { SidebarState } from "./ui/sidebar";
import type { ScenarioBriefing } from "./simulation/mission-file";
import type { MissionResult, ObjectiveView } from "./simulation/objectives";
import { evaluateObjectives } from "./simulation/objectives";
import { playerFactionOf } from "./simulation/ownership";

const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const canvas = byId<HTMLCanvasElement>("game-canvas");
const minimap = byId<HTMLCanvasElement>("minimap");
/** Level sources by scenario ID; loading a level file adds or replaces one. */
const levels = new Map(LEVEL_SOURCES);
let platform: Platform;
let library: SaveLibrary;
let session: GameSession | undefined;
let mission: LoadedMission | undefined;
let busy = false;
let loadRequest = 0;
let missionGeneration = 0;
/** Objectives already complete, so only new completions autosave. */
let completed = new Set<string>();
let sidebar: ReturnType<typeof createSidebar> | undefined;
const MENU_TEXT = {
  menu: { title: "Paused", description: "" },
  defeat: {
    title: "Defeat",
    description: "A mandatory objective failed. The mission is paused.",
  },
  victory: {
    title: "Victory",
    description:
      "All victory objectives are complete. Continue exploring in free play, or restart the mission.",
  },
  loaded: {
    title: "Mission loaded",
    description: "Inspect the saved mission, then resume when ready.",
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
const BRIEFING_ELEMENTS: Record<keyof ScenarioBriefing, string> = {
  label: "scenario-label",
  title: "scenario-title",
  description: "scenario-description",
  goalsHeading: "preparation-heading",
  goalsNote: "scenario-goals-note",
  rules: "scenario-rules",
};

const elapsed = () =>
  session ? formatElapsed(topBarState(session).elapsedSeconds) : "";

/** Rolling saves would otherwise replace good progress with a lost mission. */
const canSave = () => !!session && !session.halted();

const saveSource = (name: string) =>
  session!.save({ name, savedAt: new Date().toISOString() });

/** A file name made of the save name's letters, digits, and dashes. */
const fileNameFor = (name: string) =>
  `${name.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "mission"}.json`;

const notifications = createNotifications(document);
const audio = createAudioMixer();
const dialogs = createDialogs(byId("game-dialogs"), {
  version,
  audio,
  mission: () => session,
  focusWorld: () => canvas.focus({ preventScroll: true }),
  notify: notifications.message,
  cancelLoad: () => {
    loadRequest++;
  },
  start: (faction) => {
    const level = faction === "arc" ? "arc-economy-opening" : "circle-wolf-den";
    levels.set(level, LEVEL_SOURCES.get(level)!);
    startLevel(level);
  },
  restart: () => {
    if (mission) startLevel(mission.scenario.id);
  },
  exitToTitle: returnToTitle,
  showTitle,
  quit: quitGame,
  listSaves: () => library.list(),
  removeSave: (id) => library.remove(id),
  load: (id) =>
    loadFrom(() =>
      id === undefined ? platform.importFile() : library.read(id),
    ),
  save: writeSave,
  export: exportMission,
});

const topBar = createTopBar(byId("top-bar"), {
  togglePause: () => {
    if (!session || busy) return;
    if (session.playing()) session.pause();
    else session.resume();
  },
  setSpeed: (speed) => session?.setSpeed(speed),
  showObjectives: () => sidebar?.showGoals(),
});

const updateTopBar = (state?: SidebarState) =>
  topBar.update(topBarState(session, state));

const report = (message: string) => dialogs.report(message);

function showMenu(mode: MenuMode, result?: MissionResult) {
  const failure =
    result?.kind === "defeat" &&
    mission?.scenario.objectives?.find(({ id }) => id === result.objectiveId);
  dialogs.showMenu({
    ...MENU_TEXT[mode],
    mode,
    description: failure
      ? `Objective failed: ${failure.label}. The mission is paused.`
      : mode === "menu"
        ? `${mission?.scenario.name ?? "Mission"} · ${elapsed()} elapsed`
        : MENU_TEXT[mode].description,
    continueLabel:
      mode === "victory"
        ? "Continue free play"
        : mode === "menu" || mode === "loaded"
          ? "Resume"
          : undefined,
    mission: session
      ? {
          saveName: `${mission?.scenario.name ?? "Mission"} ${elapsed()}`,
          canSave: canSave(),
          canRestart: levels.has(mission?.scenario.id ?? ""),
        }
      : undefined,
  });
}

function openMenu() {
  if (session) showMenu("menu");
}

function showBriefing(briefing?: ScenarioBriefing) {
  for (const [key, id] of Object.entries(BRIEFING_ELEMENTS))
    byId(id).textContent = briefing?.[key as keyof ScenarioBriefing] ?? "";
}

function setBusy(value: boolean) {
  busy = value;
  dialogs.setBusy(value);
}

/** Releases the current mission and everything presented for it. */
async function releaseMission() {
  missionGeneration++;
  dialogs.resetMission();
  try {
    await session?.disposeAsync();
  } finally {
    session = undefined;
    sidebar = undefined;
    mission = undefined;
    notifications.clear();
  }
}

function showTitle() {
  document.body.classList.add("at-title");
  showMenu("home");
}

async function start(next: LoadedMission, loaded = false) {
  if (busy) return;
  loadRequest++;
  setBusy(true);
  try {
    await releaseMission();
    const generation = missionGeneration;
    document.body.classList.remove("at-title");
    delete canvas.dataset.missionResult;
    delete canvas.dataset.terrainReady;
    delete canvas.dataset.simulationFault;
    const { createGameSession } = await import("./session");
    mission = next;
    completed = new Set(
      evaluateObjectives(next.scenario.objectives ?? [], next.state.objectives)
        .views.filter(({ status }) => status === "complete")
        .map(({ id }) => id),
    );
    showBriefing(next.scenario.briefing);
    byId("economy-overview").hidden = !next.state.economy;
    byId("network-view-control").hidden =
      !next.state.economy ||
      !next.definitions.some((definition) => definition.support);
    const playerFaction = playerFactionOf(next.state);
    sidebar = createSidebar(byId("game-sidebar"), {
      definitions: next.definitions,
      economy: !!next.state.economy,
      presentations: new Map(Object.entries(next.content.presentation)),
      goals: next.scenario.goals ?? [],
      playerOwner: next.state.playerOwner,
      playerFaction,
      factionName: factionName(next.content, playerFaction),
      selectActor: (id, additive) => session?.selectActor(id, additive),
    });
    const activeSidebar = sidebar;
    session = await createGameSession(canvas, minimap, {
      ...activeSidebar.controls,
      mission: next,
      audio,
      startPaused: loaded,
      onMenu: openMenu,
      cameraControls: byId("camera-controls"),
      onStateChanged: (state) => {
        if (generation !== missionGeneration) return;
        activeSidebar.update(state);
        updateTopBar(state);
        autosaveOnProgress(state.objectives ?? []);
      },
      onAlerts: (alerts) => {
        if (generation !== missionGeneration) return;
        for (const alert of alerts) notifications.alert(alert, elapsed());
      },
      onPopup: (popup) => {
        if (generation === missionGeneration) dialogs.offerGuide(popup);
      },
      showActor: activeSidebar.showActor,
      onDispose: activeSidebar.dispose,
      // Results present at startup show once the session is ready.
      onResult: (result) => {
        if (generation === missionGeneration && session)
          showMenu(result.kind, result);
      },
      onReady: (ready) => {
        session = ready;
        notifications.setFocus(ready.focus);
      },
    });
  } catch (error) {
    try {
      sidebar?.dispose();
    } catch (cleanupError) {
      console.error("Sidebar cleanup failed.", cleanupError);
    }
    sidebar = undefined;
    session = undefined;
    mission = undefined;
    updateTopBar();
    console.error("The mission failed to start.", error);
    showTitle();
    report("The mission could not start. Try New mission or Load.");
    return;
  } finally {
    setBusy(false);
  }
  const result = session.simulation.result;
  if (result) showMenu(result.kind, result);
  else if (loaded) showMenu("loaded");
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
    report(`The level could not start: ${errorMessage(error)}`);
  }
}

async function writeSave(kind: SaveKind, name: string) {
  if (busy || !canSave()) return false;
  const savedSession = session;
  try {
    await library.write(kind, saveSource(name));
    return session === savedSession;
  } catch (error) {
    if (session === savedSession)
      throw new Error(`Saving failed: ${errorMessage(error)}`);
    return false;
  }
}

async function backgroundSave(kind: SaveKind, name: string) {
  const savedSession = session;
  try {
    if ((await writeSave(kind, name)) && session === savedSession)
      report(saveCompleteMessage(kind, name));
  } catch (error) {
    if (session === savedSession) report(errorMessage(error));
  }
}

async function exportMission(name: string) {
  if (busy || !canSave()) return;
  const savedSession = session;
  const file = fileNameFor(name);
  try {
    if (
      (await platform.exportFile(file, saveSource(name))) &&
      session === savedSession
    )
      return file;
  } catch (error) {
    if (session === savedSession)
      throw new Error(`Export failed: ${errorMessage(error)}`);
  }
}

function autosaveOnProgress(objectives: readonly ObjectiveView[]) {
  const done = objectives.filter(({ status }) => status === "complete");
  const fresh = done.filter(({ id }) => !completed.has(id));
  if (fresh.length === 0) return;
  for (const { id } of fresh) completed.add(id);
  void backgroundSave("auto", `Autosave: ${fresh[fresh.length - 1].label}`);
}

async function quitGame() {
  if (busy) return;
  loadRequest++;
  setBusy(true);
  try {
    await library.flush();
    if (!(await platform.exit())) showMenu("quit");
  } catch (error) {
    report(`Could not exit: ${errorMessage(error)}`);
  } finally {
    setBusy(false);
  }
}

async function returnToTitle() {
  if (busy) return;
  loadRequest++;
  setBusy(true);
  try {
    await releaseMission();
    updateTopBar();
    showTitle();
  } catch (error) {
    updateTopBar();
    showTitle();
    report(`Mission cleanup failed: ${errorMessage(error)}`);
  } finally {
    setBusy(false);
  }
}
byId("open-menu").addEventListener("click", openMenu);
// F5 and F10 would otherwise reload the page or focus the browser menu.
window.addEventListener("keydown", (event) => {
  const action = {
    F5: () => backgroundSave("quick", "Quicksave"),
    F9: () => loadFrom(library.readQuicksave),
    F10: openMenu,
  }[event.key];
  if (!action) return;
  event.preventDefault();
  if (!event.repeat && library && worldInputAvailable(document))
    void Promise.resolve(action()).catch((error) =>
      report(errorMessage(error)),
    );
});
// Windows fires contextmenu after release, once the radial menu is under the
// cursor. Text fields keep the native menu for clipboard actions.
document.addEventListener("contextmenu", (event) => {
  if (!isTextEntry(event.target)) event.preventDefault();
});

async function init() {
  setBusy(true);
  try {
    platform = await createPlatform();
    library = createSaveLibrary(platform.saves);
    setBusy(false);
    // Explicit level links remain available for authoring and browser checks.
    const level = new URLSearchParams(location.search).get("level");
    if (level !== null) startLevel(level);
    else showTitle();
  } catch (error) {
    // Stays busy: saves, loads, and exit need the platform.
    showTitle();
    report(
      `The game could not initialize: ${errorMessage(error)}. Reload to try again.`,
    );
  }
}
void init();
