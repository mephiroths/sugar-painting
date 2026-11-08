import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {launchBrowser,studioControl,openRackManagement,confirmFinishedSave} from './browser-test.mjs';

const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'}),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
const output=fileURLToPath(new URL('./artifacts/shared-theme-results.json',import.meta.url));
const state=()=>page.evaluate(()=>sugarStudio.getState());
const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const shot=name=>page.screenshot({path:fileURLToPath(new URL(`./artifacts/theme-${name}.png`,import.meta.url))});
let headerReference,settingsReference,primaryReference;
async function commonChrome(label){
  await page.mouse.move(0,0);await page.waitForTimeout(200);
  const header=await page.evaluate(()=>{
    const css=e=>{const c=getComputedStyle(e);return {font:c.fontFamily,size:c.fontSize,color:c.color,image:c.backgroundImage,borderImage:c.borderImageSource};};
    const r=document.querySelector('.brand').getBoundingClientRect();return {root:getComputedStyle(document.documentElement).backgroundColor,background:getComputedStyle(document.documentElement).backgroundImage,brand:[r.width,r.height],rack:css(document.querySelector('#rack-open')),settings:css(document.querySelector('#settings-trigger')),language:css(document.querySelector('#language'))};
  });
  assert.notEqual(header.background,'none');assert.equal(header.root,'rgb(231, 215, 188)');
  if(headerReference)assert.deepEqual(header,headerReference,label+': same header across screens');else headerReference=header;
  const primaryId={home:'beginner',draw:'scene-finish',held:'pin-current',inspect:'share-work'}[label];
  if(primaryId){
    const primary=await page.locator('#'+primaryId).evaluate(e=>{const c=getComputedStyle(e);return {font:c.fontFamily,size:c.fontSize,weight:c.fontWeight,color:c.color,background:c.backgroundColor,image:c.backgroundImage,borderImage:c.borderImageSource,radius:c.borderRadius};});
    if(primaryReference)assert.deepEqual(primary,primaryReference,label+': same primary button styling');else primaryReference=primary;
  }
  await page.locator('#settings-trigger').click();
  const panel=await page.locator('.settings-panel').evaluate(e=>{const c=getComputedStyle(e);return {background:c.backgroundColor,image:c.backgroundImage,borderImage:c.borderImageSource,radius:c.borderRadius,font:c.fontFamily};});
  assert.equal(panel.image,'none');assert.equal(panel.borderImage,'none');
  if(settingsReference)assert.deepEqual(panel,settingsReference,label+': same settings surface');else settingsReference=panel;
  if(label==='home')await shot('settings');await page.locator('#settings-close').click();
}
async function cleanSurface(selector){
  const c=await page.locator(selector).evaluate(e=>{const c=getComputedStyle(e);return [c.backgroundColor,c.backgroundImage,c.borderImageSource,c.fontFamily];});
  assert.equal(c[0],'rgb(245, 232, 208)');assert.equal(c[1],'none');assert.equal(c[2],'none');assert.match(c[3],/Microsoft YaHei/);
}
try{
  await page.goto(pathToFileURL(fileURLToPath(new URL('./糖画铺.html',import.meta.url))).href);await page.waitForFunction(()=>window.sugarStudio);await frame();
  await commonChrome('home');await shot('home');
  await page.locator('#pattern-trigger').click();await cleanSurface('#pattern-picker > .popover-body');
  assert.equal(await page.locator('.pattern').first().evaluate(e=>getComputedStyle(e).backgroundImage),'none');await shot('patterns');await page.keyboard.press('Escape');
  await page.locator('#draw-mode').click();await commonChrome('draw');await frame();
  const points=await page.evaluate(()=>[sugarStudio.projectPoint(-1,0),sugarStudio.projectPoint(1,.3)]);
  await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.waitForTimeout(240);await page.mouse.move(points[1].x,points[1].y,{steps:20});await page.mouse.up();
  await page.waitForFunction(()=>sugarStudio.getState().strokes===1&&!sugarStudio.getState().draining);await page.waitForFunction(()=>sugarStudio.getState().material.coolingCells===0);
  const original=await page.evaluate(()=>Array.from(sugarStudio.captureSurface()));await shot('drawing');
  await (await studioControl(page,'#focus-view')).click();await frame();assert.equal(await page.locator('#scene').evaluate(e=>{const r=e.getBoundingClientRect();return r.top===0&&r.left===0&&r.width===innerWidth&&r.height===innerHeight;}),true);await page.locator('.focus-exit').click();await frame();
  await (await studioControl(page,'#gallery-save')).click();await cleanSurface('#save-work-dialog');await shot('save');await page.keyboard.press('Escape');
  await (await studioControl(page,'#share-scene')).click();await page.waitForFunction(()=>!!document.querySelector('#share-download').getAttribute('href'));await cleanSurface('#share-dialog');await shot('share');await page.locator('#share-close').click();
  await page.locator('#scene-finish').click();await commonChrome('held');await shot('held');
  await page.locator('#pin-current').click();await confirmFinishedSave(page,'整站统一验收');await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='rack');await commonChrome('rack');
  await page.locator('#rack-examples').click();await frame();await shot('rack');await page.locator('#rack-personal').click();await frame();
  await page.locator('#rack-items button').first().click();await commonChrome('inspect');await shot('inspect');
  await page.locator('#replay-work').click();await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='replay');await commonChrome('replay');await shot('replay');await page.locator('#replay-back').click();
  await page.locator('#rack-back').click();await page.locator('#rack-manage').click();await cleanSurface('#gallery');await shot('backup');await page.locator('#gallery-close').click();
  await page.locator('#resume-drawing').click();await page.locator('#template-mode').click();await commonChrome('template');
  await page.setViewportSize({width:390,height:844});await frame();await shot('mobile');await page.locator('#settings-trigger').click();await shot('settings-mobile');await page.locator('#settings-close').click();
  assert.ok(original.some(value=>value>0));assert.equal((await state()).mode,'template');assert.deepEqual(errors,[]);
  const result={ok:true,checks:['Home, drawing, template, held artwork, rack, inspection and replay share identical header colors, type and branding','Settings, pattern picker, save, share and backup all use the same untextured surface and typography','Drawing, named save, gallery inspection and replay remain functional'],errors};fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){await shot('failure');fs.writeFileSync(output,JSON.stringify({ok:false,checks,errors,error:String(error)},null,2));throw error;}
finally{await browser.close();}
