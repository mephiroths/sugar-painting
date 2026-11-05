import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {launchBrowser,studioControl} from './browser-test.mjs';

const root=path.dirname(fileURLToPath(import.meta.url)),browser=await launchBrowser();
const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1,reducedMotion:'reduce'}),errors=[];
page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
async function canvasStats() {
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  return page.evaluate(()=>{
    const source=document.querySelector('#scene canvas'),canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(source,0,0);const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let partialAlpha=0,amberPixels=0;
    for(let i=0;i<data.length;i+=4){if(data[i+3]!==255)partialAlpha++;if(data[i]>data[i+1]+12&&data[i+1]>data[i+2]+30)amberPixels++;}
    return {partialAlpha,amberPixels};
  });
}
try {
  await page.goto(pathToFileURL(path.join(root,'糖画铺.html')).href);await page.waitForFunction(()=>window.sugarStudio);
  await (await studioControl(page,'#detail-view')).click();
  const macro=await canvasStats();assert.equal(macro.partialAlpha,0,'the stone-backed sugar contour must not punch alpha holes into the canvas');assert.ok(macro.amberPixels>2000,'sugar remains shaded and amber');
  const crop=await page.evaluate(()=>{
    const source=document.querySelector('#scene canvas'),canvas=document.createElement('canvas');canvas.width=560;canvas.height=440;
    canvas.getContext('2d').drawImage(source,source.width*.15,source.height*.35,source.width*.7,source.height*.45,0,0,560,440);return canvas.toDataURL('image/png');
  });
  fs.writeFileSync(path.join(root,'artifacts','sugar-edge-fixed.png'),Buffer.from(crop.split(',')[1],'base64'));
  await page.screenshot({path:path.join(root,'artifacts','sugar-optics-desktop.png'),fullPage:true});
  const downloadPromise=page.waitForEvent('download');await (await studioControl(page,'#save')).click();const download=await downloadPromise;
  const exportPath=path.join(root,'artifacts','sugar-optics-export.png');await download.saveAs(exportPath);
  const exportAlpha=await page.evaluate(async data=>{
    const image=new Image();image.src=data;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let partial=0;
    for(let i=3;i<pixels.length;i+=4)if(pixels[i]!==255)partial++;return partial;
  },'data:image/png;base64,'+fs.readFileSync(exportPath).toString('base64'));
  assert.equal(exportAlpha,0,'PNG export must preserve the opaque stone at the sugar contour');
  await (await studioControl(page,'#play')).click();await page.waitForFunction(()=>sugarStudio.getState().pour.flowing&&sugarStudio.getState().material.volume>.001);await page.locator('#pause').click();
  const pouring=await canvasStats();assert.equal(pouring.partialAlpha,0,'flowing sugar must composite over the board');
  await page.locator('#template-mode').click();
  const point=await page.evaluate(()=>sugarStudio.projectPoint(0,0));await page.mouse.move(point.x,point.y);await page.mouse.down();await page.waitForTimeout(300);await page.mouse.up();
  await page.waitForFunction(()=>sugarStudio.getState().strokes===1&&!sugarStudio.getState().draining);
  await page.setViewportSize({width:390,height:844});await page.locator('#scene').scrollIntoViewIfNeeded();
  assert.equal((await canvasStats()).partialAlpha,0,'mobile hand-drawn sugar has no alpha fringe');
  assert.equal(await page.evaluate(()=>sugarStudio.getState().template.visible),true);
  await page.screenshot({path:path.join(root,'artifacts','sugar-optics-mobile.png')});
  const baseline=path.join(root,'artifacts','optics-diagnostic-base.png');
  if(fs.existsSync(baseline)){
    const comparison=await page.evaluate(async({before,after})=>{
      const canvas=document.createElement('canvas');canvas.width=1120;canvas.height=480;const ctx=canvas.getContext('2d');ctx.fillStyle='#f3eddf';ctx.fillRect(0,0,1120,480);ctx.font='20px Microsoft YaHei, sans-serif';
      for(const [i,data]of[before,after].entries()){const image=new Image();image.src=data;await image.decode();ctx.drawImage(image,i*560,40,560,440);ctx.fillStyle='#332e26';ctx.fillText(i===0?'调整前':'调整后',i*560+16,28);}return canvas.toDataURL('image/png');
    },{before:'data:image/png;base64,'+fs.readFileSync(baseline).toString('base64'),after:crop});
    fs.writeFileSync(path.join(root,'artifacts','sugar-edge-comparison.png'),Buffer.from(comparison.split(',')[1],'base64'));
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,macro,pouring,exportAlpha,checks:['macro sugar remains amber without canvas alpha holes','PNG export retains opaque contour','falling and deposited sugar composite together','mobile hand drawing and template remain visible'],errors},null,2));
} finally {await browser.close();}
