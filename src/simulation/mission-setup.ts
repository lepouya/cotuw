import { createRelations } from "./ownership";
import { hasOwn, isIdList, isRecord } from "./validation";

import type { Owner, OwnerRelationship } from "./ownership";

/** Each `scale` multiplies enemy health and damage. */
export const DIFFICULTIES = {
  easy: { name: "Easy", scale: Math.SQRT1_2 },
  normal: { name: "Normal", scale: 1 },
  hard: { name: "Hard", scale: Math.SQRT2 },
} as const;

export type Difficulty = keyof typeof DIFFICULTIES;
export const DIFFICULTY_IDS = Object.keys(DIFFICULTIES) as Difficulty[];

/** The launch choices a mission keeps so restarts reproduce them. */
export type MissionSetup = {
  readonly difficulty: Difficulty;
  readonly enemyScale: number;
  /** Set at launch; later relationship changes do not alter scaling. */
  readonly enemyOwners: readonly string[];
  /** Faction by start slot in an assembled skirmish. */
  readonly factions?: Readonly<Record<string, string>>;
};

type SetupOwners = {
  readonly owners: readonly Owner[];
  readonly playerOwner: string;
  readonly relationships?: readonly OwnerRelationship[];
};

export const isDifficulty = (value: unknown): value is Difficulty =>
  typeof value === "string" && hasOwn(DIFFICULTIES, value);

/** Every owner outside the player's alliance counts as an enemy. */
export function resolveSetup(
  difficulty: Difficulty,
  { owners, playerOwner, relationships = [] }: SetupOwners,
  factions?: MissionSetup["factions"],
): MissionSetup {
  const relations = createRelations(relationships);
  return {
    difficulty,
    enemyScale: DIFFICULTIES[difficulty].scale,
    enemyOwners: owners
      .map(({ id }) => id)
      .filter((id) => relations.relationship(playerOwner, id) !== "allied"),
    ...(factions && { factions }),
  };
}

/** An owner's multiplier for damage dealt and effective health. */
export function combatScaling(setup: MissionSetup | undefined) {
  const enemies = new Set(setup?.enemyOwners);
  const scale = setup?.enemyScale ?? 1;
  return (owner: string) => (enemies.has(owner) ? scale : 1);
}

export function validateSetup(
  setup: MissionSetup | undefined,
  { owners, playerOwner }: SetupOwners,
  skirmish: boolean,
): void {
  if (setup === undefined) return;
  const ownerIds = new Set(owners.map(({ id }) => id));
  const factions = setup?.factions;
  if (
    !isRecord(setup) ||
    !isDifficulty(setup.difficulty) ||
    setup.enemyScale !== DIFFICULTIES[setup.difficulty].scale ||
    !isIdList(setup.enemyOwners) ||
    setup.enemyOwners.some((id) => !ownerIds.has(id) || id === playerOwner) ||
    (factions !== undefined &&
      (!skirmish ||
        !isRecord(factions) ||
        Object.keys(factions).length !== owners.length ||
        owners.some(
          ({ id, faction }) =>
            !hasOwn(factions, id) || factions[id] !== faction,
        )))
  )
    throw new RangeError("Mission has an invalid setup.");
}
