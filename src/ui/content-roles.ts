import type { ActorDefinition } from "../simulation/actor";

/** Player-facing names of economy roles, taken from content. */
export function contentRoles(
  definitions: readonly ActorDefinition[],
  names: ReadonlyMap<string, string>,
  context: { definitionId?: string; faction?: string } = {},
) {
  const subject = definitions.find(({ id }) => id === context.definitionId);
  const faction = subject?.faction ?? context.faction;
  const candidates = definitions.filter(
    (definition) => faction === undefined || definition.faction === faction,
  );
  const refinery = subject?.refinery
    ? subject
    : candidates.find(
        ({ refinery }) =>
          refinery &&
          (!subject?.harvesting ||
            refinery.harvesterDefinitionId === subject.id),
      );
  const harvester = subject?.harvesting
    ? subject
    : (definitions.find(
        ({ id }) => id === refinery?.refinery?.harvesterDefinitionId,
      ) ?? candidates.find(({ harvesting }) => harvesting));
  const roleName = (
    definition: ActorDefinition | undefined,
    fallback: string,
  ) => names.get(definition?.id ?? "") || fallback;
  return {
    // Support paths lead to the headquarters that also supplies support.
    supportHub: roleName(
      candidates.find(
        ({ infrastructure, support }) => infrastructure && support,
      ),
      "headquarters",
    ),
    refinery: roleName(refinery, "Refinery"),
    harvester: roleName(harvester, "Harvester"),
  };
}

export type ContentRoles = ReturnType<typeof contentRoles>;
