import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {confirmFinishedSave,launchBrowser,studioControl} from './browser-test.mjs';

const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'}),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
const url=pathToFileURL(fileURLToPath(new URL('./糖画铺.html',import.meta.url))).href;
const state=()=>page.evaluate(()=>sugarStudio.getState());
const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const backdropReferences=new Map();
async function assertCleanBackdrop(label) {
  await frame();const current=await state();assert.equal(current.presentation.ground.visible,false,label);
  const pixels=await page.evaluate(()=>{
    const source=document.querySelector('#scene canvas'),copy=document.createElement('canvas');copy.width=source.width;copy.height=source.height;
    const context=copy.getContext('2d');context.drawImage(source,0,0);
    const {data}=context.getImageData(0,0,copy.width,copy.height),bounds=sugarStudio.getState().presentation.framing;
    const left=(bounds.left+1)*copy.width/2-12,right=(bounds.right+1)*copy.width/2+12,top=(1-bounds.top)*copy.height/2-12,bottom=(1-bounds.bottom)*copy.height/2+12;
    const samples=[];
    for(let y=8;y<copy.height-8;y+=8)for(let x=8;x<copy.width-8;x+=8){
      if(x>=left&&x<=right&&y>=top&&y<=bottom)continue;
      const index=(y*copy.width+x)*4;samples.push([x,y,data[index],data[index+1],data[index+2]]);
    }
    return {width:copy.width,height:copy.height,samples};
  });
  // The current folk-craft backdrop is textured. Compare the same pixels
  // between front/back inspections instead of expecting one flat RGB color.
  assert.ok(pixels.samples.length>100,label);
  const key=`${pixels.width}x${pixels.height}`,previous=backdropReferences.get(key);
  if(previous){
    let compared=0;
    for(const [x,y,...rgb] of pixels.samples){const before=previous.get(`${x},${y}`);if(!before)continue;compared++;assert.ok(rgb.every((value,index)=>Math.abs(value-before[index])<=3),`${label}: backdrop outside the artwork stays unchanged`);}
    assert.ok(compared>100,label);
  } else backdropReferences.set(key,new Map(pixels.samples.map(([x,y,...rgb])=>[`${x},${y}`,rgb])));
}
async function assertRackContact() {
  const ground=(await state()).presentation.ground;
  assert.equal(ground.visible,true);assert.ok(Math.abs(ground.rackBaseY-ground.y-.005)<1e-7,'shadow receiver is directly beneath the rack feet');
}
try {
  await page.goto(url);await page.waitForFunction(()=>window.sugarStudio);
  await page.locator('#finish').click();await assertCleanBackdrop('held painting');
  await page.locator('#scene').scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL('./artifacts/shadow-held-front.png',import.meta.url))});
  await page.locator('#pin-current').click();await confirmFinishedSave(page);await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='rack');
  await assertRackContact();await frame();await page.screenshot({path:fileURLToPath(new URL('./artifacts/shadow-rack-contact.png',import.meta.url))});
  await page.locator('#rack-items button').first().click();await assertCleanBackdrop('inspected front');
  await (await studioControl(page,'#top-view')).click();await assertCleanBackdrop('inspected back');
  await page.setViewportSize({width:390,height:844});await frame();await assertCleanBackdrop('mobile inspected back');
  await page.locator('#scene').scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL('./artifacts/shadow-inspect-back-mobile.png',import.meta.url))});
  await page.locator('#rack-back').click();await assertRackContact();
  await page.locator('#resume-drawing').click();assert.equal((await state()).presentation.ground.visible,false);
  checks.push('Held and inspected paintings keep the textured backdrop unchanged outside the artwork, with the shadow receiver hidden');
  checks.push('Front, back and mobile views keep the same shadow rule');
  checks.push('Returning to the rack restores a receiver 0.005 units below the feet');
  checks.push('Returning to the workbench hides the presentation receiver');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks,errors},null,2));
} finally {await browser.close();}
