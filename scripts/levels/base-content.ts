import { currentContentPack } from "../../src/content/packs.ts";
import { costAmount } from "../../src/simulation/economy.ts";

export const BASE_CONTENT = currentContentPack("base");

export function actorDefinition(id: string) {
  const definition = BASE_CONTENT.actors.find((actor) => actor.id === id);
  if (!definition) throw new RangeError(`Unknown base actor: ${id}.`);
  return definition;
}

/** Authored guidance follows content tuning. */
export const costOf = (id: string) => costAmount(actorDefinition(id));
