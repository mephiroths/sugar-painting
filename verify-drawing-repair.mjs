import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {launchBrowser,setStudioLocale} from './browser-test.mjs';

const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'}),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
const state=()=>page.evaluate(()=>sugarStudio.getState());
const url=pathToFileURL(fileURLToPath(new URL('./糖画铺.html',import.meta.url))).href;
const visibleFit=async(ids,width,height)=>{
  const boxes=[];
  for(const id of ids){const r=await page.locator('#'+id).boundingBox();assert.ok(r&&r.x>=0&&r.y>=0&&r.x+r.width<=width+1&&r.y+r.height<=height+1,`${id} fits ${width}×${height}`);boxes.push(r);}
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    const a=boxes[i],b=boxes[j];assert.ok(a.x+a.width<=b.x+1||b.x+b.width<=a.x+1||a.y+a.height<=b.y+1||b.y+b.height<=a.y+1,`${ids[i]} does not overlap ${ids[j]}`);
  }
};
try{
  await page.goto(url);await page.waitForFunction(()=>window.sugarStudio);
  assert.equal(await page.locator('.watch-cta #finish').count(),0);assert.equal(await page.locator('#finish').isVisible(),false);
  assert.equal(await page.locator('#language').isVisible(),true);assert.equal(await page.locator('#view-menu #language').count(),0);
  await page.locator('#pattern-trigger').click();assert.equal(await page.getByRole('dialog',{name:'挑一幅糖画',exact:true}).isVisible(),true);
  assert.equal(await page.locator('#pattern-trigger').evaluate(el=>getComputedStyle(el,'::after').display),'none');await page.keyboard.press('Escape');
  checks.push('Homepage has one CTA; language is directly available; the pattern gallery uses a gallery icon instead of a dropdown arrow');
  // Pause animation frames: input must not disappear when an entire gesture
  // is received between two rendered frames, including on a busy device.
  await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
  for(const mode of ['template','draw']){
    await page.locator('#'+mode+'-mode').click();await page.clock.runFor(1000);
    const before=(await state()).strokes,points=await page.evaluate(()=>[sugarStudio.projectPoint(-1,0),sugarStudio.projectPoint(1,.4)]);
    await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.mouse.move(points[1].x,points[1].y,{steps:12});await page.mouse.up();
    await page.clock.runFor(1600);
    assert.equal((await state()).strokes,before+1,`${mode} preserves a swipe with no animation frames`);assert.ok((await state()).material.volume>0);
    await page.locator('#scene-undo').click();assert.equal((await state()).strokes,before);await page.locator('#scene-redo').click();assert.equal((await state()).strokes,before+1);
  }
  await page.clock.resume();checks.push('Both drawing modes accept quick swipes between animation frames, produce sugar, and support undo and redo');
  await page.reload();await page.waitForFunction(()=>window.sugarStudio);await page.locator('#template-mode').click();
  assert.equal(await page.locator('.autosave-note').isVisible(),false);
  for(const [width,height] of [[320,568],[390,844],[768,900],[1028,884],[1280,900],[940,377]])for(const locale of ['zh-CN','en','zh-TW','ja']){
    await page.setViewportSize({width,height});await setStudioLocale(page,locale);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await visibleFit(['rack-open','settings-trigger','language','watch-mode','template-mode','draw-mode'],width,height);
    const picker=await page.locator('#pattern-trigger').boundingBox(),hint=await page.locator('#workflow-hint').boundingBox();
    assert.ok(hint.y>=picker.y+picker.height+5,`${locale} ${width} hint is below the pattern button`);
    assert.ok(hint.x>=0&&hint.x+hint.width<=width+1);
  }
  checks.push('Healthy draft recovery stays quiet; header and separate drawing hint fit four languages across mobile, tablet, desktop and landscape');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks,errors},null,2));
}finally{await browser.close();}
