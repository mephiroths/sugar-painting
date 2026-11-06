import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {confirmFinishedSave,openRackManagement,closeRackManagement,launchBrowser,inspectCurrentWork,studioControl} from './browser-test.mjs';

const root=path.dirname(fileURLToPath(import.meta.url)),engineArgument=process.argv.slice(2).find(value=>!value.startsWith('--')),engines=engineArgument?[engineArgument]:['firefox','webkit'],html=fs.readFileSync(path.join(root,'糖画铺.html'));
const modern=process.argv.includes('--compat-driver'),suffix=modern?'-modern':'',driverRoot=path.join(root,modern?'tools/compat/node_modules/playwright':'node_modules/playwright');
if(!fs.existsSync(path.join(driverRoot,'package.json')))throw new Error('测试驱动尚未安装，请先运行 npm run compat:setup');
const driverVersion=JSON.parse(fs.readFileSync(path.join(driverRoot,'package.json'),'utf8')).version,driver=modern?await import(pathToFileURL(path.join(driverRoot,'index.mjs')).href):undefined;
const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const url=`http://127.0.0.1:${server.address().port}/?mode=template`;
let currentEngine='',stage='starting';
const watchdog=setTimeout(()=>{
  const result={engine:currentEngine,driverVersion,status:'timeout',stage};fs.writeFileSync(path.join(root,'artifacts',`compat-${currentEngine}${suffix}.json`),JSON.stringify(result,null,2));console.error(JSON.stringify(result));process.exit(1);
},180000);
const frame=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
try {
  for(const engine of engines){
    currentEngine=engine;let browser,page;const errors=[],warnings=[],checks=[],artifact=`compat-${engine}${suffix}`,result={engine,driverVersion,platform:process.platform,status:'failed'};
    const progress=value=>{stage=value;console.log(`[${engine}] ${value}`);};
    try {
      progress('launch');const software=engine==='firefox'&&process.argv.includes('--software');result.launchMode=software?'software-compositor':'default';browser=await launchBrowser(engine,{timeout:20000,...(software?{firefoxUserPrefs:{'layers.acceleration.disabled':true,'gfx.webrender.software':true}}:{})},driver);result.version=browser.version();
      progress('create page');page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1,reducedMotion:'reduce',acceptDownloads:true});page.setDefaultTimeout(20000);
      page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());if(message.type()==='warning')warnings.push(message.text());});
      progress('load studio');await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
      await page.waitForFunction(()=>window.sugarStudio||document.querySelector('#loading p')?.textContent.includes('暂时没能'),null,{timeout:30000});
      assert.equal(await page.evaluate(()=>!!window.sugarStudio),true,await page.locator('#loading p').textContent());
      result.capabilities=await page.evaluate(()=>{const canvas=document.querySelector('#scene canvas'),gl=canvas.getContext('webgl2');return{webgl2:!!gl,floatLinear:!!gl?.getExtension('OES_texture_float_linear'),mediaRecorder:typeof MediaRecorder==='function',captureStream:typeof canvas.captureStream==='function',formats:typeof MediaRecorder==='function'?['video/webm','video/mp4'].filter(type=>MediaRecorder.isTypeSupported(type)):[]};});
      checks.push('HTTP studio and template load');await frame(page);
      const colorAtCenter=()=>page.evaluate(()=>{
        const source=document.querySelector('#scene canvas'),point=sugarStudio.projectPoint(0,0),rect=source.getBoundingClientRect(),canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;const ctx=canvas.getContext('2d');ctx.drawImage(source,0,0);
        const x=Math.round((point.x-rect.left)/rect.width*source.width),y=Math.round((point.y-rect.top)/rect.height*source.height),pixels=ctx.getImageData(x-2,y-2,5,5).data,color=[0,0,0];
        for(let i=0;i<pixels.length;i+=4)for(let c=0;c<3;c++)color[c]+=pixels[i+c]/25;return color;
      });
      const before=await colorAtCenter(),point=await page.evaluate(()=>sugarStudio.projectPoint(0,0));
      progress('draw sugar');await page.mouse.move(point.x,point.y);await page.mouse.down();await page.waitForTimeout(450);
      const end=await page.evaluate(()=>sugarStudio.projectPoint(1,0));
      for(let i=1;i<=5;i++){await page.mouse.move(point.x+(end.x-point.x)*i/5,point.y+(end.y-point.y)*i/5);await page.waitForTimeout(40);}
      await page.waitForTimeout(150);await page.mouse.up();
      await page.waitForFunction(()=>sugarStudio.getState().strokes===1&&!sugarStudio.getState().draining);await page.waitForFunction(()=>sugarStudio.getState().material.coolingCells===0);await frame(page);
      const after=await colorAtCenter();result.centerColor={before,after};assert.ok(after[0]>after[1]+3&&after[1]>after[2]+5&&Math.hypot(...after.map((value,i)=>value-before[i]))>2,'sugar must be visibly amber at the deposited point');
      const volume=await page.evaluate(()=>sugarStudio.getState().material.volume);assert.ok(volume>0);checks.push('actual amber sugar renders');
      const reach=await page.evaluate(()=>{const field=sugarStudio.captureSurface();let max=-Infinity;for(let i=0;i<field.length;i++)if(field[i]>.0015)max=Math.max(max,(i%768)/767*9.1-4.55);return max;});assert.ok(reach>.6,'dragging must deposit a real path beyond the initial pool');checks.push('pointer drag deposits a continuous path');
      await (await studioControl(page,'#undo')).click();assert.equal(await page.evaluate(()=>sugarStudio.getState().material.volume),0);await (await studioControl(page,'#redo')).click();assert.ok(Math.abs(await page.evaluate(()=>sugarStudio.getState().material.volume)-volume)<1e-6);checks.push('undo and redo');
      progress('export and reload');const download=page.waitForEvent('download');await (await studioControl(page,'#save')).click();const image=await download,png=path.join(root,'artifacts',`${artifact}-export.png`);await image.saveAs(png);const data=fs.readFileSync(png);assert.ok(data.length>10000);assert.equal(data.subarray(1,4).toString(),'PNG');assert.equal(await page.evaluate(()=>sugarStudio.getState().template.visible),true);checks.push('PNG download and guide restoration');
      await page.waitForFunction(()=>document.querySelector('#draft-status').textContent==='作品已保存在本机');await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.sugarStudio);assert.equal(await page.evaluate(()=>sugarStudio.getState().strokes),1);checks.push('IndexedDB draft reload');
      await page.screenshot({path:path.join(root,'artifacts',`${artifact}-desktop.png`),fullPage:true});
      await page.setViewportSize({width:390,height:844});await page.locator('#scene').scrollIntoViewIfNeeded();await frame(page);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);checks.push('390px layout');
      progress('lift and save');await page.locator('#scene-finish').click();await frame(page);assert.equal(await page.evaluate(()=>sugarStudio.getState().finished),true);assert.equal(await page.evaluate(()=>sugarStudio.getState().finishedStick),true);await page.screenshot({path:path.join(root,'artifacts',`${artifact}-mobile.png`)});checks.push('closed solid renders');
      await page.locator('#pin-current').click();await confirmFinishedSave(page);await page.waitForFunction(()=>sugarStudio.getState().presentation.mode==='rack');await openRackManagement(page);await page.waitForFunction(()=>document.querySelectorAll('.gallery-item').length===1);await closeRackManagement(page);checks.push('gallery save');
      assert.equal(await page.evaluate(()=>sugarStudio.getState().finished),false);assert.equal(await page.evaluate(()=>sugarStudio.getState().strokes),0);
      await page.locator('#rack-open').click();await page.locator('#rack-items button').first().click();
      await page.locator('#share-work').click();await page.waitForFunction(()=>!!document.querySelector('#share-download').getAttribute('href'));
      const posterDownload=page.waitForEvent('download');await page.locator('#share-download').click();const poster=await posterDownload,posterPath=path.join(root,'artifacts',`${artifact}-share.png`);await poster.saveAs(posterPath);
      const posterBytes=fs.readFileSync(posterPath);assert.equal(posterBytes.readUInt32BE(16),1200);assert.equal(posterBytes.readUInt32BE(20),1500);assert.ok(posterBytes.length>10000);await page.locator('#share-close').click();assert.equal(await page.evaluate(()=>sugarStudio.getState().presentation.mode),'inspect');checks.push('share poster downloads at 1200x1500 and preserves the archived work');
      await (await studioControl(page,'#record-format')).selectOption('portrait');
      if(result.capabilities.mediaRecorder&&result.capabilities.captureStream&&result.capabilities.formats.length){
        await page.evaluate(()=>{window.recorderEvents=[];const start=MediaRecorder.prototype.start;MediaRecorder.prototype.start=function(...args){for(const event of ['start','stop','error'])this.addEventListener(event,e=>recorderEvents.push({event,error:e.error?.name,message:e.error?.message,mime:this.mimeType}));return start.apply(this,args);};});
        progress('record portrait');await (await studioControl(page,'#record-format')).selectOption('portrait');await (await studioControl(page,'#record-video')).click();await page.waitForFunction(()=>!document.querySelector('#download-video').hidden,null,{timeout:30000});
        const video=page.waitForEvent('download');await page.locator('#download-video').click();const file=await video,extension=path.extname(file.suggestedFilename()),target=path.join(root,'artifacts',`${artifact}-video${extension}`);await file.saveAs(target);
        const decoded=await page.evaluate(async({data,type})=>{
          const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type})),video=document.createElement('video');
          const wait=event=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`video ${event} timeout`)),10000);video.addEventListener(event,()=>{clearTimeout(timer);resolve();},{once:true});video.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('video decode failed'));},{once:true});});
          try {
            const metadata=wait('loadedmetadata');video.src=url;video.muted=true;await metadata;
            video.style.cssText='position:fixed;left:0;top:0;width:160px;height:284px;z-index:99;pointer-events:none';document.body.append(video);video.playbackRate=2;
            const canvas=document.createElement('canvas');canvas.width=360;canvas.height=640;const ctx=canvas.getContext('2d');
            const hash=pixels=>{let value=2166136261;for(const byte of pixels)value=Math.imul(value^byte,16777619);return value>>>0;};
            const motion=await new Promise((resolve,reject)=>{
              let first=null,frames=0,settled=false;const timer=setTimeout(()=>finish(new Error('video showed no decoded motion')),15000);
              const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);video.pause();if(error)reject(error);else resolve(result);};
              const sample=()=>{
                ctx.drawImage(video,0,0,360,640);const pixels=ctx.getImageData(90,280,180,130).data;let brightness=0;
                for(let i=0;i<pixels.length;i+=4)brightness+=pixels[i];if(brightness/(pixels.length/4)<80)return;
                frames++;if(!first){first=pixels;return;}
                let changed=0;
                for(let i=0;i<pixels.length;i+=4)if(Math.max(Math.abs(pixels[i]-first[i]),Math.abs(pixels[i+1]-first[i+1]),Math.abs(pixels[i+2]-first[i+2]))>12)changed++;
                if(changed>40)finish(null,{first:hash(first),second:hash(pixels),changedPixels:changed,frames});
              };
              const request=callback=>typeof video.requestVideoFrameCallback==='function'?video.requestVideoFrameCallback(callback):requestAnimationFrame(callback);
              const next=()=>{if(settled)return;try{sample();if(!settled)request(next);}catch(error){finish(error);}};
              video.addEventListener('ended',()=>{if(settled)return;sample();if(!settled)finish(new Error('decoded video remained static'));},{once:true});
              request(next);video.play().catch(error=>finish(error));
            });
            return{width:video.videoWidth,height:video.videoHeight,...motion};
          }finally{video.pause();video.remove();URL.revokeObjectURL(url);}
        },{data:fs.readFileSync(target).toString('base64'),type:extension==='.mp4'?'video/mp4':'video/webm'});
        assert.equal(decoded.width,720);assert.equal(decoded.height,1280);assert.notEqual(decoded.first,decoded.second);result.portrait=decoded;checks.push('portrait video decodes at 720x1280 with motion');result.video='passed';
      } else {
        progress('unsupported recording fallback');const original=await page.evaluate(()=>sugarStudio.getState().material.volume);await (await studioControl(page,'#record-video')).click();
        assert.match(await page.locator('#toast').textContent(),/不支持视频录制|没有可用的视频编码器/);assert.equal(await page.locator('#record-format').isDisabled(),false);assert.equal(await page.evaluate(()=>sugarStudio.getState().playing),false);assert.ok(Math.abs(await page.evaluate(()=>sugarStudio.getState().material.volume)-original)<1e-6);
        result.video='unavailable';checks.push('unsupported recording preserves artwork and offers PNG fallback');
      }
      assert.deepEqual(errors,[]);result.status='passed';
    } catch(error){result.error=String(error);result.stage=stage;if(stage==='launch'||stage==='create page')result.status='unavailable';if(page){result.loading=await page.locator('#loading p').textContent().catch(()=>null);result.diagnostics=await page.evaluate(()=>({state:window.sugarStudio?.getState(),toast:document.querySelector('#toast')?.textContent,videoButton:document.querySelector('#record-video')?.textContent,hidden:document.hidden})).catch(()=>null);await page.screenshot({path:path.join(root,'artifacts',`${artifact}-failure.png`)}).catch(()=>{});}process.exitCode=1;}
    finally {
      result.checks=checks;result.errors=errors;result.warnings=warnings;if(page)result.recorderEvents=await page.evaluate(()=>window.recorderEvents).catch(()=>null);fs.writeFileSync(path.join(root,'artifacts',`${artifact}.json`),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));await browser?.close();
    }
  }
} finally {clearTimeout(watchdog);await new Promise(resolve=>server.close(resolve));}
