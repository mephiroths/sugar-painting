import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {launchBrowser,studioControl,inspectCurrentWork} from './browser-test.mjs';

const root=path.dirname(fileURLToPath(import.meta.url)),browser=await launchBrowser();
const page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
const state=()=>page.evaluate(()=>sugarStudio.getState());
const field=()=>page.evaluate(()=>Array.from(sugarStudio.captureSurface()));
const pixels=()=>page.evaluate(()=>{
  const source=document.querySelector('#scene canvas'),canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;
  const ctx=canvas.getContext('2d');ctx.drawImage(source,0,0,320,240);return Array.from(ctx.getImageData(0,0,320,240).data);
});
async function press(x=0,z=0) {
  await page.locator('#scene').scrollIntoViewIfNeeded();
  const point=await page.evaluate(([x,z])=>sugarStudio.projectPoint(x,z),[x,z]);
  await page.mouse.move(point.x,point.y);await page.mouse.down();await page.waitForTimeout(300);
}
async function lose() {
  await page.evaluate(()=>window.contextLoss.loseContext());
  await page.waitForFunction(()=>!document.querySelector('#loading').hidden);
}
async function restore() {
  await page.evaluate(()=>{
    document.querySelector('#scene canvas').addEventListener('webglcontextrestored',()=>{window.justRestoredSurface=Array.from(sugarStudio.captureSurface());},{once:true});
    window.contextLoss.restoreContext();
  });
  await page.waitForFunction(()=>document.querySelector('#loading').hidden);
  await page.waitForTimeout(150);
  return page.evaluate(()=>window.justRestoredSurface);
}
try {
  await page.goto(pathToFileURL(path.join(root,'糖画铺.html')).href+'?mode=template');
  await page.waitForFunction(()=>window.sugarStudio);
  assert.equal(await page.evaluate(()=>!!(window.contextLoss=document.querySelector('#scene canvas').getContext('webgl2').getExtension('WEBGL_lose_context'))),true);
  await press();await page.mouse.up();
  await page.waitForFunction(()=>sugarStudio.getState().strokes===1&&!sugarStudio.getState().draining);
  await page.waitForFunction(()=>document.querySelector('#draft-status').textContent==='作品已保存在本机');
  await page.waitForTimeout(500);
  await page.locator('#navigate-drawing').click();
  const before=await field(),beforePixels=await pixels();
  await lose();
  await page.waitForFunction(()=>!document.querySelector('#reload-scene').hidden);
  assert.equal(await page.locator('#save').isDisabled(),true);
  assert.equal(await page.locator('.studio-panel').evaluate(element=>element.inert),true);
  assert.deepEqual(await field(),before);
  await page.screenshot({path:path.join(root,'artifacts','context-lost-desktop.png')});
  await restore();
  assert.deepEqual(await field(),before);
  const afterPixels=await pixels();
  const pixelDifference=beforePixels.reduce((sum,value,index)=>sum+Math.abs(value-afterPixels[index]),0)/beforePixels.length;
  assert.ok(pixelDifference<3,`restored lighting and scene differ by ${pixelDifference} per channel`);
  assert.equal(await page.locator('#save').isDisabled(),false);
  assert.equal(await page.locator('#navigate-drawing').getAttribute('aria-pressed'),'true');
  const beforePan=await page.evaluate(()=>sugarStudio.projectPoint(0,0));await page.locator('#scene').focus();await page.keyboard.press('ArrowRight');
  const afterPan=await page.evaluate(()=>sugarStudio.projectPoint(0,0));assert.ok(Math.hypot(afterPan.x-beforePan.x,afterPan.y-beforePan.y)>2,'navigation controls recover after context restoration');
  await page.locator('#navigate-drawing').click();
  await press(1,0);
  await page.evaluate(()=>{
    const original=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,key){if(key==='current')throw new DOMException('test quota','QuotaExceededError');return original.call(this,value,key);};
    window.restoreStorage=()=>{IDBObjectStore.prototype.put=original;};
  });
  await lose();await page.mouse.up();
  await page.waitForFunction(()=>document.querySelector('#draft-status').textContent.includes('草稿保存失败'));
  assert.equal((await state()).strokes,2);assert.equal((await state()).drawing,false);assert.equal((await state()).draining,false);
  assert.equal(await page.locator('#reload-scene').isHidden(),true,'reload must not be offered after a failed save');
  const interrupted=await field();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(root,'artifacts','context-lost-mobile.png')});
  assert.deepEqual(await field(),interrupted,'surface stays frozen while context is lost');
  assert.deepEqual(await restore(),interrupted,'restoration retains the exact interrupted surface');
  const interruptedVolume=interrupted.reduce((sum,h)=>sum+h,0),cooledVolume=(await field()).reduce((sum,h)=>sum+h,0);
  assert.ok(Math.abs(cooledVolume-interruptedVolume)<interruptedVolume*1e-5,'cooling after restoration conserves sugar');
  await page.waitForFunction(()=>!document.querySelector('#retry-save').hidden);
  await page.evaluate(()=>window.restoreStorage());
  await page.locator('#retry-save').click();
  await page.waitForFunction(()=>document.querySelector('#draft-status').textContent==='作品已保存在本机');
  assert.equal(await page.locator('#retry-save').isHidden(),true);
  const savedStrokes=await page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('sugar-painting',1);request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const db=request.result,read=db.transaction('drafts','readonly').objectStore('drafts').get('current');read.onsuccess=()=>{resolve(read.result.templates['0'].length);db.close();};read.onerror=()=>{db.close();reject(read.error);};};
  }));
  assert.equal(savedStrokes,2,'retry writes the interrupted work to the actual database');
  await press(-1,0);await page.mouse.up();
  await page.waitForFunction(()=>sugarStudio.getState().strokes===3&&!sugarStudio.getState().draining);
  await page.waitForFunction(()=>document.querySelector('#draft-status').textContent==='作品已保存在本机');
  await inspectCurrentWork(page);await (await studioControl(page,'#record-format')).selectOption('portrait');await (await studioControl(page,'#record-video')).click();
  await page.waitForFunction(()=>sugarStudio.getState().playing&&sugarStudio.getState().presentation.mode==='replay');
  assert.equal((await state()).playing,true,JSON.stringify(await page.evaluate(()=>({state:sugarStudio.getState(),toast:document.querySelector('#toast').textContent,record:document.querySelector('#record-video').textContent}))));
  await lose();
  assert.equal((await state()).presentation.mode,'inspect',JSON.stringify(await page.evaluate(()=>({state:sugarStudio.getState(),toast:document.querySelector('#toast').textContent,loading:document.querySelector('#loading').textContent}))));
  assert.equal(await page.locator('#record-format').isDisabled(),false);
  assert.equal(await page.locator('#download-video').isHidden(),true);
  await restore();assert.equal((await state()).presentation.mode,'inspect');
  await page.locator('#resume-drawing').click();
  assert.equal((await state()).playing,false);
  assert.equal((await state()).strokes,3);
  await page.screenshot({path:path.join(root,'artifacts','context-restored-mobile.png')});
  await page.locator('#scene-finish').click();assert.equal((await state()).finished,true);
  await lose();await page.waitForFunction(()=>!document.querySelector('#reload-scene').hidden);await restore();
  assert.equal((await state()).finished,true);assert.equal((await state()).template.visible,false);assert.ok((await state()).triangles>0);
  await page.screenshot({path:path.join(root,'artifacts','context-finished-restored.png')});
  await page.locator('#resume-drawing').click();assert.equal((await state()).finished,false);assert.equal((await state()).strokes,3);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,pixelDifference,checks:['native WebGL context loss and restoration','sugar surface and regenerated lighting survive','navigation mode and keyboard pan recover','interrupted stroke drains and commits','failed storage keeps reload hidden','failed storage can retry without another stroke','drawing works after recovery','archive video cancellation restores the source work','closed sugar solid survives context recovery'],errors},null,2));
} finally {await browser.close();}
