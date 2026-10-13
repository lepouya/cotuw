import { createLifetime } from "../lifetime";

/** Owns disposable views keyed by stable IDs, with adapter-defined revisions. */
export function createViewRegistry<
  State extends { readonly id: string },
  Key,
  View extends { dispose: () => void },
>(adapter: {
  keyFor: (state: State) => Key;
  create: (state: State, key: Key) => View;
  sameKey?: (left: Key, right: Key) => boolean;
  /** Runs only when an ID leaves the registry. */
  onRemove?: (id: string) => void;
  /** Keeps an ID's state when its view changes, such as after an asset load. */
  onReplace?: (id: string, previous: Key, next: Key) => void;
}) {
  const views = new Map<string, { key: Key; view: View }>();
  let disposed = false;
  /** Forgets the view before disposing it, so a failed cleanup still leaves. */
  const release = (id: string, view: View, after?: () => void) => {
    views.delete(id);
    try {
      view.dispose();
    } finally {
      after?.();
    }
  };
  const remove = (id: string) => {
    const entry = views.get(id);
    if (entry) release(id, entry.view, () => adapter.onRemove?.(id));
  };
  return {
    get: (id: string) => views.get(id)?.view,
    has: (id: string) => views.has(id),
    values: () => [...views.values()].map(({ view }) => view),
    sync: (states: readonly State[]) => {
      const present = new Set(states.map(({ id }) => id));
      for (const id of views.keys()) if (!present.has(id)) remove(id);
      // Adapter callbacks may dispose the registry; check after each one.
      for (const state of states) {
        if (disposed) return;
        const key = adapter.keyFor(state);
        const existing = views.get(state.id);
        const unchanged =
          existing && (adapter.sameKey ?? Object.is)(existing.key, key);
        if (disposed) return;
        if (existing && !unchanged)
          release(state.id, existing.view, () =>
            adapter.onReplace?.(state.id, existing.key, key),
          );
        if (disposed || views.has(state.id)) continue;
        const view = adapter.create(state, key);
        if (disposed) view.dispose();
        else views.set(state.id, { key, view });
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      const cleanup = createLifetime();
      for (const id of views.keys()) cleanup.defer(() => remove(id));
      cleanup.dispose();
    },
  };
}
