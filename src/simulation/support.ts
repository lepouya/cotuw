import { deepFreeze } from "./actor";
import type { ActorDefinition, ActorRenderState, DeepReadonly } from "./actor";
import type { WorldPosition } from "./world";

export type SupportNode = {
  actorId: string;
  center: Readonly<WorldPosition>;
  radius: number;
  complete: boolean;
  root: boolean;
  connected: boolean;
};
export type SupportNetwork = {
  nodes: SupportNode[];
  links: { from: string; to: string; active: boolean }[];
};

export type SupportView = DeepReadonly<SupportNetwork>;

/** Cache topology for fixed definitions; staged actors may change in place. */
export function createSupportResolver(
  definitions: ReadonlyMap<string, ActorDefinition>,
) {
  let previousActors: readonly ActorRenderState[] | undefined;
  let key = "";
  let network: SupportView;
  return (actors: readonly ActorRenderState[]): SupportView => {
    if (actors === previousActors && Object.isFrozen(actors)) return network;
    const next = JSON.stringify(
      actors
        .filter(
          (actor) =>
            actor.tilePlacement && definitions.get(actor.definitionId)?.support,
        )
        .map((actor) => [
          actor.id,
          actor.definitionId,
          actor.worldPosition.x,
          actor.worldPosition.z,
          !actor.construction,
        ]),
    );
    if (next !== key) {
      network = deepFreeze(createSupportNetwork(actors, definitions));
      key = next;
    }
    previousActors = actors;
    return network;
  };
}

export function validateSupportDefinition(definition: ActorDefinition) {
  const support = definition.support;
  if (
    support &&
    (!definition.footprint ||
      !Number.isFinite(support.radius) ||
      support.radius <= 0 ||
      (support.root !== undefined && typeof support.root !== "boolean"))
  )
    throw new RangeError(`Invalid support definition: ${definition.id}.`);
}

/** Completed nodes link when either center is covered; blueprints never relay. */
export function createSupportNetwork(
  actors: readonly ActorRenderState[],
  definitions: ReadonlyMap<string, ActorDefinition>,
): SupportNetwork {
  const nodes: SupportNode[] = actors
    .flatMap((actor) => {
      const support = definitions.get(actor.definitionId)?.support;
      return actor.tilePlacement && support
        ? [
            {
              actorId: actor.id,
              center: { ...actor.worldPosition },
              radius: support.radius,
              complete: !actor.construction,
              root: support.root === true,
              connected: !actor.construction && support.root === true,
            },
          ]
        : [];
    })
    .sort((a, b) =>
      a.actorId < b.actorId ? -1 : a.actorId > b.actorId ? 1 : 0,
    );
  const distance = (a: SupportNode, b: SupportNode) =>
    Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z);
  const edges: [SupportNode, SupportNode][] = [];
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i],
        b = nodes[j];
      if (
        a.complete &&
        b.complete &&
        distance(a, b) <= Math.max(a.radius, b.radius)
      )
        edges.push([a, b]);
    }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [a, b] of edges) {
      if (a.connected === b.connected) continue;
      a.connected = b.connected = true;
      changed = true;
    }
  }
  for (const node of nodes)
    if (!node.complete)
      node.connected = supportsPosition({ nodes }, node.center);
  return {
    nodes,
    links: edges.map(([a, b]) => ({
      from: a.actorId,
      to: b.actorId,
      active: a.connected && b.connected,
    })),
  };
}

/** New blueprints must place their center inside operational coverage. */
export function supportsPosition(
  network: Pick<SupportView, "nodes">,
  point: Readonly<WorldPosition>,
) {
  return network.nodes.some(
    (node) =>
      node.complete &&
      node.connected &&
      Math.hypot(node.center.x - point.x, node.center.z - point.z) <=
        node.radius,
  );
}

export function disconnectedBuildings(
  network: SupportView | undefined,
): Set<string> {
  return new Set(
    network?.nodes
      .filter((node) => !node.connected)
      .map((node) => node.actorId),
  );
}
