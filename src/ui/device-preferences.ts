/** Device preferences work in memory when the host blocks storage. */
export const devicePreferences = {
  read(key: string): string | null {
    try {
      return globalThis.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write(key: string, value: unknown) {
    try {
      globalThis.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // The live setting still applies.
    }
  },
};
