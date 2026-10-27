import type { PortraitId } from "../content/presentation";
import type { ActorDefinition } from "../simulation/actor";

/** Uses authored art, falling back to a generic gameplay-role illustration. */
export const portraitIdFor = (
  definition: ActorDefinition,
  portrait?: PortraitId,
): PortraitId =>
  portrait ??
  (definition.footprint
    ? definition.refinery
      ? "refinery"
      : definition.support?.root
        ? "headquarters"
        : "building"
    : definition.harvesting
      ? "harvester"
      : definition.weapon
        ? "armed"
        : "unarmed");

const FOUNDATION = `
  <path fill="#233e42" d="M12 57 63 36 110 57 60 77Z"/>
  <path fill="#567875" d="M20 32 61 16 100 32 59 49Z"/>
  <path fill="#304c50" d="M20 32 59 49 59 69 20 51Z"/>
  <path fill="#42625f" d="M59 49 100 32 100 51 59 69Z"/>
  <path fill="#dab76e" d="M25 43 53 55 53 59 25 47Z"/>`;
const infantry = (vest: string, gear: string) => `
  <ellipse fill="#152b31" cx="62" cy="73" rx="30" ry="5"/>
  <path stroke="#6e8983" stroke-width="11" d="M51 48 45 72M68 48 76 72"/>
  <path fill="${vest}" d="M43 27 60 22 78 29 72 52 48 52Z"/>
  <path stroke="#adc1b5" stroke-width="8" d="M46 31 34 48M75 32 87 45"/>
  <path fill="#a6bbb0" d="M46 13Q60 0 74 13V24L60 30 46 24Z"/>
  <path fill="#1d424b" d="M49 16H72V22H49Z"/>${gear}`;

const GROVE_GROUND = `<ellipse fill="#142c29" cx="60" cy="70" rx="49" ry="8"/>`;
const elf = (mantle: string, gear: string) => `
  <ellipse fill="#142c29" cx="61" cy="73" rx="29" ry="5"/>
  <path fill="${mantle}" d="M45 27Q60 18 76 27L86 70 36 70Z"/>
  <path fill="#42604b" d="M48 29 70 29 76 69 61 73 44 68Z"/>
  <path fill="#d5c8a0" d="M50 31 55 30 56 68 51 69Z"/>
  <path fill="#c8a77f" d="M47 15 35 10 47 25M72 15 85 10 72 25"/>
  <path fill="#253d33" d="M46 14Q60 -1 74 14L72 29 49 29Z"/>
  <path fill="#dbbd97" d="M49 14Q60 7 71 14L69 28 60 33 51 27Z"/>
  <path fill="none" stroke="#bcad78" stroke-width="3" d="M48 14Q60 19 73 14"/>
  <path fill="#ac75dd" d="m60 15 3 4-3 4-3-4Z"/>
  <path fill="none" stroke="#d6bd96" stroke-width="5" stroke-linecap="round"
    d="M46 34 40 48 52 52M73 34 81 47 70 52"/>
  ${gear}`;

