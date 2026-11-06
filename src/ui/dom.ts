import { createLifetime } from "../lifetime";
import type { Lifetime } from "../lifetime";

type Attributes = Record<string, string | boolean>;

/** Creates native DOM with literal attributes and text-safe children. */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== false)
      element.setAttribute(name, value === true ? "" : value);
  }
  element.append(...children);
  return element;
}

/** Creates a button that never submits a form. */
export function createButton(label: string, attributes: Attributes = {}) {
  return createElement("button", { ...attributes, type: "button" }, label);
}

/**
 * Replaces an element's text only when it differs, so unchanged nodes keep
 * their selection, focus, and screen-reader position.
 */
export function setText(element: HTMLElement | undefined, text: string) {
  if (element && element.textContent !== text) element.textContent = text;
}

/** A keyed list row: its node and how it presents the latest item. */
export type KeyedRow<T> = {
  node: HTMLElement;
  update?: (item: T) => void;
  dispose?: () => void;
};

/**
 * Keeps one row per key in item order, so retained rows keep their nodes and
 * focus. Removed rows release their resources. Other children of `container`
 * stay after the rows. Disposing or aborting prevents further updates.
 */
export function createKeyedList<T>(
  container: HTMLElement,
  keyOf: (item: T) => string,
  createRow: (item: T) => KeyedRow<T>,
  signal?: AbortSignal,
) {
  const rows = new Map<string, KeyedRow<T>>();
  let disposed = false;
  const remove = (row: KeyedRow<T>) => {
    row.dispose?.();
    row.node.remove();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener("abort", dispose);
    for (const row of rows.values()) remove(row);
    rows.clear();
  };
  signal?.addEventListener("abort", dispose, { once: true });
  if (signal?.aborted) dispose();
  return {
    dispose,
    update: (items: readonly T[]) => {
      if (disposed) return;
      const focused = container.ownerDocument?.activeElement;
      const present = new Set(items.map(keyOf));
      for (const [key, row] of rows) {
        if (present.has(key)) continue;
        remove(row);
        rows.delete(key);
      }
      items.forEach((item, index) => {
        const key = keyOf(item);
        let row = rows.get(key);
        if (!row) {
          row = createRow(item);
          rows.set(key, row);
        }
        row.update?.(item);
        if (container.children[index] !== row.node)
          container.insertBefore(row.node, container.children[index] ?? null);
      });
      // Moving a connected row with insertBefore clears native focus.
      if (
        focused &&
        container.contains(focused) &&
        container.ownerDocument.activeElement ===
          container.ownerDocument.body &&
        focused instanceof HTMLElement
      )
        focused.focus({ preventScroll: true });
    },
  };
}

/** Listener, cleanup, and element access scoped to one feature root. */
export type FeatureScope = {
  lifetime: Lifetime;
  /** Aborts when the feature is disposed. */
  signal: AbortSignal;
  element: <T extends HTMLElement = HTMLElement>(id: string) => T;
};

/**
 * Renders owned markup into a feature root, then binds the feature to it.
 * Disposal or a failed bind releases resources and empties the root.
 */
export function mountFeature<T extends object>(
  root: HTMLElement,
  markup: string,
  bind: (scope: FeatureScope) => T,
): T & { dispose: () => void } {
  const lifetime = createLifetime();
  try {
    lifetime.defer(() => root.replaceChildren());
    root.innerHTML = markup;
    const controller = new AbortController();
    lifetime.defer(() => controller.abort());
    const element = <E extends HTMLElement = HTMLElement>(id: string) =>
      root.querySelector<E>(`#${id}`)!;
    const signal = controller.signal;
    return {
      ...bind({ lifetime, signal, element }),
      dispose: lifetime.dispose,
    };
  } catch (error) {
    try {
      lifetime.dispose();
    } catch (cleanupError) {
      console.error("Feature cleanup failed.", cleanupError);
    }
    throw error;
  }
}
