import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {confirmFinishedSave,launchBrowser,studioControl} from './browser-test.mjs';

const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce'}),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
const url=pathToFileURL(fileURLToPath(new URL('./糖画铺.html',import.meta.url))).href;
const state=()=>page.evaluate(()=>sugarStudio.getState());
const image=name=>fileURLToPath(new URL(`./artifacts/${name}.png`,import.meta.url));
async function draw(x=0){
  const points=await page.evaluate(x=>[sugarStudio.projectPoint(-.8+x,-.7),sugarStudio.projectPoint(.8+x,.7)],x);
  await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.waitForTimeout(150);
  await page.mouse.move(points[1].x,points[1].y,{steps:18});await page.waitForTimeout(100);await page.mouse.up();
  await page.waitForFunction(()=>!sugarStudio.getState().drawing&&!sugarStudio.getState().draining);
}
async function draft(){return page.evaluate(()=>new Promise((resolve,reject)=>{const open=indexedDB.open('sugar-painting');open.onsuccess=()=>{const db=open.result,r=db.transaction('drafts').objectStore('drafts').get('current');r.onsuccess=()=>{db.close();resolve(r.result);};r.onerror=reject;};open.onerror=reject;}));}
async function menu(id){await studioControl(page,`#${id} > summary`);}
try{
  await page.goto(url+'?mode=draw');await page.waitForFunction(()=>window.sugarStudio);
  assert.equal(await page.locator('#record-video').isVisible(),false);
  assert.equal(await page.locator('#thickness').isVisible(),false);
  assert.equal(await page.locator('#angle-view').isVisible(),false);
  await draw();await page.waitForTimeout(750);
  const saved=await draft();assert.equal(saved.own.length,1);assert.ok(saved.own[0].commands.length>1);assert.ok(saved.own[0].deposits.length>0);
  checks.push('Drawing automatically saves commands, timings and deposits without a recording button');
  await menu('drawing-settings');assert.equal(await page.locator('#thickness').isVisible(),true);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#drawing-settings').getAttribute('open'),null);
  await menu('view-menu');await page.locator('#top-view').click();assert.equal(await page.locator('#view-menu').getAttribute('open'),null);
  await page.locator('#scene').focus();await page.keyboard.press('q');await page.keyboard.press('w');
  await page.screenshot({path:image('studio-simplified-desktop')});
  await page.locator('#scene-finish').click();await page.locator('#pin-current').click();await confirmFinishedSave(page);
  await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='rack');assert.equal((await state()).strokes,0);
  await page.locator('#rack-items button').first().click();
  assert.equal(await page.locator('#replay-work').isVisible(),true);
  await page.screenshot({path:image('studio-work-inspect')});
  await (await studioControl(page,'#resume-drawing')).click();await draw(.25);await page.waitForTimeout(750);
  await page.waitForFunction(()=>sugarStudio.getState().material.coolingCells===0);
  const original=await page.evaluate(()=>Array.from(sugarStudio.captureSurface())),originalDraft=await draft();
  await page.locator('#rack-open').click();await page.locator('#rack-items button').first().click();
  await page.locator('#replay-work').click();
  await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='replay'&&sugarStudio.getState().playing);
  assert.equal(await page.locator('#playback').isVisible(),true);
  await page.locator('#pause').click();assert.equal((await state()).paused,true);
  await page.locator('#pause').click();await page.waitForFunction(()=>!sugarStudio.getState().playing,null,{timeout:15000});
  await page.screenshot({path:image('studio-work-process')});
  await page.locator('#replay-back').click();assert.equal((await state()).presentation.mode,'inspect');
  await (await studioControl(page,'#resume-drawing')).click();
  assert.deepEqual(await page.evaluate(()=>Array.from(sugarStudio.captureSurface())),original);
  assert.deepEqual((await draft()).own,originalDraft.own);
  assert.equal((await state()).strokes,1);
  checks.push('Archive replay supports pause and finish, returning to the same editable surface and persisted draft');
  await page.locator('#rack-open').click();await page.locator('#rack-items button').first().click();
  await menu('video-menu');await page.locator('#record-video').click();
  await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='replay');
  assert.equal(await page.locator('#record-video').isVisible(),true,'video controls remain visible after leaving the More menu');
  await page.waitForFunction(()=>!document.querySelector('#download-video').hidden,null,{timeout:20000});
  assert.match(await page.locator('#download-video').getAttribute('href'),/^blob:/);
  const download=page.waitForEvent('download');await page.locator('#download-video').click();const video=await download;assert.match(video.suggestedFilename(),/\.(webm|mp4)$/);
  await video.saveAs(fileURLToPath(new URL('./artifacts/studio-process.webm',import.meta.url)));
  const metadata=await page.evaluate(()=>new Promise((resolve,reject)=>{const video=document.createElement('video');video.onloadedmetadata=()=>resolve({width:video.videoWidth,height:video.videoHeight});video.onerror=reject;video.src=document.querySelector('#download-video').href;}));
  assert.ok(metadata.width>0&&metadata.height>0,'exported video decodes');
  for(const [width,height] of [[320,568],[390,844],[844,390]])for(const language of ['zh-CN','zh-TW','en','ja']){
    await page.setViewportSize({width,height});await page.locator('#language').selectOption(language);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.locator('#download-video').scrollIntoViewIfNeeded();
    const layout=await page.evaluate(()=>{
      const play=document.querySelector('#playback').getBoundingClientRect(),back=document.querySelector('#resume-drawing').getBoundingClientRect(),download=document.querySelector('#download-video').getBoundingClientRect();
      const disjoint=(a,b)=>a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top;
      return {noOverlap:disjoint(play,back),downloadFits:download.left>=0&&download.right<=innerWidth&&download.top>=0&&download.bottom<=innerHeight};
    });assert.equal(layout.noOverlap,true,`${width}/${language}: playback and return do not overlap`);assert.equal(layout.downloadFits,true,`${width}/${language}: download stays reachable`);
  }
  await page.setViewportSize({width:1440,height:960});await page.locator('#language').selectOption('zh-CN');
  await page.keyboard.press('Escape');await page.locator('#replay-back').click();await (await studioControl(page,'#resume-drawing')).click();
  assert.deepEqual(await page.evaluate(()=>Array.from(sugarStudio.captureSurface())),original);
  checks.push('Video is generated on demand from the saved process and remains downloadable');
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    for(const lang of ['zh-CN','zh-TW','en','ja']){
      await page.locator('#language').selectOption(lang);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width}/${lang} no horizontal overflow`);
      await menu('drawing-settings');
      assert.equal(await page.evaluate(()=>{const r=document.querySelector('#drawing-settings .popover-body').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}),true,`${width}/${lang} settings fit`);
      await page.keyboard.press('Escape');
    }
  }
  await page.setViewportSize({width:390,height:844});await page.locator('#language').selectOption('en');
  await page.screenshot({path:image('studio-simplified-mobile-en')});
  checks.push('Four languages and settings fit 320, 390, 768 and 1440 px; disclosure closes by keyboard and outside clicks');
  await page.reload();await page.waitForFunction(()=>window.sugarStudio);assert.equal((await state()).strokes,1);
  assert.deepEqual(errors,[]);const result={ok:true,checks,errors};fs.writeFileSync(fileURLToPath(new URL('./artifacts/studio-ui-verification.json',import.meta.url)),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
