import { readFileSync } from "node:fs";

/** A committed GLB as a data URL, so loaders read it without a server. */
export const glbDataUrl = (url: string) =>
  `data:model/gltf-binary;base64,${readFileSync(`public${url}`).toString("base64")}`;

/** Alters a GLB's JSON for contract rejection tests, preserving binary data. */
export function editedGlbDataUrl(
  url: string,
  edit: (gltf: any) => void,
): string {
  const source = readFileSync(`public${url}`);
  const length = source.readUInt32LE(12);
  const gltf = JSON.parse(source.subarray(20, 20 + length).toString());
  edit(gltf);
  const json = Buffer.from(JSON.stringify(gltf));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(padded);
  const header = Buffer.from(source.subarray(0, 20));
  header.writeUInt32LE(padded.length, 12);
  const result = Buffer.concat([header, padded, source.subarray(20 + length)]);
  result.writeUInt32LE(result.length, 8);
  return `data:model/gltf-binary;base64,${result.toString("base64")}`;
}
