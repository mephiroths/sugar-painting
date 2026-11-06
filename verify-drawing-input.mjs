import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {launchBrowser,studioControl,setStudioLocale} from './browser-test.mjs';

const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'}),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
const url=pathToFileURL(fileURLToPath(new URL('./糖画铺.html',import.meta.url))).href+'?mode=template';
const state=()=>page.evaluate(()=>sugarStudio.getState());
const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const project=(x,z)=>page.evaluate(([x,z])=>sugarStudio.projectPoint(x,z),[x,z]);
const settings=()=>page.evaluate(()=>Object.fromEntries(['thickness','height','speed'].map(id=>[id,Number(document.getElementById(id).value)])));
const extent=async()=>{const a=await project(-1,0),b=await project(1,0);return Math.hypot(a.x-b.x,a.y-b.y);};
try {
  await page.goto(url);await page.waitForFunction(()=>window.sugarStudio);await page.locator('#scene').scrollIntoViewIfNeeded();
  const originalExtent=await extent(),center=await project(0,0);
  await page.mouse.move(center.x,center.y);await page.mouse.wheel(0,-500);await frame();
  assert.ok(await extent()>originalExtent*1.2,'wheel zooms without entering navigation mode');
  assert.equal((await state()).strokes,0);assert.equal((await state()).material.volume,0);
  await page.mouse.wheel(0,500);await frame();
  const beforeRotate=await project(1,1);
  await page.mouse.move(center.x,center.y);await page.mouse.down({button:'right'});await page.mouse.move(center.x+85,center.y-85,{steps:12});await page.mouse.up({button:'right'});await frame();
  const afterRotate=await project(1,1);assert.ok(Math.hypot(beforeRotate.x-afterRotate.x,beforeRotate.y-afterRotate.y)>5);
  assert.equal((await state()).strokes,0);assert.equal((await state()).material.volume,0);
  assert.equal(await page.locator('#scene canvas').evaluate(canvas=>!canvas.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))),true);
  checks.push('Wheel zoom and right-drag rotation work directly in drawing mode, without depositing sugar or opening a context menu');
  await page.locator('#scene').focus();
  for(const [code,id,value]of [['KeyQ','thickness',.035],['KeyW','thickness',.04],['KeyE','height',1.5],['KeyR','height',1.55],['KeyA','speed',.65],['KeyS','speed',1]]){
    await page.keyboard.press(code);assert.equal((await settings())[id],value,code);
  }
  await (await studioControl(page,'#thickness')).focus();await page.keyboard.press('KeyW');assert.equal((await settings()).thickness,.045);await page.keyboard.press('KeyQ');
  await (await studioControl(page,'#speed')).focus();await page.keyboard.press('KeyA');assert.equal((await settings()).speed,.65);await page.keyboard.press('KeyS');
  await page.keyboard.press('Escape');await page.locator('#scene').focus();
  await page.evaluate(()=>{
    const scene=document.querySelector('#scene');
    for(let i=0;i<50;i++)for(const code of ['KeyQ','KeyE','KeyA'])scene.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true,cancelable:true}));
  });assert.deepEqual(await settings(),{thickness:.025,height:.65,speed:.65});
  await page.evaluate(()=>{
    const scene=document.querySelector('#scene');
    for(let i=0;i<50;i++)for(const code of ['KeyW','KeyR','KeyS'])scene.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true,cancelable:true}));
  });assert.deepEqual(await settings(),{thickness:.06,height:2.3,speed:1.8});
  await page.evaluate(()=>{
    for(const [id,value]of [['thickness','.04'],['height','1.55'],['speed','1']]){const control=document.getElementById(id);control.value=value;control.dispatchEvent(new Event(id==='speed'?'change':'input',{bubbles:true}));}
    const input=document.createElement('input');input.id='typing-check';document.body.append(input);
  });
  await page.locator('#typing-check').focus();await page.keyboard.type('qweras');assert.equal(await page.locator('#typing-check').inputValue(),'qweras');
  assert.deepEqual(await settings(),{thickness:.04,height:1.55,speed:1});
  await page.evaluate(()=>{document.querySelector('#typing-check').remove();document.querySelector('#scene').dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',ctrlKey:true,bubbles:true,cancelable:true}));});
  assert.equal((await settings()).thickness,.04);checks.push('All six keys update existing controls, clamp at their limits, and leave typing and modified shortcuts alone');
  await page.locator('#scene').scrollIntoViewIfNeeded();
  const a=await project(-.6,.2),b=await project(.6,.2);
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.waitForTimeout(200);
  await page.keyboard.press('KeyW');await page.keyboard.press('KeyE');
  assert.equal((await state()).drawing,true,'changing flow and height does not interrupt a held stroke');
  await page.mouse.move(b.x,b.y,{steps:14});await page.waitForTimeout(180);await page.mouse.up();
  await page.waitForFunction(()=>sugarStudio.getState().strokes===1&&!sugarStudio.getState().draining);
  await page.waitForFunction(()=>sugarStudio.getState().material.coolingCells===0);
  await page.waitForFunction(()=>document.querySelector('#draft-status').textContent==='作品已保存在本机');
  const recorded=await page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('sugar-painting',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,read=db.transaction('drafts','readonly').objectStore('drafts').get('current');read.onsuccess=()=>{resolve(read.result.templates[0][0].commands);db.close();};read.onerror=()=>{db.close();reject(read.error);};};
  }));
  assert.ok(new Set(recorded.map(command=>command.amount)).size>=2);assert.ok(new Set(recorded.map(command=>command.height)).size>=2);
  await page.evaluate(()=>window.originalSurface=sugarStudio.captureSurface());
  await (await studioControl(page,'#play')).click();await page.waitForFunction(()=>!sugarStudio.getState().playing);
  assert.equal(await page.evaluate(()=>sugarStudio.captureSurface().every((value,index)=>value===originalSurface[index])),true);
  await page.reload();await page.waitForFunction(()=>window.sugarStudio);assert.equal((await state()).strokes,1);
  checks.push('Live shortcut changes remain one stroke, are saved with their timestamps, and replay without changing the final sugar surface');
  await page.locator('#scene').scrollIntoViewIfNeeded();const beforeView=await page.evaluate(()=>Array.from(sugarStudio.captureSurface())),point=await project(0,0);
  await page.mouse.move(point.x,point.y);await page.mouse.wheel(0,-250);await frame();
  await page.mouse.down({button:'right'});await page.mouse.move(point.x+55,point.y-25,{steps:8});await page.mouse.up({button:'right'});await frame();
  assert.deepEqual(await page.evaluate(()=>Array.from(sugarStudio.captureSurface())),beforeView);
  assert.equal((await state()).strokes,1);checks.push('Camera gestures preserve the finished stroke and restore correctly after reload');
  await (await studioControl(page,'.settings')).scrollIntoViewIfNeeded();
  await page.screenshot({path:fileURLToPath(new URL('./artifacts/drawing-input-desktop.png',import.meta.url))});
  for(const width of [320,390])for(const locale of ['en','ja','zh-TW','zh-CN']){
    await page.setViewportSize({width,height:844});await setStudioLocale(page,locale);
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.settings .setting-row')].every(row=>{const rect=row.getBoundingClientRect();return [...row.children].every(child=>{const box=child.getBoundingClientRect();return box.left>=rect.left-1&&box.right<=rect.right+1;});})),true,`${locale} shortcut controls fit ${width}px`);
  }
  await setStudioLocale(page,'en');await (await studioControl(page,'.settings')).scrollIntoViewIfNeeded();
  await page.screenshot({path:fileURLToPath(new URL('./artifacts/drawing-input-mobile-en.png',import.meta.url))});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks,errors},null,2));
} finally {await browser.close();}
