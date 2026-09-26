// Writes the placeholder infantry GLBs that `infantry-model.ts` builds.
import { mkdir, writeFile } from "node:fs/promises";

import { exportInfantry, INFANTRY_ROLES } from "./infantry-model.ts";

const output = new URL("../public/assets/actors/", import.meta.url);
await mkdir(output, { recursive: true });
for (const role of INFANTRY_ROLES) {
  await writeFile(
    new URL(`arc-${role}.glb`, output),
    await exportInfantry(role),
  );
}
