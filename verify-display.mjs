import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {confirmFinishedSave,launchBrowser,studioControl} from './browser-test.mjs';

const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'}),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
const url=pathToFileURL(fileURLToPath(new URL('./糖画铺.html',import.meta.url))).href;
const state=()=>page.evaluate(()=>sugarStudio.getState());
const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const shot=async name=>{await frame();return page.screenshot({path:fileURLToPath(new URL(`./artifacts/${name}.png`,import.meta.url))});};
try {
  await page.goto(url);await page.waitForFunction(()=>window.sugarStudio);
  await page.locator('#finish:visible, #scene-finish:visible').click();
  let current=await state();
  assert.equal(current.presentation.mode,'held');
  assert.ok(current.presentation.normal[2]>.99,'painting is upright with its face toward the viewer');
  assert.ok(current.presentation.mount.overlap>1,'stick overlaps the body instead of touching only the bottom edge');
  assert.ok(current.presentation.mount.contacts.length>=2,'the stick has separated sugar attachment points');
  await page.evaluate(()=>window.originalField=sugarStudio.captureSurface());
  await shot('held-butterfly-desktop');
  const viewBefore=await page.locator('#scene canvas').evaluate(canvas=>canvas.toDataURL());
  await (await studioControl(page,'#top-view')).click();
  await frame();const viewAfter=await page.locator('#scene canvas').evaluate(canvas=>canvas.toDataURL());assert.ok(viewAfter!==viewBefore,'back view changes the rendered image');
  await (await studioControl(page,'#angle-view')).click();
  await page.locator('#pin-current').click();await confirmFinishedSave(page);
  await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='rack');
  current=await state();assert.equal(current.presentation.displayed,1);assert.equal(current.rackItems.length,1);
  await shot('display-single-desktop');
  const pick=current.rackItems[0];await page.mouse.click(pick.x,pick.y);
  await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='inspect');
  assert.equal((await state()).presentation.selected,pick.id);
  assert.equal(await page.evaluate(()=>sugarStudio.captureSurface().every(value=>value===0)),true,'the completed source board is clear while inspecting the saved work');
  await page.locator('#rack-back').click();assert.equal((await state()).presentation.mode,'rack');
  await page.locator('#resume-drawing').click();assert.equal((await state()).finished,false);
  assert.equal(await page.evaluate(()=>sugarStudio.captureSurface().every(value=>value===0)),true);assert.equal((await state()).strokes,0);
  checks.push('Upright handheld presentation, long bamboo overlap, multiple glue contacts and two-sided views');
  checks.push('Pinning saves to gallery; actual 3D clicking opens detail; saving clears the source board while preserving the displayed work');

  for(const index of [1,2,3]){
    await (await studioControl(page,`[data-index="${index}"]`)).click();
    await page.locator('#finish:visible, #scene-finish:visible').click();await page.locator('#pin-current').click();await confirmFinishedSave(page);
    await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='rack');
    await page.locator('#resume-drawing').click();
  }
  await page.reload();await page.waitForFunction(()=>window.sugarStudio);
  await page.locator('#rack-open').click();await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='rack');
  assert.equal((await state()).presentation.displayed,4);assert.equal((await state()).rackItems.length,3);
  await shot('display-rack-desktop');
  await page.locator('#rack-next').click();assert.equal((await state()).rackItems.length,1);
  await page.locator('#rack-prev').click();
  await page.locator('#rack-items button').first().focus();await page.keyboard.press('Enter');assert.equal((await state()).presentation.mode,'inspect');
  await page.locator('#scene').focus();await page.keyboard.press('Escape');assert.equal((await state()).presentation.mode,'rack');
  checks.push('Displayed works survive reload; three works per page; paging, keyboard selection and Escape return work');
  for(const width of [390,320]) {
    await page.setViewportSize({width,height:844});
    for(const locale of ['zh-CN','en','zh-TW','ja']) {
      await page.locator('#language').selectOption(locale);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.locator('#rack-items button').first().click();
      const controls=await page.evaluate(()=>{
        const buttons=[...document.querySelectorAll('#finish-actions button')].filter(e=>e.getClientRects().length),rects=buttons.map(e=>e.getBoundingClientRect());
        return buttons.every((e,i)=>rects[i].left>=0&&rects[i].right<=innerWidth&&rects[i].bottom<=innerHeight&&e.scrollWidth<=e.clientWidth)&&rects.every((a,i)=>rects.slice(i+1).every(b=>a.right<=b.left+.5||b.right<=a.left+.5||a.bottom<=b.top+.5||b.bottom<=a.top+.5));
      });assert.ok(controls,`${locale} actions fit ${width}px`);
      await page.locator('#rack-back').click();
    }
  }
  await page.setViewportSize({width:390,height:844});await page.locator('#language').selectOption('zh-CN');await shot('display-rack-mobile');
  await page.locator('#rack-items button').first().click();await shot('held-work-mobile');
  await page.locator('#language').selectOption('en');assert.equal(await page.locator('#rack-back').innerText(),'Back to display');
  await page.locator('#rack-back').click();
  checks.push('Display and inspection controls fit Chinese, traditional Chinese, English and Japanese on 320px and 390px screens');
  // Simulate a full storage device: the finished work remains recoverable.
  await page.locator('#resume-drawing').click();await page.locator('#finish:visible, #scene-finish:visible').click();
  await page.evaluate(()=>{window.nativeOpen=indexedDB.open.bind(indexedDB);indexedDB.open=()=>{throw new DOMException('Full','QuotaExceededError');};});
  await page.locator('#pin-current').click();await confirmFinishedSave(page);assert.equal((await state()).presentation.mode,'held');assert.equal(await page.locator('#pin-current').isEnabled(),true);
  await page.evaluate(()=>indexedDB.open=nativeOpen);
  const animated=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'no-preference'});
  animated.on('pageerror',error=>errors.push(error.message));
  await animated.goto(url);await animated.waitForFunction(()=>window.sugarStudio);
  await (await studioControl(animated,'#pattern-level')).selectOption('simple');await animated.locator('#finish:visible, #scene-finish:visible').click();
  await animated.setViewportSize({width:1100,height:844});
  await animated.waitForTimeout(1500);
  for(const width of [1100,390,320]) {
    await animated.setViewportSize({width,height:844});await animated.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const framed=await animated.evaluate(()=>sugarStudio.getState().presentation.framing);
    assert.ok(framed.top<.98&&framed.bottom>-.98&&framed.left>-.98&&framed.right<.98,`animated final pose fits ${width}px: ${JSON.stringify(framed)}`);
  }
  await animated.screenshot({path:fileURLToPath(new URL('./artifacts/held-animated-mobile.png',import.meta.url))});await animated.close();
  checks.push('Normal lift animation and a resize during the lift keep the final upright painting in frame');
  assert.deepEqual(errors,[]);
  checks.push('Storage failure preserves the held work and allows retry');
  const result={ok:true,checks,errors};fs.writeFileSync(new URL('./artifacts/display-results.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {await browser.close();}
