import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {launchBrowser,studioControl} from './browser-test.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),browser=await launchBrowser();
const page=await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce'}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const state=()=>page.evaluate(()=>sugarStudio.getState());
try {
  await page.goto(pathToFileURL(path.join(root,'糖画铺.html')).href+'?mode=template');await page.waitForFunction(()=>window.sugarStudio);
  const [start,outside,back]=await page.evaluate(()=>[[3.8,0],[4.8,0],[3.4,0]].map(([x,z])=>sugarStudio.projectPoint(x,z)));
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.waitForTimeout(400);
  await page.mouse.move(outside.x,outside.y,{steps:8});
  await page.waitForFunction(()=>sugarStudio.getState().drawing&&!sugarStudio.getState().pour.active);
  const stopped=(await state()).material.volume;await page.waitForTimeout(350);
  assert.ok(Math.abs((await state()).material.volume-stopped)<1e-8,'no further sugar is deposited while outside');
  await page.mouse.move(back.x,back.y,{steps:8});await page.waitForFunction(()=>sugarStudio.getState().pour.flowing);await page.waitForTimeout(200);await page.mouse.up();
  await page.waitForFunction(()=>!sugarStudio.getState().draining&&sugarStudio.getState().strokes===1);
  await page.waitForFunction(()=>document.querySelector('#draft-status').textContent==='作品已保存在本机');
  const commands=await page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('sugar-painting',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,get=db.transaction('drafts').objectStore('drafts').get('current');get.onsuccess=()=>{resolve(get.result.templates['0'][0].commands);db.close();};get.onerror=()=>reject(get.error);};}));
  assert.ok(commands.some(c=>c.flow===false));assert.ok(commands.some(c=>c.flow===true));
  await (await studioControl(page,'#play')).click();
  await page.waitForFunction(()=>{const s=sugarStudio.getState();return s.playing&&!s.pour.commanded&&s.replay.applied>0&&s.progress<.8;});
  await page.waitForFunction(()=>sugarStudio.getState().playing&&sugarStudio.getState().pour.commanded);
  await page.waitForFunction(()=>!sugarStudio.getState().playing);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks:['out-of-board flow stops','re-entry resumes','pause survives draft and playback'],errors},null,2));
} finally {await browser.close();}
