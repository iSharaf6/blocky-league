import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';
import sharp from 'sharp';

// Export the same editable, code-native mark used by the game. No bitmap tracing.
const source = await readFile(resolve('src/ui/gameLogo.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const art = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const out = resolve('store-assets/logo');
await mkdir(out, { recursive: true });
const standalone = svg => svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
async function save(path, data) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, data); }
async function png(svg, path, alpha = true) {
  let image = sharp(Buffer.from(standalone(svg)));
  if (!alpha) image = image.flatten({ background: art.LOGO_SKY }).removeAlpha();
  await save(path, await image.png().toBuffer());
}
function square(size, scale = 0.84) {
  const { body, box: [x, y, w, h] } = art.markBody();
  const factor = size * scale / Math.max(w, h);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${art.LOGO_SKY}"/><g transform="translate(${(size - w * factor)/2 - x*factor} ${(size-h*factor)/2-y*factor}) scale(${factor})">${body}</g></svg>`;
}
const designs = [
  ['blocky-league-mark', art.markSvg(1024)],
  ['blocky-league-wordmark', art.wordmarkSvg(424)],
  ['blocky-league-logo-horizontal', art.logoSvg('horizontal', 424)],
  ['blocky-league-logo-stacked', art.logoSvg('stacked', art.lockupCells('stacked')[1]*32)],
];
for (const [name, svg] of designs) {
  await save(resolve(out, name+'.svg'), standalone(svg));
  await png(svg, resolve(out, name+'.png'));
}
const icon = square(1024);
for (const path of ['store-assets/ios-app-icon-1024.png','store-assets/logo/blocky-league-mark-on-sky-1024.png','ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png']) await png(icon, resolve(path), false);
for (const size of [192, 512]) {
  await png(square(size), resolve(`public/icons/icon-${size}.png`), false);
  await png(square(size, 0.66), resolve(`public/icons/maskable-${size}.png`), false);
}
await png(square(180), resolve('public/apple-touch-icon.png'), false);
await png(square(512,0.66), resolve('store-assets/google-play-icon-512.png'), false);

// The square mark shares its optical centre with the icon; each favicon has a
// transparent backdrop and an independent render at its final resolution.
const faviconBuffers = [];
for (const size of [16,32,48]) {
  const svg = square(size,0.96).replace(/<rect[^>]+\/>/,'');
  const buffer = await sharp(Buffer.from(standalone(svg))).png().toBuffer();
  await save(resolve(`public/favicon-${size}.png`),buffer);
  faviconBuffers.push(buffer);
}
const header = Buffer.alloc(6 + faviconBuffers.length*16);
header.writeUInt16LE(1,2); header.writeUInt16LE(faviconBuffers.length,4);
let offset=header.length;
faviconBuffers.forEach((buffer,index)=>{
  const entry=6+index*16; const size=[16,32,48][index];
  header[entry]=size; header[entry+1]=size;
  header.writeUInt16LE(1,entry+4); header.writeUInt16LE(32,entry+6);
  header.writeUInt32LE(buffer.length,entry+8); header.writeUInt32LE(offset,entry+12);
  offset+=buffer.length;
});
await save(resolve('public/favicon.ico'),Buffer.concat([header,...faviconBuffers]));

for (const [kind,w,h] of [['horizontal',2400,800],['stacked',1600,1600]]) {
  const [cw,ch]=art.lockupCells(kind);
  const pixelCell=Math.floor(Math.min(w*.9/cw,h*.86/ch)/4)*4;
  const logo=art.logoSvg(kind,ch*pixelCell);
  const x=(w-cw*pixelCell)/2,y=(h-ch*pixelCell)/2;
  await png(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${art.LOGO_SKY}"/><g transform="translate(${x} ${y})">${logo}</g></svg>`,resolve(out,`blocky-league-logo-${kind}-on-sky-${w}x${h}.png`),false);
}
await mkdir(resolve('store-assets/app-store'),{recursive:true});
// One review image shows readability at actual Home Screen/search sizes.
const pieces=[];
for (const [size,x] of [[256,48],[120,348],[60,516],[40,624]]) pieces.push({input:await sharp(Buffer.from(standalone(square(size)))).png().toBuffer(),left:x,top:48});
await sharp({create:{width:720,height:352,channels:3,background:'#fbfbf4'}}).composite(pieces).png().toFile(resolve('store-assets/app-store/icon-size-review.png'));
console.log('Brand SVGs, opaque iOS/PWA icons, favicons and icon-size review exported.');
