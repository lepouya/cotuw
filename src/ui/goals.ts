import type { ObjectiveStatus } from "../simulation/objectives";
import { createElement as el, createKeyedList, setText } from "./dom";

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
  return createKeyedList<GoalEntry>(
    list,
    ({ id }) => id,
    ({ id }) => {
      const label = el(emphasis ? "strong" : "span");
      const directive = el("p", { class: "goal-directive muted" });
      const node = el("li", { "data-goal-id": id }, label, directive);
      return {
        node,
        update: (goal) => {
          const progress = goal.progress;
          setText(
            label,
            `${MARKS[goal.status]} ${goal.label}` +
              (progress
                ? ` (${progress.current}${progress.total === undefined ? "" : `/${progress.total}`})`
                : ""),
          );
          setText(directive, goal.directive ?? "");
          directive.hidden = !goal.directive;
          node.className = CLASSES[goal.status];
        },
      };
    },
  );
}
