import { fileURLToPath } from "node:url";
import { preparePlaytest } from "./playtest-build.ts";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--allow-dirty"))
  throw new Error("Usage: npm run playtest:build -- [--allow-dirty]");

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = await preparePlaytest(root, {
  allowDirty: args.includes("--allow-dirty"),
});
console.log(
  `Prepared playtest/ at ${manifest.revision}${manifest.distributionReady ? "" : " (local preview; modified sources)"}.`,
);
