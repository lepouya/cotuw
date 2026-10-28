import { errorMessage } from "../errors";
import { SAVE_KIND_LABELS, saveCompleteMessage } from "../saves";
import { createAudioControls } from "./audio-controls";
import { mountFeature } from "./dom";
import { formatElapsed } from "./top-bar";
import markup from "./dialogs.html?raw";
import "./dialogs.css";

import type { SaveEntry, SaveKind } from "../saves";
import type { ScenarioPopup } from "../simulation/mission-file";
import type { AudioControlDevice } from "./audio-controls";
import type { FeatureScope } from "./dom";

export type MenuMode =
  "home" | "menu" | "loaded" | "victory" | "defeat" | "quit";
export type MenuView = {
  mode: MenuMode;
  title: string;
  description: string;
  continueLabel?: string;
  mission?: { saveName: string; canSave: boolean; canRestart: boolean };
};

type DialogMission = {
  playing: () => boolean;
  pause: (options?: { keepInteractions?: boolean }) => void;
  resume: () => void;
  dismissPopup: (id: string) => void;
};
type DialogOptions = {
  version: string;
  audio: AudioControlDevice;
  /** Returns the same handle throughout a mission for pause restoration. */
  mission: () => DialogMission | undefined;
  focusWorld: () => void;
  notify: (message: string) => void;
  cancelLoad: () => void;
  start: (faction: "arc" | "circle") => void;
  restart: () => void;
  /** Releases the mission, then shows the title screen. */
  exitToTitle: () => Promise<void>;
  showTitle: () => void;
  quit: () => Promise<void>;
  listSaves: () => Promise<SaveEntry[]>;
  removeSave: (id: string) => Promise<void>;
  /** Loads a stored save, or an imported file without an ID. */
  load: (id?: string) => Promise<void>;
  /** Resolves false when the mission changed before the write finished. */
  save: (kind: Exclude<SaveKind, "auto">, name: string) => Promise<boolean>;
  /** Resolves the exported file name, if the export completed. */
  export: (name: string) => Promise<string | undefined>;
};
type Panel = "actions" | "save" | "load" | "options" | "setup";

const canSave = (view: MenuView) => !!view.mission?.canSave;
const onlyIn =
  (...modes: MenuMode[]) =>
  (view: MenuView) =>
    modes.includes(view.mode);
/** Controls a menu view can withhold; withheld controls are hidden and disabled. */
const CONTROL_RULES: Record<string, (view: MenuView) => boolean> = {
  "new-mission": onlyIn("home"),
  "open-options": onlyIn("home"),
  "quit-game": onlyIn("home"),
  "inspect-loaded-mission": onlyIn("loaded"),
  "return-to-title": onlyIn("quit"),
  "load-mission": (view) => view.mode !== "quit",
  "resume-mission": (view) => !!view.continueLabel,
  "exit-mission": (view) => !!view.mission,
  "restart-mission": (view) => !!view.mission?.canRestart,
  "save-mission": canSave,
  "quicksave-mission": canSave,
  "confirm-save": canSave,
  "export-mission": canSave,
};

/** Owns modal interaction and DOM; application operations stay in callbacks. */
export function createDialogs(host: HTMLElement, options: DialogOptions) {
  return mountFeature(host, markup, (scope) =>
    bindDialogs(host.ownerDocument, options, scope),
  );
}

