import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {launchBrowser,studioControl,saveCurrentWork,waitForAsync} from './browser-test.mjs';

const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'}),errors=[],checks=[];
const url=pathToFileURL(fileURLToPath(new URL('./糖画铺.html',import.meta.url))).href;
const output=fileURLToPath(new URL('./artifacts/fresh-start-results.json',import.meta.url));
page.on('pageerror',error=>errors.push(error.message));
page.on('dialog',()=>errors.push('Unexpected native dialog'));
await page.addInitScript(()=>{
  window.draftRecord=(key,update)=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('sugar-painting',1);request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('drafts',update?'readwrite':'readonly'),store=tx.objectStore('drafts'),read=store.get(key);let result;
      read.onsuccess=()=>{result=read.result;if(update){result=update(result);store.put(result,key);}};
      tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=tx.onerror=()=>{db.close();reject(tx.error);};
    };
  });
});
const state=()=>page.evaluate(()=>sugarStudio.getState());
const ready=()=>page.waitForFunction(()=>!document.querySelector('#scene').inert);
async function entry(selector){await page.locator(selector).click();await ready();}
async function restore(){await (await studioControl(page,'#restore-previous-draft')).click();await ready();}
async function empty(){
  const current=await state();assert.equal(current.strokes,0);assert.equal(current.material.volume,0);assert.equal(current.playing,false);assert.equal(current.drawing,false);assert.equal(current.draining,false);
  assert.equal(await page.evaluate(()=>sugarStudio.captureSurface().every(value=>value===0)),true);
  assert.equal(await page.locator('#scene-undo').isDisabled(),true);assert.equal(await page.locator('#scene-redo').isDisabled(),true);
}
async function draw(x=-.7,z=-.3){
  const count=(await state()).strokes;
  const points=await page.evaluate(([x,z])=>[sugarStudio.projectPoint(x,z),sugarStudio.projectPoint(x+.9,z+.5)],[x,z]);
  await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.waitForTimeout(220);await page.mouse.move(points[1].x,points[1].y,{steps:16});await page.mouse.up();
  await page.waitForFunction(count=>sugarStudio.getState().strokes===count+1&&!sugarStudio.getState().draining,count);
  await page.waitForFunction(()=>sugarStudio.getState().material.coolingCells===0);
  await waitForAsync(page,async count=>{const draft=await draftRecord('current'),s=sugarStudio.getState(),key=s.mode==='draw'?'draw':'template:2';return(s.mode==='draw'?draft?.own:draft?.templates?.[2])?.length===count&&draft?.surfaces?.[key]?.remaining===0;},count+1);
}
const remember=name=>page.evaluate(name=>{window[name]=Array.from(sugarStudio.captureSurface());},name);
const matches=name=>page.evaluate(name=>{const field=sugarStudio.captureSurface();return window[name].every((value,i)=>value===field[i]);},name);
try{
  await page.goto(url+'?mode=draw');await page.waitForFunction(()=>window.sugarStudio);await draw();await remember('firstSurface');
  await page.locator('#scene-finish').click();await entry('#resume-drawing');assert.equal(await matches('firstSurface'),true,'return to edit preserves the original');
  await entry('#draw-mode');await empty();assert.equal((await page.evaluate(()=>draftRecord('previous:draw'))).strokes.length,1);
  await entry('#draw-mode');await empty();assert.equal((await page.evaluate(()=>draftRecord('previous:draw'))).strokes.length,1,'empty starts retain the previous nonempty draft');
  await page.reload();await page.waitForFunction(()=>window.sugarStudio);await empty();
  await restore();assert.equal((await state()).strokes,1);
  // Compare against the persisted recovery after reload without keeping test globals.
  const restored=await page.evaluate(()=>draftRecord('current'));assert.equal(restored.own.length,1);await remember('firstSurface');
  await entry('#draw-mode');await draw(.1,-.6);await remember('secondSurface');
  await restore();assert.equal(await matches('firstSurface'),true,'recovery restores the exact cooled sugar field');
  await restore();assert.equal(await matches('secondSurface'),true,'restoring swaps the newer painting into recovery');
  checks.push('Freehand starts blank, clears undo/redo, survives reload, retains recovery on empty restarts and swaps exact sugar surfaces; return to edit preserves work');

  for(const key of ['previous:draw','current']){
    await page.evaluate(key=>{const put=IDBObjectStore.prototype.put;window.undoFailure=()=>IDBObjectStore.prototype.put=put;IDBObjectStore.prototype.put=function(value,target){if(target===key)throw new DOMException('test full','QuotaExceededError');return put.call(this,value,target);};},key);
    const before=await page.evaluate(()=>Promise.all(['current','previous:draw'].map(key=>draftRecord(key))));
    await entry('#draw-mode');assert.equal(await matches('secondSurface'),true,'failed start retains visible original');
    assert.deepEqual(await page.evaluate(()=>Promise.all(['current','previous:draw'].map(key=>draftRecord(key)))),before,'failed replacement rolls back both records');
    assert.match(await page.locator('#toast').textContent(),/原画仍保留/);await page.evaluate(()=>undoFailure());
  }
  await page.evaluate(()=>draftRecord('current',draft=>({...draft,revisions:{...draft.revisions,draw:draft.revisions.draw+1}})));
  await entry('#draw-mode');assert.equal(await matches('secondSurface'),true);assert.match(await page.locator('#toast').textContent(),/另一页面/);
  await page.reload();await page.waitForFunction(()=>window.sugarStudio);
  await page.evaluate(()=>{document.querySelector('#draw-mode').click();document.querySelector('#draw-mode').click();});await ready();await empty();await restore();assert.equal((await state()).strokes,1);
  checks.push('Quota failures roll back both writes, stale revisions reject safely, and repeated clicks preserve the recoverable painting');

  await saveCurrentWork(page,'可以继续修改');await page.waitForFunction(()=>!document.querySelector('#save-work-dialog').open);await remember('savedSurface');
  await page.locator('#rack-open').click();await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='rack');await page.locator('#rack-personal').click();await page.locator('#rack-items button').first().click();await (await studioControl(page,'#edit-inspected')).click();
  assert.equal((await state()).strokes,1);assert.equal(await matches('savedSurface'),true,'continue editing a saved artwork must resume');
  await page.locator('#watch-mode').click();await entry('#beginner');await empty();assert.equal((await state()).template.pattern,'gourd');assert.equal((await state()).template.step,0);assert.equal(await page.locator('#height').inputValue(),'0.85');assert.match(await page.locator('#tutorial-title').textContent(),/1 \/ 3/);
  await draw();await remember('gourdSurface');await page.locator('#tutorial-close').click();await page.locator('#step-next').click();
  const freehandBefore=await page.evaluate(async()=>{const d=await draftRecord('current');return{own:d.own,surface:d.surfaces.draw};});
  await page.locator('#watch-mode').click();await entry('#beginner');await empty();assert.equal((await state()).template.step,0);assert.match(await page.locator('#tutorial-title').textContent(),/1 \/ 3/);
  await restore();assert.equal(await matches('gourdSurface'),true);assert.equal((await state()).template.pattern,'gourd');
  assert.deepEqual(await page.evaluate(async()=>{const d=await draftRecord('current');return{own:d.own,surface:d.surfaces.draw};}),freehandBefore,'new practice retains the independent freehand workspace');
  await page.locator('#watch-mode').click();await entry('#draw-mode');await empty();await restore();assert.equal((await state()).strokes,1);
  checks.push('Saved works continue editing; beginner restarts a blank gourd at step one, recovers its previous drawing, and retains independent freehand work');
  assert.deepEqual(errors,[]);const result={ok:true,checks,errors};fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){fs.writeFileSync(output,JSON.stringify({ok:false,checks,errors,error:String(error),state:await state().catch(()=>null)},null,2));await page.screenshot({path:fileURLToPath(new URL('./artifacts/fresh-start-failure.png',import.meta.url))}).catch(()=>{});throw error;}
finally{await browser.close();}
