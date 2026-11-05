import assert from 'node:assert/strict';
import path from 'node:path';
import {launchBrowser,studioControl} from './browser-test.mjs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {patterns} from './src/patterns.js';
const root=path.dirname(fileURLToPath(import.meta.url));
const browser=await launchBrowser();
const page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto(pathToFileURL(path.join(root,'糖画铺.html')).href+'?mode=template');await page.waitForFunction(()=>window.sugarStudio);
  assert.equal(await page.locator('.pattern').count(),patterns.length);
  for(let i=0;i<patterns.length;i++){
    await (await studioControl(page,`[data-index="${i}"]`)).click();const state=await page.evaluate(()=>sugarStudio.getState());
    assert.equal(state.template.pattern,patterns[i].id);assert.ok(state.template.inkPixels>500,patterns[i].name);
  }
  const bounds=await page.evaluate(data=>data.map(pattern=>{
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.style.position='absolute';svg.style.visibility='hidden';document.body.append(svg);
    const paths=pattern.paths.map(d=>{const el=document.createElementNS('http://www.w3.org/2000/svg','path');el.setAttribute('d',d);svg.append(el);return el.getBBox();});
    const minX=Math.min(...paths.map(b=>b.x)),maxX=Math.max(...paths.map(b=>b.x+b.width)),minY=Math.min(...paths.map(b=>b.y)),maxY=Math.max(...paths.map(b=>b.y+b.height));svg.remove();
    return {name:pattern.name,minX:(minX-50)*.083*pattern.scale,maxX:(maxX-50)*.083*pattern.scale,minZ:(minY-46)*.083*pattern.scale,maxZ:(maxY-46)*.083*pattern.scale};
  }),patterns);
  for(const b of bounds)assert.ok(b.minX>-4.45&&b.maxX<4.45&&b.minZ>-3.68&&b.maxZ<3.68,JSON.stringify(b));
  await (await studioControl(page,'[data-index="2"]')).click();await page.locator('#scene').scrollIntoViewIfNeeded();
  const edge=await page.evaluate(()=>sugarStudio.projectPoint(0,(87-46)*.083*1.05));await page.mouse.move(edge.x,edge.y);await page.mouse.down();assert.equal((await page.evaluate(()=>sugarStudio.getState())).drawing,true);await page.mouse.up();await page.waitForFunction(()=>!sugarStudio.getState().draining);
  await (await studioControl(page,'#pattern-level')).selectOption('simple');assert.deepEqual(await page.locator('.pattern:visible').count(),2);assert.equal((await page.evaluate(()=>sugarStudio.getState())).template.pattern,'gourd');
  await (await studioControl(page,'#pattern-level')).selectOption('medium');assert.equal(await page.locator('.pattern:visible').count(),3);assert.equal((await page.evaluate(()=>sugarStudio.getState())).template.pattern,'fish');
  await (await studioControl(page,'[data-index="4"]')).click();await page.locator('#scene').scrollIntoViewIfNeeded();
  const trace=await page.evaluate(pattern=>{const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',pattern.paths[0]);const length=p.getTotalLength();return Array.from({length:8},(_,i)=>{const q=p.getPointAtLength(length*i/10);return sugarStudio.projectPoint((q.x-50)*.083*pattern.scale,(q.y-46)*.083*pattern.scale);});},patterns[4]);
  await page.mouse.move(trace[0].x,trace[0].y);await page.mouse.down();await page.waitForTimeout(200);
  for(const p of trace.slice(1)){await page.mouse.move(p.x,p.y,{steps:3});await page.waitForTimeout(50);}await page.mouse.up();
  await page.waitForFunction(()=>!sugarStudio.getState().draining&&sugarStudio.getState().strokes===1);await page.waitForTimeout(900);
  const original=await page.evaluate(()=>Array.from(sugarStudio.captureSurface()));
  await (await studioControl(page,'#pattern-level')).selectOption('advanced');assert.equal(await page.locator('.pattern:visible').count(),2);assert.equal((await page.evaluate(()=>sugarStudio.getState())).template.pattern,'butterfly');
  await (await studioControl(page,'#pattern-level')).selectOption('medium');await (await studioControl(page,'[data-index="4"]')).click();assert.deepEqual(await page.evaluate(()=>Array.from(sugarStudio.captureSurface())),original);
  await page.waitForFunction(()=>document.querySelector('#draft-status').textContent==='作品已保存在本机');await page.reload();await page.waitForFunction(()=>window.sugarStudio);
  await (await studioControl(page,'[data-index="4"]')).click();assert.deepEqual(await page.evaluate(()=>Array.from(sugarStudio.captureSurface())),original);
  await (await studioControl(page,'#pattern-level')).selectOption('all');await page.locator('#pattern-panel').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(root,'artifacts','catalog-desktop.png')});
  await page.setViewportSize({width:390,height:844});await page.locator('#pattern-panel').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(root,'artifacts','catalog-mobile.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#watch-mode').click();for(let i=3;i<patterns.length;i++){await (await studioControl(page,`[data-index="${i}"]`)).click();const state=await page.evaluate(()=>sugarStudio.getState());assert.equal(state.pattern,patterns[i].id);assert.ok(state.material.volume>0);}
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks:['all seven guides render within board','difficulty filters and selection','new template drawing survives switching and reload','new demonstration patterns render','mobile fits'],errors},null,2));
} catch(error){console.error(error);console.error(errors);process.exitCode=1;}
finally{await browser.close();}
