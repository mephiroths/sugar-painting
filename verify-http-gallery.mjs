import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openRackManagement,closeRackManagement,launchBrowser,studioControl,saveCurrentWork} from './browser-test.mjs';

const root=path.dirname(fileURLToPath(import.meta.url)),browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const origin='http://sugar-painting.test/';
async function works(){return page.evaluate(()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('sugar-painting',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,read=db.transaction('drafts','readonly').objectStore('drafts').get('gallery');read.onsuccess=()=>{resolve(read.result||[]);db.close();};read.onerror=()=>{db.close();reject(read.error);};};
}));}
try {
  // Fulfil the reserved test origin locally. The browser still applies normal
  // non-secure HTTP API restrictions; no remote test server is contacted.
  await page.route(origin+'**',route=>route.fulfill({path:path.join(root,'糖画铺.html'),contentType:'text/html'}));
  await page.goto(origin+'?mode=template');await page.waitForFunction(()=>window.sugarStudio);
  const capabilities=await page.evaluate(()=>({secure:isSecureContext,randomUUID:typeof crypto.randomUUID,randomValues:typeof crypto.getRandomValues}));
  assert.equal(capabilities.secure,false);assert.equal(capabilities.randomUUID,'undefined');assert.equal(capabilities.randomValues,'function');
  const point=await page.evaluate(()=>sugarStudio.projectPoint(0,0));await page.mouse.move(point.x,point.y);await page.mouse.down();await page.waitForTimeout(250);await page.mouse.up();
  await page.waitForFunction(()=>sugarStudio.getState().strokes===1&&!sugarStudio.getState().draining);await page.waitForTimeout(850);
  const volume=await page.evaluate(()=>sugarStudio.getState().material.volume);
  for(const name of ['HTTP 练习一','HTTP 练习二']){
    await page.evaluate(()=>document.querySelector('#toast').textContent='');await saveCurrentWork(page,name);
    await page.waitForFunction(()=>document.querySelector('#toast').textContent==='已存入糖画架。',null,{timeout:5000});
  }
  const stored=await works();assert.equal(stored.length,2);assert.equal(new Set(stored.map(item=>item.id)).size,2);
  for(const item of stored)assert.match(item.id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  await page.evaluate(()=>{const original=HTMLCanvasElement.prototype.toDataURL;window.restoreImageExport=()=>{HTMLCanvasElement.prototype.toDataURL=original;};HTMLCanvasElement.prototype.toDataURL=()=>{throw new Error('test snapshot failure');};});
  await (await studioControl(page,'#gallery-save')).click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('没能保存'));
  assert.equal((await works()).length,2);assert.equal(await page.evaluate(()=>sugarStudio.getState().strokes),1);
  await page.evaluate(()=>window.restoreImageExport());
  await page.reload();await page.waitForFunction(()=>window.sugarStudio);await (await studioControl(page,'#clear')).click();await openRackManagement(page);
  await page.waitForFunction(()=>document.querySelectorAll('.gallery-item').length===2);await page.locator('.gallery-item').first().getByRole('button',{name:'打开',exact:true}).click();
  assert.equal(await page.evaluate(()=>sugarStudio.getState().strokes),1);assert.ok(Math.abs(await page.evaluate(()=>sugarStudio.getState().material.volume)-volume)<volume*1e-5);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,capabilities,checks:['native non-secure HTTP context','unique work IDs without randomUUID','thumbnail failure is recoverable','saved works survive reload and reopen'],errors},null,2));
} catch(error){console.error(error);console.error(JSON.stringify({errors}));process.exitCode=1;}
finally {await browser.close();}
