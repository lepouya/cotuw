import type { TerrainBounds } from "../map";

/**
 * Versioned tile bounds whose navigation may have changed. Terrain edits and
 * future blockers such as structures record into the same log.
 */
export class NavigationChangeLog {
  private readonly historyLimit: number;
  private readonly history: { version: number; bounds: TerrainBounds }[] = [];
  private currentVersion = 0;
  private currentGeneration = 0;

  constructor(historyLimit: number) {
    this.historyLimit = historyLimit;
  }

  /** Increases with every recorded change. */
  get version(): number {
    return this.currentVersion;
  }

  /**
   * Increases when the log restarts at a restored version. Versions from an
   * earlier generation describe different terrain.
   */
  get generation(): number {
    return this.currentGeneration;
  }

  /** Continues from `version` with no history, as after loading a save. */
  restart(version: number): void {
    this.currentVersion = version;
    this.currentGeneration += 1;
    this.history.length = 0;
  }

  record(bounds: Readonly<TerrainBounds>): void {
    this.currentVersion += 1;
    this.history.push({ version: this.version, bounds: { ...bounds } });
    if (this.history.length > this.historyLimit) {
      this.history.shift();
    }
  }

  /** Changes after `version`, or `undefined` when retained history is too new. */
  since(version: number): readonly Readonly<TerrainBounds>[] | undefined {
    if (version === this.version) {
      return [];
    }
    const first = this.history[0];
    if (
      version < 0 ||
      version > this.version ||
      !first ||
      version < first.version - 1
    ) {
      return undefined;
    }
    return this.history
      .filter((change) => change.version > version)
      .map(({ bounds }) => bounds);
  }
}
