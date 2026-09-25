/** A renderer-neutral horizontal position in continuous world units. */
export type WorldPosition = {
  x: number;
  z: number;
};

/** The playable world area, inclusive of its edges. */
export type WorldBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export function isFinitePosition({ x, z }: WorldPosition): boolean {
  return Number.isFinite(x) && Number.isFinite(z);
}

export function withinBounds(
  { x, z }: WorldPosition,
  { minX, maxX, minZ, maxZ }: WorldBounds,
): boolean {
  return x >= minX && x <= maxX && z >= minZ && z <= maxZ;
}

export function clampToBounds(
  { x, z }: WorldPosition,
  { minX, maxX, minZ, maxZ }: WorldBounds,
): WorldPosition {
  return {
    x: Math.min(Math.max(x, minX), maxX),
    z: Math.min(Math.max(z, minZ), maxZ),
  };
}
