import assert from 'node:assert/strict';
import path from 'node:path';
import {launchBrowser,studioControl} from './browser-test.mjs';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const browser=await launchBrowser();
const page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
const frame=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const state=()=>page.evaluate(()=>sugarStudio.getState());
try {
  await page.goto(pathToFileURL(path.join(root,'糖画铺.html')).href+'?mode=template');await page.waitForFunction(()=>window.sugarStudio);
  const points=await page.evaluate(()=>[[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]].map(([x,z])=>sugarStudio.projectPoint(x,z)));
  await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.waitForTimeout(150);
  for(const p of points.slice(1)){await page.mouse.move(p.x,p.y,{steps:16});await page.waitForTimeout(100);}
  await page.mouse.up();await page.waitForFunction(()=>!sugarStudio.getState().draining&&sugarStudio.getState().strokes===1);await page.waitForTimeout(600);
  await page.waitForFunction(()=>sugarStudio.getState().material.coolingCells===0);
  await page.evaluate(()=>{window.surfaceBeforeFinish=sugarStudio.captureSurface();});
  const original=await state();await page.locator('#finish:visible, #scene-finish:visible').click();await frame();
  const lifted=await state();assert.equal(lifted.finished,true);assert.equal(lifted.finishedStick,true);assert.equal(lifted.template.visible,false);assert.ok(lifted.triangles>0);
  await page.screenshot({path:path.join(root,'artifacts','finished-desktop.png')});
  const before=await page.locator('#scene canvas').evaluate(c=>c.toDataURL());
  const box=await page.locator('#scene').boundingBox();await page.mouse.move(box.x+box.width*.55,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.68,box.y+box.height*.56,{steps:10});await page.mouse.up();await frame();
  const after=await page.locator('#scene canvas').evaluate(c=>c.toDataURL());assert.notEqual(after,before,'drag should rotate the view');
  const download=page.waitForEvent('download');await (await studioControl(page,'#save')).click();const image=await download;assert.match(image.suggestedFilename(),/\.png$/);await image.saveAs(path.join(root,'artifacts','finished-export.png'));
  assert.equal((await state()).finished,true);assert.equal((await state()).template.visible,false);
  await page.setViewportSize({width:390,height:844});await frame();await page.screenshot({path:path.join(root,'artifacts','finished-mobile.png')});
  await page.locator('#resume-drawing').click();await frame();const restored=await state();assert.equal(restored.finished,false);assert.equal(restored.template.visible,true);assert.equal(restored.strokes,1);assert.ok(Math.abs(restored.material.volume-original.material.volume)<1e-6);
  assert.equal(await page.evaluate(()=>sugarStudio.captureSurface().every((height,index)=>height===surfaceBeforeFinish[index])),true,'returning preserves every height value');
  const hotPoint=await page.evaluate(()=>sugarStudio.projectPoint(0,0));await page.mouse.move(hotPoint.x,hotPoint.y);await page.mouse.down();await page.waitForTimeout(300);await page.mouse.up();
  await page.waitForFunction(()=>sugarStudio.getState().strokes===2&&!sugarStudio.getState().draining);
  await page.locator('#finish:visible, #scene-finish:visible').click();await page.evaluate(()=>{window.hotPreviewSurface=sugarStudio.captureSurface();});await page.waitForTimeout(800);
  assert.equal(await page.evaluate(()=>sugarStudio.captureSurface().every((height,index)=>height===hotPreviewSurface[index])),true,'hidden hot sugar stays frozen while admiring the solid');
  await page.locator('#resume-drawing').click();const fullVolume=(await state()).material.volume;
  await (await studioControl(page,'#play')).click();await page.waitForFunction(()=>sugarStudio.getState().progress>.02);
  await page.locator('#finish:visible, #scene-finish:visible').click();assert.equal((await state()).playing,false);assert.equal((await state()).pour.threadVisible,false);assert.ok(Math.abs((await state()).material.volume-fullVolume)<1e-6,'finishing replay uses the original complete work');
  await page.locator('#resume-drawing').click();assert.equal(await page.locator('#record-video').isVisible(),false);await page.locator('#finish:visible, #scene-finish:visible').click();
  assert.equal((await state()).finished,true);assert.equal(await page.locator('#record-format').isDisabled(),false);assert.equal(await page.locator('#download-video').isHidden(),true);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks:['lifted solid renders','drag rotates view','finished PNG export','return preserves every height value and guide','hot preview freezes the working surface','finishing replay restores the complete work','workbench video controls stay hidden'],errors},null,2));
} catch(error){console.error(error);console.error(errors);process.exitCode=1;}
finally {await browser.close();}
