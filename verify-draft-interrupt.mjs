import assert from 'node:assert/strict';
import path from 'node:path';
import {launchBrowser,studioControl} from './browser-test.mjs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {applySurface,decodeSurface} from './src/surface-record.js';
const root=path.dirname(fileURLToPath(import.meta.url));
const browser=await launchBrowser();
const page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'});
try {
  await page.goto(pathToFileURL(path.join(root,'糖画铺.html')).href+'?mode=template');await page.waitForFunction(()=>window.sugarStudio);
  const point=await page.evaluate(()=>sugarStudio.projectPoint(0,0));
  await page.mouse.move(point.x,point.y);await page.mouse.down();await page.waitForTimeout(180);await page.mouse.up();
  await page.waitForFunction(()=>sugarStudio.getState().strokes===1&&!sugarStudio.getState().draining);await page.waitForTimeout(900);
  const first=await page.evaluate(()=>Array.from(sugarStudio.captureSurface()));
  await (await studioControl(page,'#clear')).click();await (await studioControl(page,'#undo')).click();
  await page.mouse.move(point.x+35,point.y);await page.mouse.down();await page.waitForTimeout(800);
  assert.equal((await page.evaluate(()=>sugarStudio.getState())).drawing,true);
  const saved=await page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('sugar-painting',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,read=db.transaction('drafts').objectStore('drafts').get('current');read.onsuccess=()=>{resolve(read.result);db.close();};read.onerror=()=>reject(read.error);};}));
  assert.equal(saved.templates['0'].length,1);
  const nx=768,nz=632,layer={nx,field:new Float32Array(nx*nz),heat:new Float32Array(nx*nz),texture:{}};
  applySurface(layer,decodeSurface(saved.surfaces['template:0'],nx,nz));assert.deepEqual(Array.from(layer.field),first);
  await page.mouse.up();await page.waitForFunction(()=>sugarStudio.getState().strokes===2&&!sugarStudio.getState().draining);await page.waitForTimeout(900);
  const second=await page.evaluate(()=>Array.from(sugarStudio.captureSurface()));assert.notDeepEqual(second,first);
  await (await studioControl(page,'#undo')).click();assert.deepEqual(await page.evaluate(()=>Array.from(sugarStudio.captureSurface())),first);
  await (await studioControl(page,'#redo')).click();assert.deepEqual(await page.evaluate(()=>Array.from(sugarStudio.captureSurface())),second);
  const oldPage=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'});
  await oldPage.goto(pathToFileURL(path.join(root,'糖画铺.html')).href+'?mode=template');await oldPage.waitForFunction(()=>window.sugarStudio);
  const legacy={version:1,own:[],templates:saved.templates};
  await oldPage.evaluate(draft=>new Promise((resolve,reject)=>{const request=indexedDB.open('sugar-painting',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(draft,'current');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};}),legacy);
  await oldPage.reload();await oldPage.waitForFunction(()=>window.sugarStudio);const legacyState=await oldPage.evaluate(()=>sugarStudio.getState());assert.equal(legacyState.strokes,1);assert.ok(legacyState.material.volume>0);await oldPage.close();
  console.log(JSON.stringify({ok:true,checks:['autosave excludes unfinished stroke','undo and redo preserve cooled surface','legacy drafts reconstruct from strokes']},null,2));
}catch(error){console.error(error);process.exitCode=1;}
finally{await browser.close();}
