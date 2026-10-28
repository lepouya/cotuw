/** Releases owned resources in reverse order, including after partial setup. */
export function createLifetime() {
  const cleanups: (() => void)[] = [];
  let disposed = false;
  const defer = (cleanup: () => void) => {
    if (disposed) cleanup();
    else cleanups.push(cleanup);
  };
  return {
    defer,
    own: <T extends { dispose: () => void }>(resource: T): T => {
      defer(() => resource.dispose());
      return resource;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      let failed = false;
      let fault: unknown;
      for (const cleanup of cleanups.reverse()) {
        try {
          cleanup();
        } catch (error) {
          if (!failed) fault = error;
          failed = true;
        }
      }
      cleanups.length = 0;
      if (failed) throw fault;
    },
  };
}

export type Lifetime = ReturnType<typeof createLifetime>;