function bindDialogs(
  document: Document,
  options: DialogOptions,
  { lifetime, signal, element }: FeatureScope,
) {
  const dialog = element<HTMLDialogElement>("game-menu");
  const explanation = element<HTMLDialogElement>("explanation");
  const title = element("game-menu-title");
  const description = element("game-menu-description");
  const status = element("game-menu-status");
  const actions = element("game-menu-actions");
  const saveForm = element<HTMLFormElement>("save-form");
  const saveName = element<HTMLInputElement>("save-name");
  const saveEntries = element("save-entries");
  const audioRoot = element("menu-audio");
  const resume = element("resume-mission");
  const version = element("game-version");
  version.textContent = `Prototype demo · v${options.version}`;
  lifetime.own(createAudioControls(audioRoot, options.audio));
  /** Each panel's exclusive content, opening focus, and replacement text. */
  const panels: Record<
    Panel,
    {
      content: HTMLElement;
      focus: () => HTMLElement | null;
      title?: string;
      description?: string;
    }
  > = {
    actions: {
      content: actions,
      focus: () => actions.querySelector("button:not([hidden]):not(:disabled)"),
    },
    save: { content: saveForm, focus: () => saveName },
    load: {
      content: element("load-panel"),
      focus: () => element("import-mission"),
    },
    options: {
      content: element("cancel-options"),
      focus: () => audioRoot.querySelector("input"),
      title: "Options",
      description: "",
    },
    setup: {
      content: element("mission-setup"),
      focus: () => element("choose-arc"),
      title: "Choose your faction",
      description: "Choose a faction for the wolf-den demo.",
    },
  };
  let revision = 0;
  let disposed = false;
  let busy = false;
  let panelPending = false;
  let panel: Panel = "actions";
  let view: MenuView | undefined;
  let opener: HTMLElement | undefined;
  let menuMission: DialogMission | undefined;
  let resumeOnClose = false;
  let guideBlocked = false;
  let pendingGuide: ScenarioPopup | undefined;
  let shownGuide:
    | { popup: ScenarioPopup; mission: DialogMission; resume: boolean }
    | undefined;

  const isCurrent = (request: number) => !disposed && request === revision;
  const invalidatePanel = () => {
    revision++;
    panelPending = false;
    saveEntries.replaceChildren();
    saveEntries.setAttribute("aria-busy", "false");
    options.cancelLoad();
  };
  const report = (message: string) => {
    if (disposed) return;
    if (dialog.open) status.textContent = message;
    else options.notify(message);
  };
  const focusedElement = () => {
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body
      ? active
      : undefined;
  };
  const focusPanel = () => {
    if (!dialog.open) return;
    const target = panels[panel].focus();
    (target && !target.matches(":disabled") ? target : dialog).focus();
  };
  const restoreFocus = () => {
    if (
      opener?.isConnected &&
      opener.getClientRects().length &&
      !opener.matches(":disabled")
    )
      opener.focus({ preventScroll: true });
    else options.focusWorld();
    opener = undefined;
  };
  /** Disabling a focused control drops focus to the document. */
  const restorePanelFocus = () => {
    const active = document.activeElement;
    if (dialog.open && (!dialog.contains(active) || active === dialog))
      focusPanel();
  };
  const syncAvailability = () => {
    for (const control of dialog.querySelectorAll<
      HTMLInputElement | HTMLButtonElement
    >("button, input")) {
      // Audio settings stay available, including during busy work.
      if (audioRoot.contains(control)) continue;
      control.disabled =
        busy ||
        !view ||
        !(CONTROL_RULES[control.id]?.(view) ?? true) ||
        (panelPending && "panelWork" in control.dataset);
    }
  };
  const showPanel = (next: Panel) => {
    invalidatePanel();
    status.textContent = "";
    panel = next;
    for (const [name, { content }] of Object.entries(panels))
      content.hidden = name !== next;
    // In a mission, audio settings stay beside every panel.
    audioRoot.hidden = next !== "options" && !view?.mission;
    title.textContent = panels[next].title ?? view?.title ?? "";
    description.textContent =
      panels[next].description ?? view?.description ?? "";
    description.hidden = !description.textContent;
    syncAvailability();
    focusPanel();
  };

  /** Runs work for the current panel; `lock` disables other panel work. */
  async function perform(
    work: (current: () => boolean) => Promise<void>,
    lock = false,
  ) {
    if (disposed || busy || (lock && panelPending)) return;
    const request = revision;
    if (lock) {
      panelPending = true;
      syncAvailability();
    }
    try {
      await work(() => isCurrent(request));
    } catch (error) {
      if (isCurrent(request)) report(errorMessage(error));
    } finally {
      if (lock && isCurrent(request)) {
        panelPending = false;
        syncAvailability();
        restorePanelFocus();
      }
    }
  }

  function showGuide() {
    const mission = options.mission();
    if (
      disposed ||
      busy ||
      guideBlocked ||
      !mission ||
      !pendingGuide ||
      dialog.open ||
      explanation.open
    )
      return;
    const popup = pendingGuide;
    pendingGuide = undefined;
    opener = focusedElement();
    shownGuide = { popup, mission, resume: mission.playing() };
    // Placement continues after the explanation of it.
    mission.pause({ keepInteractions: true });
    element("explanation-title").textContent = popup.title;
    element("explanation-text").textContent = popup.text;
    explanation.showModal();
    element("dismiss-explanation").focus();
  }
  function dismissGuide() {
    if (busy || !shownGuide) return;
    const shown = shownGuide;
    shownGuide = undefined;
    explanation.close();
    if (shown.mission === options.mission()) {
      shown.mission.dismissPopup(shown.popup.id);
      if (shown.resume) shown.mission.resume();
    }
    restoreFocus();
  }
  function closeMenu(continueMission: boolean) {
    if (busy || !view) return;
    invalidatePanel();
    dialog.close();
    if (continueMission && menuMission === options.mission())
      menuMission?.resume();
    guideBlocked = false;
    restoreFocus();
    showGuide();
  }
  /** Escape backs out of a panel, then closes only the pause menu. */
  function cancelMenu() {
    if (busy) return;
    if (panel !== "actions") showPanel("actions");
    else if (view?.mode === "menu") closeMenu(resumeOnClose);
  }
  const showEmptySaves = () => {
    const empty = document.createElement("li");
    empty.textContent = "No saved missions yet.";
    saveEntries.append(empty);
  };
  const saveRow = (entry: SaveEntry, listed: () => boolean) => {
    const item = document.createElement("li");
    const label = document.createElement("span");
    const details = document.createElement("small");
    label.textContent = `${SAVE_KIND_LABELS[entry.kind]} · ${entry.name}`;
    details.textContent = [
      entry.missionName,
      `${formatElapsed(entry.elapsedSeconds)} elapsed`,
      entry.savedAt && new Date(entry.savedAt).toLocaleString(),
    ]
      .filter(Boolean)
      .join(" · ");
    label.append(details);
    const load = document.createElement("button");
    load.type = "button";
    load.textContent = "Load";
    load.dataset.panelWork = "";
    load.addEventListener("click", () => {
      if (listed()) void perform(() => options.load(entry.id));
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.dataset.panelWork = "";
    let armed = false;
    remove.addEventListener("click", () => {
      if (!listed()) return;
      // The first press only arms deletion.
      if (!armed) {
        armed = true;
        remove.textContent = "Confirm";
        return;
      }
      void perform(async (current) => {
        await options.removeSave(entry.id);
        if (!current()) return;
        item.remove();
        if (!saveEntries.childElementCount) showEmptySaves();
      }, true);
    });
    item.append(label, load, remove);
    return item;
  };
  async function showSaves() {
    showPanel("load");
    const loading = document.createElement("li");
    loading.textContent = "Loading saved missions…";
    saveEntries.append(loading);
    saveEntries.setAttribute("aria-busy", "true");
    await perform(async (current) => {
      try {
        const entries = await options.listSaves();
        if (!current()) return;
        if (!entries.length) showEmptySaves();
        for (const entry of entries)
          saveEntries.append(saveRow(entry, current));
        syncAvailability();
      } finally {
        if (current()) {
          loading.remove();
          saveEntries.setAttribute("aria-busy", "false");
        }
      }
    });
  }
  /** Saves or exports, reporting the outcome only to the requesting panel. */
  const saveWork = (
    work: () => Promise<string | undefined>,
    after?: () => void,
  ) =>
    void perform(async (current) => {
      const message = await work();
      if (message === undefined || !current()) return;
      after?.();
      report(message);
    }, true);

  const click = (id: string, action: () => void) =>
    element(id).addEventListener(
      "click",
      () => {
        if (!busy) action();
      },
      { signal },
    );
  const onEscape = (target: HTMLDialogElement, action: () => void) => {
    target.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape") return;
        // Repeated native close requests can become non-cancelable.
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) action();
      },
      { signal },
    );
    target.addEventListener(
      "cancel",
      (event) => {
        event.preventDefault();
        action();
      },
      { signal },
    );
  };
  onEscape(dialog, cancelMenu);
  onEscape(explanation, dismissGuide);
  click("dismiss-explanation", dismissGuide);
  click("resume-mission", () =>
    closeMenu(view?.mode === "menu" ? resumeOnClose : true),
  );
  click("inspect-loaded-mission", () => closeMenu(false));
  click("new-mission", () => showPanel("setup"));
  click("choose-arc", () => options.start("arc"));
  click("choose-circle", () => options.start("circle"));
  click("restart-mission", options.restart);
  click("exit-mission", () => void perform(options.exitToTitle));
  click("quit-game", () => void perform(options.quit));
  click("return-to-title", options.showTitle);
  click("open-options", () => showPanel("options"));
  for (const id of [
    "cancel-options",
    "cancel-mission-setup",
    "cancel-save",
    "cancel-load",
  ])
    click(id, () => showPanel("actions"));
  click("load-mission", () => void showSaves());
  click("import-mission", () => void perform(() => options.load()));
  click("save-mission", () => {
    showPanel("save");
    saveName.value = view?.mission?.saveName ?? "Mission";
    saveName.select();
  });
  const chosenName = () => saveName.value.trim() || "Mission";
  saveForm.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      const name = chosenName();
      saveWork(
        async () =>
          (await options.save("manual", name))
            ? saveCompleteMessage("manual", name)
            : undefined,
        () => showPanel("actions"),
      );
    },
    { signal },
  );
  click("quicksave-mission", () =>
    saveWork(async () =>
      (await options.save("quick", "Quicksave"))
        ? saveCompleteMessage("quick", "Quicksave")
        : undefined,
    ),
  );
  click("export-mission", () =>
    saveWork(async () => {
      const file = await options.export(chosenName());
      return file ? `Exported ${file}.` : undefined;
    }),
  );

  const resetMission = () => {
    if (disposed) return;
    invalidatePanel();
    pendingGuide = shownGuide = undefined;
    resumeOnClose = guideBlocked = false;
    menuMission = undefined;
    view = undefined;
    opener = undefined;
    explanation.close();
    dialog.close();
    status.textContent = "";
  };
  lifetime.defer(() => {
    try {
      resetMission();
    } finally {
      disposed = true;
    }
  });
  return {
    showMenu: (next: MenuView) => {
      if (
        disposed ||
        (next.mode === "menu" && (busy || dialog.open || explanation.open))
      )
        return;
      if (shownGuide) {
        // A result preempts the guide, which returns after continuation.
        pendingGuide = shownGuide.popup;
        shownGuide = undefined;
        explanation.close();
      } else if (!dialog.open) opener = focusedElement();
      menuMission = options.mission();
      resumeOnClose = next.mode === "menu" && !!menuMission?.playing();
      if (next.mission) menuMission?.pause();
      guideBlocked = next.mode === "victory" || next.mode === "defeat";
      view = next;
      for (const [id, available] of Object.entries(CONTROL_RULES))
        element(id).hidden = !available(next);
      resume.textContent =
        next.mode === "menu" && !resumeOnClose
          ? "Close"
          : (next.continueLabel ?? "Resume");
      version.hidden = !!next.mission;
      dialog.classList.toggle("title-menu", !next.mission);
      if (!dialog.open) dialog.showModal();
      showPanel("actions");
    },
    offerGuide: (popup: ScenarioPopup) => {
      if (disposed) return;
      pendingGuide = popup;
      showGuide();
    },
    report,
    setBusy: (value: boolean) => {
      if (disposed) return;
      const wasBusy = busy;
      busy = value;
      syncAvailability();
      if (wasBusy && !busy) restorePanelFocus();
      if (!busy) showGuide();
    },
    resetMission,
  };
}
