import {
  cultivationEfficiency,
  cultivationRouteBlocked,
  cultivationStatus,
} from "../simulation/cultivation";
import {
  headquarteredOwners,
  replacesHeadquarters,
} from "../simulation/infrastructure";

import type {
  ActorDefinition,
  ActorRenderState,
  DeepReadonly,
} from "../simulation/actor";
import type {
  CultivationSite,
  CultivatorState,
} from "../simulation/cultivation";

export const percent = (amount: number, total: number) =>
  Math.round((amount / total) * 100);

/** Reserve and efficiency as last observed by the player. */
export function cultivationSiteDetails(
  site: DeepReadonly<CultivationSite>,
  visible: boolean,
) {
  return {
    name: site.name,
    status: cultivationStatus(site),
    reservePercent: percent(site.reserve, site.capacity),
    efficiencyPercent: percent(cultivationEfficiency(site), 1),
    dormantAt: percent(site.dormantBelow, site.capacity),
    reopensAt: percent(site.recoverAt, site.capacity),
    dormant: site.dormant,
    visible,
  };
}

export type SiteSelection = ReturnType<typeof cultivationSiteDetails>;

export function cultivationSiteSummary(site: SiteSelection) {
  return [
    site.visible ? undefined : "Last seen",
    site.status,
    `${site.reservePercent}% reserve`,
    `${site.efficiencyPercent}% efficiency`,
    site.dormant ? `Recovery reopens it at ${site.reopensAt}%` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The same growth status drives the building, tender, and transition alerts. */
export function growthFeedback(
  actors: ReadonlyMap<string, ActorRenderState>,
  workers: readonly DeepReadonly<CultivatorState>[],
  definitions: ReadonlyMap<string, ActorDefinition>,
  emergencyHeadquarters?: boolean,
) {
  const tenders = new Map(
    workers.flatMap((worker) =>
      worker.tendingId ? [[worker.tendingId, worker] as const] : [],
    ),
  );
  const rules = { definitions, emergencyHeadquarters };
  const headquartered = emergencyHeadquarters
    ? headquarteredOwners([...actors.values()], definitions)
    : new Set<string>();
  const states = new Map<string, GrowthStatus>();
  for (const building of actors.values()) {
    if (
      !building.construction ||
      !definitions.get(building.definitionId)?.growth
    )
      continue;
    const tender = tenders.get(building.id);
    const movement = tender && actors.get(tender.actorId)?.movement;
    let status: GrowthStatus;
    if (building.construction.active) status = "growing";
    else if (!tender) status = "untended";
    else if (cultivationRouteBlocked(tender, movement))
      status = "route-blocked";
    else if (
      !building.headquartersId &&
      !replacesHeadquarters(building, headquartered, rules)
    )
      status = "unhosted";
    else status = movement ? "travelling" : "waiting";
    states.set(building.id, status);
  }
  return states;
}

export type GrowthStatus =
  | "growing"
  | "untended"
  | "unhosted"
  | "route-blocked"
  | "travelling"
  | "waiting";
