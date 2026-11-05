import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {launchBrowser,studioControl,saveCurrentWork} from './browser-test.mjs';

const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'}),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
const url=pathToFileURL(fileURLToPath(new URL('./糖画铺.html',import.meta.url))).href;
const state=()=>page.evaluate(()=>sugarStudio.getState());
const shot=async name=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:fileURLToPath(new URL(`./artifacts/${name}.png`,import.meta.url))});};
async function manage(){await page.locator('#rack-manage').click();await page.waitForFunction(()=>document.querySelector('#gallery').getAttribute('aria-busy')==='false');}
try {
  await page.goto(url+'?mode=draw');await page.waitForFunction(()=>window.sugarStudio);
  assert.equal(await page.locator('#gallery-open').count(),0);
  const point=await page.evaluate(()=>sugarStudio.projectPoint(0,0));await page.mouse.move(point.x,point.y);await page.mouse.down();await page.waitForTimeout(300);await page.mouse.up();
  await page.waitForFunction(()=>sugarStudio.getState().strokes===1&&!sugarStudio.getState().draining);
  await saveCurrentWork(page,'旧作品');
  await page.waitForFunction(()=>document.querySelector('#toast').textContent==='已存入糖画架。');
  // Old gallery-only records with missing/false display flags are also visible.
  await page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('sugar-painting',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts'),get=store.get('gallery');
      get.onsuccess=()=>{const original=get.result[0];store.put([{...original,id:'old-unflagged',name:'旧作品'},{...original,id:'old-hidden',name:'旧备份',displayed:false},{...original,id:'old-displayed',name:'已上架作品',displayed:true}],'gallery');};
      tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};
    };
  }));
  await page.locator('#rack-open').click();await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='rack');
  assert.equal((await state()).rackItems.length,3);assert.equal((await state()).presentation.displayed,3);
  assert.equal((await page.locator('body').innerText()).includes('作品簿'),false);
  await shot('rack-unified-desktop');
  checks.push('Single header entry; gallery-only and imported legacy records appear without a data migration');
  await manage();assert.equal(await page.locator('#gallery-title').innerText(),'管理糖画架');assert.equal(await page.locator('.gallery-item').count(),3);
  await page.locator('.gallery-item').first().getByRole('button',{name:'拿近看看',exact:true}).click();
  await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='inspect');assert.equal(await page.locator('#gallery').evaluate(element=>element.open),false);
  await page.locator('#rack-back').click();await manage();
  const download=page.waitForEvent('download');await page.locator('#gallery-export').click();const backup=await download;
  assert.ok(backup.suggestedFilename().endsWith('.json'));
  page.once('dialog',dialog=>dialog.accept());await page.locator('.gallery-item').first().getByRole('button',{name:'删除',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.gallery-item').length===2);
  await page.locator('#gallery-close').click();await page.waitForFunction(()=>sugarStudio.getState().rackItems.length===2);
  checks.push('Management supports backup and deletion, closes back to the rack, and inspect opens the actual saved 3D painting');
  for(const locale of ['en','ja','zh-TW','zh-CN']){
    await page.setViewportSize({width:320,height:844});await page.locator('#language').selectOption(locale);await page.locator('#scene').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await page.locator('#rack-manage').isVisible(),true);
    await manage();assert.equal((await page.locator('#gallery-title').innerText()).includes('作品簿'),false);await page.locator('#gallery-close').click();
  }
  await page.setViewportSize({width:390,height:844});await page.locator('#scene').scrollIntoViewIfNeeded();await shot('rack-unified-mobile');
  await manage();await shot('rack-management-mobile');
  await page.locator('.gallery-item').first().getByRole('button',{name:'打开',exact:true}).click();
  await page.waitForFunction(()=>sugarStudio.getState().presentation.mode===null);assert.equal((await state()).strokes,1);
  checks.push('Four-language management fits mobile; opening a stored work still returns to editing');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks,errors},null,2));
} finally {await browser.close();}
