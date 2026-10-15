import type { ActorDefinition } from "../simulation/actor";

type PortraitRole =
  "refinery" | "headquarters" | "building" | "harvester" | "armed" | "unarmed";

/** Picks an illustration from the gameplay role the definition declares. */
const portraitRole = (definition: ActorDefinition): PortraitRole =>
  definition.footprint
    ? definition.refinery
      ? "refinery"
      : definition.support?.root
        ? "headquarters"
        : "building"
    : definition.harvesting
      ? "harvester"
      : definition.weapon
        ? "armed"
        : "unarmed";

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

/** Small original illustrations drawn in a 120 × 80 view box. */
const PORTRAITS: Record<PortraitRole, string> = {
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
): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 120 80");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("actor-portrait");
  svg.innerHTML = PORTRAITS[portraitRole(definition)];
  return svg;
}
