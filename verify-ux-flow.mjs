import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {confirmFinishedSave,launchBrowser,studioControl,saveCurrentWork,setStudioLocale} from './browser-test.mjs';

const engine=process.argv[2]||'chromium',driver=engine==='firefox'?await import('./tools/compat/node_modules/playwright/index.mjs'):undefined;
const browser=await launchBrowser(engine,{},driver),page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('dialog',()=>errors.push('Unexpected native browser prompt'));
const url=pathToFileURL(fileURLToPath(new URL('./糖画铺.html',import.meta.url))).href;
const state=()=>page.evaluate(()=>sugarStudio.getState());
const artifact=name=>fileURLToPath(new URL(`./artifacts/${engine==='chromium'?'':engine+'-'}${name}`,import.meta.url));
const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const sceneColors=()=>page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const ctx=canvas.getContext('2d');ctx.drawImage(document.querySelector('#scene canvas'),0,0,32,32);const data=ctx.getImageData(0,0,32,32).data,colors=new Set();for(let i=0;i<data.length;i+=4)colors.add(`${data[i]},${data[i+1]},${data[i+2]},${data[i+3]}`);return colors.size;});
try{
  await page.goto(url);await page.waitForFunction(()=>window.sugarStudio);
  assert.equal(await page.locator('#beginner').isVisible(),true);
  assert.equal(await page.locator('#beginner').textContent(),'我也来画');
  assert.equal(await page.locator('#pattern-picker').evaluate(e=>e.contains(document.querySelector('#beginner'))),false);
  for(const lang of ['zh-CN','zh-TW','en','ja'])for(const width of [320,390]){
    await setStudioLocale(page,lang);await page.setViewportSize({width,height:844});await frame();
    assert.ok((await page.locator('#pattern-trigger').boundingBox()).width>=110,`${lang}/${width}: pattern entrance cannot collapse`);
    assert.equal(await page.locator('#beginner').evaluate(e=>{const rect=e.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight;}),true);
  }
  await setStudioLocale(page,'zh-CN');await page.setViewportSize({width:390,height:844});await frame();
  await page.screenshot({path:artifact('ux-watch-mobile.png')});
  await page.locator('#beginner').click();
  assert.equal((await state()).mode,'template');assert.equal((await state()).template.pattern,'gourd');
  assert.equal(await page.locator('#pattern-current').textContent(),'图案：福禄葫芦');
  assert.equal(await page.locator('#tutorial').evaluate(e=>e.getBoundingClientRect().bottom<=document.querySelector('#scene').getBoundingClientRect().top),true,'practice never covers the board');
  checks.push('Visible first-paint action starts the gourd practice in one click; pattern and instructions identify the current task');
  const points=await page.evaluate(()=>[[-.6,0],[.6,0]].map(([x,z])=>sugarStudio.projectPoint(x,z)));
  await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.waitForTimeout(250);await page.mouse.move(points[1].x,points[1].y,{steps:20});await page.waitForTimeout(180);await page.mouse.up();
  await page.waitForFunction(()=>sugarStudio.getState().strokes===1&&!sugarStudio.getState().draining);
  await page.waitForFunction(()=>sugarStudio.getState().material.coolingCells===0);
  await page.locator('#tutorial-close').click();await frame();
  assert.match(await page.locator('#workflow-hint').textContent(),/拿起来看看/);
  assert.equal(await page.locator('#gallery-save').evaluate(e=>e.closest('details').id),'board-menu');
  assert.match(await page.locator('#draft-status').textContent(),/本机|保存/);
  await page.screenshot({path:artifact('ux-paint-mobile.png')});

  await page.evaluate(()=>window.originalUxSurface=Array.from(sugarStudio.captureSurface()));
  await (await studioControl(page,'#gallery-save')).click();
  assert.equal(await page.locator('#work-name').evaluate(e=>document.activeElement===e),true);
  await page.locator('#work-name').fill('取消保存的作品');await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('#save-work-dialog').open&&!sugarStudio.getState().paused);
  assert.equal(await page.evaluate(()=>{const field=sugarStudio.captureSurface();return originalUxSurface.every((v,i)=>v===field[i]);}),true);
  assert.equal((await state()).presentation.displayed,0);
  await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;window.restoreUxWrite=()=>IDBObjectStore.prototype.put=put;IDBObjectStore.prototype.put=function(value,key){if(key==='gallery')throw new DOMException('test quota','QuotaExceededError');return put.call(this,value,key);};});
  await saveCurrentWork(page,'我的第一幅糖画');
  assert.equal(await page.locator('#save-work-dialog').evaluate(d=>d.open),true);
  assert.match(await page.locator('#save-work-status').textContent(),/空间不足/);
  assert.equal(await page.locator('#save-work-submit').isEnabled(),true);
  await page.screenshot({path:artifact('ux-save-retry.png')});
  await page.evaluate(()=>restoreUxWrite());await page.locator('#save-work-submit').click();await page.waitForFunction(()=>!document.querySelector('#save-work-dialog').open&&!sugarStudio.getState().paused);
  assert.equal((await state()).strokes,1);assert.equal((await state()).presentation.displayed,1);
  assert.equal(await page.evaluate(()=>{const field=sugarStudio.captureSurface();return originalUxSurface.every((v,i)=>v===field[i]);}),true);
  checks.push('In-app naming supports keyboard cancel, retains the exact board, explains copy saving, and retries quota failure without duplicate works');

  const center=await page.evaluate(()=>{const rect=document.querySelector('#scene').getBoundingClientRect(),p=sugarStudio.projectPoint(0,0);return[(p.x-rect.left)/rect.width,(p.y-rect.top)/rect.height];});
  await page.setViewportSize({width:1440,height:900});await frame();await page.setViewportSize({width:390,height:844});await frame();
  const after=await page.evaluate(()=>{const rect=document.querySelector('#scene').getBoundingClientRect(),p=sugarStudio.projectPoint(0,0);return[(p.x-rect.left)/rect.width,(p.y-rect.top)/rect.height];});
  assert.ok(Math.abs(after[0]-center[0])<.01&&Math.abs(after[1]-center[1])<.01,'resizing preserves camera intent after a round trip');
  for(const lang of ['zh-CN','zh-TW','en','ja'])for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});await setStudioLocale(page,lang);await frame();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${lang}/${width} overflow`);
    await (await studioControl(page,'#gallery-save')).click();
    assert.equal(await page.locator('#save-work-dialog').evaluate(d=>d.scrollWidth<=d.clientWidth),true);
    if(lang==='en'&&width===320)await page.screenshot({path:artifact('ux-name-mobile-en.png')});
    await page.keyboard.press('Escape');
  }
  checks.push('Four languages and 320–1440 px layouts expose the task and save form; resizing preserves artwork and camera direction');

  await setStudioLocale(page,'zh-CN');await page.setViewportSize({width:390,height:844});await page.locator('#scene-finish').click();await frame();
  assert.equal(await page.locator('#finish-note').isVisible(),true);assert.match(await page.locator('#finish-note').textContent(),/清空本幅画板/);
  assert.equal(await page.locator('#pin-current').textContent(),'保存并去糖画架');
  assert.equal(await page.locator('#resume-drawing').evaluate(e=>e.parentElement.id),'finish-actions');
  await page.screenshot({path:artifact('ux-finish-mobile.png')});
  await page.locator('#resume-drawing').click();assert.equal((await state()).strokes,1);
  await page.locator('#watch-mode').click();await page.locator('#beginner').click();assert.equal((await state()).strokes,1);assert.equal(await page.locator('#tutorial').isHidden(),true,'existing gourd draft is retained without restarting practice');
  await page.locator('#scene-finish').click();await page.locator('#pin-current').click();await confirmFinishedSave(page);await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='rack');
  assert.equal((await state()).strokes,0);assert.equal((await state()).presentation.displayed,2);
  assert.equal(await page.locator('#finish-actions').isVisible(),false,'rack has its own actions, not the finished-work action strip');
  await page.locator('#rack-items button').first().click();assert.equal(await page.locator('#share-work').isVisible(),true);
  await frame();assert.ok(await sceneColors()>4,'archived work renders before sharing');
  await page.locator('#share-work').click();await page.waitForFunction(()=>!!document.querySelector('#share-download').getAttribute('href'));await page.locator('#share-close').click();
  await page.waitForFunction(()=>document.activeElement===document.querySelector('#share-work'));
  await frame();assert.ok(await sceneColors()>4,'closing sharing restores the rendered work');
  await page.keyboard.press('Escape');assert.equal((await state()).presentation.mode,'rack');
  await page.keyboard.press('Escape');assert.equal((await state()).presentation.mode,null);
  checks.push('Finish explains save-and-clear behavior; return preserves the board; restart keeps an existing draft; saved work remains shareable');
  assert.deepEqual(errors,[]);const result={ok:true,engine,checks,errors};fs.writeFileSync(artifact('ux-flow-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){const diagnostics=await page.evaluate(()=>({state:window.sugarStudio?.getState(),focus:document.activeElement?.id})).catch(()=>null);fs.writeFileSync(artifact('ux-flow-verification.json'),JSON.stringify({ok:false,engine,checks,errors,error:String(error),diagnostics},null,2));await page.screenshot({path:artifact('ux-flow-failure.png')}).catch(()=>{});throw error;}
finally{await browser.close();}
