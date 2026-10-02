/** Owns disposable views keyed by stable IDs, with adapter-defined revisions. */
export function createViewRegistry<
  State extends { readonly id: string },
  Key,
  View extends { dispose: () => void },
>(adapter: {
  keyFor: (state: State) => Key;
  create: (state: State, key: Key) => View;
  sameKey?: (left: Key, right: Key) => boolean;
  onRemove?: (id: string) => void;
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
        if (existing && !(adapter.sameKey ?? Object.is)(existing.key, key))
          remove(state.id);
        if (!views.has(state.id))
          views.set(state.id, { key, view: adapter.create(state, key) });
      }
    },
    dispose: () => {
      for (const id of views.keys()) remove(id);
    },
  };
}
