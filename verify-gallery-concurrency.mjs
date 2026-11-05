import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {openRackManagement,closeRackManagement,launchBrowser,waitForAsync,studioControl,saveCurrentWork} from './browser-test.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const browser=await launchBrowser();
const context=await browser.newContext({viewport:{width:1280,height:800},reducedMotion:'reduce'});
const first=await context.newPage(),errors=[];
first.on('pageerror',error=>errors.push(error.message));
const url=pathToFileURL(path.join(root,'糖画铺.html')).href+'?mode=template';
try {
  await first.goto(url);await first.waitForFunction(()=>window.sugarStudio);
  const point=await first.evaluate(()=>sugarStudio.projectPoint(0,0));
  await first.mouse.move(point.x,point.y);await first.mouse.down();await first.waitForTimeout(250);await first.mouse.up();
  await first.waitForFunction(()=>sugarStudio.getState().strokes===1&&!sugarStudio.getState().draining);
  await first.waitForFunction(()=>document.querySelector('#draft-status').textContent==='作品已保存在本机');
  const second=await context.newPage();second.on('pageerror',error=>errors.push(error.message));
  await second.goto(url);await second.waitForFunction(()=>window.sugarStudio);
  assert.equal(await second.evaluate(()=>sugarStudio.getState().strokes),1);
  await Promise.all([saveCurrentWork(first,'第一幅'),saveCurrentWork(second,'第二幅')]);
  await Promise.all([first,second].map(page=>page.waitForFunction(()=>document.querySelector('#toast').textContent==='已存入糖画架。')));
  await Promise.all([first,second].map(page=>openRackManagement(page)));
  await Promise.all([first,second].map(page=>page.waitForFunction(()=>document.querySelectorAll('.gallery-item').length===2)));
  first.once('dialog',dialog=>dialog.accept());second.once('dialog',dialog=>dialog.accept());
  await Promise.all([
    first.locator('.gallery-item').filter({hasText:'第一幅'}).getByRole('button',{name:'删除'}).click(),
    second.locator('.gallery-item').filter({hasText:'第二幅'}).getByRole('button',{name:'删除'}).click()
  ]);
  await waitForAsync(first,async()=>{
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('sugar-painting',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try{return await new Promise((resolve,reject)=>{const request=db.transaction('drafts','readonly').objectStore('drafts').get('gallery');request.onsuccess=()=>resolve(request.result?.length===0);request.onerror=()=>reject(request.error);});}finally{db.close();}
  });
  await closeRackManagement(first);await openRackManagement(first);
  await first.waitForFunction(()=>document.querySelectorAll('.gallery-item').length===0);
  await first.reload();await first.waitForFunction(()=>window.sugarStudio);await openRackManagement(first);
  await first.waitForFunction(()=>document.querySelectorAll('.gallery-item').length===0);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,checks:['concurrent saves retain both works','gallery refreshes across pages','concurrent deletes retain both changes','changes survive reload'],errors},null,2));
} finally {await context.close();await browser.close();}
