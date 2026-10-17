#!/usr/bin/env node
/**
 * Current-build gameplay, 30 fps at normal simulation speed. The starting match
 * situations are deterministic developer scenarios; kicks, AI, physics, cameras,
 * HUD, effects and celebrations then run through the unmodified game.
 * No generated video, audio, cursor, bars, or promotional overlays.
 *
 * BLOCKY_CAPTURE_NODE_MODULES=/path/to/node_modules
 * BLOCKY_CAPTURE_FFMPEG=/path/to/ffmpeg BLOCKY_CAPTURE_FFPROBE=/path/to/ffprobe
 * node scripts/capture-campaign-footage.mjs [--reference-only] [--landscape-only|--portrait-only]
 * --assemble-only reuses existing source clips when replacing opening covers.
 * --cover-route=b assembles the same source clips with Route B covers, preserving A.
 * Optional opening covers: BLOCKY_CAPTURE_COVER_LANDSCAPE and _PORTRAIT.
 */
import {createRequire} from 'node:module';
import {mkdir, writeFile, readFile, stat} from 'node:fs/promises';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn, execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'store-assets/campaign-2026-10-14/footage');
const modules = process.env.BLOCKY_CAPTURE_NODE_MODULES || '/Users/IslamSharaf_1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const require = createRequire(join(modules, '..', 'blocky-capture-loader.cjs'));
const {chromium} = require('playwright');
const ffmpeg = process.env.BLOCKY_CAPTURE_FFMPEG || '/tmp/blocky-campaign-ffmpeg';
const ffprobe = process.env.BLOCKY_CAPTURE_FFPROBE || '/tmp/blocky-campaign-ffprobe';
const fps = 30;
const referenceOnly = process.argv.includes('--reference-only');
const simulationOnly = process.argv.includes('--simulation-only');
const coverRoute = process.argv.find(a=>a.startsWith('--cover-route='))?.slice(14) || 'a';
if(!['a','b'].includes(coverRoute))throw new Error('Cover route must be a or b');
const filePrefix = coverRoute==='b'?'route-b':'blocky-league';
const coverFolder = coverRoute==='b'?'renderer-art':'illustrated-art';
const assembleOnly = process.argv.includes('--assemble-only') || coverRoute==='b';
const selectedScene = process.argv.find(a=>a.startsWith('--scene='))?.slice(8);
const sets = [
  {name:'landscape', width:1920, height:1080, cover:process.env.BLOCKY_CAPTURE_COVER_LANDSCAPE || join(out,'..',coverFolder,`route-${coverRoute}-landscape-1920x1080.png`)},
  {name:'portrait', width:1080, height:1620, cover:process.env.BLOCKY_CAPTURE_COVER_PORTRAIT || join(out,'..',coverFolder,`route-${coverRoute}-portrait-800x1200.png`)},
].filter(s => !process.argv.includes('--landscape-only') && !process.argv.includes('--portrait-only') || process.argv.includes(`--${s.name}-only`));
const scenes = [
  {name:'01-super-shot', kind:'super', duration:5.4, tod:'day', weather:'clear', mode:'classic'},
  {name:'02-bend-the-free-kick', kind:'freekick', duration:3, tod:'sunset', weather:'clear', mode:'classic'},
  {name:'03-blitz-fireball', kind:'mega', duration:5.4, tod:'night', weather:'clear', mode:'blitz'},
];
await mkdir(join(out, 'raw'), {recursive:true});
await mkdir(join(out, 'reference'), {recursive:true});
await mkdir(join(out, 'previews'), {recursive:true});
const server = await createServer({root, server:{host:'127.0.0.1', port:4194, strictPort:true}});
await server.listen();
const browser = await chromium.launch({headless:true, args:['--use-gl=angle','--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist']});
const manifest = {
  capturedAt:new Date().toISOString(),
  provenance:'Current local Blocky League source, deterministic starting situations via developer hooks. Subsequent input, simulation, renderer, HUD, effects, camera and celebrations run at native speed. Editorial hard cuts join three genuine captures. No AI-generated video, audio or promotional text.',
  simulationHz:60, captureFps:fps, clips:[], outputs:[],
  reproducibility:{script:'scripts/capture-campaign-footage.mjs', seed:31, vitePort:4194},
};
try {
  const old=JSON.parse(await readFile(join(out,'footage-manifest.json'),'utf8'));
  manifest.clips=assembleOnly?old.clips:old.clips.filter(c=>!sets.some(s=>s.name===c.aspect) || selectedScene && c.scene!==selectedScene);
  manifest.outputs=old.outputs.filter(c=>!sets.some(s=>c.path.includes(`/${filePrefix}-gameplay-${s.name}-`))).map(c=>({...c,route:c.route||(c.path.includes('/route-b-')?'b':'a')}));
} catch { /* First capture. */ }

