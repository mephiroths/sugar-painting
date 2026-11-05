import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {launchBrowser,waitForAsync,studioControl,closeRackManagement} from './browser-test.mjs';

const root=path.dirname(fileURLToPath(import.meta.url)),browser=await launchBrowser(),errors=[];
const context=await browser.newContext({viewport:{width:1280,height:800},reducedMotion:'reduce'});
await context.addInitScript(()=>{
  window.readStored=key=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('sugar-painting',1);request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const db=request.result,read=db.transaction('drafts','readonly').objectStore('drafts').get(key);read.onsuccess=()=>{resolve(read.result);db.close();};read.onerror=()=>{db.close();reject(read.error);};};
  });
});
const first=await context.newPage(),second=await context.newPage(),url=pathToFileURL(path.join(root,'糖画铺.html')).href+'?mode=template';
for(const page of [first,second])page.on('pageerror',error=>errors.push(error.message));
async function draw(page,x,z,expectFailure=false) {
  await page.bringToFront();await page.locator('#scene').scrollIntoViewIfNeeded();const count=await page.evaluate(()=>sugarStudio.getState().strokes),point=await page.evaluate(([x,z])=>sugarStudio.projectPoint(x,z),[x,z]);
  await page.mouse.move(point.x,point.y);await page.mouse.down();await page.waitForTimeout(250);await page.mouse.up();
  await page.waitForFunction(count=>sugarStudio.getState().strokes===count+1&&!sugarStudio.getState().draining,count);
  await page.waitForFunction(()=>sugarStudio.getState().material.coolingCells===0);
  if(expectFailure)await page.waitForFunction(()=>!document.querySelector('#retry-save').hidden);
  else await page.waitForFunction(()=>document.querySelector('#draft-status').textContent.includes('已保存'));
}
try {
  for(const page of [first,second]){await page.goto(url);await page.waitForFunction(()=>window.sugarStudio);}
  await draw(first,-1,-1);
  await second.bringToFront();await (await studioControl(second,'[data-index="1"]')).click();await draw(second,1,1);
  let draft=await second.evaluate(()=>readStored('current'));
  assert.equal(draft.templates['0']?.length,1,'a different page saving fish must retain the butterfly draft');assert.equal(draft.templates['1']?.length,1);
  assert.ok(draft.surfaces['template:0']&&draft.surfaces['template:1']);
  await draw(first,-.5,0);draft=await first.evaluate(()=>readStored('current'));
  const canonical=JSON.stringify({strokes:draft.templates['0'],surface:draft.surfaces['template:0']});
  await second.bringToFront();await (await studioControl(second,'[data-index="0"]')).click();
  await second.evaluate(()=>{const encoder=HTMLCanvasElement.prototype.toDataURL;window.restorePreviewEncoder=()=>{HTMLCanvasElement.prototype.toDataURL=encoder;};HTMLCanvasElement.prototype.toDataURL=()=>{throw new Error('test preview encoder failure');};});
  await draw(second,.5,.5);await second.evaluate(()=>window.restorePreviewEncoder());
  await waitForAsync(second,async()=>{const works=await readStored('gallery');return works?.filter(work=>work.source==='draft-conflict').length===1;});
  let copies=(await second.evaluate(()=>readStored('gallery'))).filter(work=>work.source==='draft-conflict');const copyId=copies[0].id;
  assert.equal(copies[0].strokes.length,1);assert.ok(copies[0].image.startsWith('data:image/svg+xml'),'preview failure keeps a readable fallback and the actual drawing');assert.equal(await second.locator('#draft-copy-open').isVisible(),true);
  await draw(second,.8,.5);copies=(await second.evaluate(()=>readStored('gallery'))).filter(work=>work.source==='draft-conflict');
  assert.equal(copies.length,1);assert.equal(copies[0].id,copyId);assert.equal(copies[0].strokes.length,2,'subsequent edits update the same page copy');assert.ok(copies[0].image.startsWith('data:image/jpeg'),'saved sugar surface produces a real preview');
  draft=await second.evaluate(()=>readStored('current'));assert.equal(JSON.stringify({strokes:draft.templates['0'],surface:draft.surfaces['template:0']}),canonical);
  await second.evaluate(()=>{const put=IDBObjectStore.prototype.put;window.restoreStorage=()=>{IDBObjectStore.prototype.put=put;};IDBObjectStore.prototype.put=function(value,key){if(key==='gallery')throw new DOMException('test quota','QuotaExceededError');return put.call(this,value,key);};});
  await draw(second,.5,-.5,true);assert.equal((await second.evaluate(()=>readStored('gallery'))).find(work=>work.id===copyId).strokes.length,2);
  await second.evaluate(()=>window.restoreStorage());await second.locator('#retry-save').click();
  await waitForAsync(second,async id=>(await readStored('gallery')).find(work=>work.id===id)?.strokes.length===3,copyId);
  await second.reload();await second.waitForFunction(()=>window.sugarStudio);assert.equal(await second.evaluate(()=>sugarStudio.getState().strokes),2);
  await second.locator('#draft-copy-open').click();await second.locator('.gallery-item').filter({hasText:'页面副本'}).getByRole('button',{name:'打开',exact:true}).click();
  assert.equal(await second.evaluate(()=>sugarStudio.getState().strokes),3);await second.waitForTimeout(800);
  draft=await second.evaluate(()=>readStored('current'));assert.equal(JSON.stringify({strokes:draft.templates['0'],surface:draft.surfaces['template:0']}),canonical,'opening a recovered copy does not replace the other page draft');
  await first.bringToFront();await (await studioControl(first,'#clear')).click();await waitForAsync(first,async()=>(await readStored('current')).templates['0'].length===0);
  draft=await first.evaluate(()=>readStored('current'));assert.equal(draft.templates['1'].length,1);
  assert.equal(draft.surfaces['template:0']===null,true,JSON.stringify({state:await first.evaluate(()=>sugarStudio.getState()),status:await first.locator('#draft-status').textContent(),storedSurface:!!draft.surfaces['template:0'],revision:draft.revisions}));
  await (await studioControl(first,'#undo')).click();await waitForAsync(first,async()=>(await readStored('current')).templates['0'].length===2);
  assert.equal((await first.evaluate(()=>readStored('current'))).templates['1'].length,1);
  await first.locator('#draw-mode').click();await draw(first,-1,0);draft=await first.evaluate(()=>readStored('current'));assert.equal(draft.own.length,1);assert.equal(draft.templates['0'].length,2);assert.equal(draft.templates['1'].length,1);
  await second.bringToFront();await second.locator('#draft-copy-open').click();const download=second.waitForEvent('download');await second.locator('#gallery-export').click();const backup=path.join(root,'artifacts','draft-conflict-backup.json');await(await download).saveAs(backup);
  assert.equal(JSON.parse(fs.readFileSync(backup,'utf8')).works.find(work=>work.id===copyId).strokes.length,3);
  await closeRackManagement(second);await draw(second,-.3,-.5);await waitForAsync(second,async id=>(await readStored('gallery')).find(work=>work.id===id)?.strokes.length===4,copyId);
  await second.locator('#draft-copy-open').click();await second.locator('#gallery-import').setInputFiles(backup);
  await waitForAsync(second,async id=>{const works=await readStored('gallery');return works.find(work=>work.id===id)?.strokes.length===4&&works.some(work=>work.importedFrom===id&&work.strokes.length===3);},copyId);
  await second.locator('.gallery-item').filter({hasText:'导入副本'}).getByRole('button',{name:'打开',exact:true}).click();assert.equal(await second.evaluate(()=>sugarStudio.getState().strokes),3);
  await second.waitForFunction(()=>document.querySelector('#draft-status').textContent.includes('已保存'));await second.locator('#draft-copy-open').click();
  await second.evaluate(()=>document.querySelector('#gallery-status').textContent='');await second.locator('#gallery-import').setInputFiles(backup);await second.waitForFunction(()=>document.querySelector('#gallery-status').textContent.includes('已导入'));
  const versions=await second.evaluate(()=>readStored('gallery'));assert.equal(versions.length,2,'re-importing the same older version does not add another duplicate');
  const storeModule=await build({entryPoints:[path.join(root,'src/draft-store.js')],bundle:true,write:false,format:'iife',globalName:'draftStoreTest',platform:'browser',target:'es2022'});
  await second.addScriptTag({content:storeModule.outputFiles[0].text});
  const automatic=await second.evaluate(async()=>{
    const works=await readStored('gallery'),older=works.find(work=>work.importedFrom),newer=works.find(work=>!work.importedFrom),key='template:6';
    const snapshot=work=>({version:1,updatedAt:Date.now(),own:[],templates:{6:work.strokes},surfaces:{[key]:work.surface}});
    await draftStoreTest.writeDraft(snapshot(older),{keys:[key],expected:{[key]:0},copies:{}});
    await draftStoreTest.writeDraft(snapshot(newer),{keys:[key],expected:{[key]:1},copies:{}});
    const result=await draftStoreTest.writeDraft(snapshot(older),{keys:[key],expected:{[key]:1},autoKeys:[key],copies:{}}),current=await readStored('current');
    return{ignored:result.ignored,strokes:current.templates['6'].length,copies:(await readStored('gallery')).length};
  });
  assert.deepEqual(automatic,{ignored:['template:6'],strokes:4,copies:2},'an old automatic cooling save must not overwrite newer work or create a copy');
  await second.setViewportSize({width:390,height:844});await second.waitForFunction(()=>Array.from(document.querySelectorAll('.gallery-item img')).every(image=>image.complete&&image.naturalWidth>0));await second.screenshot({path:path.join(root,'artifacts','draft-conflict-mobile.png')});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks:['different workspace saves merge','same workspace conflict keeps both versions','page copy updates without duplicate cards','preview encoding failure retains the drawing','copy write failure can retry','copy survives reload and opens independently','clear, undo and free drawing retain other page work','recovery copy is included in backups','importing an older version keeps both versions and deduplicates repeats','stale automatic cooling creates no conflict copy'],errors},null,2));
} finally {await context.close();await browser.close();}
