import { compareIds } from "../simulation/actor";
import { setText } from "./dom";

export type IdleWorkerElements = {
  next: HTMLButtonElement;
  selectAll: HTMLButtonElement;
};

/** Cycles through idle workers in stable ID order, or selects them all. */
export function createIdleWorkerControls(
  elements: IdleWorkerElements | undefined,
  {
    idleIds,
    select,
    focus,
    enabled,
  }: {
    /** Sorted by `compareIds`. */
    idleIds: () => readonly string[];
    select: (ids: readonly string[]) => void;
    focus: (ids: readonly string[]) => void;
    enabled: () => boolean;
  },
) {
  const controller = new AbortController();
  let last: string | undefined;
  /** Selects and focuses the idle worker after the last one chosen. */
  const next = () => {
    if (!enabled()) return false;
    const ids = idleIds();
    if (!ids.length) return false;
    const after = last;
    const id =
      (after !== undefined && ids.find((id) => compareIds(id, after) > 0)) ||
      ids[0]!;
    last = id;
    const chosen = [id];
    select(chosen);
    focus(chosen);
    return true;
  };
  /** Selects every idle worker without moving the camera. */
  const selectAll = () => {
    if (!enabled()) return false;
    const ids = idleIds();
    if (!ids.length) return false;
    select(ids);
    return true;
  };
  elements?.next.addEventListener("click", next, { signal: controller.signal });
  elements?.selectAll.addEventListener("click", selectAll, {
    signal: controller.signal,
  });
  return {
    next,
    selectAll,
    refresh: () => {
      if (!elements) return;
      const count = idleIds().length;
      const disabled = !enabled() || !count;
      setText(elements.next, `Idle workers (${count})`);
      elements.next.disabled = disabled;
      elements.selectAll.disabled = disabled;
    },
    dispose: () => controller.abort(),
  };
}