async function pageFor(set, scene) {
  const page = await browser.newPage({viewport:{width:set.width,height:set.height}, deviceScaleFactor:1, hasTouch:false});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(() => {
    const raf=requestAnimationFrame;
    window.requestAnimationFrame=fn=>raf(t=>{if(!window.__captureFreeze)fn(t)});
    let seed=31; Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
    localStorage.clear();
    localStorage.setItem('blocky-league-save-v1',JSON.stringify({version:1,clubIdx:5,opponentIdx:6,seenTutorial:true,
      settings:{quality:'high',qualityPicked:true,camZoom:'cinematic',commentary:false,music:false,sfx:false,crowd:false,roadIntroSeen:true,difficulty:1,celebration:'knee',controls:{trainer:false}},
      record:{played:10,won:6,drawn:2,lost:2,goalsFor:14,goalsAgainst:8}, progress:{xp:3800,streak:2,bestStreak:3,stars:20}}));
  });
  await page.goto(`http://127.0.0.1:4194/?quick=1&tod=${scene.tod}&level=5${scene.mode==='blitz'?'&blitz=1':''}`);
  await page.waitForFunction(()=>document.getElementById('boot')?.classList.contains('gone') && window.__bl?.session);
  await page.evaluate(()=>window.__captureFreeze=true);
  await page.waitForTimeout(80);
  await page.evaluate(async ({kind,tod,weather})=>{
    const b=window.__bl,s=b.session,m=s.match,w=b.world;
    const {writeFrame}=await import('/src/game/replay.ts');
    const {HALF_L,BALL_R}=await import('/src/sim/constants.ts');
    s.endLineup();s.introLeft=0;s.holdFirst=false;s.view.frameHook=null;s.cam.setMode('broadcast');s.cam.setZoom('cinematic');
    s.hud?.hideIntro();s.hud?.setCommentary(false);s.hud?.setSkippable(false);s.trainer?.hide();s.present?.hidePlate();
    m.phase='play';m.phaseT=0;m.restart=null;m.events.length=0;m.offWatch=null;m.clock=62;m.ball.held=false;m.active=10;
    m.trainer=false;s.eatButtons=false;s.hitStopT=0;s.replay=null;s.paused=false;
    s.applyTimeOfDay(tod,weather);s.setCelebration('knee');
    w.renderer.setPixelRatio(1);w.renderer.setSize(innerWidth,innerHeight,false);w.camera.aspect=innerWidth/innerHeight;w.camera.updateProjectionMatrix();
    const place=(i,x,z,facing=0)=>{const p=m.players[i];p.pos.x=x;p.pos.z=z;p.vel.x=p.vel.z=0;p.facing=p.drawFacing=facing;p.state='move';p.stateT=0;p.order=null;p.y=0;p.wantX=p.wantZ=0;p.runPhase=(i*.137)%1;p.sentOff=false;};
    const ours=[[-45,0],[5,-17],[9,-6],[8,9],[4,19],[12,-19],[16,12],[24,-17],[28,-7],[24,12],[31,0]];
    const theirs=[[HALF_L-1,1],[39,-18],[35,-10],[39,10],[38,20],[28,-23],[26,8],[17,-8],[18,-14],[15,20],[13,0]];
    ours.forEach((p,i)=>place(i,p[0],p[1]));theirs.forEach((p,i)=>place(i+11,p[0],p[1],Math.PI));
    m.ball.owner=10;m.ball.lastTouch=10;m.ball.pos.x=31.65;m.ball.pos.y=BALL_R;m.ball.pos.z=0;m.ball.vel.x=m.ball.vel.y=m.ball.vel.z=0;
    writeFrame(m,s.cur,s.time);s.prev.set(s.cur);s.view.apply(s.prev,s.cur,1,s.time,0);
    window.__capture={b,s,m,w,kind,t:0,goalAt:null,events:[],lastPhase:m.phase, controls:{sx:0,sy:0,sprint:false,pass:false,shoot:false,through:false,power:false,skill:false}};
    // Supply ordinary screen-space input. The world-to-stick mapping is the inverse
    // of CameraRig.screenToWorld, so both portal aspect ratios aim the same kick.
    b.input.read=()=>window.__capture.controls;
    b.input.lastDevice='gamepad';
    if(kind==='freekick'){
      if(!b.stage('freekick'))throw new Error('Could not stage free kick');
      b.step(150);
      const fk=m.ctl[0].fk;fk.pen.z=-2.5;fk.pen.h=1.8;fk.curl=-.8;
    }else if(kind==='mega'){
      m.heldPower[0]='mega';
    }else b.superShot(0);
    b.step(1);w.render();
    window.__capture.advance=()=>{
      const c=window.__capture,t=c.t;
      const move=(x,z)=>{const yaw=s.cam.yaw;c.controls.sx=x*Math.cos(yaw)+z*Math.sin(yaw);c.controls.sy=x*Math.sin(yaw)-z*Math.cos(yaw);};
      Object.assign(c.controls,{sx:0,sy:0,sprint:false,pass:false,shoot:false,through:false,power:false,skill:false});
      if(kind==='freekick'){
        c.controls.shoot=t>=.20&&t<.55;
      }else{
        if(t<.85)move(1,0);
        c.controls.sprint=t<.55;
        c.controls.power=kind==='mega'&&t<.1;
        c.controls.shoot=t>=.55&&t<.85;
      }
      b.step(2);
      // Stop further controls when the shot is in flight or scored. Native goal
      // celebration and native replay remain free to play out.
      if(m.phase!==c.lastPhase){c.events.push({time:Number(t.toFixed(3)),from:c.lastPhase,to:m.phase,score:[...m.score]});c.lastPhase=m.phase;}
      if(m.phase==='goal'&&c.goalAt===null)c.goalAt=t;
      c.t+=1/30;w.render();
    };
  },scene);
  await page.addStyleTag({content:'.trainer,.trainer-tag{display:none!important}'});
  if(errors.length)throw new Error(errors.join('; '));
  return {page,errors};
}

