import assert from 'node:assert/strict';
import path from 'node:path';
import {openRackManagement,closeRackManagement,launchBrowser,studioControl,saveCurrentWork} from './browser-test.mjs';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const browser=await launchBrowser();
const page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const state=()=>page.evaluate(()=>sugarStudio.getState());
async function drawShort() {
  const point=await page.evaluate(()=>sugarStudio.projectPoint(0,0));
  await page.mouse.move(point.x,point.y);await page.mouse.down();await page.waitForTimeout(90);await page.mouse.up();
  await page.waitForFunction(()=>!sugarStudio.getState().drawing&&!sugarStudio.getState().draining&&sugarStudio.getState().strokes===1);
  await page.waitForTimeout(800);
}
try {
  const url=pathToFileURL(path.join(root,'糖画铺.html')).href+'?mode=template';
  await page.goto(url);await page.waitForFunction(()=>window.sugarStudio);
  await drawShort();const original=await state();assert.ok(original.material.volume>0);
  const originalField=await page.evaluate(()=>Array.from(sugarStudio.captureSurface()));
  await page.evaluate(()=>{window.originalSurface=sugarStudio.captureSurface();});
  assert.equal(await page.locator('#record-video').isVisible(),false,'process recording is automatic; video export is on the rack');
  await (await studioControl(page,'#play')).click();await page.waitForFunction(()=>!sugarStudio.getState().playing,{timeout:15000});
  const replay=await state();assert.ok(Math.abs(replay.material.volume/original.material.volume-1)<.01,`replay ratio ${replay.material.volume/original.material.volume}`);
  const shapeError=await page.evaluate(()=>{const actual=sugarStudio.captureSurface();let max=0;for(let i=0;i<actual.length;i++)max=Math.max(max,Math.abs(actual[i]-originalSurface[i]));return max;});assert.equal(shapeError,0);
  for(const speed of ['0.65','1.8']){
    await (await studioControl(page,'#speed')).selectOption(speed);await (await studioControl(page,'#play')).click();await page.waitForFunction(()=>!sugarStudio.getState().playing,{timeout:15000});
    const max=await page.evaluate(()=>{const actual=sugarStudio.captureSurface();let diff=0;for(let i=0;i<actual.length;i++)diff=Math.max(diff,Math.abs(actual[i]-originalSurface[i]));return diff;});assert.equal(max,0,`shape mismatch at ${speed}x`);
  }
  await (await studioControl(page,'#clear')).click();assert.equal((await state()).strokes,0);
  await (await studioControl(page,'#undo')).click();assert.equal((await state()).strokes,1);
  assert.deepEqual(await page.evaluate(()=>Array.from(sugarStudio.captureSurface())),originalField);
  await (await studioControl(page,'#redo')).click();assert.equal((await state()).strokes,0);
  await (await studioControl(page,'#undo')).click();
  await (await studioControl(page,'[data-index="1"]')).click();await drawShort();
  const fishField=await page.evaluate(()=>Array.from(sugarStudio.captureSurface()));
  await page.waitForFunction(()=>document.querySelector('#draft-status').textContent==='作品已保存在本机');
  await page.reload();await page.waitForFunction(()=>window.sugarStudio);
  assert.equal((await state()).strokes,1);
  assert.deepEqual(await page.evaluate(()=>Array.from(sugarStudio.captureSurface())),originalField);
  await (await studioControl(page,'[data-index="1"]')).click();assert.equal((await state()).strokes,1);
  assert.deepEqual(await page.evaluate(()=>Array.from(sugarStudio.captureSurface())),fishField);
  await saveCurrentWork(page,'金鱼练习');await page.waitForFunction(()=>document.querySelector('#toast').textContent==='已存入糖画架。');
  await (await studioControl(page,'#clear')).click();assert.equal((await state()).strokes,0);
  await openRackManagement(page);assert.equal(await page.locator('.gallery-item').count(),1);
  await page.getByRole('button',{name:'打开',exact:true}).click();assert.equal((await state()).strokes,1);
  assert.deepEqual(await page.evaluate(()=>Array.from(sugarStudio.captureSurface())),fishField);
  await openRackManagement(page);const download=page.waitForEvent('download');await page.locator('#gallery-export').click();const backup=await download;assert.ok(backup.suggestedFilename().endsWith('.json'));
  const backupPath=path.join(root,'artifacts','gallery-backup.json');await backup.saveAs(backupPath);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'删除',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.gallery-item').length===0);
  await page.locator('#gallery-import').setInputFiles(backupPath);await page.waitForFunction(()=>document.querySelectorAll('.gallery-item').length===1);
  await page.getByRole('button',{name:'打开',exact:true}).click();assert.deepEqual(await page.evaluate(()=>Array.from(sugarStudio.captureSurface())),fishField);
  await openRackManagement(page);
  await page.screenshot({path:path.join(root,'artifacts','gallery-desktop.png')});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(root,'artifacts','gallery-mobile.png')});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,originalVolume:original.material.volume,replayVolume:replay.material.volume,shapeError,checks:['工作台隐藏视频操作，自动记录制作数据','短笔画回放体积和逐格形状','清空、撤销与重做','两个模板刷新后恢复','糖画架保存、打开以及备份导出和导入'],errors},null,2));
} catch(error) {console.error(error);console.error(errors);process.exitCode=1;}
finally {await browser.close();}
