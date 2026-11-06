import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {launchBrowser,studioControl,saveCurrentWork} from './browser-test.mjs';

const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const state=()=>page.evaluate(()=>sugarStudio.getState());
const savedWorks=()=>page.evaluate(()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('sugar-painting',1);
  request.onsuccess=()=>{const db=request.result,tx=db.transaction('drafts','readonly'),get=tx.objectStore('drafts').get('gallery');get.onsuccess=()=>resolve(get.result||[]);get.onerror=()=>reject(get.error);tx.oncomplete=()=>db.close();};request.onerror=()=>reject(request.error);
}));
try{
  await page.goto(pathToFileURL(fileURLToPath(new URL('./糖画铺.html',import.meta.url))).href);await page.waitForFunction(()=>window.sugarStudio);
  await page.locator('#rack-open').click();await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='rack');
  assert.deepEqual(await page.locator('#rack-items button').allTextContents(),['蝶恋花','年年有鱼','福禄葫芦']);
  assert.equal((await state()).rackItems.length,3);assert.equal(await page.locator('#rack-empty-message').isVisible(),false);
  assert.deepEqual(await savedWorks(),[]);
  await page.locator('#rack-items button').first().click();await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='inspect');
  assert.equal(await page.locator('#replay-work').isEnabled(),true);
  await (await studioControl(page,'#delete-inspected')).isVisible().then(value=>assert.equal(value,false));
  await page.keyboard.press('Escape');
  await page.locator('#replay-work').click();await page.waitForFunction(()=>sugarStudio.getState().playing);
  assert.ok((await state()).strokes>5);await page.locator('#replay-back').click();
  await page.locator('#rack-back').click();await page.locator('#rack-personal').click();
  assert.equal((await state()).rackItems.length,0);assert.equal(await page.locator('#rack-empty-message').isVisible(),true);
  await page.locator('#rack-examples').click();assert.equal((await state()).rackItems.length,3);
  await page.locator('#resume-drawing').click();await page.locator('#draw-mode').click();
  const points=await page.evaluate(()=>[sugarStudio.projectPoint(-1,0),sugarStudio.projectPoint(1,.5)]);
  await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.waitForTimeout(180);await page.mouse.move(points[1].x,points[1].y,{steps:20});await page.mouse.up();
  await page.waitForFunction(()=>sugarStudio.getState().strokes===1&&!sugarStudio.getState().draining);
  await saveCurrentWork(page,'保留的个人作品');await page.locator('#rack-open').click();await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='rack');
  assert.deepEqual(await page.locator('#rack-items button').allTextContents(),['保留的个人作品']);
  const personal=await savedWorks();assert.equal(personal.length,1);
  await page.locator('#rack-examples').click();await page.locator('#rack-personal').click();assert.deepEqual(await savedWorks(),personal);
  await page.reload();await page.waitForFunction(()=>window.sugarStudio);await page.locator('#rack-open').click();await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='rack');
  assert.equal((await state()).rackItems.length,1);assert.equal((await state()).presentation.collection,'personal');assert.deepEqual(await savedWorks(),personal);
  for(const [width,height] of [[320,568],[390,844],[940,377]]){
    await page.setViewportSize({width,height});await page.locator('#rack-examples').click();
    for(const id of ['rack-examples','rack-personal','rack-items','rack-manage','resume-drawing']){
      const box=await page.locator('#'+id).boundingBox();assert.ok(box&&box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1,`${id} fits ${width}×${height}`);
    }
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks:['Complete builtin examples are separate from saved works','Sample inspection and replay work','Personal art survives switching, save and reload','Rack controls fit mobile and landscape'],errors},null,2));
}finally{await browser.close();}
