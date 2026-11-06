import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {launchBrowser,studioControl,saveCurrentWork,setStudioLocale} from './browser-test.mjs';

const root=path.dirname(fileURLToPath(import.meta.url)),web=path.join(root,'artifacts/vercel-site');
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname,file=path.join(web,name==='/'?'index.html':name);if(!file.startsWith(web+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.mp3')?'audio/mpeg':'text/html; charset=utf-8');res.end(fs.readFileSync(file));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'}),errors=[],checks=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('pouring-music.mp3'))requests.push(r.url());});
const url=`http://127.0.0.1:${server.address().port}/?mode=draw`;
const state=()=>page.evaluate(()=>sugarStudio.getState());
const rms=()=>page.evaluate(()=>{const analyser=window.musicAnalyser;if(!analyser)return 0;const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);return Math.sqrt(data.reduce((sum,n)=>sum+n*n,0)/data.length);});
await page.addInitScript(()=>{
  const create=AudioContext.prototype.createGain;
  AudioContext.prototype.createGain=function(){const gain=create.call(this),analyser=this.createAnalyser();analyser.fftSize=2048;gain.connect(analyser);window.musicAnalyser=analyser;return gain;};
  const Recorder=window.MediaRecorder;
  window.MediaRecorder=class extends Recorder{constructor(stream,options){super(stream,options);window.recordedTrackKinds=stream.getTracks().map(t=>t.kind);}};
});
async function toggle(){await (await studioControl(page,'#music-toggle')).click();}
async function exportVideo(filename){
  await (await studioControl(page,'#record-video')).click();
  await page.waitForFunction(()=>!document.querySelector('#download-video').hidden,null,{timeout:30000});
  const download=page.waitForEvent('download');await (await studioControl(page,'#download-video')).click();const result=await download,target=path.join(root,'artifacts',filename);await result.saveAs(target);
  return JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_type','-of','json',target],{encoding:'utf8'})).streams.map(s=>s.codec_type);
}
try{
  await page.goto(url);await page.waitForFunction(()=>window.sugarStudio);
  assert.equal(requests.length,0);assert.equal((await state()).music.context,null);assert.equal((await state()).music.loaded,false);
  const firstPoint=await page.evaluate(()=>sugarStudio.projectPoint(0,0));await page.mouse.click(firstPoint.x,firstPoint.y,{delay:200});
  await page.waitForFunction(()=>sugarStudio.getState().music.loaded&&sugarStudio.getState().music.playing);
  await page.waitForTimeout(700);assert.equal(requests.length,1);assert.ok(await rms()>1e-5,'the actual MP3 reaches the audio output');assert.ok((await state()).music.duration>100);
  checks.push('No audio context or music request before interaction; the real MP3 plays after a gesture at low volume');
  await toggle();await page.waitForTimeout(550);assert.equal((await state()).music.enabled,false);assert.equal((await state()).music.playing,false);assert.ok(await rms()<1e-5);
  await page.reload();await page.waitForFunction(()=>window.sugarStudio);await page.locator('#draw-mode').click();assert.equal((await state()).music.enabled,false);assert.equal(requests.length,1);
  await toggle();await page.waitForFunction(()=>sugarStudio.getState().music.loaded&&sugarStudio.getState().music.playing);
  await (await studioControl(page,'#clear')).click();
  await page.locator('#scene').click({position:{x:600,y:360},delay:250});
  await page.waitForFunction(()=>sugarStudio.getState().strokes===1&&!sugarStudio.getState().draining);await page.waitForFunction(()=>sugarStudio.getState().material.coolingCells===0);
  const surface=await page.evaluate(()=>Array.from(sugarStudio.captureSurface()));
  await saveCurrentWork(page,'Music process');await page.locator('#rack-open').click();await page.locator('#rack-items button').first().click();
  await page.waitForTimeout(550);assert.equal((await state()).music.active,false);assert.ok(await rms()<1e-5);
  assert.ok((await exportVideo('music-process.webm')).includes('audio'));assert.deepEqual(await page.evaluate(()=>recordedTrackKinds.slice().sort()),['audio','video']);assert.equal((await state()).music.recordings,0);
  const pcm=execFileSync('ffmpeg',['-v','error','-i',path.join(root,'artifacts/music-process.webm'),'-vn','-ac','1','-ar','16000','-f','f32le','pipe:1'],{maxBuffer:8*1024*1024});
  let energy=0;for(let i=0;i<pcm.length;i+=4)energy+=pcm.readFloatLE(i)**2;assert.ok(Math.sqrt(energy/(pcm.length/4))>1e-6,'encoded soundtrack contains audible samples');
  await page.locator('#replay-back').click();await page.locator('#resume-drawing').click();assert.deepEqual(await page.evaluate(()=>Array.from(sugarStudio.captureSurface())),surface);
  checks.push('Preference survives reload; finished views fade out; video contains an encoded audio stream and preserves the draft');
  await page.locator('#rack-open').click();await page.locator('#rack-items button').first().click();await toggle();
  assert.equal((await exportVideo('music-off-process.webm')).includes('audio'),false);assert.deepEqual(await page.evaluate(()=>recordedTrackKinds),['video']);
  await page.locator('#replay-back').click();await page.locator('#resume-drawing').click();await toggle();
  await page.waitForFunction(()=>sugarStudio.getState().music.playing);await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForTimeout(600);assert.equal((await state()).music.active,false);assert.ok(await rms()<1e-5);
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await page.waitForFunction(()=>sugarStudio.getState().music.active);
  checks.push('Music-off exports stay silent; hiding the page fades and stops audio, returning resumes it');
  for(const width of [320,390,1280])for(const language of ['zh-CN','zh-TW','en','ja']){
    await page.setViewportSize({width,height:844});await setStudioLocale(page,language);await (await studioControl(page,'#music-toggle')).focus();
    assert.equal(await page.evaluate(()=>{const a=document.querySelector('#view-menu .popover-body').getBoundingClientRect(),b=document.querySelector('#music-toggle').getBoundingClientRect();return a.left>=0&&a.right<=innerWidth&&b.left>=a.left&&b.right<=a.right;}),true,`${width}/${language} sound control fits`);
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({width:390,height:844});await setStudioLocale(page,'zh-CN');await (await studioControl(page,'#music-toggle')).focus();await page.screenshot({path:path.join(root,'artifacts/music-mobile.png')});
  const offline=await browser.newPage({reducedMotion:'reduce'});await offline.goto(pathToFileURL(path.join(root,'糖画铺.html')).href+'?mode=draw');await offline.waitForFunction(()=>window.sugarStudio);await offline.locator('#draw-mode').click();await offline.waitForFunction(()=>sugarStudio.getState().music.loaded);await offline.close();
  checks.push('The menu works in all four languages at 320/390/1280 px; the standalone HTML plays its embedded music offline');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks,errors},null,2));
}catch(error){console.error(JSON.stringify({music:await page.evaluate(()=>window.sugarStudio?.getState().music).catch(()=>null),requests,errors},null,2));throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
