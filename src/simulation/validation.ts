/** Shared checks for untrusted saved state and authored definitions. */

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export const isIdList = (ids: unknown): ids is string[] =>
  Array.isArray(ids) && ids.every(isId) && new Set(ids).size === ids.length;

export const isPositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/** Whether a value is one of a fixed set, such as an authored enum. */
export const isOneOf = <T>(values: readonly T[], value: unknown): value is T =>
  (values as readonly unknown[]).includes(value);

/** A non-negative safe integer, such as a tick or an amount. */
export const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
