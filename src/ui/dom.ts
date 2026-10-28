import { createLifetime } from "../lifetime";
import type { Lifetime } from "../lifetime";

/**
 * Replaces an element's text only when it differs, so unchanged nodes keep
 * their selection, focus, and screen-reader position.
 */
export function setText(element: HTMLElement | undefined, text: string) {
  if (element && element.textContent !== text) element.textContent = text;
}

/** Listener, cleanup, and element access scoped to one feature root. */
export type FeatureScope = {
  lifetime: Lifetime;
  /** Aborts when the feature is disposed. */
  signal: AbortSignal;
  element: <T extends HTMLElement = HTMLElement>(id: string) => T;
};

/**
 * Binds a feature to its root, first rendering owned markup when given.
 * Disposal or a failed bind releases resources and removes that markup.
 */
export function mountFeature<T extends object>(
  root: HTMLElement,
  markup: string | undefined,
  bind: (scope: FeatureScope) => T,
): T & { dispose: () => void } {
  const lifetime = createLifetime();
  try {
    if (markup !== undefined) {
      lifetime.defer(() => root.replaceChildren());
      root.innerHTML = markup;
    }
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
