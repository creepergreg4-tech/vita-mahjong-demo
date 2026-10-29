import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const b=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-gl=angle','--use-angle=swiftshader']});
const p=await b.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const dir=process.env.SCREENSHOT_DIR||'test-output/v11-stacks';fs.mkdirSync(dir,{recursive:true});
const url=process.env.GAME_URL||'http://localhost:4192/';
const st=()=>p.evaluate(()=>window.__test.state());
const ready=()=>p.waitForFunction(()=>window.__test&&!window.__test.state().busy,null,{timeout:120000});
async function tap(id){const s=await st(),t=s.tiles.find(t=>t.id===id),r=await p.locator('canvas').boundingBox();if(!t)return;await p.touchscreen.tap(r.x+t.screen.x*r.width/s.canvas.width,r.y+t.screen.y*r.height/s.canvas.height);}
try {
 for(const level of [17,19]) {
  await p.goto(url+`?test=1&level=${level}`);await ready();await p.screenshot({path:dir+`/${level}-01-machine.png`});
  const witness=await p.evaluate(()=>{const g=window.__game.scene.scenes[0],original=g.experimentView.play.bind(g.experimentView);window.stackEntered=null;g.experimentView.play=async e=>{if(e.result==='stackNormal')window.stackEntered=e;return original(e);};return g.p.level.solution;});
  for(const a of witness) {
   if(a.type==='stash')await p.evaluate(()=>window.__test.stash());
   for(const id of a.type==='pair'?[a.a,a.b]:[a.a]) {
    const t=(await st()).tiles.find(t=>t.id===id);if(!t)continue;
    if(t.hidden){await tap(id);await ready();}
    await tap(id);
    await p.waitForFunction(()=>window.stackEntered||!window.__test.state().busy);
    if(await p.evaluate(()=>!!window.stackEntered)){await p.waitForTimeout(level===19?1250:500);await p.screenshot({path:dir+`/${level}-02-delivery.png`});await ready();break;}
    await ready();
   }
   if(await p.evaluate(()=>!!window.stackEntered))break;
  }
  const e=await p.evaluate(()=>window.stackEntered);assert.equal(e?.result,'stackNormal');assert.equal(e.ids.length,6);
  const s=await st(),newTiles=s.tiles.filter(t=>e.ids.includes(t.id));assert.equal(newTiles.length,6);assert.ok(newTiles.every(t=>t.kind==='normal'));
  const tops=newTiles.filter(t=>t.free);assert.equal(tops.length,2);assert.notEqual(tops[0].face,tops[1].face);assert.ok(newTiles.some(t=>!t.exposed));
  if(level===19)assert.equal(await p.evaluate(()=>window.__game.scene.scenes[0].experimentView.lastFaces.length),3);
  await p.screenshot({path:dir+`/${level}-03-stacked-puzzle.png`});
  const plan=await p.evaluate(()=>window.__test.solve());assert.ok(plan?.length);
  // Exercise the new geometry through the real touch path and show a usable next state.
  for(const a of plan.slice(0,6)) {if(a.type==='stash')await p.evaluate(()=>window.__test.stash());for(const id of a.type==='pair'?[a.a,a.b]:[a.a]){const t=(await st()).tiles.find(t=>t.id===id);if(!t)continue;if(t.hidden){await tap(id);await ready();}await tap(id);await ready();}}
  assert.equal((await st()).modal,false);await p.screenshot({path:dir+`/${level}-04-after-decisions.png`});
 }
 // A negative gift and a machine charge may settle in the same pair. The gift
 // redraw must not make newly emitted cards appear before their flight.
 await p.goto(url+'?test=1&level=17');await ready();
 await p.evaluate(()=>{const g=window.__game.scene.scenes[0],s=structuredClone(g.p.s);s.tiles.forEach((t,i)=>{t.removed=i>=8;t.hidden=false;t.kind=i<2?'gift':'normal';t.face=Math.floor(i/2);t.x=i%2?5:0;t.y=1+Math.floor(i/2)*1.2;t.z=0;});s.experiment.streak=s.experiment.threshold-1;s.seed=1500;window.__test.fixture(s);const original=g.experimentView.play.bind(g.experimentView);window.noPrematureCards=null;g.experimentView.play=async e=>{const promise=original(e);if(e.result==='stackNormal')window.noPrematureCards=e.ids.every(id=>!g.tileViews.has(id));return promise;};});
 await tap(0);await ready();await tap(1);await ready();
 assert.equal(await p.evaluate(()=>window.noPrematureCards),true,'gift redraw cannot reveal stack before delivery');await p.screenshot({path:dir+'/gift-and-delivery.png'});
 assert.deepEqual(errors,[]);fs.writeFileSync(dir+'/verified.json',JSON.stringify({passed:true,url,levels:[17,19],checks:['real touch manual combo activates','six real ordinary tiles','two unlike exposed tops','covered lower tiles','machine shows actual faces','real solver route touchable','negative gift then delivery uses before snapshot'],errors},null,2));console.log('V11 dragon + reel stacked puzzle mobile PASS');
} finally {await b.close();}
