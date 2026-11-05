import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {launchBrowser,studioControl} from './browser-test.mjs';

const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'}),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
const url=pathToFileURL(fileURLToPath(new URL('./糖画铺.html',import.meta.url))).href;
const state=()=>page.evaluate(()=>sugarStudio.getState());
const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function assertCleanBackdrop(label) {
  await frame();const current=await state();assert.equal(current.presentation.ground.visible,false,label);
  const pixels=await page.evaluate(()=>{
    const source=document.querySelector('#scene canvas'),copy=document.createElement('canvas');copy.width=source.width;copy.height=source.height;
    const context=copy.getContext('2d');context.drawImage(source,0,0);
    const {data}=context.getImageData(0,0,copy.width,copy.height),bounds=sugarStudio.getState().presentation.framing;
    const left=(bounds.left+1)*copy.width/2-12,right=(bounds.right+1)*copy.width/2+12,top=(1-bounds.top)*copy.height/2-12,bottom=(1-bounds.bottom)*copy.height/2+12;
    let sampled=0,marked=0;
    for(let y=8;y<copy.height-8;y+=8)for(let x=8;x<copy.width-8;x+=8){
      if(x>=left&&x<=right&&y>=top&&y<=bottom)continue;
      const index=(y*copy.width+x)*4;sampled++;
      if(Math.max(Math.abs(data[index]-data[0]),Math.abs(data[index+1]-data[1]),Math.abs(data[index+2]-data[2]))>3)marked++;
    }
    return {sampled,marked};
  });
  assert.ok(pixels.sampled>100,label);assert.equal(pixels.marked,0,`${label}: no detached floor shadow outside the painting`);
}
async function assertRackContact() {
  const ground=(await state()).presentation.ground;
  assert.equal(ground.visible,true);assert.ok(Math.abs(ground.rackBaseY-ground.y-.005)<1e-7,'shadow receiver is directly beneath the rack feet');
}
try {
  await page.goto(url);await page.waitForFunction(()=>window.sugarStudio);
  await page.locator('#finish').click();await assertCleanBackdrop('held painting');
  await page.locator('#scene').scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL('./artifacts/shadow-held-front.png',import.meta.url))});
  await page.locator('#pin-current').click();await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='rack');
  await assertRackContact();await frame();await page.screenshot({path:fileURLToPath(new URL('./artifacts/shadow-rack-contact.png',import.meta.url))});
  await page.locator('#rack-items button').first().click();await assertCleanBackdrop('inspected front');
  await (await studioControl(page,'#top-view')).click();await assertCleanBackdrop('inspected back');
  await page.setViewportSize({width:390,height:844});await frame();await assertCleanBackdrop('mobile inspected back');
  await page.locator('#scene').scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL('./artifacts/shadow-inspect-back-mobile.png',import.meta.url))});
  await page.locator('#rack-back').click();await assertRackContact();
  await page.locator('#resume-drawing').click();assert.equal((await state()).presentation.ground.visible,false);
  checks.push('Held and inspected paintings have a uniform backdrop with no detached floor shadow');
  checks.push('Front, back and mobile views keep the same shadow rule');
  checks.push('Returning to the rack restores a receiver 0.005 units below the feet');
  checks.push('Returning to the workbench hides the presentation receiver');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks,errors},null,2));
} finally {await browser.close();}
