// Writes the bundled level files, replacing any hand edits.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

// Vite transforms the app modules that the level definitions import.
const { module } = await runnerImport<typeof import("./levels/index.ts")>(
  fileURLToPath(new URL("levels/index.ts", import.meta.url)),
);
for (const [id, source] of module.buildLevels())
  await writeFile(
    new URL(`../src/content/levels/${id}.json`, import.meta.url),
    `${source}\n`,
  );
