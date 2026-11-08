import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {launchBrowser,studioControl,setStudioLocale,confirmFinishedSave} from './browser-test.mjs';

const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'}),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
const state=()=>page.evaluate(()=>sugarStudio.getState());
const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const shot=name=>page.screenshot({path:fileURLToPath(new URL(`./artifacts/${name}.png`,import.meta.url))});
const output=fileURLToPath(new URL('./artifacts/ivory-gallery-results.json',import.meta.url));
async function assertStage(label){
  await frame();const result=await page.evaluate(()=>{
    const source=document.querySelector('#scene canvas'),copy=document.createElement('canvas');copy.width=source.width;copy.height=source.height;
    const ctx=copy.getContext('2d');ctx.drawImage(source,0,0);const {data}=ctx.getImageData(0,0,copy.width,copy.height),f=sugarStudio.getState().presentation.framing;
    const left=(f.left+1)*copy.width/2-10,right=(f.right+1)*copy.width/2+10,top=(1-f.top)*copy.height/2-10,bottom=(1-f.bottom)*copy.height/2+10;
    let outside=0,marked=0,amber=0;const bg=[data[0],data[1],data[2]];
    for(let y=4;y<copy.height-4;y+=3)for(let x=4;x<copy.width-4;x+=3){const k=(y*copy.width+x)*4,r=data[k],g=data[k+1],b=data[k+2];
      if(x<left||x>right||y<top||y>bottom){outside++;if(Math.max(Math.abs(r-bg[0]),Math.abs(g-bg[1]),Math.abs(b-bg[2]))>3)marked++;}
      else if(r>g+18&&g>b+15&&r<235)amber++;
    }
    const hex=getComputedStyle(document.documentElement).getPropertyValue('--scene-canvas').trim();
    const expected=[1,3,5].map(start=>parseInt(hex.slice(start,start+2),16));
    return {bg,expected,outside,marked,amber};
  });
  assert.deepEqual(result.bg,result.expected,label+': scene follows the shared palette');assert.ok(result.outside>100);assert.equal(result.marked,0,label+': no backdrop texture or shadow');assert.ok(result.amber>30,label+': amber lines remain visible');
  return result;
}
async function fits(ids,label){
  const boxes=[];
  for(const id of ids){const r=await page.locator('#'+id).boundingBox(),size=page.viewportSize();assert.ok(r&&r.x>=-.5&&r.y>=-.5&&r.x+r.width<=size.width+.5&&r.y+r.height<=size.height+.5,label+' '+id);boxes.push(r);}
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];assert.ok(a.x+a.width<=b.x+.5||b.x+b.width<=a.x+.5||a.y+a.height<=b.y+.5||b.y+b.height<=a.y+.5,label+': controls do not overlap');}
  const f=(await state()).presentation.framing;assert.ok(f.left>-.99&&f.right<.99&&f.bottom>-.99&&f.top<.99,label+': whole artwork fits');
  const balance=await page.evaluate(()=>{const f=sugarStudio.getState().presentation.framing,r=document.querySelector('#scene').getBoundingClientRect(),caption=document.querySelector('.scene-caption').getBoundingClientRect(),dock=document.querySelector(sugarStudio.getState().presentation.mode==='inspect'?'#work-process':'#finish-actions').getBoundingClientRect();return {actual:r.top+(1-(f.top+f.bottom)/2)*r.height/2,expected:(caption.bottom+dock.top)/2};});
  assert.ok(Math.abs(balance.actual-balance.expected)<25,label+': artwork is centered between title and actions');
}
try{
  await page.goto(pathToFileURL(fileURLToPath(new URL('./糖画铺.html',import.meta.url))).href);await page.waitForFunction(()=>window.sugarStudio);
  await page.locator('#rack-open').click();await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='rack');await page.locator('#rack-items button').first().click();
  const sample=await assertStage('example');await shot('ivory-example-desktop');
  for(const [width,height] of [[390,844],[320,568],[940,377],[1280,900]]){
    await page.setViewportSize({width,height});await frame();await fits(['rack-back','share-work','replay-work'],`${width}×${height}`);
    if(width===390)await shot('ivory-example-mobile');
  }
  checks.push('Complete sample artworks render in deeper amber on an untextured ivory background, with compact actions and responsive framing');
  await (await studioControl(page,'#resume-drawing')).click();await page.locator('#draw-mode').click();
  const points=await page.evaluate(()=>[[-1.3,1],[0,-1.1],[1.1,.9],[-.9,-.1],[1.3,-.1]].map(([x,z])=>sugarStudio.projectPoint(x,z)));
  await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.waitForTimeout(200);for(const p of points.slice(1))await page.mouse.move(p.x,p.y,{steps:18});await page.mouse.up();
  await page.waitForFunction(()=>sugarStudio.getState().strokes===1&&!sugarStudio.getState().draining);await page.waitForFunction(()=>sugarStudio.getState().material.coolingCells===0);
  const original=await page.evaluate(()=>Array.from(sugarStudio.captureSurface()));await page.locator('#scene-finish').click();const thin=await assertStage('hand-drawn lines');await shot('ivory-held-desktop');
  assert.equal(await page.locator('#image-work').isVisible(),false);assert.equal(await page.locator('#next-painting').isVisible(),false);
  for(const [width,height] of [[390,844],[320,568],[940,377]])for(const locale of ['zh-CN','en','zh-TW','ja']){
    await page.setViewportSize({width,height});await setStudioLocale(page,locale);await frame();await fits(['rack-open','settings-trigger','language','resume-drawing','share-work','pin-current','finish-more'],`${locale} ${width}×${height}`);
  }
  await setStudioLocale(page,'zh-CN');await page.setViewportSize({width:390,height:844});await frame();await shot('ivory-held-mobile');
  const before=await page.evaluate(()=>sugarStudio.getPresentationSpine()),box=await page.locator('#scene').boundingBox();
  await page.mouse.move(box.x+box.width*.4,box.y+box.height*.4);await page.mouse.down();await page.mouse.move(box.x+box.width*.65,box.y+box.height*.4,{steps:12});await page.mouse.up();await frame();
  const after=await page.evaluate(()=>sugarStudio.getPresentationSpine());for(let i=0;i<2;i++)for(let j=0;j<2;j++)assert.ok(Math.abs(before.ends[i][j]-after.ends[i][j])<1e-6);
  await page.locator('#share-work').click();await page.waitForFunction(()=>!!document.querySelector('#share-download').getAttribute('href'));await page.locator('#share-close').click();
  const download=page.waitForEvent('download');await (await studioControl(page,'#image-work')).click();assert.match((await download).suggestedFilename(),/\.png$/);
  await page.locator('#resume-drawing').click();assert.deepEqual(await page.evaluate(()=>Array.from(sugarStudio.captureSurface())),original);
  await page.locator('#scene-finish').click();await page.locator('#pin-current').click();await confirmFinishedSave(page,'米白展示验收');await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='rack');
  checks.push('Thin hand-drawn lines stay visible; four-language actions fit phones and landscape; central-axis rotation, sharing, original surface restoration and named saving remain intact');
  assert.deepEqual(errors,[]);const result={ok:true,checks,sample,thin,errors};fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){await shot('ivory-gallery-failure');fs.writeFileSync(output,JSON.stringify({ok:false,checks,errors,error:String(error)},null,2));throw error;}
finally{await browser.close();}
