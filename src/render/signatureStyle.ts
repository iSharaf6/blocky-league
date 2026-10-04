/** Signature identities: real material/ceremony palettes, shared by match rendering and the shop preview. */
export const SIGNATURE_PALETTES: readonly (readonly number[])[] = [
  [0x8dd9ff, 0xffffff, 0x526bc6], [0xc8975a, 0xffdd85, 0x6e4030], [0x89edb0, 0xff96cf, 0xffefb1],
  [0x70afff, 0xd4f2ff, 0xb18aee], [0xffdb75, 0xffffff, 0x765ac9], [0xff9f70, 0x73f2e5, 0xffedb6],
  [0xff8e65, 0xffdf7c, 0xe96792], [0x74f0dc, 0xffde89, 0xb5ffff], [0xf4ba64, 0xf99b70, 0xffebaa],
  [0xb687ff, 0x7cefff, 0xffb8ed], [0xff9c56, 0xffdf72, 0xff7ba9], [0x9baeff, 0xfff2c9, 0xf792aa],
];
export function signatureMonth(id: string): number {
  const m = /^(?:net|kick)?pass(\d{2})$/.exec(id);
  const n = Number(m?.[1]);
  return n >= 1 && n <= 12 ? n - 1 : -1;
}
export function signatureNetColour(id: string, x: number, y: number, z: number): number {
  const palette = SIGNATURE_PALETTES[signatureMonth(id)];
  if (!palette) return 0xfbfbf4;
  const band = Math.floor((y + z + x * 0.35) * 2.1);
  return palette[((band % palette.length) + palette.length) % palette.length];
}
