import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {launchBrowser,studioControl,inspectCurrentWork} from './browser-test.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),browser=await launchBrowser();
const page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce',acceptDownloads:true}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto(pathToFileURL(path.join(root,'糖画铺.html')).href+'?mode=template');await page.waitForFunction(()=>window.sugarStudio);
  const [a,b]=await page.evaluate(()=>[[-1,0],[1,0]].map(([x,z])=>sugarStudio.projectPoint(x,z)));
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.waitForTimeout(300);
  for(let i=1;i<=20;i++){await page.mouse.move(a.x+(b.x-a.x)*i/20,a.y+(b.y-a.y)*i/20);await page.waitForTimeout(60);}
  await page.mouse.up();await page.waitForFunction(()=>!sugarStudio.getState().draining&&sugarStudio.getState().strokes===1);
  await (await studioControl(page,'#pour-view')).click();
  await inspectCurrentWork(page);await page.locator('#replay-work').click();await page.locator('#pause').click();
  const before=await page.evaluate(()=>{const c=document.querySelector('#scene canvas');return{width:c.width,height:c.height,cssWidth:c.clientWidth,cssHeight:c.clientHeight,point:sugarStudio.projectPoint(0,0)};});
  await (await studioControl(page,'#record-format')).selectOption('portrait');await (await studioControl(page,'#record-video')).click();
  assert.equal(await page.locator('#record-format').isDisabled(),true);
  assert.equal(await page.evaluate(()=>sugarStudio.getState().template.visible),false);
  const during=await page.evaluate(()=>{const c=document.querySelector('#scene canvas'),gl=c.getContext('webgl2');return{width:c.width,height:c.height,viewport:Array.from(gl.getParameter(gl.VIEWPORT)),scissor:gl.isEnabled(gl.SCISSOR_TEST),point:sugarStudio.projectPoint(0,0)};});
  assert.deepEqual(during.viewport,[0,0,during.width,during.height],'screen viewport must be restored after each portrait frame');assert.equal(during.scissor,false);
  assert.ok(Math.hypot(during.point.x-before.point.x,during.point.y-before.point.y)<.01,'portrait camera must not distort the screen camera');
  await page.waitForFunction(()=>!document.querySelector('#download-video').hidden,null,{timeout:30000});
  assert.equal(await page.locator('#record-format').isDisabled(),false);
  const restored=await page.evaluate(()=>{const c=document.querySelector('#scene canvas');return[c.width,c.height];});assert.deepEqual(restored,[before.width,before.height]);
  const download=page.waitForEvent('download');await page.locator('#download-video').click();const item=await download,type=item.suggestedFilename().endsWith('.mp4')?'video/mp4':'video/webm',file=path.join(root,'artifacts','portrait-video.'+(type==='video/mp4'?'mp4':'webm'));await item.saveAs(file);
  const data=fs.readFileSync(file).toString('base64');
  const video=await page.evaluate(async({data,type})=>{
    const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type}));
    try {
      const v=document.createElement('video');v.src=url;v.muted=true;await new Promise((resolve,reject)=>{v.onloadedmetadata=resolve;v.onerror=()=>reject(new Error('video metadata unavailable'));});
      const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;const ctx=c.getContext('2d');
      const frame=async t=>{v.currentTime=t;await new Promise((resolve,reject)=>{v.onseeked=resolve;v.onerror=()=>reject(new Error('video seek failed'));});ctx.drawImage(v,0,0);return c.toDataURL('image/png');};
      const first=await frame(.5),second=await frame(1.4),pixels=ctx.getImageData(40,200,640,120).data;let min=255,max=0;
      for(let i=0;i<pixels.length;i+=4){min=Math.min(min,pixels[i]);max=Math.max(max,pixels[i]);}
      return {width:v.videoWidth,height:v.videoHeight,first,second,backgroundRange:max-min};
    } finally {URL.revokeObjectURL(url);}
  },{data,type});
  assert.equal(video.width,720);assert.equal(video.height,1280);assert.notEqual(video.first,video.second,'recording must show motion');
  assert.ok(video.backgroundRange>4,'portrait video should render the stall rather than a flat letterbox background');
  fs.writeFileSync(path.join(root,'artifacts','portrait-video-frame.png'),Buffer.from(video.second.split(',')[1],'base64'));
  await page.locator('#record-video').click();await page.locator('#record-video').click();
  assert.deepEqual(await page.evaluate(()=>{const c=document.querySelector('#scene canvas');return[c.width,c.height];}),[before.width,before.height],'cancel restores the original drawing buffer');
  await page.evaluate(()=>{window.originalRecorder=window.MediaRecorder;window.MediaRecorder=class {static isTypeSupported(type){return originalRecorder.isTypeSupported(type);}constructor(){throw new Error('test encoder failure');}};});
  await page.locator('#record-video').click();
  assert.deepEqual(await page.evaluate(()=>{const c=document.querySelector('#scene canvas');return[c.width,c.height];}),[before.width,before.height],'encoder failure restores the original drawing buffer');
  await page.evaluate(()=>{window.MediaRecorder=window.originalRecorder;});
  await page.locator('#record-video').click();await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.locator('#record-video').click();
  const resized=await page.evaluate(()=>{const c=document.querySelector('#scene canvas');return{width:c.width,height:c.height,cssWidth:c.clientWidth,cssHeight:c.clientHeight};});
  assert.ok(Math.abs(resized.width-resized.cssWidth*before.width/before.cssWidth)<2&&Math.abs(resized.height-resized.cssHeight*before.height/before.cssHeight)<2,'cancel after resize restores the normal pixel ratio');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,size:[video.width,video.height],backgroundRange:video.backgroundRange,checks:['portrait encoding','moving frames','independent portrait composition','screen camera and viewport preserved','record and cancel restore drawing buffer','encoder failure and window resize cleanup','record controls restore'],errors},null,2));
} finally {await browser.close();}
