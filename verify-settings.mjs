import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {launchBrowser,studioControl,setStudioLocale} from './browser-test.mjs';

const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'}),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
const state=()=>page.evaluate(()=>sugarStudio.getState());
const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const output=fileURLToPath(new URL('./artifacts/settings-verification.json',import.meta.url));
const screenshot=name=>page.screenshot({path:fileURLToPath(new URL(`./artifacts/${name}.png`,import.meta.url))});
async function fit(ids,label){
  const boxes=[];
  for(const id of ids){const box=await page.locator('#'+id).boundingBox();assert.ok(box&&box.x>=-.5&&box.y>=-.5&&box.x+box.width<=await page.evaluate(()=>innerWidth)+.5&&box.y+box.height<=await page.evaluate(()=>innerHeight)+.5,label+' '+id);boxes.push(box);}
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    const a=boxes[i],b=boxes[j];assert.ok(a.x+a.width<=b.x+.5||b.x+b.width<=a.x+.5||a.y+a.height<=b.y+.5||b.y+b.height<=a.y+.5,label+': '+ids[i]+' and '+ids[j]+' overlap');
  }
}
try{
  await page.goto(pathToFileURL(fileURLToPath(new URL('./糖画铺.html',import.meta.url))).href);await page.waitForFunction(()=>window.sugarStudio);
  assert.equal(await page.locator('.header-music').count(),0);assert.equal(await page.locator('#music-toggle').isVisible(),false);assert.equal(await page.locator('#language').isVisible(),true);assert.equal(await page.locator('#view-menu #language').count(),0);
  assert.equal(await page.locator('.pattern-rail').isVisible(),false);assert.equal(await page.locator('.scene-quick-controls').isVisible(),false);
  await screenshot('settings-home-desktop');
  await page.locator('#settings-trigger').click();assert.equal(await page.locator('#music-toggle').isVisible(),true);
  const enabled=await page.locator('#music-toggle').getAttribute('aria-pressed');await page.locator('#music-toggle').click();assert.notEqual(await page.locator('#music-toggle').getAttribute('aria-pressed'),enabled);assert.equal(await page.locator('#view-menu').evaluate(e=>e.open),true);
  assert.equal(await page.locator('#thickness').isVisible(),false);assert.equal(await page.locator('#save').isVisible(),false);
  await screenshot('settings-panel-desktop');await page.keyboard.press('Escape');assert.equal(await page.locator('#settings-trigger').evaluate(e=>e===document.activeElement),true);
  checks.push('Settings contains music, drawing, view and artwork controls; language stays in the header; secondary groups start collapsed and Escape restores focus');
  for(const [width,height] of [[320,568],[390,844],[768,900],[940,377],[1280,900]])for(const locale of ['zh-CN','en','zh-TW','ja']){
    await page.setViewportSize({width,height});await setStudioLocale(page,locale);await frame();
    await fit(['rack-open','settings-trigger','watch-mode','template-mode','draw-mode'],`${locale} ${width}×${height} header`);
    await fit(['beginner','playback'],`${locale} ${width}×${height} watch footer`);
    await page.locator('#settings-trigger').click();const panel=await page.locator('.settings-panel').boundingBox();assert.ok(panel.x>=0&&panel.y>=0&&panel.x+panel.width<=width+.5&&panel.y+panel.height<=height+.5);
    await page.locator('#settings-close').click();
  }
  checks.push('Header, settings panel and viewing controls fit four languages at 320px, mobile, tablet, desktop and short landscape sizes');
  await page.setViewportSize({width:940,height:377});await setStudioLocale(page,'zh-CN');await page.locator('#draw-mode').click();await frame();
  await fit(['scene-undo','scene-redo','scene-finish'],'short landscape drawing');assert.equal(await page.locator('#playback').isVisible(),false);assert.equal(await page.locator('#navigate-drawing').isVisible(),false);
  await screenshot('settings-drawing-landscape');
  await (await studioControl(page,'#thickness')).focus();await page.keyboard.press('ArrowRight');const flux=(await state()).pour.flux;assert.ok(flux>.0068);
  await (await studioControl(page,'#navigate-drawing')).click();assert.equal(await page.locator('#navigate-drawing').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#view-menu').evaluate(e=>e.open),false);
  await (await studioControl(page,'#navigate-drawing')).click();assert.equal(await page.locator('#navigate-drawing').getAttribute('aria-pressed'),'false');
  await page.setViewportSize({width:1280,height:900});await frame();
  const p=await page.evaluate(()=>[sugarStudio.projectPoint(-1,0),sugarStudio.projectPoint(1,.4)]);
  await page.mouse.move(p[0].x,p[0].y);await page.mouse.down();await page.waitForTimeout(350);await page.mouse.move(p[1].x,p[1].y,{steps:20});await page.mouse.up();await page.waitForFunction(()=>sugarStudio.getState().strokes===1&&!sugarStudio.getState().draining);
  await page.locator('#scene-undo').click();assert.equal((await state()).strokes,0);await page.locator('#scene-redo').click();assert.equal((await state()).strokes,1);
  await screenshot('settings-drawing-desktop');
  await (await studioControl(page,'#play')).click();await page.waitForFunction(()=>sugarStudio.getState().playing);
  assert.equal(await page.locator('.scene-quick-controls').isVisible(),false);assert.equal(await page.locator('#playback-exit').isVisible(),true);
  await page.locator('#pause').click();await page.locator('#playback-exit').click();assert.equal((await state()).playing,false);assert.equal((await state()).strokes,1);assert.equal(await page.locator('.scene-quick-controls').isVisible(),true);
  checks.push('Drawing retains only undo, redo and finish; parameters and canvas navigation work through Settings; playback uses a separate footer and returns without losing artwork');
  await page.setViewportSize({width:390,height:844});await frame();await screenshot('settings-drawing-mobile');
  await page.locator('#settings-trigger').click();await page.locator('#drawing-settings > summary').click();await screenshot('settings-panel-mobile');await page.locator('#settings-close').click();
  await page.locator('#scene-finish').click();await page.locator('#settings-trigger').click();assert.equal(await page.locator('#drawing-settings').isVisible(),false);assert.equal(await page.locator('#board-menu').isVisible(),false);
  await page.locator('#settings-close').click();await page.locator('#resume-drawing').click();assert.equal((await state()).strokes,1);
  assert.deepEqual(errors,[]);const result={ok:true,checks,errors};fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){await screenshot('settings-failure');console.error(errors);fs.writeFileSync(output,JSON.stringify({ok:false,checks,errors,error:String(error)},null,2));throw error;}
finally{await browser.close();}
