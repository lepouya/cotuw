import "./actor-portrait.css";
import type { PortraitId } from "../content/presentation";
import type { ActorDefinition } from "../simulation/actor";

/** The generic illustration for a gameplay role without authored art. */
function rolePortrait(definition: ActorDefinition): PortraitId {
  if (definition.footprint) {
    if (definition.refinery) return "refinery";
    return definition.support?.root ? "headquarters" : "building";
  }
  if (definition.harvesting) return "harvester";
  return definition.weapon ? "armed" : "unarmed";
}

const FOUNDATION = `
  <path fill="#233e42" d="M12 57 63 36 110 57 60 77Z"/>
  <path fill="#567875" d="M20 32 61 16 100 32 59 49Z"/>
  <path fill="#304c50" d="M20 32 59 49 59 69 20 51Z"/>
  <path fill="#42625f" d="M59 49 100 32 100 51 59 69Z"/>
  <path fill="#dab76e" d="M25 43 53 55 53 59 25 47Z"/>`;
const infantry = (
  vest: string,
  gear: string,
  { helmet = "#a6bbb0", visor = "#1d424b" } = {},
) => `
  <ellipse fill="#152b31" cx="62" cy="73" rx="30" ry="5"/>
  <path stroke="#6e8983" stroke-width="11" d="M51 48 45 72M68 48 76 72"/>
  <path fill="${vest}" d="M43 27 60 22 78 29 72 52 48 52Z"/>
  <path stroke="#adc1b5" stroke-width="8" d="M46 31 34 48M75 32 87 45"/>
  <path fill="${helmet}" d="M46 13Q60 0 74 13V24L60 30 46 24Z"/>
  <path fill="${visor}" d="M49 16H72V22H49Z"/>${gear}`;

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
  "arc-field-barracks": `
    <path fill="#233433" d="M11 57 29 37H108L112 64 92 72H11Z"/>
    <path fill="#636b4f" d="M15 43H96V65H15Z"/>
    <path fill="#485442" d="m96 43 14-16v20L96 65Z"/>
    <path fill="#969c7d" d="m15 43 17-17h78L96 43Z"/>
    <path fill="#727c64" d="M42 35 59 18H81L64 35Z"/>
    <path fill="#6d9ad2" d="m49 34 16-16h7L56 34Z"/>
    <path fill="#354646" d="M42 35H66V65H42Z"/>
    <path fill="#6d9ad2" d="M40 34H68V41H40Z"/>
    <path stroke="#fcf0bb" stroke-width="2" d="M45 43V50M63 43V50"/>
    <path fill="#9ba38b" d="M48 45H60V64H48Z"/>
    <path stroke="#45594e" stroke-width="2" d="M54 45V64"/>
    <path fill="#30484b" d="M20 47H38V54H20ZM70 47H91V54H70Z"/>
    <path stroke="#8cb0a6" stroke-width="2" d="M23 50H35M73 50H88"/>
    <path fill="#516355" d="m29 35 4-5h11l-4 5Z"/>
    <ellipse fill="#516355" cx="88" cy="32" rx="7" ry="4"/>`,
  "arc-relay-station": `
    <path fill="#233e42" d="m18 61 43-13 60 10-46 19Z"/>
    <path fill="#58727e" d="m28 46 41-13 23 9-39 15Z"/>
    <path fill="#30464f" d="m28 46 25 11v11L28 57Z"/>
    <path fill="#405b66" d="m53 57 39-15v12L53 68Z"/>
    <path fill="#6d9ad2" d="m28 48 25 11 39-15v5L53 64 28 53Z"/>
    <path stroke="#a8bfbe" stroke-width="5" d="M61 48V7"/>
    <path stroke="#6d9ad2" stroke-width="6" d="M36 15H86M39 28H83"/>
    <path stroke="#d7e5db" stroke-width="3" d="M36 10V20M86 10V20M39 23V33M83 23V33"/>`,
  "arc-sentry-turret": `
    <ellipse fill="#233e42" cx="59" cy="65" rx="42" ry="12"/>
    <path fill="#405b50" d="M32 49H86V62Q59 80 32 62Z"/>
    <ellipse fill="#7c9483" cx="59" cy="49" rx="27" ry="10"/>
    <path stroke="#6d9ad2" stroke-width="7" d="M44 49H76"/>
    <path fill="#415647" d="M32 26 60 16 82 26 55 40Z"/>
    <path fill="#2c4039" d="M32 26 55 40v16L32 43Z"/>
    <path fill="#607565" d="M55 40 82 26v17L55 56Z"/>
    <path stroke="#a5b7ad" stroke-width="9" d="M66 33 99 22M73 42 106 31"/>
    <path stroke="#182c30" stroke-width="5" d="m97 23 7-2m0 11 7-2"/>
    <path fill="#f0bd65" d="m37 32 9 5v5l-9-5Z"/>`,
  "arc-trooper": `
    <ellipse fill="#152b31" cx="59" cy="73" rx="32" ry="5"/>
    <path stroke="#303a43" stroke-width="13" d="m50 48-5 22m20-22 11 22"/>
    <path fill="#ad713a" d="m43 55 12 1-3 13-11-1Zm23 0 11-2 6 14-12 2Z"/>
    <path fill="#253039" d="M38 67H52V74H35ZM70 67H83L88 74H71Z"/>
    <path fill="#253039" d="M35 30 44 24 73 27 79 52 44 55Z"/>
    <path fill="#ae7036" d="m47 27 26 2-2 14-24 3-7-9Z"/>
    <path fill="#b7793d" d="m32 29 9-5 9 5-3 11-12-2Zm38 0 9-4 9 6-1 10-14-1Z"/>
    <path fill="#6e9ad1" d="m33 29 8-4 8 4-4 4h-9Zm39 1 7-4 8 6-4 3-9-1Z"/>
    <path fill="#ce9350" d="M45 11 52 5 66 3 76 8 79 16 74 24 46 23Z"/>
    <path fill="#25343c" d="M46 15 78 13 77 24 68 29 51 26Z"/>
    <path fill="#71d8de" d="m52 17 24-2-1 5-20 3Z"/>
    <path fill="#7ca5d6" d="m53 6 13-3 5 3-13 4Z"/>
    <path stroke="#b77b3f" stroke-width="8" d="m37 39 13 8 12-5m22-3-9 11-10-2"/>
    <path fill="#26343c" d="m46 39 13-3 5 2 25-8 5 9-23 8-2 6-9 2-4-8-10 1Z"/>
    <path fill="#849596" d="m56 38 32-11 12-2 2 5-12 4-31 10Z"/>
    <path fill="#26343c" d="m98 24 9-3 3 8-9 3Z"/>
    <path fill="#71d8de" d="m64 34 7-2 1 3-7 2Z"/>`,
  "arc-medic": infantry(
    "#dfeada",
    `
    <path fill="#f0f4e7" d="M46 13Q60 0 74 13V16H46Z"/>
    <path fill="#6d9ad2" d="M57 5H64V16H57Z"/>
    <path fill="#2d795f" d="M56 31H64V36H70V43H64V49H56V43H50V36H56Z"/>
    <path fill="#293f3a" d="M25 43H40V50H36V47H29V50H25Z"/>
    <rect fill="#e6efdf" x="22" y="49" width="22" height="21" rx="2"/>
    <path fill="#2d795f" d="M30 53H36V57H40V63H36V67H30V63H26V57H30Z"/>
    <path fill="#a9c8b6" d="M81 38 94 41 91 51 79 48Z"/>
    <path fill="#74e5b7" d="M84 40 91 42 89 46 82 44Z"/>`,
  ),
  "arc-mechanic": infantry(
    "#d88e2b",
    `
    <rect fill="#6e8185" x="29" y="24" width="12" height="28" rx="5"/>
    <path fill="#e3a649" d="M29 26H41V32H29Z"/>
    <path fill="#dc982f" d="M43 17Q44 3 60 3Q77 3 78 17Z"/>
    <path fill="#f2b84d" d="M40 16H81V22H40Z"/>
    <path fill="#6d9ad2" d="M57 5H64V16H57Z"/>
    <rect fill="#ffedb4" x="56" y="17" width="9" height="6"/>
    <path fill="#38484a" d="M45 45H74V54H45Z"/>
    <path fill="#9fafae" d="M47 29H52V44H47ZM68 29H73V44H68Z"/>
    <path stroke="#afc3c5" stroke-width="7" stroke-linecap="round" d="M88 65 98 29"/>
    <path fill="#c4d4d2" d="M91 32 88 24 91 14 96 12 96 23 101 24 105 14 110 17 109 28 102 34Z"/>
    <path stroke="#33474b" stroke-width="8" d="M89 61 92 50"/>`,
  ),
  "arc-demolition-trooper": infantry(
    "#4a5763",
    `
    <path fill="#9caaaa" d="M26 24H34V53H26ZM36 20H44V49H36Z"/>
    <path fill="#35414c" d="m26 24 4-9 4 9ZM36 20l4-9 4 9Z"/>
    <path fill="#223039" d="M24 36H46V43H24Z"/>
    <path fill="#6d9ad2" d="M57 5H64V15H57ZM55 33H63V44H55Z"/>
    <path fill="#1b2831" d="M67 27 99 14 110 26 76 40Z"/>
    <path fill="#596873" d="M67 27 99 14 104 19 72 33Z"/>
    <path stroke="#b7c4c3" stroke-width="4" d="M70 28 77 37"/>
    <ellipse fill="#b7c4c3" cx="106" cy="21" rx="8" ry="11" transform="rotate(-27 106 21)"/>
    <ellipse fill="#111f28" cx="107" cy="21" rx="5" ry="7" transform="rotate(-27 107 21)"/>
    <path fill="#f3b34e" d="m86 20 7-3 3 4-7 3Z"/>
    <path stroke="#35414c" stroke-width="9" d="M77 37 72 45 59 40"/>`,
    { helmet: "#3c4955", visor: "#f3b34e" },
  ),
  "circle-cultivator": elf(
    "#697545",
    `
    <ellipse fill="#697545" cx="35" cy="37" rx="11" ry="15"/>
    <path fill="#b98be3" d="m35 27 5 10-5 9-5-9Z"/>
    <path fill="none" stroke="#d3c28d" stroke-width="3" d="M31 25Q23 37 31 49M39 25Q47 37 39 49"/>
    <path fill="#76abd1" d="M30 22H40V27H30Z"/>
    <path fill="none" stroke="#d3c28d" stroke-width="4" d="m50 32 9 18 11-18M79 44l8 17-2 10m2-10 10 5"/>
    <path fill="#b98be3" d="m90 62 5 4-3 6-5-4Z"/>`,
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
  "circle-healer": elf(
    "#6f9c8c",
    `
    <path fill="#8fc2ae" d="M40 30Q26 48 28 70L44 70 47 36ZM80 30Q94 48 92 70L76 70 73 36Z"/>
    <path fill="none" stroke="#dbbd97" stroke-width="5" stroke-linecap="round" d="M44 40 30 34M76 40 90 34"/>
    <path fill="#b9f28c" d="M26 33Q19 23 27 17Q34 25 26 33ZM94 33Q101 23 93 17Q86 25 94 33Z"/>
    <path fill="#d7b3ed" d="m60 41 5 6-5 7-5-7Z"/>`,
  ),
  "circle-artificer": elf(
    "#5b4a33",
    `
    <path fill="#7a6544" d="M47 30 73 30 75 52 45 52Z"/>
    <path fill="none" stroke="#2f2618" stroke-width="4" d="M46 33 74 50M74 33 46 50"/>
    <path fill="#3a2e1f" d="M42 52H78V58H42Z"/>
    <path fill="#c9b27b" d="M46 58H51V67H46ZM55 58H60V64H55ZM69 58H74V68H69Z"/>
    <path fill="none" stroke="#cbbb90" stroke-width="4" stroke-linecap="round" d="M84 70 92 38"/>
    <path fill="#aa7edd" d="m92 30 6 5-4 8-6-4Z"/>`,
  ),
  "circle-briar-ram": `${GROVE_GROUND}
    <path stroke="#3a2a1b" stroke-width="9" stroke-linecap="round" d="M30 50 28 68M46 52 46 69M74 52 76 69M88 50 92 67"/>
    <path fill="#d4c79c" d="M20 44Q22 26 50 25Q80 22 92 36L96 52 22 54Z"/>
    <path fill="#b7a879" d="M28 31 46 27 44 40 26 42ZM50 26 70 25 68 38 49 39ZM72 27 89 34 86 44 71 41Z"/>
    <path fill="#c9bb8c" d="M90 34Q104 31 110 44L104 56 92 54Z"/>
    <path fill="none" stroke="#5c3f26" stroke-width="4" stroke-linecap="round" d="M96 32Q94 18 104 15M104 35Q108 22 116 23"/>
    <path fill="#9a63d1" d="M56 44Q62 40 66 45 62 50 57 49Z"/>
    <path fill="#76abd1" d="M34 46H52V50H34Z"/>`,
  "circle-thornspire": `${GROVE_GROUND}
    <path fill="#2e2015" d="M42 70Q50 60 52 66L68 66Q70 60 78 70Z"/>
    <path fill="#cbbd90" d="M52 68 54 24H66L68 68Z"/>
    <path fill="#a7996c" d="M54 60 42 52 54 50ZM66 52 79 44 66 42ZM54 42 44 34 55 33ZM66 34 76 26 66 26Z"/>
    <path fill="#245a3e" d="M50 26 60 6 70 26 60 22Z"/>
    <path fill="#be8bf0" d="M56 22Q60 12 64 22 60 30 56 22Z"/>
    <path fill="#76abd1" d="M55 55H65V60H55Z"/>`,
  "circle-construct-nursery": `${GROVE_GROUND}
    <path fill="#204b37" d="M14 54Q20 16 60 14Q100 16 106 54Z"/>
    <path fill="none" stroke="#bdb28b" stroke-width="6" stroke-linecap="round"
      d="M16 66Q16 22 60 18Q104 22 104 66M30 67Q32 34 60 32Q88 34 90 67"/>
    <path fill="#102e28" d="M44 68Q44 44 60 42Q76 44 76 68Z"/>
    <ellipse fill="#c7b78c" cx="60" cy="66" rx="20" ry="5"/>
    <path fill="#9a63d1" d="m60 48 5 6-5 7-5-7Z"/>
    <path stroke="#76abd1" stroke-width="3" d="M24 40 30 44M96 40 90 44"/>`,
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
    <path fill="#183c31" d="M16 56 24 36 46 16 86 22 103 39 106 63 69 71Z"/>
    <path fill="#27573e" d="M15 42Q18 24 46 15L88 20 74 32 62 53Q43 44 15 42Z"/>
    <path fill="#4a7f51"
      d="M17 42Q22 23 47 15Q37 28 34 45ZM31 44Q36 25 61 17Q52 29 48 48ZM46 47Q53 26 75 19Q67 31 63 52Z"/>
    <path fill="none" stroke="#aa9a73" stroke-width="3"
      d="M18 42 16 59 69 71M35 45 32 63M50 49 47 67"/>
    <path fill="#173329" stroke="#d4c79f" stroke-width="5" stroke-linejoin="round"
      d="M68 70Q70 41 86 23Q102 38 106 63"/>
    <path fill="#3b7049" d="M72 67Q73 50 80 45Q84 56 80 67ZM93 64Q88 52 94 43Q102 51 103 62Z"/>
    <path fill="#a983de" d="m71 55 4 3-2 7-4-3Zm30-5 4 3 1 6-4-2Z"/>
    <path fill="#83aed0" d="m83 32 7-2 2 5-7 3Z"/>`,
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
  const id = portrait ?? rolePortrait(definition);
  svg.setAttribute("data-portrait", id);
  svg.innerHTML = PORTRAITS[id];
  return svg;
}
