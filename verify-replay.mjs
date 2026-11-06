import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {launchBrowser,studioControl} from './browser-test.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),browser=await launchBrowser();
const page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto(pathToFileURL(path.join(root,'糖画铺.html')).href+'?mode=template');await page.waitForFunction(()=>window.sugarStudio);
  for(const [index,x] of [-1,0,1].entries()){
    const p=await page.evaluate(x=>sugarStudio.projectPoint(x,0),x);
    await page.mouse.move(p.x,p.y);await page.mouse.down();await page.waitForTimeout(100);await page.mouse.up();
    await page.waitForFunction(n=>!sugarStudio.getState().draining&&sugarStudio.getState().strokes===n,index+1);
  }
  await page.waitForTimeout(700);
  const original=await page.evaluate(()=>Array.from(sugarStudio.captureSurface()));
  for(const speed of ['0.65','1.8']){
    await (await studioControl(page,`.speed-choices button[data-speed="${speed}"]`)).click();await (await studioControl(page,'#play')).click();
    await page.waitForFunction(()=>{const s=sugarStudio.getState();return s.playing&&s.progress===1;},{timeout:20000});
    const s=await page.evaluate(()=>sugarStudio.getState());
    assert.ok(s.replay.total>0);assert.equal(s.replay.applied,s.replay.total,`all deposits must be applied at ${speed}x before surface restoration`);
    assert.ok(s.material.volume>0);
    await page.waitForFunction(()=>!sugarStudio.getState().playing,{timeout:15000});
    assert.deepEqual(await page.evaluate(()=>Array.from(sugarStudio.captureSurface())),original);
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks:['multi-stroke deposits applied before final restore','slow and fast playback','final surface retained'],errors},null,2));
} finally {await browser.close();}
