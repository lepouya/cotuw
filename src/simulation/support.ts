import { deepFreeze } from "./actor";
import type { ActorDefinition, ActorRenderState, DeepReadonly } from "./actor";
import { compareIds } from "./actor";
import { distance } from "./world";
import { isPositive } from "./validation";
import type { WorldPosition } from "./world";

export type SupportNode = {
  actorId: string;
  owner: string;
  faction?: string;
  center: Readonly<WorldPosition>;
  radius: number;
  complete: boolean;
  root: boolean;
  connected: boolean;
  /** Owners of the operational roots supplying this node. */
  rootOwners: string[];
};
export type SupportNetwork = {
  nodes: SupportNode[];
  links: { from: string; to: string; active: boolean }[];
};

export type SupportView = DeepReadonly<SupportNetwork>;

/** Whether one owner's support covers another's buildings. */
export type SharesSupport = (left: string, right: string) => boolean;

/**
 * Cache topology for fixed definitions; staged actors may change in place.
 * Pass a new `sharesSupport` whenever relationships change.
 */
export function createSupportResolver(
  definitions: ReadonlyMap<string, ActorDefinition>,
) {
  let previousActors: readonly ActorRenderState[] | undefined;
  let previousSharing: SharesSupport | undefined;
  let key = "";
  let network: SupportView;
  return (
    actors: readonly ActorRenderState[],
    sharesSupport: SharesSupport,
  ): SupportView => {
    if (
      actors === previousActors &&
      sharesSupport === previousSharing &&
      Object.isFrozen(actors)
    )
      return network;
    const next = JSON.stringify(
      actors
        .filter(
          (actor) =>
            actor.tilePlacement && definitions.get(actor.definitionId)?.support,
        )
        .map((actor) => [
          actor.id,
          actor.definitionId,
          actor.owner,
          actor.worldPosition.x,
          actor.worldPosition.z,
          !actor.construction,
        ]),
    );
    if (next !== key || sharesSupport !== previousSharing) {
      network = deepFreeze(
        createSupportNetwork(actors, definitions, sharesSupport),
      );
      key = next;
    }
    previousActors = actors;
    previousSharing = sharesSupport;
    return network;
  };
}

export function validateSupportDefinition(definition: ActorDefinition) {
  const support = definition.support;
  if (
    support &&
    (!definition.footprint ||
      !isPositive(support.radius) ||
      (support.root !== undefined && typeof support.root !== "boolean"))
  )
    throw new RangeError(`Invalid support definition: ${definition.id}.`);
}

/** Completed nodes link when either center is covered; blueprints never relay. */
export function createSupportNetwork(
  actors: readonly ActorRenderState[],
  definitions: ReadonlyMap<string, ActorDefinition>,
  sharesSupport: SharesSupport,
): SupportNetwork {
  const nodes: SupportNode[] = actors
    .flatMap((actor) => {
      const definition = definitions.get(actor.definitionId);
      const support = definition?.support;
      return actor.tilePlacement && support
        ? [
            {
              actorId: actor.id,
              owner: actor.owner,
              faction: definition.faction,
              center: { ...actor.worldPosition },
              radius: support.radius,
              complete: !actor.construction,
              root: support.root === true,
              connected: false,
              rootOwners: [],
            },
          ]
        : [];
    })
    .sort((a, b) => compareIds(a.actorId, b.actorId));
  const edges: [SupportNode, SupportNode][] = [];
  const neighbors = new Map(nodes.map((node) => [node, [] as SupportNode[]]));
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!,
        b = nodes[j]!;
      if (
        a.complete &&
        b.complete &&
        a.faction === b.faction &&
        sharesSupport(a.owner, b.owner) &&
        distance(a.center, b.center) <= Math.max(a.radius, b.radius)
      ) {
        edges.push([a, b]);
        neighbors.get(a)!.push(b);
        neighbors.get(b)!.push(a);
      }
    }
  const roots = nodes.filter((node) => node.complete && node.root);
  // A root cannot route power through an owner it does not share with.
  for (const owner of new Set(roots.map((node) => node.owner))) {
    const queue = roots.filter((node) => node.owner === owner);
    const visited = new Set(queue);
    for (const node of queue) {
      node.rootOwners.push(owner);
      node.connected = true;
      for (const neighbor of neighbors.get(node)!) {
        if (visited.has(neighbor) || !sharesSupport(owner, neighbor.owner))
          continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  for (const node of nodes)
    if (!node.complete) {
      node.rootOwners = [
        ...new Set(
          nodes.flatMap((source) =>
            source.complete &&
            source.faction === node.faction &&
            sharesSupport(source.owner, node.owner) &&
            distance(source.center, node.center) <= source.radius
              ? source.rootOwners.filter((owner) =>
                  sharesSupport(owner, node.owner),
                )
              : [],
          ),
        ),
      ];
      node.connected = node.rootOwners.length > 0;
    }
  return {
    nodes,
    links: edges.map(([a, b]) => ({
      from: a.actorId,
      to: b.actorId,
      active: a.rootOwners.some((owner) => b.rootOwners.includes(owner)),
    })),
  };
}

function supportAvailableTo(
  node: DeepReadonly<SupportNode>,
  owner: string,
  sharesSupport: SharesSupport,
) {
  return (
    sharesSupport(node.owner, owner) &&
    node.rootOwners.some((root) => sharesSupport(root, owner))
  );
}

/** Projects shared coverage into the requesting owner's usable network. */
export function supportForOwner(
  network: SupportView,
  owner: string,
  sharesSupport: SharesSupport,
): SupportView {
  const nodes = network.nodes
    .filter((node) => sharesSupport(node.owner, owner))
    .map((node) => ({
      ...node,
      rootOwners: node.rootOwners.filter((root) => sharesSupport(root, owner)),
      connected: supportAvailableTo(node, owner, sharesSupport),
    }));
  const byId = new Map(nodes.map((node) => [node.actorId, node]));
  return {
    nodes,
    links: network.links.flatMap((link) => {
      const a = byId.get(link.from),
        b = byId.get(link.to);
      return a && b
        ? [
            {
              ...link,
              active: a.rootOwners.some((root) => b.rootOwners.includes(root)),
            },
          ]
        : [];
    }),
  };
}

/** New blueprints need operational coverage their owner may use. */
export function supportsPosition(
  network: Pick<SupportView, "nodes">,
  point: Readonly<WorldPosition>,
  recipient: Pick<SupportNode, "owner" | "faction">,
  sharesSupport: SharesSupport,
) {
  return network.nodes.some(
    (node) =>
      node.complete &&
      node.faction === recipient.faction &&
      supportAvailableTo(node, recipient.owner, sharesSupport) &&
      distance(node.center, point) <= node.radius,
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
