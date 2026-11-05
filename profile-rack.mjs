import fs from 'node:fs';
import assert from 'node:assert/strict';
import {launchBrowser} from './browser-test.mjs';

// Instrument the development response in this isolated test browser only.
const label=process.argv[2]||'baseline',browser=await launchBrowser();
const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
await page.addInitScript(()=>window.__rackProbe={build:[],inspect:[],rack:[],pick:[],paint:[]});
await page.route('**/src/main.js',async route=>{
  const response=await route.fetch();let source=await response.text();
  for(const [name,arg]of [['paintingFromWork','item'],['inspectDisplayed','id'],['renderRack','']]){
    source=source.replace(`function ${name}(${arg}) {`,`function __original_${name}(${arg}) {`);
    const metric=name==='paintingFromWork'?'build':name==='inspectDisplayed'?'inspect':'rack';
    source+=`\nfunction ${name}(${arg}){const begin=performance.now();try{return __original_${name}(${arg});}finally{window.__rackProbe.${metric}.push(performance.now()-begin);${metric==='inspect'?'requestAnimationFrame(()=>requestAnimationFrame(()=>window.__rackProbe.paint.push(performance.now()-begin)));':''}}}\n`;
  }
  for(const expression of ['raycaster.intersectObject(rackRoot,true)','raycaster.intersectObjects(rackRoot.userData.pickTargets,false)'])source=source.replace(expression,`__measurePick(()=>${expression})`);
  source+='\nfunction __measurePick(operation){const begin=performance.now();try{return operation();}finally{window.__rackProbe.pick.push(performance.now()-begin);}}\nwindow.__readRackGpu=()=>({geometries:renderer.info.memory.geometries,programs:renderer.info.programs.length});';
  await route.fulfill({response,body:source});
});
try {
  await page.goto('http://127.0.0.1:5177/');await page.waitForFunction(()=>window.sugarStudio);
  for(const index of [0,1,6]){
    await page.locator(`[data-index="${index}"]`).click();await page.locator('#finish').click();await page.locator('#pin-current').click();
    await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='rack');
    if(index!==6)await page.locator('#resume-drawing').click();
  }
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const memoryBefore=await page.evaluate(()=>__readRackGpu());
  await page.evaluate(()=>{for(const key of Object.keys(__rackProbe))__rackProbe[key]=[];});
  for(let i=0;i<4;i++){
    const target=await page.evaluate(index=>sugarStudio.getState().rackItems[index],i%3);
    await page.mouse.click(target.x,target.y);await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='inspect');
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.locator('#rack-back').click();await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='rack');
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  }
  const result=await page.evaluate(()=>({samples:__rackProbe,memoryAfter:__readRackGpu(),triangles:sugarStudio.getState().triangles}));
  result.memoryBefore=memoryBefore;result.errors=errors;result.label=label;
  result.summary=Object.fromEntries(['inspect','pick','rack','paint'].map(key=>{const values=result.samples[key];return[key,{count:values.length,medianMs:values.slice().sort((a,b)=>a-b)[Math.floor(values.length/2)]||0,maxMs:Math.max(0,...values)}];}));
  result.modelBuilds=result.samples.build.length;
  if(label==='optimized'){
    assert.equal(result.modelBuilds,0,'cached inspection and return must not remesh any painting');
    assert.equal(result.memoryAfter.geometries,memoryBefore.geometries,'repeated inspection must not grow geometry buffers');
    assert.deepEqual(errors,[]);
  }
  fs.writeFileSync(new URL(`./artifacts/rack-performance-${label}.json`,import.meta.url),JSON.stringify(result,null,2));
  console.log(JSON.stringify({label,summary:result.summary,modelBuilds:result.modelBuilds,memoryBefore,memoryAfter:result.memoryAfter,triangles:result.triangles,errors},null,2));
} finally {await browser.close();}