function encodeStream(path,width,height) {
  const proc=spawn(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','image2pipe','-vcodec','mjpeg','-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','slow','-crf','17','-pix_fmt','yuv420p','-r',String(fps),'-movflags','+faststart',path],{stdio:['pipe','ignore','pipe']});
  let stderr='';proc.stderr.on('data',v=>stderr+=v);proc.on('error',e=>stderr+=e.message);
  return {proc, async write(frame){if(!proc.stdin.write(frame))await once(proc.stdin,'drain')},async finish(){proc.stdin.end();const [code]=await once(proc,'close');if(code!==0)throw new Error(stderr)}};
}
function probe(path) {
  return JSON.parse(execFileSync(ffprobe,['-v','error','-show_format','-show_streams','-of','json',path],{encoding:'utf8'}));
}
async function metadata(path) {
  const p=probe(path),v=p.streams.find(s=>s.codec_type==='video'),bytes=(await stat(path)).size;
  if(p.streams.some(s=>s.codec_type==='audio'))throw new Error('Portal exports must have no audio');
  return {path:path.slice(root.length+1),width:v.width,height:v.height,fps:v.avg_frame_rate,codec:v.codec_name,pixelFormat:v.pix_fmt,duration:Number(p.format.duration),bytes,sha256:createHash('sha256').update(await readFile(path)).digest('hex')};
}

try {
  for(const set of sets){
    const paths=[];
    for(const scene of scenes.filter(s=>!assembleOnly&&(!selectedScene||s.name===selectedScene))){
      console.log(`Capture ${set.name}: ${scene.name}`);
      const {page,errors}=await pageFor(set,scene);
      const capturePath=join(out,'raw',`${set.name}-${scene.name}.mp4`);
      const encoder=referenceOnly||simulationOnly?null:encodeStream(capturePath,set.width,set.height);
      const count=referenceOnly?1:Math.round(scene.duration*fps);
      for(let frame=0;frame<count;frame++){
        if(frame>0)await page.evaluate(()=>__capture.advance());
        if(encoder)await encoder.write(await page.screenshot({type:'jpeg',quality:96}));
        if(frame===0||frame===30||frame===60||frame===90||frame===120){
          await page.screenshot({path:join(out,'reference',`${set.name}-${scene.name}-${String(frame).padStart(3,'0')}.png`)});
        }
      }
      if(encoder)await encoder.finish();
      const state=await page.evaluate(()=>({events:__capture.events,goalAt:__capture.goalAt,score:[...__capture.m.score],phase:__capture.m.phase}));
      if(errors.length)throw new Error(errors.join('; '));
      manifest.clips.push({scene:scene.name,aspect:set.name,startingScenario:scene,state,...(encoder?await metadata(capturePath):{})});
      paths.push(capturePath);console.log(JSON.stringify(state));await page.close();
    }
    if(!referenceOnly&&!simulationOnly){
      if(selectedScene||assembleOnly)paths.splice(0,paths.length,...scenes.map(s=>join(out,'raw',`${set.name}-${s.name}.mp4`)));
      if(set.cover){
        const still=join(out,'raw',`${filePrefix}-${set.name}-00-opening-cover.mp4`);
        execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-loop','1','-i',resolve(set.cover),'-t','0.6','-vf',`scale=${set.width}:${set.height}:force_original_aspect_ratio=increase,crop=${set.width}:${set.height}`,'-an','-c:v','libx264','-preset','slow','-crf','17','-pix_fmt','yuv420p','-r',String(fps),'-movflags','+faststart',still]);
        paths.unshift(still);
      }
      const concat=join(out,'raw',`${filePrefix}-${set.name}-edit-list.txt`);
      await writeFile(concat,paths.map(p=>`file '${p.replaceAll("'","'\\''")}'`).join('\n')+'\n');
      const final=join(out,`${filePrefix}-gameplay-${set.name}-${set.width}x${set.height}.mp4`);
      execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',concat,'-an','-c','copy','-movflags','+faststart',final]);
      const m=await metadata(final);
      if(m.duration>20||m.bytes>50*1024*1024||m.fps!=='30/1')throw new Error('Portal output exceeds media constraints');
      manifest.outputs.push({...m,route:coverRoute,sourceClips:scenes.map(s=>`store-assets/campaign-2026-10-14/footage/raw/${set.name}-${s.name}.mp4`),openingStill:set.cover?{path:resolve(set.cover).slice(root.length+1),duration:.6}:null});console.log(`Wrote ${m.path}: ${m.duration}s, ${(m.bytes/1024/1024).toFixed(1)}MiB`);
    }
  }
  await writeFile(join(out,'footage-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
}finally{await browser.close();await server.close();}