/** Small original illustrations drawn in a 120 × 80 view box. */
const PORTRAITS: Record<PortraitId, string> = {
  "circle-cultivator": elf(
    "#43583a",
    `
    <path stroke="#bdab7c" stroke-width="4" fill="none" d="M79 63 83 29 91 19M83 29 77 19"/>
    <path fill="#a77ad0" d="m87 18 5-5 4 5-5 7Z"/>
    <ellipse fill="#8caf69" cx="37" cy="55" rx="10" ry="13"/>
    <path fill="none" stroke="#c9ba8b" stroke-width="3" d="M37 44V67M30 52 44 57"/>`,
  ),
  "circle-sentinel": elf(
    "#183e34",
    `
    <path fill="#c9c39b" d="M47 29Q34 22 31 39L44 36ZM73 29Q87 22 90 39L77 36Z"/>
    <path fill="#a7ad83" d="m53 32 7 5 8-5-3 16h-9Z"/>
    <path fill="none" stroke="#d5c79a" stroke-width="5" d="M49 54Q42 37 58 40M70 54Q78 37 62 40"/>
    <path fill="#be8bf0" d="M58 41Q68 40 65 50L59 55 54 49Z"/>
    <path fill="none" stroke="#cda6f6" stroke-width="2" d="m60 35-3-6 7-4M71 46l6-4 5 3"/>`,
  ),
  "circle-wayfinder": elf(
    "#205e46",
    `
    <path fill="#1c4939" d="M43 18Q47 -1 63 3Q80 4 79 29L70 26 71 13Q59 7 49 17L51 29 42 31Z"/>
    <path fill="none" stroke="#cbbb90" stroke-width="4" d="M84 70 87 20Q96 12 89 5"/>
    <path fill="#aa7edd" d="m88 8 4 5-5 7-3-5Z"/>
    <path fill="#6b9980" d="m44 36 12 4-7 24-9-5Z"/>`,
  ),
  "circle-heartgrove": `${GROVE_GROUND}
    <path fill="none" stroke="#b9ab7d" stroke-width="9" stroke-linecap="round"
      d="M60 65 60 23M30 68Q35 37 60 46Q84 38 92 68M60 46 36 25M60 39 84 18"/>
    <path fill="#245a3e" d="M18 25Q12 10 37 11Q47 0 61 8Q80 -1 89 14Q113 17 99 33L72 37 44 35Z"/>
    <path fill="#3e7750" d="M27 21Q37 10 55 16L51 28 30 29ZM65 13Q83 8 92 20L80 29 62 26Z"/>
    <path fill="#b289d6" d="m59 42 6 7-6 10-5-10Z"/>
    <path fill="none" stroke="#76abd1" stroke-width="3" d="M48 55 45 65M73 53 78 64"/>`,
  "circle-conservatory": `${GROVE_GROUND}
    <path fill="none" stroke="#bcb084" stroke-width="6" d="M22 64Q20 19 60 22Q100 19 100 64M38 67Q35 24 60 22Q86 24 84 66"/>
    <path fill="#204c37" d="M15 36Q20 8 60 16Q101 8 107 36L79 33 60 25 41 34Z"/>
    <path fill="#3d7850" d="M60 17Q22 11 15 36L44 29ZM62 17Q98 10 107 36L78 28Z"/>
    <ellipse fill="#c7b78c" cx="60" cy="62" rx="28" ry="10"/>
    <ellipse fill="#9162bb" cx="60" cy="59" rx="23" ry="7"/>
    <path fill="#d7b3ed" d="m58 41 5 5-3 8-5-5Z"/>`,
  "circle-musterhall": `${GROVE_GROUND}
    <path fill="#204b37" d="M19 51 38 18Q50 6 64 18L102 38 95 62 62 66Z"/>
    <path fill="#39704c" d="M39 18Q50 7 64 18L102 38 76 40Z"/>
    <path fill="none" stroke="#bdb28b" stroke-width="5"
      d="M20 61 32 31Q40 15 49 29L62 65M39 64 50 35Q59 19 68 33L81 67M62 65 73 39Q82 25 92 39L102 59"/>
    <path fill="#102e28" d="M76 67V51Q85 32 93 48V63Z"/>
    <path stroke="#83aed0" stroke-width="3" d="M85 39V50"/>`,
  refinery: `${FOUNDATION}
    <path fill="#8ea4a0" d="M70 14 82 10 94 14 94 38 82 44 70 38Z"/>
    <path fill="#527477" d="M70 14 82 19 94 14 82 10Z"/>
    <path fill="#dab76e" d="M35 23 45 19 53 23 53 34 43 38 35 34Z"/>
    <path stroke="#a7c7c4" stroke-width="4" fill="none" d="M45 22V12H65V25"/>`,
  headquarters: `${FOUNDATION}
    <path fill="#9ab1ab" d="M45 18 60 12 76 18 60 25Z"/>
    <path fill="#6d8c88" d="M45 18 60 25 76 18 76 28 60 35 45 28Z"/>
    <path stroke="#dab76e" stroke-width="3" d="M61 16V2M54 6H68"/>`,
  building: `${FOUNDATION}
    <path fill="#152b31" d="M68 47 89 38 89 54 68 63Z"/>
    <path stroke="#b9cac0" stroke-width="3" d="M29 27 43 32M38 23 53 28"/>
    <path stroke="#dab76e" stroke-width="3" d="M87 25V7"/>
    <path fill="#dab76e" d="M88 7 105 10 88 15Z"/>`,
  harvester: `
    <ellipse fill="#152b31" cx="61" cy="66" rx="43" ry="9"/>
    <path stroke="#17272c" stroke-width="12" d="M25 54 49 65M70 64 98 52"/>
    <path fill="#527477" d="M20 40 65 26 104 41 60 59Z"/>
    <path fill="#355257" d="M20 40 60 59 60 65 20 49Z"/>
    <path fill="#dab76e" d="M60 59 104 41 104 49 60 65Z"/>
    <path fill="#8da5a1" d="M55 29 80 20 96 26 96 41 70 51 55 43Z"/>
    <path fill="#173941" d="M31 33 49 27 60 32 60 42 44 48 31 42Z"/>
    <path stroke="#b8c9c1" stroke-width="5" d="M26 43V63"/>
    <path fill="#86d4b0" d="M20 63H32L26 72Z"/>`,
  armed: infantry(
    "#77938a",
    `<path stroke="#142a30" stroke-width="7" d="M37 43 93 34"/>
     <path stroke="#dab76e" stroke-width="3" d="M90 34 103 32"/>`,
  ),
  unarmed: infantry(
    "#dab76e",
    `<path fill="#19353d" d="M38 38H51V47H38ZM59 38H72V47H59Z"/>
     <path stroke="#9fc2c5" stroke-width="2" d="M75 14 81 3"/>`,
  ),
};

/** A decorative illustration for a production card. */
export function createActorPortrait(
  definition: ActorDefinition,
  portrait?: PortraitId,
): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 120 80");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("actor-portrait");
  const id = portraitIdFor(definition, portrait);
  svg.setAttribute("data-portrait", id);
  svg.innerHTML = PORTRAITS[id];
  return svg;
}
