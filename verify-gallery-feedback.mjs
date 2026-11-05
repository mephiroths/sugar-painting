import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {openRackManagement,closeRackManagement,launchBrowser,studioControl,saveCurrentWork} from './browser-test.mjs';

const root=path.dirname(fileURLToPath(import.meta.url)),browser=await launchBrowser(),page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const status=()=>page.locator('#gallery-status');
const waitIdle=()=>page.waitForFunction(()=>document.querySelector('#gallery').getAttribute('aria-busy')==='false');
async function visibleFeedback() {
  const dialog=await page.locator('#gallery').boundingBox(),message=await status().boundingBox();
  assert.ok(message.height>0&&message.y>=dialog.y&&message.y+message.height<=dialog.y+dialog.height,'feedback remains inside the visible dialog');
}
try {
  await page.goto(pathToFileURL(path.join(root,'糖画铺.html')).href+'?mode=template');await page.waitForFunction(()=>window.sugarStudio);
  const point=await page.evaluate(()=>sugarStudio.projectPoint(0,0));await page.mouse.move(point.x,point.y);await page.mouse.down();await page.waitForTimeout(300);await page.mouse.up();
  await page.waitForFunction(()=>sugarStudio.getState().strokes===1&&!sugarStudio.getState().draining);
  await saveCurrentWork(page,'操作练习');await page.waitForFunction(()=>document.querySelector('#toast').textContent==='已存入糖画架。');
  await openRackManagement(page);await waitIdle();assert.equal(await page.locator('.gallery-item').count(),1);
  await page.locator('#gallery-import-open').focus();const chooser=page.waitForEvent('filechooser');await page.keyboard.press('Enter');
  await(await chooser).setFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('invalid backup')});
  await page.waitForFunction(()=>document.querySelector('#gallery-status').textContent.includes('导入失败'));await waitIdle();await visibleFeedback();
  assert.equal(await status().getAttribute('data-kind'),'error');assert.equal(await page.evaluate(()=>document.activeElement.id),'gallery-import-open');
  await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;window.restoreWrite=()=>{IDBObjectStore.prototype.put=put;};IDBObjectStore.prototype.put=function(value,key){if(key==='gallery')throw new DOMException('test quota','QuotaExceededError');return put.call(this,value,key);};});
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'删除',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#gallery-status').textContent.includes('删除失败'));await waitIdle();assert.equal(await page.locator('.gallery-item').count(),1);await visibleFeedback();
  await page.evaluate(()=>window.restoreWrite());
  await page.evaluate(()=>{const get=IDBObjectStore.prototype.get;window.restoreRead=()=>{IDBObjectStore.prototype.get=get;};IDBObjectStore.prototype.get=function(key){if(key==='gallery')throw new Error('test read failure');return get.call(this,key);};});
  await page.locator('#gallery-export').click();await page.waitForFunction(()=>document.querySelector('#gallery-status').textContent.includes('导出失败'));await waitIdle();assert.equal(await page.locator('#gallery-export').isDisabled(),false);await visibleFeedback();await page.evaluate(()=>window.restoreRead());
  const download=page.waitForEvent('download');await page.locator('#gallery-export').click();const file=path.join(root,'artifacts','gallery-feedback-backup.json');await(await download).saveAs(file);await waitIdle();assert.match(await status().textContent(),/备份已生成/);
  const backup=JSON.parse(fs.readFileSync(file,'utf8')),original=backup.works[0];backup.works=[original,...Array.from({length:3},(_,i)=>({...original,id:randomUUID(),name:`滚动练习 ${i+1}`}))];
  await page.evaluate(()=>{const text=File.prototype.text;window.restoreFileRead=()=>{File.prototype.text=text;};File.prototype.text=function(){return new Promise((resolve,reject)=>setTimeout(()=>text.call(this).then(resolve,reject),750));};});
  await page.locator('#gallery-import').setInputFiles({name:'many.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await closeRackManagement(page);await openRackManagement(page);assert.match(await status().textContent(),/正在导入/);assert.equal(await page.locator('#gallery-import-open').isDisabled(),true);
  await page.waitForFunction(()=>document.querySelector('#gallery-status').textContent.includes('已导入'));await waitIdle();await page.evaluate(()=>window.restoreFileRead());assert.equal(await page.locator('.gallery-item').count(),4);
  assert.equal(await page.locator('#gallery-list').evaluate(element=>element.scrollHeight>element.clientHeight),true,'only the artwork list scrolls');
  await page.locator('#gallery-list').evaluate(element=>{element.scrollTop=element.scrollHeight;});
  await page.locator('#gallery-import').setInputFiles({name:'invalid-again.json',mimeType:'application/json',buffer:Buffer.from('{}')});await page.waitForFunction(()=>document.querySelector('#gallery-status').textContent.includes('导入失败'));await waitIdle();await visibleFeedback();
  const dialog=await page.locator('#gallery').boundingBox(),actions=await page.locator('.gallery-actions').boundingBox();assert.ok(actions.y+actions.height<=dialog.y+dialog.height,'backup controls remain visible after scrolling');
  await page.screenshot({path:path.join(root,'artifacts','gallery-feedback-mobile.png')});
  await page.setViewportSize({width:1280,height:800});await page.screenshot({path:path.join(root,'artifacts','gallery-feedback-desktop.png')});
  await page.keyboard.press('Escape');assert.equal(await page.locator('#gallery').evaluate(element=>element.open),false);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks:['keyboard opens the backup picker','invalid backup feedback is visible in the modal','delete failure retains the artwork','export failure allows retry','reopening during import preserves progress and completion','successful backup feedback','list scroll preserves feedback and actions','Escape closes the dialog'],errors},null,2));
} finally {await browser.close();}
