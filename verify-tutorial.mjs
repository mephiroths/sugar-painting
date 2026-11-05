import assert from 'node:assert/strict';
import path from 'node:path';
import {launchBrowser,studioControl} from './browser-test.mjs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {patterns} from './src/patterns.js';
const root=path.dirname(fileURLToPath(import.meta.url));
const browser=await launchBrowser();
const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto(pathToFileURL(path.join(root,'糖画铺.html')).href);await page.waitForFunction(()=>window.sugarStudio);
  await (await studioControl(page,'#beginner')).click();await page.keyboard.press('Escape');await page.locator('#scene').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('#tutorial-title').textContent(),'练习 1 / 3');
  assert.equal(await page.locator('#height').inputValue(),'0.85');assert.equal((await page.evaluate(()=>sugarStudio.getState())).template.pattern,'gourd');
  await page.screenshot({path:path.join(root,'artifacts','tutorial-mobile.png')});
  const trace=await page.evaluate(pattern=>{const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',pattern.paths[0]);const length=p.getTotalLength();return Array.from({length:10},(_,i)=>{const q=p.getPointAtLength(length*i/20);return sugarStudio.projectPoint((q.x-50)*.083*pattern.scale,(q.y-46)*.083*pattern.scale);});},patterns[2]);
  await page.mouse.move(trace[0].x,trace[0].y);await page.mouse.down();assert.equal(await page.locator('#tutorial-title').textContent(),'练习 2 / 3');await page.waitForTimeout(200);
  for(const p of trace.slice(1)){await page.mouse.move(p.x,p.y,{steps:3});await page.waitForTimeout(50);}
  assert.equal(await page.locator('#tutorial-title').textContent(),'练习 3 / 3');await page.mouse.up();
  await page.waitForFunction(()=>document.querySelector('#tutorial-title').textContent==='第一笔完成');
  assert.equal((await page.evaluate(()=>sugarStudio.getState())).strokes,1);
  await page.setViewportSize({width:1280,height:800});await page.screenshot({path:path.join(root,'artifacts','tutorial-desktop.png')});
  await page.locator('#tutorial-finish').click();assert.equal((await page.evaluate(()=>sugarStudio.getState())).finished,true);assert.equal(await page.locator('#tutorial').isHidden(),true);
  await page.locator('#resume-drawing').click();assert.equal((await page.evaluate(()=>sugarStudio.getState())).strokes,1);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks:['beginner mode and low spoon','press, move and release guidance','finish and resume preserve drawing'],errors},null,2));
} catch(error){console.error(error);console.error(errors);process.exitCode=1;}
finally {await browser.close();}
