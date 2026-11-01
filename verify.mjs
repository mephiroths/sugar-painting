import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(path.resolve(root,'../su7-ultra-product/vendor/teardown/package.json'));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/94733/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',args:['--use-angle=d3d11','--ignore-gpu-blocklist','--enable-webgl']});
const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1,reducedMotion:'reduce',acceptDownloads:true});
const errors=[],checks=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>requests.push(r.url()));
async function snap(name){await page.screenshot({path:path.join(root,'artifacts',name+'.png'),fullPage:true});}
try {
  await page.goto(process.argv.includes('--offline')?pathToFileURL(path.join(root,'糖画铺.html')).href:'http://127.0.0.1:5177',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.sugarStudio,{timeout:30000});
  await snap('desktop');checks.push('WebGL scene loads');
  if(process.argv.includes('--capture-only')) {await page.locator('#detail-view').click();await snap('detail');console.log(JSON.stringify({checks,errors,state:await page.evaluate(()=>sugarStudio.getState())}));}
  else {
    assert.equal(await page.evaluate(()=>sugarStudio.getState().strokes),28);
    const material=await page.evaluate(()=>sugarStudio.getState().material);
    assert.equal(material.surface,'continuous height field');assert.equal(material.transmission,1);assert.ok(material.maxDepth>.04&&material.wetCells>10000);
    checks.push('Continuous transmissive sugar volume is present');
    await page.locator('#detail-view').click();assert.equal(await page.evaluate(()=>sugarStudio.getState().view),'detail');await snap('detail');
    await page.locator('#angle-view').click();checks.push('Macro material view');
    for(const [i,id] of [[1,'fish'],[2,'gourd'],[0,'butterfly']]) {await page.locator(`[data-index="${i}"]`).click();assert.equal(await page.evaluate(()=>sugarStudio.getState().pattern),id);}
    checks.push('All three sugar patterns');
    await page.locator('#play').click();await page.waitForFunction(()=>{const s=sugarStudio.getState();return s.pour.flowing&&s.material.volume>.001;});
    const flowing=await page.evaluate(()=>sugarStudio.getState());assert.ok(flowing.pour.threadVisible);assert.ok(Math.hypot(flowing.pour.source[0]-flowing.pour.contact[0],flowing.pour.source[2]-flowing.pour.contact[2])>.05);
    checks.push('Actual falling thread reaches a delayed contact point before depositing sugar');
    await page.locator('#pause').click();const paused=await page.evaluate(()=>sugarStudio.getState().progress);
    await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>sugarStudio.getState().progress),paused);
    await snap('pouring');await page.locator('#pause').click();checks.push('Progress advances, pause holds, resume works');
    await page.locator('#draw-mode').click();assert.equal(await page.evaluate(()=>sugarStudio.getState().mode),'draw');
    const originalFall=await page.evaluate(()=>sugarStudio.getState().pour.flightTime);await page.locator('#height').focus();await page.locator('#height').press('End');
    assert.ok(await page.evaluate(()=>sugarStudio.getState().pour.flightTime)>originalFall);checks.push('Spoon-height slider changes the actual fall time');
    const points=await page.evaluate(()=>[sugarStudio.projectPoint(-1,-1),sugarStudio.projectPoint(0,0),sugarStudio.projectPoint(1,-1)]);
    await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.mouse.move(points[1].x,points[1].y,{steps:12});await page.mouse.move(points[2].x,points[2].y,{steps:12});await page.mouse.up();
    assert.equal(await page.evaluate(()=>sugarStudio.getState().draining),true);
    await page.waitForFunction(()=>!sugarStudio.getState().draining&&sugarStudio.getState().strokes===1);
    assert.equal(await page.evaluate(()=>sugarStudio.getState().strokes),1);await snap('drawing');
    assert.equal(await page.evaluate(()=>sugarStudio.getState().pour.active),false);checks.push('Pointer release lets airborne sugar finish landing before committing the stroke');
    await page.locator('#play').click();await page.waitForFunction(()=>sugarStudio.getState().progress>.01);assert.equal(await page.evaluate(()=>sugarStudio.getState().playing),true);
    await page.locator('#clear').click();assert.equal(await page.evaluate(()=>sugarStudio.getState().strokes),0);assert.equal(await page.locator('#play').isDisabled(),true);
    checks.push('Pointer drawing produces a stroke, custom replay and clearing work');
    const blank=await page.evaluate(()=>sugarStudio.getState().material);assert.equal(blank.volume,0);assert.equal(blank.wetCells,0);checks.push('Clearing removes the deposited sugar volume');
    await page.locator('#watch-mode').click();await page.locator('#top-view').click();assert.equal(await page.evaluate(()=>sugarStudio.getState().view),'top');await snap('top-view');
    await page.locator('#angle-view').click();await page.locator('#scene').focus();await page.keyboard.press('ArrowLeft');
    const dlPromise=page.waitForEvent('download');await page.locator('#save').click();const dl=await dlPromise;assert.match(dl.suggestedFilename(),/\.png$/);await dl.saveAs(path.join(root,'artifacts','sugar-export.png'));checks.push('View controls, keyboard orbit and actual PNG download');
    await page.locator('#focus-view').click();assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('focus')),true);await page.locator('#scene').focus();await page.keyboard.press('Escape');assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('focus')),false);checks.push('Focus mode and Escape');
    for(const width of [1280,390,320]) {await page.setViewportSize({width,height:844});await snap('layout-'+width);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
    checks.push('1280, 390, 320 pixel layouts without horizontal overflow');
    assert.deepEqual(errors,[]);
    if(process.argv.includes('--offline')){assert.equal(requests.some(u=>/^https?:/.test(u)),false);checks.push('Standalone HTML opens locally with zero network requests');}
    const result={ok:true,checks,errors,state:await page.evaluate(()=>sugarStudio.getState())};fs.writeFileSync(path.join(root,'artifacts','verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  }
} catch(e){console.error(e);await snap('failure');fs.writeFileSync(path.join(root,'artifacts','verification.json'),JSON.stringify({ok:false,checks,errors,error:String(e)},null,2));process.exitCode=1;}
finally {await browser.close();}
