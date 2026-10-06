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
  const remove = (id: string) => {
    views.get(id)?.view.dispose();
    views.delete(id);
    adapter.onRemove?.(id);
  };
  return {
    get: (id: string) => views.get(id)?.view,
    has: (id: string) => views.has(id),
    values: () => [...views.values()].map(({ view }) => view),
    sync: (states: readonly State[]) => {
      const present = new Set(states.map(({ id }) => id));
      for (const id of views.keys()) if (!present.has(id)) remove(id);
      for (const state of states) {
        const key = adapter.keyFor(state);
        const existing = views.get(state.id);
        if (existing && !(adapter.sameKey ?? Object.is)(existing.key, key)) {
          existing.view.dispose();
          views.delete(state.id);
          adapter.onReplace?.(state.id, existing.key, key);
        }
        if (!views.has(state.id))
          views.set(state.id, { key, view: adapter.create(state, key) });
      }
    },
    dispose: () => {
      for (const id of views.keys()) remove(id);
    },
  };
}
