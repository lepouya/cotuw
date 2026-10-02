export type Rgb = [number, number, number];

export function isRgb(value: unknown): value is Rgb {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      (channel) => Number.isFinite(channel) && channel >= 0 && channel <= 1,
    )
  );
}
