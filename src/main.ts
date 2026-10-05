import "./styles.css";
import { LEVEL_SOURCES } from "./content/levels";
import { createPlatform } from "./platform";
import { worldInputAvailable } from "./render/input-focus";
import { createGameSession, loadMission } from "./session";
import { createSaveLibrary } from "./saves";
import { createSidebar } from "./ui/sidebar";
import { createNotifications } from "./ui/notifications";
import { createTopBar, formatElapsed, topBarState } from "./ui/top-bar";

import type { Platform } from "./platform";
import type { GameSession, LoadedMission } from "./session";
import type { SaveKind, SaveLibrary } from "./saves";
import type { SidebarState } from "./ui/sidebar";
import type {
  ScenarioBriefing,
  ScenarioPopup,
} from "./simulation/mission-file";
import type { MissionResult, ObjectiveView } from "./simulation/objectives";
import { evaluateObjectives } from "./simulation/objectives";

const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const canvas = byId<HTMLCanvasElement>("game-canvas");
const minimap = byId<HTMLCanvasElement>("minimap");
const dialog = byId<HTMLDialogElement>("game-menu");
const title = byId("game-menu-title");
const description = byId("game-menu-description");
const menuStatus = byId("game-menu-status");
const actions = byId("game-menu-actions");
const restart = byId<HTMLButtonElement>("restart-mission");
const load = byId<HTMLButtonElement>("load-mission");
const exit = byId<HTMLButtonElement>("exit-mission");
const resume = byId<HTMLButtonElement>("resume-mission");
const inspect = byId<HTMLButtonElement>("inspect-loaded-mission");
const explanation = byId<HTMLDialogElement>("explanation");
const save = byId<HTMLButtonElement>("save-mission");
const quicksave = byId<HTMLButtonElement>("quicksave-mission");
const saveForm = byId<HTMLFormElement>("save-form");
const saveName = byId<HTMLInputElement>("save-name");
const loadPanel = byId("load-panel");
const saveEntries = byId("save-entries");

/** Level sources by scenario ID; loading a level file adds or replaces one. */
const levels = new Map(LEVEL_SOURCES);
let platform: Platform;
let library: SaveLibrary;
let session: GameSession | undefined;
let mission: LoadedMission | undefined;
let busy = false;
// Restart, exit, and newer loads invalidate pending file reads.
let loadRequest = 0;
let saveListRequest = 0;
/** Objectives already complete, so only new completions autosave. */
let completed = new Set<string>();
let resumeOnClose = false;
let menuMode: keyof typeof MENU_TEXT = "exit";
let sidebar: ReturnType<typeof createSidebar> | undefined;
/** A popup waiting for the game menu to close. */
let pendingPopup: ScenarioPopup | undefined;
let shownPopup: { popup: ScenarioPopup; resume: boolean } | undefined;

