import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {launchBrowser,studioControl,setStudioLocale} from './browser-test.mjs';

const browser=await launchBrowser(),errors=[],checks=[];
const url=pathToFileURL(fileURLToPath(new URL('./糖画铺.html',import.meta.url))).href;
const output=fileURLToPath(new URL('./artifacts/watch-and-gallery-results.json',import.meta.url));
try{
  for(const preference of ['reduce','no-preference']){
    const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:preference}),page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    const state=()=>page.evaluate(()=>sugarStudio.getState());
    async function pouring(label){
      await page.waitForFunction(()=>{const s=sugarStudio.getState();return s.mode==='watch'&&s.playing&&!s.paused&&s.progress<.15&&s.pour.threadVisible&&s.material.volume>0;});
      const before=(await state()).material.volume;await page.waitForFunction(volume=>sugarStudio.getState().material.volume>volume,before);
      assert.equal((await state()).view,'pour',label);
    }
    await page.goto(url+'?mode=draw');await page.waitForFunction(()=>window.sugarStudio);
    const points=await page.evaluate(()=>[sugarStudio.projectPoint(-.8,-.2),sugarStudio.projectPoint(.8,.3)]);
    await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.waitForTimeout(200);await page.mouse.move(points[1].x,points[1].y,{steps:16});await page.mouse.up();
    await page.waitForFunction(()=>sugarStudio.getState().strokes===1&&!sugarStudio.getState().draining);await page.waitForFunction(()=>sugarStudio.getState().material.coolingCells===0);
    const original=await page.evaluate(()=>Array.from(sugarStudio.captureSurface()));
    await page.locator('#watch-mode').click();await pouring('switch from drawing');
    await (await studioControl(page,'#thickness')).focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Escape');await pouring('change flow while playing');
    await page.locator('#pause').click();assert.equal((await state()).paused,true);await page.locator('#watch-mode').click();await pouring('restart paused watch');
    await page.locator('#watch-mode').click();await pouring('restart selected watch tab');
    await (await studioControl(page,'#finish')).click();await page.locator('#resume-drawing').click();assert.equal((await state()).playing,false);
    await page.locator('#watch-mode').click();await pouring('restart after finished preview');
    await page.locator('#rack-open').click();await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='rack');await page.locator('#resume-drawing').click();
    await page.locator('#watch-mode').click();await pouring('restart after rack return');
    await (await studioControl(page,'.pattern[data-index="2"]')).click();await pouring('manually selected pattern');assert.equal((await state()).pattern,'gourd');
    await page.locator('#draw-mode').click();await page.waitForFunction(()=>sugarStudio.getState().mode==='draw'&&!document.querySelector('#scene').inert);assert.equal((await state()).strokes,0);
    await (await studioControl(page,'#restore-previous-draft')).click();await page.waitForFunction(()=>sugarStudio.getState().strokes===1&&!document.querySelector('#scene').inert);
    assert.deepEqual(await page.evaluate(()=>Array.from(sugarStudio.captureSurface())),original,'watching preserves the exact drawing surface for explicit recovery');
    checks.push(`${preference}: watch entry, flow adjustment, repeated selection, paused state, finished preview, rack return and pattern selection all visibly pour sugar while preserving the draft`);
    if(preference==='reduce'){
      await page.locator('#rack-open').click();await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='rack');await page.locator('#rack-examples').click();
      assert.equal(await page.locator('.rack-collections').evaluate(e=>e.parentElement.id),'rack-tools');assert.equal(await page.locator('#resume-drawing').evaluate(e=>e.parentElement.id),'rack-navigation');
      const rackSkin=await page.locator('html').evaluate(e=>({image:getComputedStyle(e).backgroundImage,color:getComputedStyle(e).backgroundColor}));assert.notEqual(rackSkin.image,'none');assert.equal(rackSkin.color,'rgb(231, 215, 188)');
      assert.equal(await page.locator('.scene-caption').evaluate(e=>getComputedStyle(e).borderImageSource),'none');
      assert.equal(await page.locator('#rack-items button').first().evaluate(e=>getComputedStyle(e).borderImageSource),'none');
      for(const [width,height] of [[1280,900],[390,844],[320,568],[940,377]])for(const locale of ['zh-CN','en','zh-TW','ja']){
        await page.setViewportSize({width,height});await setStudioLocale(page,locale);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        for(const id of ['rack-examples','rack-personal','rack-manage','rack-prev','rack-next','resume-drawing','settings-trigger','language']){
          const box=await page.locator('#'+id).boundingBox();assert.ok(box&&box.x>=-.5&&box.y>=-.5&&box.x+box.width<=width+.5&&box.y+box.height<=height+.5,`${locale} ${width}×${height}: ${id}`);
        }
      }
      await setStudioLocale(page,'zh-CN');await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.screenshot({path:fileURLToPath(new URL('./artifacts/gallery-coherent-desktop.png',import.meta.url))});
      await page.setViewportSize({width:390,height:844});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:fileURLToPath(new URL('./artifacts/gallery-coherent-mobile.png',import.meta.url))});
      await page.locator('#rack-items button').first().click();assert.deepEqual(await page.locator('html').evaluate(e=>({image:getComputedStyle(e).backgroundImage,color:getComputedStyle(e).backgroundColor})),rackSkin);
      checks.push('Rack and inspection share a warm-paper header and stage, plain labels and matching amber; gallery controls fit four languages on desktop, phone and short landscape');
    }
    await context.close();
  }
  assert.deepEqual(errors,[]);const result={ok:true,checks,errors};fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){fs.writeFileSync(output,JSON.stringify({ok:false,checks,errors,error:String(error)},null,2));throw error;}
finally{await browser.close();}
