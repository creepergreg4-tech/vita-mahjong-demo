import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-gl=angle','--use-angle=swiftshader']});
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('response',r=>{if(r.status()>=400)console.log('HTTP',r.status(),r.url());});
page.on('requestfailed',r=>console.log('REQUEST FAILED',r.url(),r.failure()?.errorText));
const dir=process.env.SCREENSHOT_DIR||'test-output/v9-reward';fs.mkdirSync(dir,{recursive:true});
const url=process.env.GAME_URL||'http://localhost:4191/';
const st=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
const ready=()=>page.waitForFunction(()=>window.render_game_to_text&&!JSON.parse(window.render_game_to_text()).busy,null,{timeout:120000});
async function tap(pt){const s=await st(),r=await page.locator('canvas').boundingBox();await page.touchscreen.tap(r.x+pt.x*r.width/s.canvas.width,r.y+pt.y*r.height/s.canvas.height);}
try {
 await page.goto(url);await ready();assert.equal((await st()).mode,'home');await page.screenshot({path:dir+'/01-cold-home.png'});
 await tap((await st()).controls.start);await ready();assert.equal((await st()).mode,'play');
 await tap((await st()).controls.dm);await page.getByRole('button',{name:'宝箱开箱演示',exact:true}).click();
 await page.waitForFunction(()=>window.__game.scene.scenes[0].nativeFx?.stage==='opening');
 const before=await page.evaluate(()=>window.__game.scene.scenes[0].visualInventory.undo);
 await page.waitForTimeout(750);
 assert.equal(await page.evaluate(()=>{const g=window.__game.scene.scenes[0];const l=g.children.getByName('gift-reward');return l.list.some(x=>x.type==='Rectangle'&&x.width>=500&&x.height>=g.H*.8);}),false,'no full-screen dark overlay');
 assert.equal(await page.evaluate(()=>window.__game.scene.scenes[0].children.list.find(x=>x.anims?.currentAnim?.key==='native.giftGlow')?.blendMode),1,'native light uses ADD, box remains NORMAL');
 await page.screenshot({path:dir+'/02-opening-no-black.png'});
 await page.waitForFunction(()=>window.__game.scene.scenes[0].nativeFx?.stage==='reveal');await page.waitForTimeout(180);
 assert.equal(await page.evaluate(()=>window.__game.scene.scenes[0].visualInventory.undo),before,'reward not credited at reveal');
 await page.screenshot({path:dir+'/03-gold-reveal.png'});
 await page.waitForFunction(()=>window.__game.scene.scenes[0].nativeFx?.stage==='flight');
 assert.equal(await page.evaluate(()=>window.__game.scene.scenes[0].visualInventory.undo),before);
 await ready();assert.equal(await page.evaluate(()=>window.__game.scene.scenes[0].visualInventory.undo),before+1);await page.waitForTimeout(700);
 assert.equal(await page.evaluate(()=>window.__game.scene.scenes[0].children.getByName('gift-reward')?.active||false),false);
 await page.screenshot({path:dir+'/04-arrived.png'});
 await page.goto(url+'?test=1&level=14');await ready();const previouslyHidden=new Set((await st()).state.tiles.filter(x=>x.everHidden).map(x=>x.id));await page.evaluate(()=>{let seed=1;while(((Math.imul(seed,1664525)+1013904223)>>>0)/4294967296<.85)seed++;window.__test.gift(seed);});
 await page.waitForFunction(()=>window.__game.scene.scenes[0].nativeFx?.stage==='reveal');await page.screenshot({path:dir+'/05-light-negative.png'});await ready();
 const newlyHidden=(await st()).state.tiles.filter(x=>x.hidden&&x.everHidden&&!previouslyHidden.has(x.id));assert.ok(newlyHidden.length<=4);assert.ok(newlyHidden.every(x=>x.kind==='normal'));
 assert.deepEqual(errors,[]);fs.writeFileSync(dir+'/verified.json',JSON.stringify({passed:true,url,checks:['production cold start and touch','DM gift entry','no full-screen dim','separate additive glow','gold reveal','inventory credits only after flight','light negative branch','effects cleanup'],errors},null,2));console.log('V9 reward mobile browser PASS');
} finally {await browser.close();}
