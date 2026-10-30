import { SAVE_KIND_LABELS, saveCompleteMessage } from "../saves";
import { mountFeature } from "./dom";
import { formatElapsed } from "./top-bar";
import markup from "./save-panel.html?raw";
import "./save-panel.css";

import type { SaveEntry, SaveKind } from "../saves";
import type { FeatureScope } from "./dom";

/** Application operations; reading, validation, and storage stay behind them. */
export type SaveOperations = {
  listSaves: () => Promise<SaveEntry[]>;
  removeSave: (id: string) => Promise<void>;
  /** Loads a stored save, or an imported file without an ID. */
  load: (id?: string) => Promise<void>;
  /** Resolves false when the mission changed before the write finished. */
  save: (kind: Exclude<SaveKind, "auto">, name: string) => Promise<boolean>;
  /** Resolves the exported file name, if the export completed. */
  export: (name: string) => Promise<string | undefined>;
};

/** The dialog services the panel works through. */
type SavePanelHost = {
  /**
   * Runs work for the open panel. `current` turns false once the panel
   * changes; `lock` disables other panel work until it finishes.
   */
  perform: (
    work: (current: () => boolean) => Promise<void>,
    lock?: boolean,
  ) => Promise<void>;
  report: (message: string) => void;
  /** Applies menu availability to newly added controls. */
  refresh: () => void;
  /** Returns to the menu actions. */
  back: () => void;
};

/** Save naming, the saved-mission list, and their local feedback. */
export function createSavePanel(
  root: HTMLElement,
  operations: SaveOperations,
  host: SavePanelHost,
) {
  return mountFeature(root, markup, (scope) =>
    bindSavePanel(root.ownerDocument, operations, host, scope),
  );
}

function bindSavePanel(
  document: Document,
  operations: SaveOperations,
  host: SavePanelHost,
  { signal, element }: FeatureScope,
) {
  const saveForm = element<HTMLFormElement>("save-form");
  const saveName = element<HTMLInputElement>("save-name");
  const loadPanel = element("load-panel");
  const saveEntries = element("save-entries");

  const showEmptySaves = () => {
    const empty = document.createElement("li");
    empty.textContent = "No saved missions yet.";
    saveEntries.append(empty);
  };
  const button = (text: string) => {
    const control = document.createElement("button");
    control.type = "button";
    control.textContent = text;
    control.dataset.panelWork = "";
    return control;
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
    if (entry.incompatible !== undefined) {
      const reason = document.createElement("small");
      reason.className = "save-incompatible";
      reason.textContent = `Incompatible: ${entry.incompatible}`;
      label.append(reason);
    }
    item.append(label);
    // Loading would only fail, so incompatible saves offer deletion alone.
    if (entry.incompatible === undefined) {
      const load = button("Load");
      load.addEventListener("click", () => {
        if (listed()) void host.perform(() => operations.load(entry.id));
      });
      item.append(load);
    }
    const remove = button("Delete");
    let armed = false;
    remove.addEventListener("click", () => {
      if (!listed()) return;
      // The first press only arms deletion.
      if (!armed) {
        armed = true;
        remove.textContent = "Confirm";
        return;
      }
      void host.perform(async (current) => {
        await operations.removeSave(entry.id);
        if (!current()) return;
        item.remove();
        if (!saveEntries.childElementCount) showEmptySaves();
      }, true);
    });
    item.append(remove);
    return item;
  };
  /** Saves or exports, reporting the outcome only to the requesting panel. */
  const saveWork = (
    work: () => Promise<string | undefined>,
    after?: () => void,
  ) =>
    void host.perform(async (current) => {
      const message = await work();
      if (message === undefined || !current()) return;
      after?.();
      host.report(message);
    }, true);
  const write = (
    kind: Exclude<SaveKind, "auto">,
    name: string,
    after?: () => void,
  ) =>
    saveWork(
      async () =>
        (await operations.save(kind, name))
          ? saveCompleteMessage(kind, name)
          : undefined,
      after,
    );
  const chosenName = () => saveName.value.trim() || "Mission";

  saveForm.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      write("manual", chosenName(), host.back);
    },
    { signal },
  );
  const click = (id: string, action: () => void) =>
    element(id).addEventListener("click", action, { signal });
  click("export-mission", () =>
    saveWork(async () => {
      const file = await operations.export(chosenName());
      return file ? `Exported ${file}.` : undefined;
    }),
  );
  click("import-mission", () => void host.perform(() => operations.load()));
  click("cancel-save", host.back);
  click("cancel-load", host.back);

  return {
    /** Panel content and opening focus, for the dialog's panel switching. */
    panels: {
      save: { content: saveForm, focus: () => saveName },
      load: { content: loadPanel, focus: () => element("import-mission") },
    },
    /** Fills the opened save form with a suggested name. */
    suggestName: (name: string) => {
      saveName.value = name;
      saveName.select();
    },
    quicksave: () => write("quick", "Quicksave"),
    /** Lists saves into the opened load panel. */
    showSaves: async () => {
      const loading = document.createElement("li");
      loading.textContent = "Loading saved missions…";
      saveEntries.append(loading);
      saveEntries.setAttribute("aria-busy", "true");
      await host.perform(async (current) => {
        try {
          const entries = await operations.listSaves();
          if (!current()) return;
          if (!entries.length) showEmptySaves();
          for (const entry of entries)
            saveEntries.append(saveRow(entry, current));
          host.refresh();
        } finally {
          if (current()) {
            loading.remove();
            saveEntries.setAttribute("aria-busy", "false");
          }
        }
      });
    },
    /** Drops listed rows when the panel changes. */
    clear: () => {
      saveEntries.replaceChildren();
      saveEntries.setAttribute("aria-busy", "false");
    },
  };
}
