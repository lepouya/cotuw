import type { ObjectiveStatus } from "../simulation/objectives";
import { setText } from "./dom";

export type GoalEntry = {
  id: string;
  label: string;
  status: ObjectiveStatus;
  directive?: string;
  progress?: { current: number; total?: number };
};

const MARKS: Record<ObjectiveStatus, string> = {
  active: "○",
  complete: "✓",
  failed: "✗",
};
const CLASSES: Record<ObjectiveStatus, string> = {
  active: "",
  complete: "goal-complete",
  failed: "goal-failed",
};

/** Reconciles keyed entries while keeping unchanged nodes and focus intact. */
export function createGoalList(list: HTMLElement, emphasis = false) {
  list.replaceChildren();
  const entries = new Map<
    string,
    { item: HTMLLIElement; label: HTMLElement; directive: HTMLParagraphElement }
  >();
  return {
    update: (goals: readonly GoalEntry[]) => {
      const present = new Set(goals.map(({ id }) => id));
      for (const [id, entry] of entries) {
        if (present.has(id)) continue;
        entry.item.remove();
        entries.delete(id);
      }
      for (const [index, goal] of goals.entries()) {
        let entry = entries.get(goal.id);
        if (!entry) {
          const item = document.createElement("li");
          item.dataset.goalId = goal.id;
          const label = document.createElement(emphasis ? "strong" : "span");
          const directive = document.createElement("p");
          directive.className = "goal-directive muted";
          item.append(label, directive);
          entry = { item, label, directive };
          entries.set(goal.id, entry);
        }
        if (list.children[index] !== entry.item)
          list.insertBefore(entry.item, list.children[index] ?? null);
        const progress = goal.progress;
        const text =
          `${MARKS[goal.status]} ${goal.label}` +
          (progress
            ? ` (${progress.current}${progress.total === undefined ? "" : `/${progress.total}`})`
            : "");
        setText(entry.label, text);
        const directive = goal.directive ?? "";
        setText(entry.directive, directive);
        entry.directive.hidden = !directive;
        const className = CLASSES[goal.status];
        if (entry.item.className !== className)
          entry.item.className = className;
      }
    },
  };
}
