import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {patterns} from './src/patterns.js';
import {guideCoverage} from './src/guide-progress.js';
import {launchBrowser,studioControl} from './browser-test.mjs';
const field=new Float32Array(101*101),layer={field,nx:101,nz:101,width:10,depth:10,dx:.1,dz:.1};
const samples=Array.from({length:11},(_,i)=>({x:i*.1,z:0}));
assert.equal(guideCoverage(samples,layer),0);
for(let x=50;x<=55;x++)field[50*101+x]=.02;
assert.ok(guideCoverage(samples,layer)>.4&&guideCoverage(samples,layer)<.8);
for(let x=56;x<=60;x++)field[50*101+x]=.02;
assert.equal(guideCoverage(samples,layer),1);
const root=path.dirname(fileURLToPath(import.meta.url)),browser=await launchBrowser();
const page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto(pathToFileURL(path.join(root,'糖画铺.html')).href+'?mode=template');await page.waitForFunction(()=>window.sugarStudio);
  await (await studioControl(page,'.pattern[data-index="2"]')).click();await (await studioControl(page,'#step-guide')).check();
  for(let i=0;i<9;i++)await page.locator('#step-next').click();
  const points=await page.evaluate(pattern=>{const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',pattern.paths[9]);const length=path.getTotalLength();return Array.from({length:21},(_,i)=>{const p=path.getPointAtLength(length*i/20);return sugarStudio.projectPoint((p.x-50)*.083*pattern.scale,(p.y-46)*.083*pattern.scale);});},patterns[2]);
  async function draw(part){await page.mouse.move(part[0].x,part[0].y);await page.mouse.down();await page.waitForTimeout(300);for(const p of part.slice(1)){await page.mouse.move(p.x,p.y);await page.waitForTimeout(35);}await page.waitForTimeout(300);await page.mouse.up();await page.waitForFunction(()=>!sugarStudio.getState().draining);}
  await draw(points.slice(0,11));assert.equal((await page.evaluate(()=>sugarStudio.getState())).template.step,9,'partial tracing remains on the current step');
  await draw(points.slice(10));assert.equal((await page.evaluate(()=>sugarStudio.getState())).template.step,10,'completed tracing advances');
  await page.locator('#step-prev').click();const unrelated=await page.evaluate(()=>sugarStudio.projectPoint(-3,2));
  await draw([unrelated,unrelated]);assert.equal((await page.evaluate(()=>sugarStudio.getState())).template.step,9,'existing coverage and an unrelated mark must not advance');
  await (await studioControl(page,'#clear')).click();assert.equal((await page.evaluate(()=>sugarStudio.getState())).template.step,0);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks:['coverage thresholds','partial tracing','completion advances','clear resets guide'],errors},null,2));
} finally {await browser.close();}
