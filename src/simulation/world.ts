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

export function isFinitePosition(value: unknown): value is WorldPosition {
  const point = value as WorldPosition | null | undefined;
  return (
    !!point &&
    typeof point === "object" &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.z)
  );
}

export function withinBounds(
  { x, z }: WorldPosition,
  { minX, maxX, minZ, maxZ }: WorldBounds,
): boolean {
  return x >= minX && x <= maxX && z >= minZ && z <= maxZ;
}

export function distance(left: WorldPosition, right: WorldPosition): number {
  return Math.hypot(left.x - right.x, left.z - right.z);
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

/** Signed radians from one facing to another, turning the short way round. */
export function shortestTurn(from: number, to: number): number {
  const turn = to - from;
  return turn - Math.PI * 2 * Math.round(turn / (Math.PI * 2));
}
