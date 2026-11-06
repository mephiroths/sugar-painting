import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {launchBrowser,studioControl,confirmFinishedSave} from './browser-test.mjs';

const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
const errors=[],checks=[];page.on('pageerror',error=>errors.push(error.message));
const state=()=>page.evaluate(()=>sugarStudio.getState());
const spine=()=>page.evaluate(()=>sugarStudio.getPresentationSpine());
const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const output=fileURLToPath(new URL('./artifacts/inspection-axis-results.json',import.meta.url));
async function rotate(label) {
  const before=await state(),axis=await spine(),rect=await page.locator('#scene').boundingBox();
  await page.mouse.move(rect.x+rect.width*.38,rect.y+rect.height*.45);await page.mouse.down();
  for(const [x,y] of [[.48,.45],[.59,.50],[.40,.58]]){
    await page.mouse.move(rect.x+rect.width*x,rect.y+rect.height*y,{steps:8});await frame();
    const actual=await spine(),current=await state();
    for(let end=0;end<2;end++)for(let component=0;component<2;component++)assert.ok(Math.abs(actual.ends[end][component]-axis.ends[end][component])<1e-6,`${label}: bamboo axis stays fixed on screen`);
    for(let i=0;i<3;i++)assert.ok(Math.abs(current.camera.target[i]-actual.pivot[i])<1e-7,`${label}: orbit target is on the actual bamboo spine`);
    assert.ok(Math.abs(current.camera.position[1]-current.camera.target[1])<1e-7,`${label}: vertical dragging does not tip the upright artwork`);
  }
  await page.mouse.up();await frame();
  assert.notDeepEqual((await state()).camera.position,before.camera.position,label+': horizontal drag turns the painting');
}
try {
  await page.goto(pathToFileURL(fileURLToPath(new URL('./糖画铺.html',import.meta.url))).href);await page.waitForFunction(()=>window.sugarStudio);
  await page.locator('#finish').click();await rotate('held desktop');
  await page.screenshot({path:fileURLToPath(new URL('./artifacts/inspection-axis-desktop.png',import.meta.url))});
  await (await studioControl(page,'#top-view')).click();await rotate('held back');
  await (await studioControl(page,'#angle-view')).click();
  const axisBefore=(await spine()).pivot;await page.locator('#scene').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowUp');await frame();
  assert.deepEqual((await spine()).pivot,axisBefore);
  checks.push('Desktop held front and back views rotate around a fixed vertical bamboo axis, including keyboard input');
  await page.locator('#pin-current').click();await confirmFinishedSave(page);await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='rack');
  await page.locator('#rack-items button').first().click();await rotate('saved work');
  await page.setViewportSize({width:390,height:844});await frame();await rotate('mobile saved work');
  await page.screenshot({path:fileURLToPath(new URL('./artifacts/inspection-axis-mobile.png',import.meta.url))});
  for(const [width,height] of [[320,568],[390,844],[844,390],[1280,900]]){
    await page.setViewportSize({width,height});await frame();await (await studioControl(page,'#angle-view')).click();await frame();
    const current=await state(),box=current.presentation.framing;
    assert.ok(box.left>-.99&&box.right<.99&&box.bottom>-.99&&box.top<.99,`${width}×${height}: whole painting fits`);
    const axis=await spine();assert.ok(Math.abs(current.camera.target[0]-axis.pivot[0])<1e-8);
  }
  checks.push('Saved works keep the same central axis on desktop and mobile; framing fits narrow portrait and landscape screens');
  const beforeShare=await spine();await page.locator('#share-work').click();await page.waitForFunction(()=>!!document.querySelector('#share-download').getAttribute('href'));await page.locator('#share-close').click();
  const afterShare=await spine();assert.deepEqual(afterShare.pivot,beforeShare.pivot);
  for(let end=0;end<2;end++)for(let component=0;component<3;component++)assert.ok(Math.abs(afterShare.ends[end][component]-beforeShare.ends[end][component])<1e-8,'sharing must preserve the central-axis view and its framing');
  await page.locator('#rack-back').click();await page.locator('#resume-drawing').click();assert.equal(await spine(),null);
  await (await studioControl(page,'.pattern[data-index="1"]')).click();await page.locator('#finish').click();await frame();assert.equal((await state()).presentation.mode,'held');await rotate('re-entered held view');
  checks.push('Sharing preserves the orbit and composition; returning to the workbench restores normal camera controls');
  assert.deepEqual(errors,[]);const result={ok:true,checks,errors};fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} catch(error){fs.writeFileSync(output,JSON.stringify({ok:false,checks,errors,error:String(error)},null,2));throw error;}
finally{await browser.close();}
