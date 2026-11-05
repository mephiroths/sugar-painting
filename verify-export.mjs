import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {launchBrowser,studioControl} from './browser-test.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const browser=await launchBrowser();
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,reducedMotion:'reduce',acceptDownloads:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto(pathToFileURL(path.join(root,'糖画铺.html')).href+'?mode=template');
  await page.waitForFunction(()=>window.sugarStudio);await page.locator('#scene').scrollIntoViewIfNeeded();
  const points=await page.evaluate(()=>[[-1,0],[1,0]].map(([x,z])=>sugarStudio.projectPoint(x,z)));
  await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.waitForTimeout(200);
  await page.mouse.move(points[1].x,points[1].y,{steps:25});await page.waitForTimeout(200);await page.mouse.up();
  await page.waitForFunction(()=>!sugarStudio.getState().draining&&sugarStudio.getState().strokes===1);
  const before=await page.locator('#scene canvas').evaluate(c=>[c.width,c.height]);
  const downloadPromise=page.waitForEvent('download');await (await studioControl(page,'#save')).click();
  const output=path.join(root,'artifacts','export-mobile.png');await (await downloadPromise).saveAs(output);
  const png=fs.readFileSync(output),width=png.readUInt32BE(16),height=png.readUInt32BE(20);
  assert.ok(width>before[0]&&height>before[1]);assert.ok(Math.max(width,height)<=1801);
  assert.deepEqual(await page.locator('#scene canvas').evaluate(c=>[c.width,c.height]),before);
  assert.equal((await page.evaluate(()=>sugarStudio.getState())).template.visible,true);
  const colors=await page.evaluate(async data=>{const img=new Image();img.src=data;await img.decode();const c=document.createElement('canvas');c.width=40;c.height=40;const ctx=c.getContext('2d');ctx.drawImage(img,0,0,40,40);const pixels=ctx.getImageData(0,0,40,40).data;return new Set(Array.from({length:1600},(_,i)=>`${pixels[i*4]},${pixels[i*4+1]},${pixels[i*4+2]}`)).size;},'data:image/png;base64,'+png.toString('base64'));
  assert.ok(colors>100,'export should contain a rendered scene');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,canvas:before,export:[width,height],colors,errors},null,2));
} finally {await browser.close();}
