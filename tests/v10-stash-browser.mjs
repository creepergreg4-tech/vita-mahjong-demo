import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const b=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-gl=angle','--use-angle=swiftshader']});
const p=await b.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errors=[];p.on('pageerror',e=>errors.push(e.message));
const dir='test-output/v10-stash';fs.mkdirSync(dir,{recursive:true});
const ready=()=>p.waitForFunction(()=>window.__test&&!window.__test.state().busy,null,{timeout:120000});
const st=()=>p.evaluate(()=>window.__test.state());
async function tap(id){const s=await st(),r=await p.locator('canvas').boundingBox(),pt=s.tiles.find(t=>t.id===id).screen;await p.touchscreen.tap(r.x+pt.x*r.width/s.canvas.width,r.y+pt.y*r.height/s.canvas.height);await ready();}
try {
 await p.goto((process.env.GAME_URL||'http://localhost:4178/')+'?test=1&level=13');await ready();
 const original=await p.evaluate(()=>structuredClone(window.__game.scene.scenes[0].p.s));
 const candidates=(await st()).tiles.filter(t=>t.exposed&&!t.hidden&&t.kind==='normal');
 assert.ok(candidates.length);
 for(const t of candidates){await p.evaluate(s=>{s.slotOpen=true;window.__test.fixture(s);window.__test.stash();},original);await ready();await tap(t.id);assert.equal((await st()).state.slot,t.id,`visible side-blocked ${t.id} must enter stash via actual touch`);}
 console.log('Visible side-blocked touch candidates passed:',candidates.map(t=>t.id));
 // Hidden surface ordinary tiles reveal and enter stash with the same tap.
 const hidden=(await p.evaluate(s=>{s.slotOpen=true;s.slot=null;s.slotPending=null;s.tray=[];s.tiles.forEach((t,i)=>{t.removed=i>=6;t.kind='normal';t.face=i%3;t.x=i%3;t.y=Math.floor(i/3)*2;t.z=0;t.hidden=i===1;t.everHidden=i===1;});window.__test.fixture(s);return window.__test.state().tiles.find(t=>t.hidden&&t.exposed&&t.kind==='normal');},original));
 assert.equal(hidden?.free,false,'fixture reproduces a surface blue back clamped on both sides');
 assert.ok(hidden);await p.evaluate(()=>window.__test.stash());await ready();await tap(hidden.id);
 assert.equal((await st()).state.tiles.find(t=>t.id===hidden.id).hidden,false,'stash selection must allow surface blue-back reveal');
 assert.equal((await st()).stashMode,false);assert.equal((await st()).state.slot,hidden.id);
 await p.screenshot({path:dir+'/01-side-blocked-hidden-stashed.png'});
 for(const kind of ['normal','bomb','move','gift']) {
  await p.evaluate(({s,kind})=>{s.slotOpen=true;s.slot=null;s.slotPending=null;s.tray=[];s.tiles.forEach((t,i)=>{t.removed=i>=6;t.kind=i===1||i===4?kind:'normal';t.face=i%3;t.x=i%3;t.y=Math.floor(i/3)*2;t.z=0;t.hidden=false;});window.__test.fixture(s);window.__game.scene.scenes[0].p.stashMode=false;window.__test.stash();},{s:original,kind});await ready();
  const target=(await st()).tiles.find(t=>t.id===original.tiles[1].id);assert.equal(target.free,false);await tap(target.id);assert.equal((await st()).state.slot,target.id,`${kind} surface clamped tile must stash`);
  await p.screenshot({path:dir+`/02-${kind}-stashed.png`});
 }
 assert.deepEqual(errors,[]);
 fs.writeFileSync(dir+'/verified.json',JSON.stringify({passed:true,visibleSideBlocked:candidates.map(t=>t.id),hidden: hidden.id,errors},null,2));console.log('V10 stash mobile touch PASS');
} finally {await b.close();}
