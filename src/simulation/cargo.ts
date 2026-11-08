import { RESOURCE_SCALE } from "./resources";
import type { Resource } from "./resources";
import { deposit } from "./stockpiles";
import type { Ledger } from "./stockpiles";
import { isCount, isId } from "./validation";
import type { EconomyWorld } from "./economy";

/** Collected amounts by site in `RESOURCE_SCALE` units, oldest first. */
export type CargoSource = { siteId: string; amount: number };
type CargoWorker = {
  actorId: string;
  cargo: number;
  cargoSources?: CargoSource[];
};

export function gatherCargo(
  worker: Pick<CargoWorker, "cargoSources">,
  siteId: string,
  amount: number,
) {
  if (!amount) return;
  const sources = (worker.cargoSources ??= []);
  const last = sources[sources.length - 1];
  if (last?.siteId === siteId) last.amount += amount;
  else sources.push({ siteId, amount });
}

/** Banks whole cargo in collection order, keeping fractional remainders. */
export function depositCargo(
  ledger: Ledger,
  world: Pick<EconomyWorld, "income" | "deliver">,
  owner: string,
  resource: Resource,
  worker: CargoWorker,
  buildingId: string,
) {
  const sources = worker.cargoSources ?? [];
  const delivered: CargoSource[] = [];
  let remaining = worker.cargo * RESOURCE_SCALE;
  while (remaining > 0) {
    const source = sources[0]!;
    const amount = Math.min(remaining, source.amount);
    delivered.push({ siteId: source.siteId, amount });
    source.amount -= amount;
    remaining -= amount;
    if (!source.amount) sources.shift();
  }
  deposit(ledger, owner, resource, worker.cargo);
  world.income?.(owner, resource, worker.cargo, delivered);
  world.deliver(buildingId, worker.actorId);
  worker.cargo = 0;
}

/** Whether sources attribute exactly `amount` to known sites. */
export function validCargoSources(
  worker: Pick<CargoWorker, "cargoSources">,
  amount: number,
  siteIds: ReadonlySet<string>,
): boolean {
  const sources = worker.cargoSources === undefined ? [] : worker.cargoSources;
  return (
    Array.isArray(sources) &&
    // `Array.from` visits holes in untrusted arrays, which `every` skips.
    Array.from(sources).every(
      (source) =>
        source &&
        isId(source.siteId) &&
        siteIds.has(source.siteId) &&
        isCount(source.amount) &&
        source.amount > 0,
    ) &&
    sources.reduce((total, source) => total + source.amount, 0) === amount
  );
}
