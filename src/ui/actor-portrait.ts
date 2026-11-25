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
    <path fill="#233e42" d="m15 60 49-16 43 15-49 17Z"/>
    <path fill="#a2ad9b" d="m22 49 42-13 34 12-41 15Z"/>
    <path fill="#47574a" d="m22 51 35 12v10L22 61Z"/>
    <path fill="#576959" d="m57 63 41-15v12L57 73Z"/>
    <path fill="#739fd4" d="m24 49 31 11-6 2-30-11Zm52-10 23 8-6 2-24-8Z"/>
    <path fill="#293f42" d="m61 63 32-11v6L61 69Z"/>
    <path stroke="#a2e5d7" stroke-width="2" d="m80 61 10-3"/>
    <path stroke="#314749" stroke-width="4" d="m42 53 18-26 14 18"/>
    <path stroke="#88978a" stroke-width="6" d="M59 51V24"/>
    <path fill="#aab8ad" d="M31 7 57 14 57 31 32 25Zm33 7 25-9 1 19-26 8Z"/>
    <path fill="#537f84" d="m34 11 19 5v11l-19-5Zm34 6 18-7v11l-18 6Z"/>
    <path stroke="#29494b" stroke-width="2" d="m34 17 19 5m15 0 18-7"/>
    <path fill="#739fd4" d="m30 6 5 2v18l-4-1ZM85 6l6-2v20l-5 2Z"/>
    <path fill="#aab8ad" d="M56 24H65V34H56Z"/>`,
  "arc-sentry-turret": `
    <path fill="#233e42" d="m15 56 47-17 44 16v6L59 77 15 62Z"/>
    <path fill="#586658" d="m16 53 47-17 41 16-46 17Z"/>
    <path fill="#8a998a" d="m23 53 8-3 36 13-8 3Zm33-12 8-3 36 13-8 3Z"/>
    <path fill="#729fd4" d="m24 52 4-2 36 13-5 2Zm35-11 4-2 36 13-5 2Z"/>
    <path fill="#445346" d="M35 45h47v9q-23 19-47 0Z"/>
    <ellipse fill="#98a69a" cx="59" cy="45" rx="24" ry="10"/>
    <ellipse fill="#283d3d" cx="59" cy="43" rx="19" ry="8"/>
    <path fill="#889787" d="m30 27 28-12 26 11-28 14Z"/>
    <path fill="#465548" d="m30 27 26 13-1 13-22-11Zm26 13 28-14-2 14-27 13Z"/>
    <path fill="#729fd4" d="m33 27 23 11-5 3-19-10Zm8-5 17-7 5 2-17 7Z"/>
    <path stroke="#536557" stroke-width="10" d="m62 38 13 5m3-12 14 5"/>
    <path fill="#a2e5d7" d="m69 36 6-3 3 2-6 3Z"/>
    <path stroke="#263c3d" stroke-width="6" d="m75 43 13 5m4-12 13 5"/>
    <path stroke="#a3b2a8" stroke-width="8" d="m87 48 6 2m10-9 6 2"/>
    <path stroke="#263c3d" stroke-width="4" d="m92 50 2 1m14-8 2 1"/>`,
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
  "arc-scout": `
    <ellipse fill="#152b31" cx="59" cy="73" rx="27" ry="5"/>
    <path stroke="#505e60" stroke-width="10" d="m52 48-5 23m17-23 8 23"/>
    <path fill="#27343a" d="M42 67H51V74H38Zm25 0h9l4 7H67Z"/>
    <path fill="#c5a473" d="m44 56 8 1-1 5-8-1Zm23 0 8-1 1 5-8 1Z"/>
    <path fill="#8a7151" d="M36 24 48 20 57 26 54 47 34 44Z"/>
    <path fill="#27343a" d="M35 27 44 25 44 41 34 39Z"/>
    <path fill="#78a3d8" d="M36 24 48 20 53 23 40 27Z"/>
    <path stroke="#abb9b7" stroke-width="3" d="m38 25-8-20"/>
    <path stroke="#d0aa70" stroke-width="4" d="m32 10-2-5"/>
    <path stroke="#505e60" stroke-width="7" d="m46 33-8 13 4 11m30-24 8 13-2 9"/>
    <path fill="#26343a" d="m38 52 7 1 1 6-7 1Zm38 0 7 1-2 7-7-1Z"/>
    <path fill="#505e60" d="M44 30 62 26 74 32 69 52 47 53Z"/>
    <path fill="#c5a473" d="m48 34 22-2-2 12-19 3Z"/>
    <path stroke="#303a3c" stroke-width="4" d="m49 29 5 19m12-19 1 17"/>
    <path fill="#78a3d8" d="m42 32 6-3 2 4-7 3Zm28-3 6 3 1 4-7-2Z"/>
    <path fill="#c5a473" d="M46 14 51 8 65 6 75 12 77 20 47 22Z"/>
    <path fill="#303a3c" d="m47 17 30-1-2 12-7 4-17-3Z"/>
    <path fill="#78a3d8" d="m54 8 10-2 5 3-10 3Z"/>
    <path fill="#a1b0ae" d="m55 17 7-1 4 4-2 6-7 1-4-4Zm14-1 7-1 4 4-2 6-7 1-4-4Z"/>
    <path fill="#77dfcc" d="m57 19 5-1 2 3-2 3-4 1-3-3Zm14-1 5-1 2 3-2 3-4 1-3-3Z"/>`,
  "arc-medic": `
    <ellipse fill="#152b31" cx="60" cy="73" rx="31" ry="5"/>
    <path stroke="#2d5047" stroke-width="12" d="m51 49-5 21m19-21 8 21"/>
    <path fill="#b9d0bc" d="m43 54 11 2-3 12-10-2Zm24 2 10-2 3 12-10 2Z"/>
    <path fill="#26363a" d="m41 67 11 1-1 6H37Zm29 1 10-1 5 7H71Z"/>
    <path fill="#344a48" d="m30 25 10-5 12 4 2 26-11 4-13-7Z"/>
    <path fill="#a4beaa" d="m29 29 10-4 6 3v22l-6 2-10-6Z"/>
    <path fill="#78a3d8" d="m31 26 9-4 5 2-9 4Z"/>
    <path fill="#34584e" d="m43 29 14-6 18 5 5 18-9 9-24-1-7-10Z"/>
    <path fill="#dce9db" d="m49 30 22-2 5 5-4 13-20 2-6-6Z"/>
    <path fill="#2e6a5b" d="m57 32 6-1 1 4 6-1 1 5-6 1v4l-6 1-1-4-6 1-1-5 6-1Z"/>
    <path stroke="#bdd4c1" stroke-width="9" d="m42 36-8 13m42-14 8 12"/>
    <path fill="#78a3d8" d="m36 32 7-4 6 4-4 4-9 1Zm33-4 7-2 7 4 1 5-10-1Z"/>
    <path fill="#2b4241" d="m27 42 12 1 5 6-4 8-13-3Z"/>
    <path fill="#83e5cf" d="m30 44 9 2-2 6-7-1Z"/>
    <path stroke="#293d3d" stroke-width="4" d="M83 53v-5h8v5"/>
    <path fill="#a7c3b0" d="m76 53 8-5 14 3 3 15-7 6-17-5Z"/>
    <path fill="#e1ebd9" d="m80 53 14-2 4 4v11l-5 4-13-4Z"/>
    <path fill="#2e6a5b" d="m86 54 4 1v4l4 1v4l-4-1v4l-4-1v-4l-4-1v-4l4 1Z"/>
    <path fill="#dce9da" d="M45 13 51 6 64 3 75 8 78 15 73 23 47 23Z"/>
    <path fill="#293d3d" d="m46 15 31-2-1 11-8 5-17-3Z"/>
    <path fill="#83e5cf" d="m51 17 23-2-1 5-20 3Z"/>
    <path fill="#78a3d8" d="m53 6 11-3 6 3-13 4Z"/>`,
  "arc-mechanic": `
    <ellipse fill="#152b31" cx="61" cy="73" rx="31" ry="5"/>
    <path stroke="#3e4b4b" stroke-width="13" d="m51 48-5 22m20-22 10 22"/>
    <path fill="#d8963d" d="m43 55 11 2-2 12-11-1Zm24 2 10-2 4 13-10 1Z"/>
    <path fill="#263638" d="m41 66 11 1v7H37Zm30 1 9-1 6 8H72Z"/>
    <path fill="#273c3e" d="m32 26 12-9 12 2 3 28-16 6-11-11Z"/>
    <path fill="#95a8a8" d="m30 19 9-4 5 4v26l-6 3-7-4Zm16-3 8-3 6 3v21l-7 4-7-3Z"/>
    <path fill="#e5ae51" d="m30 16 9-3 5 4v6l-6 3-8-3Zm16-2 8-3 6 3v6l-7 3-7-3Z"/>
    <path fill="#34474a" d="m31 39 7 3 6-3v5l-6 4-7-3Z"/>
    <path fill="#789fd5" d="m41 31 7-3v5l-7 4Z"/>
    <path fill="#44504d" d="m43 28 19-5 16 7 3 16-12 8-23-1-8-8Z"/>
    <path fill="#df9d41" d="m48 30 24-1 6 5-5 12-24 2-4-6Z"/>
    <path stroke="#354849" stroke-width="5" d="m49 28 5 20m15-20 3 18"/>
    <path fill="#aab7b4" d="m51 39 5-1 1 4-5 1Zm17-2 6-1 1 4-6 1Z"/>
    <path fill="#364849" d="m39 47 9-2 4 3-1 8-11 1Zm32 1 9-3 6 4-2 8-12 1Z"/>
    <path stroke="#d59a46" stroke-width="9" d="m42 37-6 12m41-13 8 12-2 5"/>
    <path fill="#78a3d8" d="m36 32 7-3 6 4-5 3-9 1Zm35-3 7-2 6 4-2 4-10-1Z"/>
    <path fill="#edb34e" d="M43 14 48 6 59 2 71 5 76 12 76 17 43 20Z"/>
    <path fill="#789fd5" d="m52 5 8-3 6 2-9 4Z"/>
    <path fill="#35494a" d="m47 18 27-3-1 11-9 4-13-3Z"/>
    <path fill="#f1be65" d="m40 17 33-5 8 3-2 6-35 3-4-3Z"/>
    <path fill="#3c4b46" d="m60 12 13-2 3 7-14 3Z"/>
    <path fill="#ffebaa" d="m63 13 9-1 1 4-9 2Z"/>
    <path fill="#a7b7b5" d="m29 53 7-19-5-7 2-10 6-1-2 9 6 3 6-8 4 3-5 11-6 2-7 19Z"/>
    <path fill="#334648" d="m31 44 7 2-3 9-7-2Z"/>`,
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
    "#1a493b",
    `
    <path fill="#a49268" d="M48 30Q34 27 26 41Q39 43 48 35ZM72 30Q86 27 94 41Q81 43 72 35Z"/>
    <path fill="#e1d0a5" d="M47 28Q39 21 26 32Q37 35 47 31ZM73 28Q81 21 94 32Q83 35 73 31Z"/>
    <path fill="#83add0" d="M43 27Q36 25 31 31L40 31ZM77 27Q84 25 89 31L80 31Z"/>
    <path fill="#b8aa7a" d="M51 33 59 37 56 51 46 40ZM69 33 61 37 64 51 74 40Z"/>
    <path fill="#b8aa7a" d="m47 49 5 7-7 8-4-7Zm26 0-5 7 7 8 4-7Z"/>
    <path fill="#47705a" d="M48 59 56 61 55 72 46 69ZM72 59 64 61 65 72 74 69Z"/>
    <path fill="none" stroke="#dfcfa4" stroke-width="4" stroke-linecap="round"
      d="M60 57C45 54 44 44 53 40L57 39M60 57C75 54 76 44 67 40L63 39"/>
    <path fill="#b87fe1" d="m60 41 7 7-7 8-7-8Z"/>
    <path fill="#dbb3f6" d="m60 41 4 7-4 4-3-5Z"/>`,
  ),
  "circle-wayfinder": elf(
    "#49866f",
    `
    <path fill="#3f765f" d="M43 19Q43 7 59 2Q72 3 79 16L77 33 69 28 72 17Q60 10 49 18L51 28 43 33Z"/>
    <path fill="#6a9d80" d="M43 18Q48 7 59 2Q72 3 79 16L72 17Q60 10 49 18Z"/>
    <path fill="#60a28a" d="M46 28 58 36 52 47 36 40ZM73 28 62 36 68 47 83 39Z"/>
    <path fill="#d8c297" d="m50 34 6 4-4 7-4-5Zm20 0 2 6-4 5-4-7Z"/>
    <path fill="#84afd0" d="M47 47Q60 52 73 47L74 51Q60 56 46 51Z"/>
    <path fill="none" stroke="#d2c096" stroke-width="4" stroke-linecap="round"
      d="M39 72 31 20Q28 13 26 8"/>
    <path fill="#ab9872" d="m34 23 2-8-7-10-4 7 2 8Z"/>
    <path fill="#bd8aee" d="m26 6-4 7 5 7 4-5Z"/>
    <path fill="#d6bd96" d="m38 44-5 3 2 6 6-3Z"/>`,
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
    <path fill="#4c3a25" d="M36 69 50 60 66 60 84 69 77 73 58 69 42 73Z"/>
    <path fill="none" stroke="#938662" stroke-width="5" stroke-linecap="round"
      d="M52 67C56 53 65 45 64 34S60 25 60 23"/>
    <path fill="#aa79de" d="m59 40 6 9-6 8-5-8Z"/>
    <path fill="none" stroke="#cdbd90" stroke-width="6" stroke-linecap="round"
      d="M46 68C49 58 49 48 47 40S49 28 59 24M75 68C69 62 72 53 74 46S69 29 62 24"/>
    <path fill="#356d49" d="M48 52Q39 49 40 43L38 37Q49 42 48 52ZM72 46Q79 39 83 38L80 46 72 52ZM49 39Q42 36 43 27L49 31ZM70 38Q68 28 77 24L75 32Z"/>
    <path fill="#76abd1" d="m46 51 5-1v7l-5 2Zm24-3 5-1-2 7-5 1Z"/>
    <path fill="#cdbd90" d="M60 28Q49 25 46 11Q55 13 59 22Q63 15 72 11Q70 24 60 28Z"/>
    <path fill="#32704b" d="M60 27Q50 24 52 15L56 18 60 25Q63 17 68 15Q70 23 60 27Z"/>
    <path fill="#c99af1" d="m60 9 6 8-6 8-6-8Z"/>`,
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
