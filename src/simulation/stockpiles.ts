import { compareIds } from "./actor";
import { costAmount, costResource, RESOURCE_IDS } from "./resources";
import { isCount, isId, isOneOf, isRecord } from "./validation";
import type { ActorDefinition, DeepReadonly } from "./actor";
import type { Resource } from "./resources";

/** One resource balance; several owners share it only when pooled. */
export type Stockpile = {
  resource: Resource;
  owners: string[];
  amount: number;
};
/** Resources one owner's workers delivered; pickups and refunds excluded. */
export type Deposit = { owner: string; resource: Resource; amount: number };
/** Owner balances and income, held in the economy state. */
export type Ledger = {
  /** Each owner holds at most one stockpile per resource. */
  stockpiles: Stockpile[];
  deposited: Deposit[];
};
type LedgerView = DeepReadonly<Ledger>;

/** Whether two owners pool their resources directly. */
export type SharesResources = (left: string, right: string) => boolean;

export function stockpileOf<T extends Ledger | LedgerView>(
  ledger: T,
  owner: string,
  resource: Resource,
): T["stockpiles"][number] | undefined {
  return ledger.stockpiles.find(
    (stockpile) =>
      stockpile.resource === resource && stockpile.owners.includes(owner),
  );
}
/** Absent when the owner holds no stockpile of the resource. */
export const balanceOf = (
  ledger: LedgerView,
  owner: string,
  resource: Resource,
) => stockpileOf(ledger, owner, resource)?.amount;
/** Balances of the resources an owner holds. */
export const resourceBalances = (
  ledger: LedgerView,
  owner: string,
): Partial<Record<Resource, number>> =>
  Object.fromEntries(
    RESOURCE_IDS.flatMap((id) => {
      const balance = balanceOf(ledger, owner, id);
      return balance === undefined ? [] : [[id, balance]];
    }),
  );
export function canAfford(
  ledger: LedgerView,
  owner: string,
  definition: ActorDefinition,
) {
  const balance = balanceOf(ledger, owner, costResource(definition));
  return balance !== undefined && balance >= costAmount(definition);
}
/** Pays a definition's price and returns the amount retained by its job. */
export function chargeCost(
  ledger: Ledger,
  owner: string,
  definition: ActorDefinition,
): number {
  const cost = costAmount(definition);
  // Callers check affordability first.
  stockpileOf(ledger, owner, costResource(definition))!.amount -= cost;
  return cost;
}
/**
 * Adds to an owner's stockpile. An owner without one gets its own, which
 * `regroupStockpiles` joins to the owner's pool.
 */
export function credit(
  ledger: Ledger,
  owner: string,
  resource: Resource,
  amount: number,
) {
  const stockpile = stockpileOf(ledger, owner, resource);
  if (stockpile) stockpile.amount += amount;
  else ledger.stockpiles.push({ resource, owners: [owner], amount });
}
/** Returns an amount in the resource that prices `definition`. */
export const refundCost = (
  ledger: Ledger,
  owner: string,
  definition: ActorDefinition,
  amount: number,
) => credit(ledger, owner, costResource(definition), amount);

const depositOf = <T extends Ledger | LedgerView>(
  ledger: T,
  owner: string,
  resource: Resource,
): T["deposited"][number] | undefined =>
  ledger.deposited.find(
    (entry) => entry.owner === owner && entry.resource === resource,
  );
/** Credits a worker delivery and records it as the owner's income. */
export function deposit(
  ledger: Ledger,
  owner: string,
  resource: Resource,
  amount: number,
) {
  credit(ledger, owner, resource, amount);
  const total = depositOf(ledger, owner, resource);
  if (total) total.amount += amount;
  else ledger.deposited.push({ owner, resource, amount });
}
export const depositedBy = (
  ledger: LedgerView,
  owner: string,
  resource: Resource,
) => depositOf(ledger, owner, resource)?.amount ?? 0;

/** Owners pooling resources, directly or through other members, by ID. */
export function resourcePools(
  owners: Iterable<string>,
  sharesResources: SharesResources,
): string[][] {
  const ids = [...owners].sort(compareIds);
  const placed = new Set<string>();
  const pools: string[][] = [];
  for (const id of ids) {
    if (placed.has(id)) continue;
    const pool = [id];
    placed.add(id);
    for (const member of pool)
      for (const other of ids)
        if (!placed.has(other) && sharesResources(member, other)) {
          placed.add(other);
          pool.push(other);
        }
    pools.push(pool.sort(compareIds));
  }
  return pools;
}
const sameOwners = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((id) => right.includes(id));
const poolsMatch = (ledger: LedgerView, pools: readonly string[][]) =>
  ledger.stockpiles.every((stockpile) =>
    pools.some((pool) => sameOwners(stockpile.owners, pool)),
  );

/**
 * Gives each pool one stockpile per resource its members hold. A separated
 * pool divides equally among its owners, earlier IDs taking remainders, so
 * totals are kept.
 */
export function regroupStockpiles(
  ledger: Ledger,
  owners: Iterable<string>,
  sharesResources: SharesResources,
) {
  const pools = resourcePools(owners, sharesResources);
  if (poolsMatch(ledger, pools)) return;
  const shares = new Map<Resource, Map<string, number>>();
  for (const { resource, owners, amount } of ledger.stockpiles) {
    const byOwner = shares.get(resource) ?? new Map<string, number>();
    shares.set(resource, byOwner);
    [...owners].sort(compareIds).forEach((owner, index) => {
      const share =
        Math.floor(amount / owners.length) +
        (index < amount % owners.length ? 1 : 0);
      byOwner.set(owner, (byOwner.get(owner) ?? 0) + share);
    });
  }
  ledger.stockpiles = RESOURCE_IDS.flatMap((resource) => {
    const byOwner = shares.get(resource);
    return pools.flatMap((pool) =>
      byOwner && pool.some((owner) => byOwner.has(owner))
        ? [
            {
              resource,
              owners: [...pool],
              amount: pool.reduce(
                (total, owner) => total + (byOwner.get(owner) ?? 0),
                0,
              ),
            },
          ]
        : [],
    );
  });
}

/** Validates balances, optionally requiring the current sharing pools. */
export function isValidLedger(
  ledger: Ledger,
  owners: ReadonlySet<string>,
  sharesResources?: SharesResources,
) {
  if (!Array.isArray(ledger.stockpiles) || !Array.isArray(ledger.deposited))
    return false;
  const listed = new Set<string>();
  /** Whether an owner-resource pair is valid and not yet listed. */
  const list = (owner: unknown, resource: unknown) => {
    const key = JSON.stringify([owner, resource]);
    if (
      !isId(owner) ||
      !owners.has(owner) ||
      !isOneOf(RESOURCE_IDS, resource) ||
      listed.has(key)
    )
      return false;
    listed.add(key);
    return true;
  };
  const stockpilesValid = ledger.stockpiles.every(
    (stockpile) =>
      isRecord(stockpile) &&
      isCount(stockpile.amount) &&
      Array.isArray(stockpile.owners) &&
      stockpile.owners.length > 0 &&
      stockpile.owners.every((owner) => list(owner, stockpile.resource)),
  );
  listed.clear();
  return (
    stockpilesValid &&
    (!sharesResources ||
      poolsMatch(ledger, resourcePools(owners, sharesResources))) &&
    ledger.deposited.every(
      (entry) =>
        isRecord(entry) &&
        isCount(entry.amount) &&
        list(entry.owner, entry.resource),
    )
  );
}
