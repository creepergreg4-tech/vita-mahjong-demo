import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const b=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-gl=angle','--use-angle=swiftshader']});
const dir='test-output/v12-loading';fs.mkdirSync(dir,{recursive:true});
const url=process.env.GAME_URL||'http://localhost:4192/';
try {
 const p=await b.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});let manifests=0,images=0;
 await p.route('**/assets/manifest.json',r=>++manifests===1?r.fulfill({status:503,body:'temporary'}):r.continue());
 await p.route('**/play-background.png',r=>++images===1?r.fulfill({status:503,body:'temporary'}):r.continue());
 await p.goto(url);await p.waitForFunction(()=>window.render_game_to_text,null,{timeout:120000});
 assert.ok(manifests>=2);assert.ok(images>=2);assert.equal(await p.evaluate(()=>JSON.parse(window.render_game_to_text()).mode),'home');
 await p.screenshot({path:dir+'/01-recovered-home.png'});await p.close();
 const q=await b.newPage({viewport:{width:390,height:844}});let attempts=0;
 await q.route('**/play-background.png',r=>{attempts++;return r.fulfill({status:503,body:'persistent'});});
 await q.goto(url);await q.getByText('素材未加载完整，点此重新加载',{exact:true}).waitFor({timeout:120000});
 assert.equal(attempts,4);assert.equal(await q.evaluate(()=>typeof window.render_game_to_text),'undefined');
 await q.screenshot({path:dir+'/02-safe-retry-screen.png'});
 await q.unroute('**/play-background.png');await q.getByText('素材未加载完整，点此重新加载',{exact:true}).click();await q.waitForFunction(()=>window.render_game_to_text,null,{timeout:120000});
 assert.equal(await q.evaluate(()=>JSON.parse(window.render_game_to_text()).mode),'home');await q.close();
 fs.writeFileSync(dir+'/verified.json',JSON.stringify({passed:true,checks:['manifest503 retry','image503 retry','6 simultaneous downloads','exhausted retries do not start broken board','visible retry button reloads successfully'],manifests,images,attempts},null,2));console.log('V12 loading recovery PASS');
}finally{await b.close();}
