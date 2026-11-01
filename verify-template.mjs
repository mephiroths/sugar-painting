import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {patterns} from './src/patterns.js';
const root=path.dirname(fileURLToPath(import.meta.url)),require=createRequire(path.resolve(root,'../su7-ultra-product/vendor/teardown/package.json'));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/94733/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',args:['--use-angle=d3d11','--ignore-gpu-blocklist','--enable-webgl']});
const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1,reducedMotion:'reduce',acceptDownloads:true});
const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const state=()=>page.evaluate(()=>sugarStudio.getState());
const settleView=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const snap=name=>page.screenshot({path:path.join(root,'artifacts',name+'.png'),fullPage:true});
async function draw(points){
  await settleView();const pixels=await page.evaluate(points=>points.map(p=>sugarStudio.projectPoint(p[0],p[1])),points);
  await page.mouse.move(pixels[0].x,pixels[0].y);await page.mouse.down();await page.waitForTimeout(160);
  for(const p of pixels.slice(1)){await page.mouse.move(p.x,p.y,{steps:4});await page.waitForTimeout(90);}
  await page.mouse.up();await page.waitForFunction(()=>!sugarStudio.getState().drawing&&!sugarStudio.getState().draining&&sugarStudio.getState().strokes>0);
  await page.waitForTimeout(700);
}
try{
  const url=process.argv.includes('--offline')?pathToFileURL(path.join(root,'糖画铺.html')).href:'http://127.0.0.1:5177/';
  await page.goto(url,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.sugarStudio);
  await page.locator('#draw-mode').click();await page.locator('#top-view').click();await draw([[-1,.5],[-.4,.2],[.3,.6]]);
  const free=await state();assert.equal(free.strokes,1);
  await page.locator('#template-mode').click();await settleView();
  let s=await state();assert.equal(s.mode,'template');assert.equal(s.view,'top');assert.equal(s.strokes,0);assert.equal(s.material.volume,0);assert.equal(s.template.pattern,'butterfly');assert.equal(s.template.visible,true);assert.ok(s.template.inkPixels>1000);
  await snap('template-empty');checks.push('Template mode prints a guide on an empty board without generating any sugar');
  for(const [i,id] of [[1,'fish'],[2,'gourd'],[0,'butterfly']]){await page.locator(`[data-index="${i}"]`).click();s=await state();assert.equal(s.template.pattern,id);assert.equal(s.material.volume,0);assert.equal(s.template.visible,true);}
  checks.push('All three template masks switch correctly');
  const pattern=patterns[0];
  const trace=await page.evaluate(p=>{const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',p.paths[0]);const len=path.getTotalLength();return Array.from({length:14},(_,i)=>{const q=path.getPointAtLength(len*i/13);return[(q.x-50)*.083*p.scale,(q.y-46)*.083*p.scale];});},pattern);
  await draw(trace);s=await state();assert.equal(s.strokes,1);assert.ok(s.material.volume>0);assert.equal(s.template.visible,true);const templateVolume=s.material.volume;
  await snap('template-tracing');checks.push('Manual tracing uses the existing falling sugar simulation and leaves the guide intact');
  await page.locator('#template-opacity').focus();await page.locator('#template-opacity').press('End');s=await state();assert.equal(s.template.opacity,.85);assert.ok(Math.abs(s.material.volume-templateVolume)<1e-6);
  await settleView();const withGuide=await page.locator('#scene canvas').evaluate(c=>c.toDataURL('image/png'));
  await page.locator('#template-visible').uncheck();await settleView();const withoutGuide=await page.locator('#scene canvas').evaluate(c=>c.toDataURL('image/png'));
  assert.notEqual(withGuide,withoutGuide);assert.ok(Math.abs((await state()).material.volume-templateVolume)<1e-6);await snap('template-hidden');
  await page.locator('#template-visible').check();await settleView();
  const downloadPromise=page.waitForEvent('download');await page.locator('#save').click();const download=await downloadPromise;const png=path.join(root,'artifacts','template-export.png');await download.saveAs(png);
  assert.ok(fs.readFileSync(png).equals(Buffer.from(withoutGuide.split(',')[1],'base64')));assert.equal((await state()).template.visible,true);
  checks.push('Guide visibility and opacity change the rendered print without changing sugar; PNG export omits the guide and restores it afterward');
  await page.locator('[data-index="1"]').click();assert.equal((await state()).strokes,0);
  await page.locator('[data-index="0"]').click();s=await state();assert.equal(s.strokes,1);assert.ok(Math.abs(s.material.volume-templateVolume)<1e-6);
  await page.locator('#draw-mode').click();s=await state();assert.equal(s.strokes,1);assert.equal(s.template.visible,false);assert.ok(Math.abs(s.material.volume-free.material.volume)<1e-6);
  await page.locator('#template-mode').click();assert.equal((await state()).strokes,1);
  checks.push('Free drawing and individual templates preserve independent workspaces');
  await page.locator('#play').click();await page.waitForFunction(()=>sugarStudio.getState().pour.flowing);assert.equal((await state()).template.visible,true);
  await page.locator('#clear').click();s=await state();assert.equal(s.strokes,0);assert.equal(s.material.volume,0);assert.equal(s.template.visible,true);assert.equal(await page.locator('#play').isDisabled(),true);
  checks.push('Template drawing can replay; clearing removes only the sugar');
  await page.locator('#angle-view').click();await settleView();await snap('template-angle');
  await page.locator('#top-view').click();for(const width of [390,320]){await page.setViewportSize({width,height:844});await settleView();await snap('template-mobile-'+width);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await page.locator('#watch-mode').click();assert.equal((await state()).template.visible,false);assert.equal((await state()).strokes,28);
  checks.push('Guide follows the stone in perspective, mobile layouts fit, and watch mode still works');
  await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:1440,height:960});await page.goto(url+'?mode=template',{waitUntil:'networkidle'});await page.waitForFunction(()=>window.sugarStudio);
  assert.equal((await state()).mode,'template');assert.equal((await state()).template.visible,true);assert.equal((await state()).material.volume,0);
  const center=await page.evaluate(()=>sugarStudio.projectPoint(0,0));const box=await page.locator('#scene').boundingBox();assert.ok(center.x>box.x&&center.x<box.x+box.width&&center.y>box.y&&center.y<box.y+box.height);
  await snap('template-entry');checks.push('Direct template entry renders a correctly aimed first frame with normal motion preferences');
  assert.deepEqual(errors,[]);const result={ok:true,checks,errors};fs.writeFileSync(path.join(root,'artifacts','template-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(e){await snap('template-failure');fs.writeFileSync(path.join(root,'artifacts','template-verification.json'),JSON.stringify({ok:false,checks,errors,error:String(e)},null,2));console.error(e);console.error(errors);process.exitCode=1;}
finally{await browser.close();}
