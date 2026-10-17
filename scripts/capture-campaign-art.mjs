#!/usr/bin/env node
/**
 * Campaign route B: reproducible staged art from the current game renderer.
 * These are promotional compositions, not live gameplay screenshots.
 *
 * BLOCKY_ART_NODE_MODULES=/path/to/node_modules node scripts/capture-campaign-art.mjs
 * Requires Playwright + Sharp. Uses its own temporary Vite server on port 4195.
 * Writes only store-assets/campaign-2026-10-14/renderer-art.
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
const out = join(root, 'store-assets/campaign-2026-10-14/renderer-art');
await mkdir(out, {recursive:true});
const { createServer } = await import('vite');
const server=await createServer({root,server:{host:'127.0.0.1',port:4195,strictPort:true}});await server.listen();
const baseUrl='http://127.0.0.1:4195';
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist']});
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
async function creativePose(page,format) {
  await page.evaluate(async format => {
    const a=__art,{s,place,open,refresh,HALF_L}=a,m=s.match;
    open();
    m.players.forEach((p,i)=>place(i,-70-i*2,-40,0));
    place(10,-HALF_L+4.3,-3,3.55);const striker=m.players[10];striker.state='kick';striker.stateT=0.27;striker.kickT=0.45;striker.kickLeg=1;
    place(11,-HALF_L+1.2,-1.6,-Math.PI/2);const keeper=m.players[11];keeper.state='dive';keeper.stateT=0.3;keeper.y=0.82;keeper.diveDir=-1;
    m.ball.owner=-1;m.ball.lastTouch=10;m.ball.pos.x=-HALF_L+2.0;m.ball.pos.y=0.95;m.ball.pos.z=-3.8;
    m.ball.vel.x=m.ball.vel.y=m.ball.vel.z=0;
    s.time=0;s.view.players.forEach(p=>{p.headYaw=0;});
    s.view.setMarkerVisible(false);s.view.setTeamRings(false);s.view.frameHook=null;refresh();
    s.view.players.forEach((p,i)=>{p.group.visible=i===10||i===11;});
    s.view.referee.group.visible=false;s.view.ballShadow.visible=false;s.view.ball.scale.setScalar(1.3);
    ['marker','rivalRing','markerRing','arrow','powerBar','nameTag','targetRing','aim','pipFill','pipEdge','passBar','passFill','passRing','passArrow','landingRing','reticle'].forEach(k=>{if(s.view[k])s.view[k].visible=false;});
    s.effects.mesh.visible=false;s.fxKit.group.visible=false;
    // Remove corner masts from promotional art: their silhouettes compete with the wordmark.
    s.stadium.group.children.forEach(child=>{
      if(!child.geometry)return;child.geometry.computeBoundingBox();const b=child.geometry.boundingBox;
      if(b.max.y>25 && b.max.x-b.min.x>120 && b.max.z-b.min.z>95)child.visible=false;
    });
    document.querySelectorAll('#boot,.hud,.touch,.trainer,.present-hud,.fun-hud,.skill-hud').forEach(el=>el.style.display='none');
    // A modest character fill preserves kit/skin colours from this reverse-side editorial camera.
    const {setCharacterFill}=await import('/src/render/characters.ts');setCharacterFill(0.25);
    a.w.sunOffset.set(-44,48,-30);a.w.setShadowSize(15);a.w.focusShadows(-HALF_L+2.8,-1.4);
    // Editorial composition using the game's own poses/models. Central hero, ball, keeper and goal.
    const cam=a.w.camera;
    if(format==='portrait'){
      s.view.players[10].group.position.set(-HALF_L+3.5,0,-2.7);
      s.view.players[11].group.position.set(-HALF_L+2.45,0.82,-0.4);
      s.view.ball.position.set(-HALF_L+2.7,1.3,-3.0);
      cam.position.set(-HALF_L+3.0,0.75,-9.4);cam.lookAt(-HALF_L+2.5,1.5,-1.6);cam.fov=45;
    }else if(format==='square'){
      s.view.players[10].group.position.set(-HALF_L+3.8,0,-3.0);
      s.view.ball.position.set(-HALF_L+2,1.15,-3.4);
      cam.position.set(-HALF_L+3.0,0.75,-9.1);cam.lookAt(-HALF_L+2.35,1.85,-1.3);cam.fov=44;
    }else{
      cam.position.set(-HALF_L+3,0.65,-7.5);cam.lookAt(-HALF_L+2.3,1.4,0.5);cam.fov=44;
    }
    s.view.players[10].group.scale.multiplyScalar(format==='landscape'?1.2:1.25);
    s.view.players[10].head.rotation.y=-0.25;
    // Ordinary in-game trail particles give the strike a clear direction.
    const h=s.view.players[10].group.position,b=s.view.ball.position;
    s.effects.clear();s.effects.mesh.visible=true;
    for(let i=0;i<8;i++){
      const t=(i+1)/10;
      s.effects.trailBit(h.x-0.8+(b.x-h.x+0.8)*t,0.55+(b.y-0.55)*t,h.z+0.1+(b.z-h.z-0.1)*t,0xfbfbf4,0.035+0.038*t,1);
    }
    s.effects.update(0.06);
    cam.updateProjectionMatrix();a.w.render();
  },format);
}


const formats=[
  {name:'landscape',width:1920,height:1080,logoWidth:620,logoX:650,logoY:70},
  {name:'portrait',width:800,height:1200,logoWidth:584,logoX:108,logoY:65},
  {name:'square',width:800,height:800,logoWidth:500,logoX:150,logoY:45},
];
const packageVersion=JSON.parse(await readFile(join(root,'package.json'),'utf8')).version;
const rendererInputs=await Promise.all(['src/render/characters.ts','src/render/matchView.ts','src/render/world.ts','src/render/stadium.ts','src/render/goalNet.ts','src/ui/gameLogo.ts'].map(async file=>({file,sha256:createHash('sha256').update(await readFile(join(root,file))).digest('hex')})));
const files=[];
async function save(buffer,name,details){
  const data=await sharp(buffer).removeAlpha().png({compressionLevel:9}).toBuffer();
  const path=join(out,name);await writeFile(path,data);
  const meta=await sharp(data).metadata();
  if(meta.hasAlpha||meta.channels!==3)throw new Error('Output must be opaque RGB');
  files.push({file:name,width:meta.width,height:meta.height,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),...details});
  console.log(`Wrote ${path}`);
}
try {
  for(const f of formats){
    const {page}=await pageFor({width:f.width,height:f.height,dpr:1,level:4});
    await creativePose(page,f.name);
    const svg=await page.evaluate(async()=>{
      const {wordmarkBody,wordmarkBox}=await import('/src/ui/gameLogo.ts');
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${wordmarkBox().join(' ')}" shape-rendering="crispEdges">${wordmarkBody()}</svg>`;
    });
    const art=await page.screenshot({animations:'disabled'});
    const clean=`route-b-${f.name}-${f.width}x${f.height}-no-title.png`;
    await save(art,clean,{type:'promotional-staged-render',aspect:f.name,branding:false});
    const logo=await sharp(Buffer.from(svg)).resize({width:f.logoWidth}).toBuffer();
    const title=await sharp(art).composite([{input:logo,left:f.logoX,top:f.logoY}]).toBuffer();
    await save(title,`route-b-${f.name}-${f.width}x${f.height}.png`,{type:'promotional-staged-render',aspect:f.name,branding:true});
    if(f.name==='landscape')await save(art,'renderer-reference.png',{type:'renderer-reference',branding:false});
    await page.close();
  }
  for(const f of formats){
    const preview=await sharp(join(out,`route-b-${f.name}-${f.width}x${f.height}.png`)).resize({width:320}).toBuffer();
    await save(preview,`preview-320-${f.name}.png`,{type:'thumbnail-readability-preview'});
  }
  const previews=await Promise.all(formats.map(async f=>({input:await sharp(join(out,`route-b-${f.name}-${f.width}x${f.height}.png`)).resize({width:480,height:720,fit:'contain',background:'#172127'}).toBuffer()})));
  const sheet=await sharp({create:{width:1504,height:752,channels:3,background:'#172127'}}).composite(previews.map((p,i)=>({...p,left:16+i*496,top:16}))).png().toBuffer();
  await save(sheet,'contact-sheet.png',{type:'preview'});
  await writeFile(join(out,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),packageVersion,rendererInputs,source:'Latest local game source loaded by Vite on 4195; deterministic Chromium WebGL render.',method:'Staged promotional art, not a live gameplay screenshot. Uses current game footballer, keeper, ball, stadium and goal meshes plus the native SVG wordmark. Individual composition for each aspect ratio.',creativeAdjustments:['Camera and staged character pose/positions','Hide HUD, markers, referee and other players','Hide corner light masts','Camera-side daylight and concentrated shadow frustum','Promotional ball draw scale 1.3','Hero draw scale 1.2 landscape / 1.25 portrait and square','Head posed three-quarter toward camera','Staged ordinary ball trail particles'],seed:31,files},null,2)+'\n');
} finally {await browser.close();await server.close();}
