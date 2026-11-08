import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {confirmFinishedSave,launchBrowser,studioControl,setStudioLocale} from './browser-test.mjs';

const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'}),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
const url=pathToFileURL(fileURLToPath(new URL('./糖画铺.html',import.meta.url))).href;
const state=()=>page.evaluate(()=>sugarStudio.getState());
async function drawStroke() {
  await page.locator('#scene').scrollIntoViewIfNeeded();
  const points=await page.evaluate(()=>[sugarStudio.projectPoint(-.6,-.6),sugarStudio.projectPoint(.6,.6)]);
  await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.waitForTimeout(200);
  await page.mouse.move(points[1].x,points[1].y,{steps:15});await page.waitForTimeout(120);await page.mouse.up();
  await page.waitForFunction(()=>!sugarStudio.getState().drawing&&!sugarStudio.getState().draining&&sugarStudio.getState().strokes===1);
}
async function assertEmpty() {
  const current=await state();assert.equal(current.strokes,0);assert.equal(current.material.volume,0);assert.equal(current.progress,0);
  assert.equal(await page.evaluate(()=>sugarStudio.captureSurface().every(value=>value===0)),true);
  assert.equal(await page.locator('#scene-undo').isDisabled(),true);assert.equal(await page.locator('#scene-redo').isDisabled(),true);
  assert.equal(await page.locator('#play').isDisabled(),true);assert.equal(await page.locator('#scene-finish').isDisabled(),true);
}
try {
  await page.goto(url+'?mode=draw');await page.waitForFunction(()=>window.sugarStudio);await drawStroke();
  await page.locator('#scene-finish').click();await (await studioControl(page,'#resume-drawing')).click();
  assert.equal((await state()).strokes,1,'preview alone can still return to edit the same painting');
  await page.locator('#scene-finish').click();
  // A failed archive must never consume the working painting.
  await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;window.restoreArchive=()=>IDBObjectStore.prototype.put=put;IDBObjectStore.prototype.put=function(value,key){if(key==='gallery')throw new DOMException('Full','QuotaExceededError');return put.call(this,value,key);};});
  await (await studioControl(page,'#next-painting')).click();await confirmFinishedSave(page);assert.equal((await state()).strokes,1);assert.equal((await state()).presentation.mode,'held');
  assert.equal(await page.locator('#next-painting').isEnabled(),true);await page.evaluate(()=>restoreArchive());
  await page.locator('#save-work-submit').click();await page.waitForFunction(()=>!sugarStudio.getState().presentation.mode&&sugarStudio.getState().strokes===0);
  await assertEmpty();assert.equal((await state()).presentation.displayed,1);
  await page.locator('#scene').scrollIntoViewIfNeeded();
  await page.screenshot({path:fileURLToPath(new URL('./artifacts/finish-reset-empty-desktop.png',import.meta.url))});
  checks.push('Preview can continue editing; archive failure keeps the painting; save-and-start-new clears only after a successful archive');
  await page.reload();await page.waitForFunction(()=>window.sugarStudio);await assertEmpty();
  await page.locator('#rack-open').click();await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='rack');
  assert.equal((await state()).rackItems.length,1);await page.locator('#rack-items button').first().click();assert.ok((await state()).presentation.mount.contacts.length>0);
  await (await studioControl(page,'#resume-drawing')).click();await assertEmpty();
  checks.push('The empty draft survives reload and the completed painting remains inspectable on the rack');
  // Keep a different board unfinished while completing the gourd template.
  await drawStroke();await page.locator('#template-mode').click();await (await studioControl(page,'[data-index="2"]')).click();
  await (await studioControl(page,'#step-guide')).check();await page.keyboard.press('Escape');await page.locator('#step-next').click();await drawStroke();
  await page.locator('#scene-finish').click();await page.locator('#pin-current').click();await confirmFinishedSave(page);
  await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='rack'&&sugarStudio.getState().presentation.displayed===2);
  await (await studioControl(page,'#resume-drawing')).click();await assertEmpty();assert.match(await page.locator('#step-label').innerText(),/第 1 \/ /);
  await page.locator('#draw-mode').click();await page.waitForFunction(()=>sugarStudio.getState().mode==='draw'&&!document.querySelector('#scene').inert);await assertEmpty();
  await (await studioControl(page,'#restore-previous-draft')).click();await page.waitForFunction(()=>sugarStudio.getState().strokes===1&&!document.querySelector('#scene').inert);assert.equal((await state()).strokes,1,'another board keeps its unfinished painting for explicit recovery');
  await page.locator('#template-mode').click();await (await studioControl(page,'[data-index="2"]')).click();await assertEmpty();
  await page.reload();await page.waitForFunction(()=>window.sugarStudio);await page.locator('#template-mode').click();await (await studioControl(page,'[data-index="2"]')).click();await assertEmpty();
  await page.setViewportSize({width:320,height:844});await drawStroke();await page.locator('#scene-finish').click();
  for(const locale of ['zh-CN','en','zh-TW','ja']) {
    await setStudioLocale(page,locale);
    const fits=await page.evaluate(()=>{
      const panel=document.querySelector('#finish-actions').getBoundingClientRect(),scene=document.querySelector('#scene').getBoundingClientRect(),buttons=[...document.querySelectorAll('#finish-actions button')].filter(e=>e.getClientRects().length),rects=buttons.map(e=>e.getBoundingClientRect());
      return panel.left>=0&&panel.right<=innerWidth&&panel.bottom<=scene.bottom&&buttons.every((e,i)=>rects[i].left>=panel.left&&rects[i].right<=panel.right&&rects[i].bottom<=panel.bottom&&e.scrollWidth<=e.clientWidth)&&rects.every((a,i)=>rects.slice(i+1).every(b=>a.right<=b.left+.5||b.right<=a.left+.5||a.bottom<=b.top+.5||b.bottom<=a.top+.5));
    });assert.equal(fits,true,`${locale} completion actions fit 320px`);
  }
  await setStudioLocale(page,'zh-CN');
  await page.locator('#scene').scrollIntoViewIfNeeded();
  await page.screenshot({path:fileURLToPath(new URL('./artifacts/finish-reset-actions-mobile.png',import.meta.url))});
  checks.push('Template sugar, guide progress and undo history reset; other unfinished boards stay intact; four-language actions fit 320px');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks,errors},null,2));
} finally {await browser.close();}
