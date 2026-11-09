/** Shared checks for untrusted saved state and authored definitions. */

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export const isIdList = (ids: unknown): ids is string[] =>
  Array.isArray(ids) &&
  Array.from(ids).every(isId) &&
  new Set(ids).size === ids.length;

export const isPositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export const isNonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Whether a value is one of a fixed set, such as an authored enum. */
export const isOneOf = <T>(values: readonly T[], value: unknown): value is T =>
  (values as readonly unknown[]).includes(value);

/** A non-negative safe integer, such as a tick or an amount. */
export const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

/** Whether a value survives a JSON round trip unchanged. */
export function isJson(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    return false;
  ancestors.add(value);
  const valid = (
    Array.isArray(value) ? Array.from(value) : Object.values(value)
  ).every((entry) => isJson(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

/** Ignores inherited names such as `constructor` in authored dictionaries. */
export const hasOwn = (record: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);
