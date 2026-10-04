// `npm run levels` regenerates these files, replacing hand edits.
import economyOpening from "./levels/arc-economy-opening.json?raw";
import sandbox from "./levels/sandbox.json?raw";

/** Bundled level files by scenario ID. */
export const LEVEL_SOURCES: ReadonlyMap<string, string> = new Map([
  ["arc-economy-opening", economyOpening],
  ["sandbox", sandbox],
]);
