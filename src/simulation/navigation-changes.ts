import type { TerrainBounds } from "./grid";
import type { OccupancyLayer } from "./occupancy";

export type NavigationChangeEffect = "increase" | "decrease" | "mixed" | "none";

export type NavigationChange = {
  bounds: TerrainBounds;
  /** Omitted when every occupancy layer may be affected. */
  layers?: OccupancyLayer[];
  effect: NavigationChangeEffect;
};

/** Queries for navigation consumers, which never record or restart. */
export type NavigationChangeView = Pick<
  NavigationChangeLog,
  "version" | "generation" | "since" | "entriesSince"
>;

/**
 * Versioned tile bounds whose navigation may have changed. Terrain edits and
 * actor footprints record into the same log.
 */
export class NavigationChangeLog {
  private readonly historyLimit: number;
  private readonly history: (NavigationChange & { version: number })[] = [];
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
    if (!Number.isSafeInteger(version) || version < 0) {
      throw new RangeError("Invalid navigation version.");
    }
    this.currentVersion = version;
    this.currentGeneration += 1;
    this.history.length = 0;
  }

  record(
    bounds: Readonly<TerrainBounds>,
    {
      layers,
      effect = "mixed",
    }: {
      layers?: readonly OccupancyLayer[];
      effect?: NavigationChangeEffect;
    } = {},
  ): void {
    this.currentVersion += 1;
    this.history.push({
      version: this.version,
      bounds: { ...bounds },
      layers: layers && [...layers],
      effect,
    });
    if (this.history.length > this.historyLimit) {
      this.history.shift();
    }
  }

  /** Changes after `version`, or `undefined` when retained history is too new. */
  since(version: number): readonly Readonly<TerrainBounds>[] | undefined {
    return this.entriesSince(version)?.map(({ bounds }) => bounds);
  }

  /** Detailed changes after `version`, optionally limited to one layer. */
  entriesSince(
    version: number,
    layer?: OccupancyLayer,
  ): readonly Readonly<NavigationChange>[] | undefined {
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
      .filter(
        (change) =>
          layer === undefined ||
          change.layers === undefined ||
          change.layers.includes(layer),
      )
      .map(({ bounds, layers, effect }) => ({
        bounds: { ...bounds },
        layers: layers && [...layers],
        effect,
      }));
  }
}
