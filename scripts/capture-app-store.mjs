#!/usr/bin/env node
/**
 * Reproducible App Store art from Blocky League's renderer, UI and pixel font.
 *
 * npm i -D playwright sharp; npx playwright install chromium
 * node scripts/capture-app-store.mjs
 *
 * Optional: BLOCKY_ART_NODE_MODULES=/path/to/node_modules,
 * PLAYWRIGHT_BROWSERS_PATH=/path/to/browsers, BLOCKY_ART_URL=http://127.0.0.1:4192
 * No external art is used. Screenshots are Chromium touch-device emulations of
 * the current game, with landscape safe areas. Creative assets use drawn poses
 * and custom cameras; they are promotional art, never labelled native captures.
 */
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extraModules = process.env.BLOCKY_ART_NODE_MODULES;
const require = createRequire(extraModules ? join(extraModules, '..', 'blocky-art-loader.cjs') : import.meta.url);
let chromium, sharp;
try { ({ chromium } = require('playwright')); sharp = require('sharp'); }
catch { throw new Error('Capture needs playwright and sharp. See usage at the top of this script.'); }
const out = join(root, 'store-assets/app-store');
const selectedShot = process.argv.find(v => v.startsWith('--shot='))?.slice(7);
const selectedDevice = process.argv.find(v => v.startsWith('--device='))?.slice(9);
await mkdir(join(out, 'creative'), { recursive: true });
await mkdir(join(out, 'previews'), { recursive: true });
let server;
const baseUrl = process.env.BLOCKY_ART_URL || 'http://127.0.0.1:4192';
if (!process.env.BLOCKY_ART_URL) {
  const { createServer } = await import('vite');
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4192, strictPort: true } });
  await server.listen();
}
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'] });
const manifest = { capturedAt: new Date().toISOString(), method: 'Current game renderer and UI in Chromium touch emulation; creative cameras staged separately.', sources: {
  creative: 'https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications',
  screenshots: 'https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications',
  guidance: 'https://developer.apple.com/app-store/asset-best-practices/'
}, files: [] };
if (process.argv.includes('--creative-only') || process.argv.includes('--screenshots-only')) {
  try {
    const previous = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
    manifest.files = previous.files.filter(f => process.argv.includes('--creative-only') ? f.type !== 'creative' : selectedShot || selectedDevice ? f.type !== 'preview' : f.type === 'creative');
  } catch { /* First capture has no previous manifest. */ }
}
async function output(buffer, path, details) {
  const rgb = await sharp(buffer).removeAlpha().png({ compressionLevel: 9 }).toBuffer();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, rgb);
  const m = await sharp(rgb).metadata();
  if (m.channels !== 3 || m.hasAlpha) throw new Error(`Expected opaque RGB: ${path}`);
  const relative = path.slice(root.length + 1);
  manifest.files = manifest.files.filter(f => f.path !== relative);
  manifest.files.push({ path: relative, width: m.width, height: m.height, channels: m.channels, bytes: rgb.length, sha256: createHash('sha256').update(rgb).digest('hex'), ...details });
  console.log(`Wrote ${path.slice(root.length + 1)} (${m.width}×${m.height})`);
}
async function pageFor({ width, height, dpr = 1, inset = 0, bottom = 0, mode = 'classic', level = 5 }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' });
  await page.addInitScript(() => {
    const raf = requestAnimationFrame;
    window.requestAnimationFrame = fn => raf(t => { if (!window.__assetFreeze) fn(t); });
    let seed = 31;
    Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    localStorage.clear();
    localStorage.setItem('blocky-league-save-v1', JSON.stringify({ version: 1, clubIdx: 5, opponentIdx: 6,
      settings: { quality: 'high', qualityPicked: true, commentary: false, camZoom: 'close', celebration: 'knee',
        music: false, sfx: false, crowd: false, stick: 'floating', roadIntroSeen: true, textSize: 'medium' },
      record: { played: 10, won: 6, drawn: 2, lost: 2, goalsFor: 14, goalsAgainst: 8 },
      seenTutorial: true, progress: { xp: 3800, streak: 2, bestStreak: 3, stars: 20 } }));
  });
  const cdp = await page.context().newCDPSession(page);
  if (inset || bottom) await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: inset, right: inset, bottom } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(mode === 'menu' ? baseUrl : `${baseUrl}/?quick=1&tod=day&level=${level}${mode === 'blitz' ? '&blitz=1' : ''}`);
  await page.waitForFunction(menu => document.getElementById('boot')?.classList.contains('gone') && (menu ? window.__bl?.demo : window.__bl?.session), mode === 'menu');
  await page.evaluate(() => { window.__assetFreeze = true; });
  await page.waitForTimeout(80);
  await page.evaluate(async ({ dpr }) => {
    const bl = window.__bl, s = bl.session || bl.demo, w = bl.world;
    const { writeFrame } = await import('/src/game/replay.ts');
    const { HALF_L, BALL_R } = await import('/src/sim/constants.ts');
    window.__art = { bl, s, w, writeFrame, HALF_L, BALL_R };
    s.endLineup(); s.introLeft = 0; s.holdFirst = false; s.view.frameHook = null;
    s.cam.setMode('broadcast'); s.cam.setZoom('close'); s.hud?.hideIntro(); s.hud?.setSkippable(false);
    s.present?.hidePlate(); s.hud?.setCommentary(false); s.trainer?.hide();
    bl.input.lastDevice = 'touch';
    // Capture full device resolution rather than the game's live GPU governor.
    w.renderer.setPixelRatio(dpr); w.renderer.setSize(innerWidth, innerHeight, false);
    w.camera.aspect = innerWidth / innerHeight; w.camera.updateProjectionMatrix();
    window.__art.refresh = () => {
      writeFrame(s.match, s.cur, s.time); s.prev.set(s.cur);
      s.view.ballGlide.x = s.view.ballGlide.y = s.view.ballGlide.z = 0;
      s.view.apply(s.prev, s.cur, 1, s.time, 0);
      w.render();
    };
    window.__art.place = (i, x, z, facing = 0) => {
      const p = s.match.players[i]; p.pos.x = x; p.pos.z = z; p.vel.x = p.vel.z = 0;
      p.facing = p.drawFacing = facing; p.state = 'move'; p.stateT = 0; p.order = null; p.y = 0;
      p.wantX = p.wantZ = 0; p.runPhase = (i * 0.137) % 1; p.sentOff = false;
    };
    window.__art.open = () => {
      const m = s.match; m.phase = 'play'; m.phaseT = 0; m.restart = null; m.events.length = 0; m.offWatch = null;
      m.clock = 62; m.ball.held = false; m.active = 10; s.eatButtons = false;
      s.hitStopT = 0; s.replay = null; s.paused = false;
    };
  }, { dpr });
  if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
  return { page, cdp };
}
async function passing(page, blitz = false) {
  await page.evaluate(({ blitz }) => {
    const a = window.__art, { bl, s, place, open, refresh } = a, m = s.match;
    open();
    const ours = [[-50,0],[-20,-18],[-14,-6],[-13,8],[-19,19],[-5,-18],[-5,12],[5,-17],[12,-7],[12,11],[0,0]];
    const theirs = [[51,0],[23,-18],[18,-6],[22,8],[25,20],[6,-23],[6,5],[-8,-8],[10,-14],[-7,20],[-12,0]];
    ours.forEach((p,i)=>place(i,p[0],p[1],0));
    theirs.forEach((p,i)=>place(i+11,p[0],p[1],Math.PI));
    m.ball.owner = 10; m.ball.lastTouch = 10; m.ball.pos.x = 0.65; m.ball.pos.y = a.BALL_R; m.ball.pos.z = 0;
    m.ball.vel.x = m.ball.vel.y = m.ball.vel.z = 0;
    bl.input.touch.sx = 0.8; bl.input.touch.sy = -0.38;
    if (blitz) {
      m.heldPower[0] = 'mega'; m.powerups = [{ id: 31, kind: 'turbo', x: 8, z: 1, t: 2 }];
    }
    refresh(); bl.step(8);
    s.trainer?.hide(); s.present?.hidePlate(); s.hud?.hideIntro(); s.hud?.setSkippable(false);
    document.querySelectorAll('.trainer,.trainer-tag').forEach(el=>el.style.visibility='hidden');
    a.w.render();
  }, { blitz });
  // Hold a real floating stick with Chrome's touch input: the page draws its ordinary controls.
  const cdp = await page.context().newCDPSession(page);
  const { w, h } = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: w * 0.18, y: h * 0.78, radiusX: 10, radiusY: 10, force: 1, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: w * 0.18 + 35, y: h * 0.78 - 16, radiusX: 10, radiusY: 10, force: 1, id: 0 }] });
  await page.evaluate(() => { __bl.step(1); __art.s.trainer?.hide(); __art.w.render(); });
}
async function goal(page) {
  await page.evaluate(() => {
    const a = __art, { bl, s, place, open, refresh, HALF_L } = a, m = s.match;
    open(); s.setCelebration('knee');
    m.players.forEach((p,i)=>place(i,p.side===0?5-i%5*4:HALF_L-8+i%4*2,p.side===0?(i%7-3)*4:-15+(i%4)*3,p.side===0?0:Math.PI));
    place(0,-50,0); place(11,HALF_L-1,0,Math.PI); place(10,HALF_L-16,1.3,0);
    place(9,10,-4,0); place(8,5,8,0); place(7,0,3,0);
    m.ball.owner=-1; m.ball.lastTouch=10; m.shooter=10; m.shotSide=0; m.shotWasOnTarget=true;
    m.shotKick=m.kickId; m.shotDist=16; m.shotSpeed=28; m.shotStyle=null; m.kickKind='shot';
    m.ball.pos.x=HALF_L-0.2; m.ball.pos.y=1.7; m.ball.pos.z=-2.6;
    m.ball.vel.x=24; m.ball.vel.y=0; m.ball.vel.z=0;
    refresh(); bl.step(2);
    // The sim detects the ball across the goal line; celebration/HUD/effects use the normal game path.
    if(m.phase!=='goal') throw new Error('Staged shot failed to score');
    bl.step(65);
    s.trainer?.hide(); a.w.render();
    // Keep the game's own celebration viewpoint, move along its lens line for a larger hero.
    const hero=s.view.players[m.celebHero].group.position;
    const cam=a.w.camera, distance=innerWidth/innerHeight>2?4.8:6.2;
    const dx=cam.position.x-hero.x,dz=cam.position.z-hero.z,k=distance/Math.hypot(dx,dz);
    const len=Math.hypot(dx,dz);
    cam.position.set(hero.x+dx*k,1.9,hero.z+dz*k); cam.lookAt(hero.x+dz/len*1.0,1.05,hero.z-dx/len*1.0);
    cam.fov=42; cam.updateProjectionMatrix(); a.w.render();
  });
}
async function freeKick(page) {
  await passing(page);
  await page.evaluate(() => {
    __bl.input.touch.sx=__bl.input.touch.sy=0;
    if(!__bl.stage('freekick'))throw new Error('Free kick did not stage');
    __bl.input.lastDevice='touch';
    __bl.step(150); __art.s.trainer?.hide(); __art.s.hud?.setCommentary(false); __art.w.render();
    if(document.querySelector('.hud-hint')?.textContent.includes('SPACE'))throw new Error('Free-kick hint must use touch labels');
  });
}
async function career(page) {
  await page.evaluate(async () => {
    const bl = __bl; bl.app.mainMenu();
    const { openCareer } = await import('/src/ui/career.ts');
    const { careerState } = await import('/src/ui/club.ts');
    const { createClub } = await import('/src/meta/career.ts');
    const cs=careerState(bl.app); cs.club=createClub({name:'Blocky Athletic',short:'BLA',kit:bl.demo.opt.kits[0],formation:'4-4-2'},31);
    await openCareer(bl.app); bl.step(1); bl.world.render();
  });
  await page.waitForSelector('.mc-career-screen .mc-play', {state:'visible'});
  if(await page.locator('.hud').count())throw new Error('Career must not retain match HUD');
  // Let the game's one-time reward toast expire normally so the club controls stay readable.
  await page.waitForFunction(() => !document.querySelector('.mc-toast.on,.menu-toast'), null, {polling:100});
}
async function transfer(page) {
  await page.evaluate(async () => {
    __bl.app.mainMenu();
    const { openMarket } = await import('/src/ui/market.ts');
    const { careerState } = await import('/src/ui/club.ts');
    const { createClub,newSeason,BOTTOM_DIVISION } = await import('/src/meta/career.ts');
    const cs=careerState(__bl.app); cs.club=createClub({name:'Blocky Athletic',short:'BLA',kit:__bl.demo.opt.kits[0],formation:'4-4-2'},31);newSeason(cs,BOTTOM_DIVISION,1);
    openMarket(__bl.app); __bl.step(1); __bl.world.render();
  });
}
async function caption(page, phrase, width, height, cell) {
  // Read the game's loaded Silkscreen Bold at its native eight-pixel grid once.
  const glyphs = await page.evaluate(async text => {
    await document.fonts.load("700 8px Silkscreen");
    const cvs=document.createElement('canvas'); cvs.width=32;cvs.height=24;
    const ctx=cvs.getContext('2d',{willReadFrequently:true});ctx.font='700 8px Silkscreen';ctx.textBaseline='top';
    const gs={};
    for(const ch of new Set(text.replaceAll(' ',''))){
      ctx.clearRect(0,0,32,24);ctx.fillStyle='#ffffff';ctx.fillText(ch,0,0);
      const d=ctx.getImageData(0,0,32,24).data;let x0=32,y0=24,x1=0,y1=0;
      for(let y=0;y<24;y++)for(let x=0;x<32;x++)if(d[(y*32+x)*4+3]>127){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
      gs[ch]=Array.from({length:y1-y0+1},(_,y)=>Array.from({length:x1-x0+1},(_,x)=>d[((y+y0)*32+x+x0)*4+3]>127?'X':'.').join(''));
    }return gs;
  }, phrase);
  const words=phrase.split(' ');let x=0;const rects=[];
  words.forEach((word,wi)=>{ for(const ch of word){const rows=glyphs[ch];rows.forEach((r,y)=>{for(let q=0;q<r.length;q++)if(r[q]==='X')rects.push({x:x+q,y,color:wi===words.length-1?'#ffd23a':'#fbfbf4'});});x+=rows[0].length+2;} x+=4; });
  const total=(x-6)*cell; const left=Math.round((width-total)/2);const top=Math.floor((height-6.25*cell)/2);
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#5cc8f5"/><rect y="${height-8}" width="100%" height="8" fill="#26262e"/><g shape-rendering="crispEdges">`;
  for(const r of rects)svg+=`<rect x="${left+r.x*cell-cell/4}" y="${top+r.y*cell-cell/4}" width="${cell*1.5}" height="${cell*2}" fill="#26262e"/>`;
  for(const r of rects)svg+=`<rect x="${left+r.x*cell}" y="${top+r.y*cell}" width="${cell}" height="${cell}" fill="${r.color}"/>`;
  return Buffer.from(svg+'</g></svg>');
}
const sets = [
  { name:'iphone-medium', width:2622,height:1206,dpr:3,strip:144,cell:16,inset:47,bottom:21 },
  { name:'iphone-large',width:2868,height:1320,dpr:3,strip:156,cell:16,inset:62,bottom:21 },
  { name:'ipad-13',width:2752,height:2064,dpr:2,strip:216,cell:24,inset:0,bottom:20 },
];
const shots=[
 { name:'01-score-screamers',text:'SCORE SCREAMERS',stage:goal,mode:'classic' },
 { name:'02-pass-and-move',text:'PASS AND MOVE',stage:passing,mode:'classic' },
 { name:'03-blitz-power-ups',text:'BLITZ POWER UPS',stage:p=>passing(p,true),mode:'blitz' },
 { name:'04-road-to-glory',text:'ROAD TO GLORY',stage:career,mode:'menu' },
 { name:'05-bend-it',text:'BEND IT',stage:freeKick,mode:'classic' },
];
if(selectedShot&&!shots.some(s=>s.name===selectedShot))throw new Error(`Unknown screenshot ${selectedShot}`);
if(selectedDevice&&!sets.some(s=>s.name===selectedDevice))throw new Error(`Unknown device ${selectedDevice}`);
async function screenshots() {
  for(const set of sets.filter(s=>!selectedDevice||s.name===selectedDevice)){
    const dir=join(out,'screenshots',set.name); await mkdir(dir,{recursive:true});
    for(const shot of shots.filter(s=>!selectedShot||s.name===selectedShot)){
      // Give the compact career hub its full reward line without cropping or changing the game UI.
      const phoneCareer=set.name.startsWith('iphone-')&&shot.name==='04-road-to-glory';
      const strip=phoneCareer?96:set.strip;
      const cell=phoneCareer?12:set.cell;
      const {page}=await pageFor({width:set.width/set.dpr,height:(set.height-strip)/set.dpr,dpr:set.dpr,inset:set.inset,bottom:set.bottom,mode:shot.mode});
      await shot.stage(page);
      await page.waitForTimeout(200);
      const frame=await page.screenshot({animations:'disabled'});const cap=await caption(page,shot.text,set.width,strip,cell);
      if(shot.name==='04-road-to-glory')await page.evaluate(()=>{
        const pay=document.querySelector('.mc-pay').getBoundingClientRect();
        const card=document.querySelector('.cr-next').getBoundingClientRect();
        const season=document.querySelector('.fv-strip').getBoundingClientRect();
        if(pay.bottom>card.bottom-2||pay.bottom>season.top)throw new Error('Career fixture reward line is clipped');
      });
      const composed=await sharp({create:{width:set.width,height:set.height,channels:3,background:'#5cc8f5'}}).composite([{input:frame,top:strip,left:0},{input:cap,top:0,left:0}]).png().toBuffer();
      await output(composed,join(dir,`${shot.name}.png`),{type:'screenshot',caption:shot.text,captionBand:{height:strip,pixelCell:cell},device:set.name,safeArea:{left:set.inset,right:set.inset,bottom:set.bottom},gameViewport:{width:set.width/set.dpr,height:(set.height-strip)/set.dpr,dpr:set.dpr}});
      await page.close();
    }
  }
}
async function creativePose(page) {
  await page.evaluate(async () => {
    const a=__art,{s,place,open,refresh,HALF_L}=a,m=s.match;
    open();
    m.players.forEach((p,i)=>place(i,-70-i*2,-40,0));
    place(10,-HALF_L+4.3,-3,-1.99);const striker=m.players[10];striker.state='kick';striker.stateT=0.27;striker.kickT=0.82;striker.kickLeg=1;
    place(11,-HALF_L+1.2,-1.6,-Math.PI/2);const keeper=m.players[11];keeper.state='dive';keeper.stateT=0.3;keeper.y=0.82;keeper.diveDir=-1;
    m.ball.owner=-1;m.ball.lastTouch=10;m.ball.pos.x=-HALF_L+0.6;m.ball.pos.y=2.15;m.ball.pos.z=-2.72;
    m.ball.vel.x=m.ball.vel.y=m.ball.vel.z=0;
    s.view.setMarkerVisible(false);s.view.setTeamRings(false);s.view.frameHook=null;refresh();
    s.view.players.forEach((p,i)=>{p.group.visible=i===10||i===11;});
    s.view.referee.group.visible=false;s.view.ballShadow.visible=false;
    ['marker','rivalRing','markerRing','arrow','powerBar','nameTag','targetRing','aim','pipFill','pipEdge','passBar','passFill','passRing','passArrow','landingRing','reticle'].forEach(k=>{if(s.view[k])s.view[k].visible=false;});
    s.effects.mesh.visible=false;s.fxKit.group.visible=false;
    // Remove corner masts from promotional art: their silhouettes compete with the wordmark.
    s.stadium.group.children.forEach(child=>{
      if(!child.geometry)return;child.geometry.computeBoundingBox();const b=child.geometry.boundingBox;
      if(b.max.y>25 && b.max.x-b.min.x>120 && b.max.z-b.min.z>95)child.visible=false;
    });
    document.querySelectorAll('.hud,.touch,.trainer,.present-hud,.fun-hud,.skill-hud').forEach(el=>el.style.display='none');
    // A modest character fill preserves kit/skin colours from this reverse-side editorial camera.
    const {setCharacterFill}=await import('/src/render/characters.ts');setCharacterFill(0.25);
    // Editorial composition using the game's own poses/models. Central hero, ball, keeper and goal.
    const cam=a.w.camera;cam.position.set(-HALF_L+3,0.65,-7.5);cam.lookAt(-HALF_L+2.3,1.4,0.5);cam.fov=44;cam.updateProjectionMatrix();
    a.w.render();
  });
}
async function creatives() {
  const formats=[{name:'universal-5244x2950',width:5244,height:2950},{name:'header-3840x1646',width:3840,height:1646},{name:'search-3840x2560',width:3840,height:2560}];
  for(const f of formats){
    const {page}=await pageFor({width:f.width,height:f.height,dpr:1,level:4});
    await creativePose(page);
    const svg = await page.evaluate(async()=>{
      const {wordmarkBody,wordmarkBox}=await import('/src/ui/gameLogo.ts');
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${wordmarkBox().join(' ')}" shape-rendering="crispEdges">${wordmarkBody()}</svg>`;
    });
    const art=await page.screenshot({animations:'disabled'});
    // Keep branding clear of the central action and within the interior crop area.
    const logoW=Math.round(f.width*0.29/4)*4;
    const wordmark=await sharp(Buffer.from(svg)).resize({width:logoW}).png().toBuffer();const lm=await sharp(wordmark).metadata();
    const x=Math.round((f.width-logoW)/2),y=Math.round(f.height*0.09);
    const final=await sharp(art).composite([{input:wordmark,left:x,top:y}]).png().toBuffer();
    await output(final,join(out,'creative',`${f.name}.png`),{type:'creative',placement:f.name.startsWith('search')?'search-results':f.name.startsWith('header')?'product-page-header':'universal-header-search',wordmark:{x,y,width:logoW,height:lm.height}});
    await page.close();
  }
}
async function contactSheets(){
  for(const set of sets){const files=manifest.files.filter(f=>f.device===set.name).sort((a,b)=>a.path.localeCompare(b.path));const thumbW=680,thumbH=Math.round(set.height/set.width*thumbW),pad=24;
    const cells=await Promise.all(files.map(async f=>({input:await sharp(join(root,f.path)).resize(thumbW,thumbH).toBuffer()})));
    const sheet=await sharp({create:{width:thumbW*3+pad*4,height:thumbH*2+pad*3,channels:3,background:'#26262e'}}).composite(cells.map((c,i)=>({...c,left:pad+(i%3)*(thumbW+pad),top:pad+Math.floor(i/3)*(thumbH+pad)}))).png().toBuffer();
    await output(sheet,join(out,'previews',`${set.name}-contact.png`),{type:'preview'});
  }
}
async function verifyFiles(){
  for(const file of manifest.files){
    const path=resolve(root,file.path);if(!path.startsWith(out+'/'))throw new Error('Unexpected asset path');
    const buffer=await readFile(path),m=await sharp(buffer).metadata();
    if(m.width!==file.width||m.height!==file.height||m.hasAlpha||m.channels!==3)throw new Error(`Invalid asset ${file.path}`);
    file.bytes=buffer.length;file.sha256=createHash('sha256').update(buffer).digest('hex');
  }
}
try {
  if(!process.argv.includes('--screenshots-only'))await creatives();
  if(!process.argv.includes('--creative-only'))await screenshots();
  await verifyFiles();
  if(!process.argv.includes('--creative-only'))await contactSheets();
  await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
} finally {await browser.close();await server?.close();}
