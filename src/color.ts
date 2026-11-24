import type { Rgb } from "./content/presentation";

export function cssColor([red, green, blue]: Rgb): string {
  return `rgb(${red * 255} ${green * 255} ${blue * 255})`;
}
