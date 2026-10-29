import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const root=process.cwd();
const out=path.join(root,'public/assets/reward-fx/baked');await fs.mkdir(out,{recursive:true});
const server=http.createServer(async(req,res)=>{try{const file=path.join(root,decodeURIComponent(req.url.split('?')[0]));const buf=await fs.readFile(file);const ext=path.extname(file);res.setHeader('Content-Type',({'.js':'application/javascript','.html':'text/html','.png':'image/png','.json':'application/json'})[ext]||'application/octet-stream');res.end(buf)}catch{res.statusCode=404;res.end('Not found')}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage();page.on('pageerror',e=>console.error(e));await page.goto(`http://127.0.0.1:${server.address().port}/tools/bake-native-spine.html`);
 const sources=[['FirecrackerBomb','FirecrackerBomb'],['SlotMachin_1','SlotMachine'],['SlotMachine_2','SlotMachine'],['Box_Up_1767','GameGiftBox'],['Box_Down_7340','GameGiftBox'],['FX_2_2450','GameGiftBox']];
 const inventory=[];for(const [name,atlasName] of sources)inventory.push(await page.evaluate(([a,b])=>inspectNative(a,b),[name,atlasName]));
 await fs.writeFile(path.join(out,'native-inventory.json'),JSON.stringify(inventory,null,2));console.log(JSON.stringify(inventory.map(({name,version,animations,width,height})=>({name,version,animations,width,height})),null,2));
 if(process.argv.includes('--inspect')){for(let i=0;i<sources.length;i++){const[name,atlasName]=sources[i];for(const a of inventory[i].animations){const bounds=await page.evaluate(x=>boundsNative(...x),[name,atlasName,a.name]);console.log(name,a.name,JSON.stringify(bounds));const png=await page.evaluate(x=>renderNative(x),{name,atlasName,animation:a.name,time:a.duration*.3,bounds});await fs.writeFile(path.join(out,`preview-${name}-${a.name}.png`),Buffer.from(png.split(',')[1],'base64'));}}}
 if(process.argv.includes('--bake')){
 // GameGiftUI Content child order: FX behind the body, then reward props, then lid.
 // Keep black-backed additive light separate from the opaque box. Flattening
 // both into a NORMAL sprite creates the rotating dark square on the board.
 const gift=[{name:'Box_Down_7340',atlasName:'GameGiftBox',animation:'Box_Down'},{name:'Box_Up_1767',atlasName:'GameGiftBox',animation:'Box_Up'}];
 const slot=(animation)=>[{name:'SlotMachine_2',atlasName:'SlotMachine',animation,skin:'Down'},{name:'SlotMachin_1',atlasName:'SlotMachine',animation,skin:'Down'}];
 const specs=[{key:'giftOpen',layers:gift,duration:2.166666746,width:320,height:320},{key:'giftGlow',layers:[{name:'FX_2_2450',atlasName:'GameGiftBox',animation:'Appear'}],duration:1.733333468,width:320,height:320},{key:'bomb',layers:[{name:'FirecrackerBomb',atlasName:'FirecrackerBomb',animation:'Bomb'}],duration:.833333373,width:320,height:320},...['SpittingCard','CollectCard','Disappear','Loop'].map((animation)=>({key:({SpittingCard:'slotSpitting',CollectCard:'slotCollect',Disappear:'slotDisappear',Loop:'slotIdle'})[animation],layers:slot(animation),duration:animation==='Loop'?0:animation==='SpittingCard'?.833333373:.266666681,width:256,height:384,loop:animation==='Loop'}))];
 const previous=JSON.parse(await fs.readFile(path.join(out,'animations.json'),'utf8'));
 const giftOnly=process.argv.includes('--gift-only');
 const result={...previous,animations:giftOnly?{...previous.animations}:{}};
 const union=(list)=>{const x=Math.min(...list.map(b=>b.x)),y=Math.min(...list.map(b=>b.y)),right=Math.max(...list.map(b=>b.right)),top=Math.max(...list.map(b=>b.top));return{x,y,right,top,width:right-x,height:top-y};};
 let slotBounds;
 for(const spec of specs){const {key,layers,duration,width,height}=spec;if(giftOnly&&!key.startsWith('gift'))continue;let bounds;
  if(key.startsWith('gift'))bounds=previous.animations.giftOpen.bounds;
  else if(key.startsWith('slot')&&slotBounds)bounds=slotBounds;
  else {const boxes=[];for(const l of layers)boxes.push(await page.evaluate(l=>boundsNative(l.name,l.atlasName,l.animation,l.skin),l));const geometric=union(boxes);const visible=[];for(let t=0;t<Math.max(duration,1/24);t+=1/24){const b=await page.evaluate(v=>renderLayers(v),{layers,time:t,width:512,height:512,bounds:geometric,scan:true});if(b.count)visible.push(b.world);}bounds=union(visible);if(key.startsWith('slot')){bounds.x-=18;bounds.y-=22;bounds.width+=36;bounds.height+=44;bounds.right+=18;bounds.top+=22;slotBounds=bounds;}}
  const frames=Math.max(1,Math.ceil(duration*24-0.00001));const cols=Math.floor(2048/width),rows=Math.floor(2048/height),capacity=cols*rows;const pages=[];
  for(let start=0;start<frames;start+=capacity){const count=Math.min(capacity,frames-start);await page.evaluate(x=>startSheet(...x),[Math.min(cols,count)*width,Math.ceil(count/cols)*height]);for(let j=0;j<count;j++){await page.evaluate(v=>renderLayers(v),{layers,time:(start+j)/24,width,height,bounds});await page.evaluate(x=>addSheetFrame(...x),[(j%cols)*width,Math.floor(j/cols)*height]);}const png=await page.evaluate(()=>finishSheet());const file=`${key}-${pages.length}.png`;await fs.writeFile(path.join(out,file),Buffer.from(png.split(',')[1],'base64'));pages.push({file:'/assets/reward-fx/baked/'+file,frames:count,startFrame:start,columns:Math.min(cols,count),rows:Math.ceil(count/cols)});}
  for(const ratio of [0,.3,.6,.9]){const png=await page.evaluate(v=>renderLayers(v),{layers,time:duration*ratio,width,height,bounds});await fs.writeFile(path.join(out,`preview-${key}-${Math.round(ratio*100)}.png`),Buffer.from(png.split(',')[1],'base64'));}
  result.animations[key]={key,pages,files:pages.map(p=>p.file),frameWidth:width,frameHeight:height,frameCount:frames,frames,fps:24,duration,loop:!!spec.loop,bounds,layers};console.log('BAKED',key,frames,JSON.stringify(bounds));
 }
 await fs.writeFile(path.join(out,'animations.json'),JSON.stringify(result,null,2));
 }
 if(process.argv.includes('--validate')){
  const manifest=JSON.parse(await fs.readFile(path.join(out,'animations.json'),'utf8'));
  const checks=await page.evaluate(async manifest=>{const checks=[];for(const a of Object.values(manifest.animations)){const hashes=[],counts=[];for(const p of a.pages){const img=new Image();img.src='/public'+p.file;await img.decode();if(img.width>2048||img.height>2048)throw Error('Oversize sheet '+p.file);const c=document.createElement('canvas');c.width=a.frameWidth;c.height=a.frameHeight;const ctx=c.getContext('2d');for(let f=0;f<p.frames;f++){ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(img,(f%p.columns)*c.width,Math.floor(f/p.columns)*c.height,c.width,c.height,0,0,c.width,c.height);const d=ctx.getImageData(0,0,c.width,c.height).data;let hash=2166136261,count=0;for(let i=0;i<d.length;i++){hash=Math.imul(hash^d[i],16777619);if(i%4===3&&d[i]>8)count++;}hashes.push(hash>>>0);counts.push(count);}}if(hashes.length!==a.frameCount)throw Error('Wrong count '+a.key);checks.push({key:a.key,frameCount:hashes.length,distinctFrames:new Set(hashes).size,visibleFrames:counts.filter(x=>x>0).length,alphaPixelRange:[Math.min(...counts),Math.max(...counts)]});}return checks;},manifest);
  await fs.writeFile(path.join(out,'validation.json'),JSON.stringify({runtime:'Spine 4.1 WebGL',transparentCanvas:true,maxSheetDimension:2048,checks},null,2));console.log(JSON.stringify(checks,null,2));
 }
}finally{await browser.close();server.close();}
