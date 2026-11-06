import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {launchBrowser,confirmFinishedSave} from './browser-test.mjs';

const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:320,height:568},reducedMotion:'reduce'});
const errors=[],checks=[];page.on('pageerror',error=>errors.push(error.message));
const output=fileURLToPath(new URL('./artifacts/publication-ux-verification.json',import.meta.url));
const state=()=>page.evaluate(()=>sugarStudio.getState());
const cameraTilt=async()=>{const c=(await state()).camera,d=c.position.map((value,index)=>value-c.target[index]);return Math.atan2(d[1],Math.hypot(d[0],d[2]))*180/Math.PI;};
const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
try {
  await page.goto(process.env.SUGAR_TEST_URL||pathToFileURL(fileURLToPath(new URL('./糖画铺.html',import.meta.url))).href);
  await page.waitForFunction(()=>window.sugarStudio);
  await page.locator('#beginner').click();
  assert.equal((await state()).view,'angle');assert.equal((await state()).template.step,0);
  assert.ok((await state()).template.opacity>=.8);
  assert.ok(await cameraTilt()>20&&await cameraTilt()<60,'practice starts oblique, not vertical');
  await page.locator('#draw-mode').click();assert.equal((await state()).view,'angle');assert.ok(await cameraTilt()<60,'freehand starts oblique');
  await page.locator('#view-menu > summary').click();await page.locator('#top-view').click();assert.ok(await cameraTilt()>85,'top view remains available by choice');
  await page.locator('#template-mode').click();assert.equal((await state()).view,'angle');assert.ok(await cameraTilt()<60);
  await page.reload();await page.waitForFunction(()=>window.sugarStudio);await page.locator('#beginner').click();assert.ok(await cameraTilt()<60,'refresh and practice restore the oblique default');
  for(const locale of ['zh-CN','zh-TW','en','ja']) {
    await page.locator('#language').selectOption(locale);await frame();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth),true,locale+' viewport');
    for(const id of ['scene-undo','scene-redo','scene-finish','navigate-drawing','pattern-trigger']) {
      const rect=await page.locator('#'+id).boundingBox();assert.ok(rect&&rect.y>=0&&rect.y+rect.height<=568&&rect.height>=44,locale+' '+id);
    }
    await page.locator('#pattern-trigger').click();
    assert.equal(await page.locator('.patterns').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),2);
    assert.equal(await page.locator('.pattern-close').isVisible(),true);
    assert.equal(await page.locator('.pattern span').evaluateAll(nodes=>nodes.every(e=>e.scrollWidth<=e.clientWidth)),true,locale+' names fit');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#pattern-trigger').evaluate(e=>e===document.activeElement),true);
  }
  await page.locator('#language').selectOption('zh-CN');
  checks.push('320×568: four languages, no page scroll, 44px core controls, two-column pattern names, Escape focus return');
  const points=await page.evaluate(()=>[sugarStudio.projectPoint(-.6,-.4),sugarStudio.projectPoint(.6,.4)]);
  await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.waitForTimeout(250);
  await page.mouse.move(points[1].x,points[1].y,{steps:10});await page.mouse.up();
  await page.waitForFunction(()=>sugarStudio.getState().strokes===1&&!sugarStudio.getState().draining);
  assert.equal(await page.locator('#tutorial-continue').isVisible(),true);
  await page.locator('#tutorial-continue').click();await page.locator('#scene-undo').click();assert.equal((await state()).strokes,0);
  await page.locator('#scene-redo').click();assert.equal((await state()).strokes,1);
  await page.locator('#scene-finish').click();assert.equal(await page.locator('.completion-title').textContent(),'先看看这份甜');
  assert.equal(await page.locator('.scene-quick-controls').isVisible(),false);
  await page.locator('#pin-current').click();assert.match(await page.locator('#save-work-description').textContent(),/清空本幅画板.*糖画架/);
  await page.keyboard.press('Escape');assert.equal((await state()).strokes,1);
  await page.locator('#resume-drawing').click();assert.equal((await state()).strokes,1);assert.equal((await state()).view,'angle');assert.ok(await cameraTilt()<60);
  checks.push('First stroke suggests continuing; undo/redo work; preview and cancelled naming preserve the editable drawing');
  await page.locator('#scene-finish').click();await page.locator('#next-painting').click();
  await page.evaluate(()=>{const original=IDBObjectStore.prototype.put;window.restoreTestWrite=()=>IDBObjectStore.prototype.put=original;IDBObjectStore.prototype.put=function(value,key){if(key==='gallery')throw new DOMException('test','QuotaExceededError');return original.call(this,value,key);};});
  await confirmFinishedSave(page,'发布验收');
  assert.match(await page.locator('#save-work-status').textContent(),/空间不足/);
  assert.equal((await state()).strokes,1);assert.equal((await state()).presentation.displayed,0);
  await page.evaluate(()=>restoreTestWrite());await page.locator('#save-work-submit').click();
  await page.waitForFunction(()=>!document.querySelector('#save-work-dialog').open&&sugarStudio.getState().presentation.mode===null);
  assert.equal((await state()).strokes,0);assert.equal((await state()).presentation.displayed,1);
  assert.equal((await state()).material.volume,0);
  checks.push('Save failure retains the drawing and retries; successful named save clears only this board and opens the next painting');
  await page.locator('#rack-open').click();await page.locator('#rack-items button').first().click();
  assert.equal(await page.locator('#delete-inspected').isVisible(),false);
  await page.locator('#work-more>summary').click();assert.equal(await page.locator('#delete-inspected').isVisible(),true);
  await page.keyboard.press('Escape');
  const canvasBefore=await page.locator('#scene canvas').evaluate(e=>[e.width,e.height]);
  await page.locator('#share-work').click();await page.waitForFunction(()=>!!document.querySelector('#share-download').getAttribute('href'));
  assert.equal(await page.locator('#share-preview').evaluate(e=>e.naturalWidth),1200);
  assert.equal(await page.locator('#share-preview').evaluate(e=>e.naturalHeight),1500);
  await page.locator('#share-close').click();
  assert.deepEqual(await page.locator('#scene canvas').evaluate(e=>[e.width,e.height]),canvasBefore);
  assert.equal((await state()).presentation.mode,'inspect');
  assert.equal(await page.locator('#share-work').evaluate(e=>e===document.activeElement),true);
  checks.push('Details keep deletion in More; 1200×1500 poster generation preserves canvas size, inspected artwork and focus');
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  for(const [width,height] of [[320,568],[390,844],[568,320],[844,390],[1028,884],[1440,900]]) {
    await page.setViewportSize({width,height});await frame();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight),true,`${width}×${height} scrolling`);
    for(const id of ['scene-undo','scene-finish','navigate-drawing']) {
      const rect=await page.locator('#'+id).boundingBox();assert.ok(rect&&rect.x>=0&&rect.y>=0&&rect.x+rect.width<=width+.5&&rect.y+rect.height<=height+.5,`${width}×${height} ${id}`);
    }
    assert.equal(await page.evaluate(()=>{const r=document.querySelector('#scene').getBoundingClientRect();return [[-4.45,-3.68],[4.45,3.68]].every(([x,z])=>{const p=sugarStudio.projectPoint(x,z);return p.x>=r.left&&p.x<=r.right&&p.y>=r.top&&p.y<=r.bottom;});}),true,`${width}×${height} board fits`);
  }
  checks.push('Phone portrait/landscape and desktop: full drawing board and essential actions remain in the viewport');
  for(const mode of ['draw','template']){
    const direct=new URL(process.env.SUGAR_TEST_URL||pathToFileURL(fileURLToPath(new URL('./糖画铺.html',import.meta.url))).href);direct.searchParams.set('mode',mode);direct.searchParams.set('pattern','gourd');
    await page.goto(direct.href);await page.waitForFunction(()=>window.sugarStudio);
    assert.equal((await state()).mode,mode);assert.equal((await state()).view,'angle');assert.ok(await cameraTilt()>20&&await cameraTilt()<60,mode+' direct entry');
  }
  checks.push('Trace and freehand use a real oblique camera on entry, refresh and return; top view remains a manual option');
  assert.deepEqual(errors,[]);
  const result={ok:true,checks,errors};fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} catch(error) {
  fs.writeFileSync(output,JSON.stringify({ok:false,checks,errors,error:String(error)},null,2));throw error;
} finally {await browser.close();}