const KIND_LABELS: Record<SaveKind, string> = {
  manual: "Manual",
  quick: "Quick",
  auto: "Auto",
};
const MENU_TEXT = {
  menu: { title: "Paused", description: "" },
  defeat: {
    title: "Defeat",
    description: "A mandatory objective failed. The mission is paused.",
  },
  victory: {
    title: "Victory",
    description:
      "All victory objectives are complete. Continue building and exploring in free play, or restart the mission.",
  },
  loaded: {
    title: "Mission loaded",
    description: "Inspect the saved mission, then resume when ready.",
  },
  exit: {
    title: "Mission ended",
    description: "Start a new mission or load a saved mission.",
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

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const elapsed = () =>
  session ? formatElapsed(topBarState(session).elapsedSeconds) : "";

/** Rolling saves would otherwise replace good progress with a lost mission. */
const canSave = () =>
  !!session &&
  !busy &&
  session.simulation.result?.kind !== "defeat" &&
  canvas.dataset.simulationFault !== "true";

const saveSource = (name: string) =>
  session!.save({ name, savedAt: new Date().toISOString() });

/** A file name made of the save name's letters, digits, and dashes. */
const fileNameFor = (name: string) =>
  `${name.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "mission"}.json`;

const notifications = createNotifications(document);

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

const report = (message: string) => {
  if (dialog.open) menuStatus.textContent = message;
  else notifications.message(message);
};

/** Shows a waiting popup once no other dialog is open, pausing the mission. */
function showPopup() {
  if (!session || !pendingPopup || dialog.open || explanation.open) return;
  const popup = pendingPopup;
  pendingPopup = undefined;
  shownPopup = { popup, resume: session.playing() };
  // Placement continues after the explanation of it.
  session.pause({ keepInteractions: true });
  byId("explanation-title").textContent = popup.title;
  byId("explanation-text").textContent = popup.text;
  explanation.showModal();
}

function dismissPopup() {
  if (!shownPopup) return;
  const { popup, resume } = shownPopup;
  shownPopup = undefined;
  explanation.close();
  session?.dismissPopup(popup.id);
  if (resume) session?.resume();
  canvas.focus({ preventScroll: true });
}

function showPanel(panel: "actions" | "save" | "load") {
  saveListRequest++;
  actions.hidden = panel !== "actions";
  saveForm.hidden = panel !== "save";
  loadPanel.hidden = panel !== "load";
}

function showMenu(mode: keyof typeof MENU_TEXT, result?: MissionResult) {
  menuMode = mode;
  title.textContent = MENU_TEXT[mode].title;
  const failure =
    result?.kind === "defeat" &&
    mission?.scenario.objectives?.find(({ id }) => id === result.objectiveId);
  description.textContent = failure
    ? `Objective failed: ${failure.label}. The mission is paused.`
    : mode === "menu"
      ? `${mission?.scenario.name ?? "Mission"} · ${elapsed()} elapsed`
      : MENU_TEXT[mode].description;
  resume.hidden = mode !== "menu" && mode !== "loaded" && mode !== "victory";
  resume.textContent =
    mode === "victory"
      ? "Continue free play"
      : mode === "menu" && !resumeOnClose
        ? "Close"
        : "Resume";
  inspect.hidden = mode !== "loaded";
  save.hidden = quicksave.hidden = !canSave();
  restart.textContent = mode === "exit" ? "Start mission" : "Restart";
  restart.hidden = !levels.has(mission?.scenario.id ?? "");
  exit.hidden = mode === "exit";
  menuStatus.textContent = "";
  showPanel("actions");
  if (!dialog.open) dialog.showModal();
}

function openMenu() {
  if (!session || busy || dialog.open || explanation.open) return;
  resumeOnClose = session.playing();
  session.pause();
  showMenu("menu");
}

function showBriefing(briefing?: ScenarioBriefing) {
  for (const [key, id] of Object.entries(BRIEFING_ELEMENTS))
    byId(id).textContent = briefing?.[key as keyof ScenarioBriefing] ?? "";
}

function setBusy(value: boolean) {
  busy = value;
  for (const button of dialog.querySelectorAll("button"))
    button.disabled = value;
}

async function start(next: LoadedMission, loaded = false) {
  if (busy) return;
  loadRequest++;
  setBusy(true);
  try {
    await session?.disposeAsync();
    session = undefined;
    dialog.close();
    pendingPopup = shownPopup = undefined;
    explanation.close();
    notifications.clear();
    delete canvas.dataset.missionResult;
    delete canvas.dataset.terrainReady;
    delete canvas.dataset.simulationFault;
    mission = next;
    completed = new Set(
      evaluateObjectives(next.scenario.objectives ?? [], next.state.objectives)
        .views.filter(({ status }) => status === "complete")
        .map(({ id }) => id),
    );
    showBriefing(next.scenario.briefing);
    for (const id of ["network-view-control", "economy-overview"])
      byId(id).hidden = !next.state.economy;
    sidebar = createSidebar(byId("game-sidebar"), {
      definitions: next.definitions,
      economy: !!next.state.economy,
      presentations: new Map(Object.entries(next.content.presentation)),
      goals: next.scenario.goals ?? [],
      playerFaction: next.state.playerFaction,
      selectActor: (id, additive) => session?.selectActor(id, additive),
    });
    const activeSidebar = sidebar;
    session = await createGameSession(canvas, minimap, {
      ...activeSidebar.controls,
      mission: next,
      startPaused: loaded,
      cameraControls: byId("camera-controls"),
      onStateChanged: (state) => {
        activeSidebar.update(state);
        updateTopBar(state);
        autosaveOnProgress(state.objectives ?? []);
      },
      onAlerts: (alerts) => {
        for (const alert of alerts) notifications.alert(alert, elapsed());
      },
      onPopup: (popup) => {
        pendingPopup = popup;
        showPopup();
      },
      showActor: activeSidebar.showActor,
      onDispose: activeSidebar.dispose,
      // Results present at startup show once the session is ready.
      onResult: (result) => session && showMenu(result.kind, result),
      onReady: (ready) => {
        session = ready;
        notifications.setFocus(ready.focus);
      },
    });
  } catch (error) {
    sidebar?.dispose();
    sidebar = undefined;
    session = undefined;
    updateTopBar();
    console.error("The mission failed to start.", error);
    showMenu("exit");
    menuStatus.textContent = "The mission could not start. Try restarting.";
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
    if (request === loadRequest) report(errorMessage(error));
  }
}

function startLevel(id: string) {
  try {
    const source = levels.get(id);
    if (source === undefined)
      throw new RangeError(`This build has no level named "${id}".`);
    void start(loadMission(source));
  } catch (error) {
    showMenu("exit");
    menuStatus.textContent = `The level could not start: ${errorMessage(error)}`;
  }
}

async function writeSave(kind: SaveKind, name: string) {
  if (!canSave()) return;
  const savedSession = session;
  try {
    await library.write(kind, saveSource(name));
    if (session === savedSession)
      report(`${KIND_LABELS[kind]} save complete: ${name}`);
  } catch (error) {
    if (session === savedSession)
      report(`Saving failed: ${errorMessage(error)}`);
  }
}

function autosaveOnProgress(objectives: readonly ObjectiveView[]) {
  const done = objectives.filter(({ status }) => status === "complete");
  const fresh = done.filter(({ id }) => !completed.has(id));
  if (fresh.length === 0) return;
  for (const { id } of fresh) completed.add(id);
  void writeSave("auto", `Autosave: ${fresh[fresh.length - 1].label}`);
}

async function showSaves() {
  showPanel("load");
  const request = saveListRequest;
  saveEntries.replaceChildren();
  let entries;
  try {
    entries = await library.list();
  } catch (error) {
    if (request === saveListRequest)
      menuStatus.textContent = errorMessage(error);
    return;
  }
  if (request !== saveListRequest || !dialog.open) return;
  if (entries.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No saved missions yet.";
    saveEntries.append(empty);
  }
  for (const entry of entries) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    const details = document.createElement("small");
    const savedAt = entry.savedAt && new Date(entry.savedAt).toLocaleString();
    label.textContent = `${KIND_LABELS[entry.kind]} · ${entry.name}`;
    details.textContent = [
      entry.missionName,
      `${formatElapsed(entry.elapsedSeconds)} elapsed`,
      savedAt,
    ]
      .filter(Boolean)
      .join(" · ");
    label.append(details);
    const loadEntry = document.createElement("button");
    loadEntry.type = "button";
    loadEntry.textContent = "Load";
    loadEntry.addEventListener("click", () =>
      loadFrom(() => library.read(entry.id)),
    );
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    let armed = false;
    remove.addEventListener("click", async () => {
      // The first press only arms deletion.
      if (!armed) {
        armed = true;
        remove.textContent = "Confirm";
        return;
      }
      try {
        await library.remove(entry.id);
        if (item.isConnected) void showSaves();
      } catch (error) {
        if (item.isConnected) menuStatus.textContent = errorMessage(error);
      }
    });
    item.append(label, loadEntry, remove);
    saveEntries.append(item);
  }
}

const resumeMission = () => {
  if (busy) return;
  loadRequest++;
  saveListRequest++;
  session?.resume();
  dialog.close();
  showPopup();
};
const closeMenu = () => {
  if (busy) return;
  if (menuMode !== "menu" || resumeOnClose) resumeMission();
  else {
    loadRequest++;
    saveListRequest++;
    dialog.close();
    showPopup();
  }
};
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  if (menuMode === "menu") closeMenu();
});
resume.addEventListener("click", closeMenu);
inspect.addEventListener("click", () => {
  if (busy) return;
  loadRequest++;
  saveListRequest++;
  dialog.close();
  showPopup();
});
byId("dismiss-explanation").addEventListener("click", dismissPopup);
explanation.addEventListener("cancel", (event) => {
  event.preventDefault();
  dismissPopup();
});
restart.addEventListener("click", () => startLevel(mission!.scenario.id));
exit.addEventListener("click", async () => {
  if (busy) return;
  loadRequest++;
  setBusy(true);
  try {
    await session?.disposeAsync();
    session = undefined;
    notifications.clear();
    sidebar = undefined;
    updateTopBar();
    showMenu("exit");
  } finally {
    setBusy(false);
  }
});
byId("open-menu").addEventListener("click", openMenu);
save.addEventListener("click", () => {
  showPanel("save");
  saveName.value = `${mission?.scenario.name ?? "Mission"} ${elapsed()}`;
  saveName.select();
});
saveForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const savedSession = session;
  const request = saveListRequest;
  await writeSave("manual", saveName.value.trim() || "Mission");
  if (session === savedSession && request === saveListRequest)
    showPanel("actions");
});
byId("export-mission").addEventListener("click", async () => {
  if (!canSave()) return;
  const name = saveName.value.trim() || "Mission";
  const file = fileNameFor(name);
  const savedSession = session;
  const request = saveListRequest;
  try {
    if (
      (await platform.exportFile(file, saveSource(name))) &&
      session === savedSession &&
      request === saveListRequest
    )
      menuStatus.textContent = `Exported ${file}.`;
  } catch (error) {
    if (session === savedSession && request === saveListRequest)
      menuStatus.textContent = `Export failed: ${errorMessage(error)}`;
  }
});
byId("cancel-save").addEventListener("click", () => showPanel("actions"));
quicksave.addEventListener("click", () => writeSave("quick", "Quicksave"));
load.addEventListener("click", () => void showSaves());
byId("import-mission").addEventListener("click", () =>
  loadFrom(() => platform.importFile()),
);
byId("cancel-load").addEventListener("click", () => {
  loadRequest++;
  showPanel("actions");
});
// F5 and F10 would otherwise reload the page or focus the browser menu.
window.addEventListener("keydown", (event) => {
  const action = {
    F5: () => writeSave("quick", "Quicksave"),
    F9: () => loadFrom(library.readQuicksave),
    F10: openMenu,
  }[event.key];
  if (!action) return;
  event.preventDefault();
  if (!event.repeat && library && worldInputAvailable(document)) void action();
});

async function init() {
  platform = await createPlatform();
  library = createSaveLibrary(platform.saves);
  // `?level=<scenario ID>` opens another bundled level; the first is default.
  startLevel(
    new URLSearchParams(location.search).get("level") ??
      LEVEL_SOURCES.keys().next().value!,
  );
}
void init();
