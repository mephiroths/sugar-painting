import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {launchBrowser,saveCurrentWork,openRackManagement,setStudioLocale,studioControl} from './browser-test.mjs';

const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'});
const errors=[],checks=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().startsWith('https://pattern-import-test.invalid'))requests.push(request.url());});
const output=fileURLToPath(new URL('./artifacts/pattern-import-verification.json',import.meta.url));
const url=pathToFileURL(fileURLToPath(new URL('./糖画铺.html',import.meta.url))).href+'?mode=template&pattern=gourd';
const state=()=>page.evaluate(()=>sugarStudio.getState());
const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 180"><script>window.__uploadedScriptRan=true</script><image href="https://pattern-import-test.invalid/image.png"/><g transform="translate(20 10) scale(1.4)"><path d="M10 20 Q35 0 45 35 Q55 0 80 20 Q90 40 45 70 Q0 40 10 20Z"/><path d="M20 85 L35 95 M65 85 L80 95"/><circle cx="50" cy="50" r="5"/></g></svg>');
const choose=async(name,mimeType,buffer)=>{
  if(!await page.locator('#pattern-picker').evaluate(e=>e.open))await page.locator('#pattern-trigger').click();
  await page.locator('#pattern-import-file').setInputFiles({name,mimeType,buffer});
  await page.waitForFunction(()=>!document.querySelector('#pattern-import-open').disabled);
};
const paint=async()=>{
  const before=(await state()).strokes,p=await page.evaluate(()=>[sugarStudio.projectPoint(-.4,0),sugarStudio.projectPoint(.4,.2)]);
  await page.mouse.move(p[0].x,p[0].y);await page.mouse.down();await page.waitForTimeout(180);await page.mouse.move(p[1].x,p[1].y,{steps:8});await page.mouse.up();
  await page.waitForFunction(n=>!sugarStudio.getState().draining&&sugarStudio.getState().strokes===n,before+1);
};
try {
  await page.goto(url);await page.waitForFunction(()=>window.sugarStudio);await paint();
  await choose('爱心线稿.svg','image/svg+xml',svg);
  assert.equal(await page.locator('#pattern-import-preview').isVisible(),true,await page.locator('#pattern-import-status').textContent());
  assert.equal(await page.locator('#pattern-import-watch').isEnabled(),true);
  await page.screenshot({path:fileURLToPath(new URL('./artifacts/pattern-import-desktop.png',import.meta.url))});
  await page.locator('#pattern-import-watch').click();
  await page.waitForFunction(()=>sugarStudio.getState().mode==='watch'&&sugarStudio.getState().pattern.startsWith('import-'));
  assert.equal((await state()).strokes,4,'separate SVG subpaths must not be joined with sugar');
  assert.equal(await page.evaluate(()=>!!window.__uploadedScriptRan),false);assert.deepEqual(requests,[]);
  await page.locator('.watch-replay').click();await page.waitForFunction(()=>sugarStudio.getState().pour.threadVisible&&sugarStudio.getState().material.volume>0);await page.locator('#pause').click();
  await page.screenshot({path:fileURLToPath(new URL('./artifacts/spoon-pouring-fixed.png',import.meta.url))});
  checks.push('SVG geometry, group transforms and separate subpaths become real pouring strokes; scripts and linked images never execute or load');
  await page.locator('#template-mode').click();assert.equal((await state()).strokes,1,'built-in draft survives imported demonstration');
  await page.locator('#pattern-trigger').click();await page.locator('.pattern[data-index="7"]').click();
  assert.equal((await state()).template.paths,4);assert.equal(await page.locator('#step-guide').isEnabled(),true);
  const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=200;c.height=180;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,200,180);x.strokeStyle='black';x.lineWidth=5;x.beginPath();x.moveTo(30,140);x.bezierCurveTo(150,20,20,20,170,140);x.stroke();return c.toDataURL('image/png').split(',')[1];}),'base64');
  await choose('我的图片.png','image/png',png);assert.equal(await page.locator('#pattern-import-watch').isDisabled(),true);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#pattern-picker .popover-body').evaluate(e=>e.scrollTop=0);
  await page.screenshot({path:fileURLToPath(new URL('./artifacts/pattern-import-mobile.png',import.meta.url))});
  await page.locator('#pattern-import-trace').click();
  await page.waitForFunction(()=>sugarStudio.getState().template.paths===0&&sugarStudio.getState().template.pattern.startsWith('import-'));
  const rasterId=(await state()).template.pattern;assert.ok((await state()).template.inkPixels>100);
  assert.equal(await page.locator('#step-guide').isDisabled(),true);assert.equal(await page.locator('#step-controls').isVisible(),false);await paint();
  await page.waitForTimeout(550);await page.reload();await page.waitForFunction(()=>window.sugarStudio);
  await page.locator('#pattern-trigger').click();assert.equal(await page.locator('.imported-pattern-image').count(),2);
  await page.locator('.pattern[data-index="8"]').click();assert.equal((await state()).template.pattern,rasterId);assert.equal((await state()).strokes,1);
  await page.screenshot({path:fileURLToPath(new URL('./artifacts/imported-image-tracing.png',import.meta.url))});
  await page.locator('#pattern-trigger').click();await page.locator('.pattern[data-index="2"]').click();assert.equal((await state()).strokes,1);
  checks.push('PNG becomes an aspect-preserving image guide without fake step guidance; imported patterns and independent drafts survive refresh');
  await choose('保存重试.svg','image/svg+xml',svg);
  await page.evaluate(()=>{const original=IDBObjectStore.prototype.put;window.restorePatternWrites=()=>IDBObjectStore.prototype.put=original;IDBObjectStore.prototype.put=function(value,key){if(key==='patterns')throw new DOMException('test','QuotaExceededError');return original.call(this,value,key);};});
  await page.locator('#pattern-import-trace').click();await page.waitForFunction(()=>document.querySelector('#pattern-import-status').textContent.includes('空间不足'));
  assert.equal((await state()).strokes,1);assert.equal(await page.locator('.imported-pattern-image').count(),2);
  await page.evaluate(()=>restorePatternWrites());await page.locator('#pattern-import-trace').click();await page.waitForFunction(id=>sugarStudio.getState().template.pattern!==id&&sugarStudio.getState().template.paths===4,rasterId);
  checks.push('Storage failure preserves the current drawing and preview; retry adds the pattern successfully');
  await choose('无路径.svg','image/svg+xml',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>文字</text></svg>'));
  assert.match(await page.locator('#pattern-import-status').textContent(),/没有线条/);
  await choose('错误.svg','image/svg+xml',Buffer.from('<svg invalid'));
  assert.match(await page.locator('#pattern-import-status').textContent(),/格式不正确/);
  await choose('大文件.svg','image/svg+xml',Buffer.alloc(8*1024*1024+1));assert.match(await page.locator('#pattern-import-status').textContent(),/8 MB/);
  await choose('非图片.txt','text/plain',Buffer.from('plain text'));assert.match(await page.locator('#pattern-import-status').textContent(),/支持 PNG/);
  checks.push('Malformed, unsupported, oversized and non-geometric files report actionable errors without replacing the drawing');
  for(const locale of ['zh-CN','zh-TW','en','ja']){
    await page.locator('#pattern-picker').evaluate(e=>e.open=false);await setStudioLocale(page,locale);await page.locator('#pattern-trigger').click();
    const button=await page.locator('#pattern-import-open').boundingBox();assert.ok(button.height>=44&&button.x>=0&&button.x+button.width<=390);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  await setStudioLocale(page,'zh-CN');await (await studioControl(page,'.pattern[data-index="8"]')).click();
  await saveCurrentWork(page,'图片底稿作品');await openRackManagement(page);
  const download=page.waitForEvent('download');await page.locator('#gallery-export').click();const backup=await (await download).path();
  const exported=JSON.parse(fs.readFileSync(backup,'utf8'));assert.equal(exported.works[0].patternDefinition.id,rasterId);
  const other=await browser.newContext({viewport:{width:1280,height:800},reducedMotion:'reduce'}),restored=await other.newPage();restored.on('pageerror',error=>errors.push(error.message));
  await restored.goto(url);await restored.waitForFunction(()=>window.sugarStudio);await openRackManagement(restored);
  await restored.locator('#gallery-import').setInputFiles({name:'作品备份.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
  await restored.waitForFunction(()=>document.querySelector('#gallery-list .gallery-item'));
  await restored.locator('#gallery-list .gallery-item-actions button').first().click();
  await restored.waitForFunction(()=>sugarStudio.getState().template.pattern?.startsWith('import-'));
  assert.equal((await restored.evaluate(()=>sugarStudio.getState())).template.pattern,rasterId);assert.equal((await restored.evaluate(()=>sugarStudio.getState())).strokes,1);
  await other.close();checks.push('Four-language mobile import controls remain usable; gallery backups carry custom guides to a fresh browser with remapped pattern indices');
  assert.deepEqual(errors,[]);const result={ok:true,checks,errors};fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} catch(error){fs.writeFileSync(output,JSON.stringify({ok:false,checks,errors,error:String(error)},null,2));throw error;}
finally{await browser.close();}
