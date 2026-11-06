import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {confirmFinishedSave,launchBrowser,studioControl} from './browser-test.mjs';
import {experienceUrl,shareFilename} from './src/share.js';

for(const href of ['file:///tmp/studio.html','http://localhost:5177/','http://192.168.1.2/','http://127.0.0.1/','http://10.0.0.2/','http://172.16.0.1/','http://[::1]/'])assert.equal(experienceUrl(href,'en','draw'),null);
assert.equal(experienceUrl('https://sugar.example/app?private=secret#draft','en','template','gourd'),'https://sugar.example/app?lang=en&mode=template&pattern=gourd');
assert.equal(shareFilename('a/b:*?'), 'a-b----share.png');
const browser=await launchBrowser(),checks=[],errors=[];
const html=fs.readFileSync(new URL('./糖画铺.html',import.meta.url),'utf8');
const output=name=>fileURLToPath(new URL(`./artifacts/${name}`,import.meta.url));
const page=await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce',acceptDownloads:true});
page.on('pageerror',e=>errors.push(e.message));
async function ready(){await page.waitForFunction(()=>window.sugarStudio);}
async function poster(){await page.waitForFunction(()=>!!document.querySelector('#share-download').getAttribute('href'));await page.locator('#share-preview').evaluate(img=>img.decode());}
async function openViewShare(){await (await studioControl(page,'#share-scene')).click();await poster();}
try{
  await page.goto(pathToFileURL(fileURLToPath(new URL('./糖画铺.html',import.meta.url))).href);await ready();
  await page.evaluate(()=>{window.beforeShare={surface:Array.from(sugarStudio.captureSurface()),state:sugarStudio.getState(),canvas:[document.querySelector('#scene canvas').width,document.querySelector('#scene canvas').height]};});
  await openViewShare();
  assert.equal(await page.locator('#share-link-row').isVisible(),false);
  assert.equal(await page.locator('#share-copy').isDisabled(),true);
  assert.match(await page.locator('#share-link-note').innerText(),/本地预览/);
  const pngReady=page.waitForEvent('download');await page.locator('#share-download').click();const download=await pngReady;await download.saveAs(output('share-poster-zh.png'));
  const png=fs.readFileSync(output('share-poster-zh.png'));assert.equal(png.readUInt32BE(16),1200);assert.equal(png.readUInt32BE(20),1500);assert.ok(png.length>50000,'poster contains a real rendered scene');
  await page.screenshot({path:output('share-desktop.png')});
  await page.keyboard.press('Escape');assert.equal(await page.locator('#share-dialog').evaluate(d=>d.open),false);
  await page.waitForFunction(()=>document.activeElement===document.querySelector('#view-menu > summary'));
  assert.equal(await page.evaluate(()=>{const after=sugarStudio.captureSurface();return beforeShare.surface.every((v,i)=>v===after[i])&&beforeShare.state.strokes===sugarStudio.getState().strokes&&beforeShare.canvas.every((v,i)=>v===[document.querySelector('#scene canvas').width,document.querySelector('#scene canvas').height][i]);}),true);
  checks.push('Offline poster downloads at 1200 × 1500; no broken public link; Escape restores focus and exact artwork/canvas state');

  // Test the native API contract without handing files to an external service.
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
    Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{
      window.shareCalls??=[];window.shareCalls.push({name:data.files[0].name,type:data.files[0].type,size:data.files[0].size,active:navigator.userActivation.isActive,text:data.text});
      if(window.shareError)throw new DOMException('test',window.shareError);
    }});
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(window.copyError)throw new Error('Denied');window.copiedLink=text;}}});
  });
  await page.route('https://sugar.example/**',route=>route.fulfill({status:200,contentType:'text/html',body:html}));
  await page.goto('https://sugar.example/?lang=en&mode=template&pattern=gourd&private=secret#draft');await ready();
  assert.equal((await page.evaluate(()=>sugarStudio.getState())).template.pattern,'gourd');
  assert.equal(await page.locator('#share-scene').isDisabled(),true,'empty boards are not shared as artwork');
  await page.locator('#scene').scrollIntoViewIfNeeded();
  const points=await page.evaluate(()=>[[-1,0],[1,0]].map(([x,z])=>sugarStudio.projectPoint(x,z)));
  await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.waitForTimeout(200);
  await page.mouse.move(points[1].x,points[1].y,{steps:20});await page.waitForTimeout(200);await page.mouse.up();
  await page.waitForFunction(()=>!sugarStudio.getState().draining&&sugarStudio.getState().strokes===1);
  await openViewShare();
  assert.equal(await page.locator('#share-link').inputValue(),'https://sugar.example/?lang=en&mode=template&pattern=gourd');
  await page.locator('#share-copy').click();assert.equal(await page.evaluate(()=>copiedLink),'https://sugar.example/?lang=en&mode=template&pattern=gourd');
  await page.locator('#share-native').click();
  assert.equal(await page.evaluate(()=>shareCalls[0].active),true);assert.equal(await page.evaluate(()=>shareCalls[0].type),'image/png');
  await page.evaluate(()=>window.shareError='AbortError');await page.locator('#share-native').click();assert.match(await page.locator('#share-status').innerText(),/cancelled/);
  await page.evaluate(()=>window.shareError='NotAllowedError');await page.locator('#share-native').click();assert.match(await page.locator('#share-status').innerText(),/did not finish/);
  await page.evaluate(()=>window.copyError=true);await page.locator('#share-copy').click();
  assert.equal(await page.locator('#share-link').evaluate(e=>e.selectionStart===0&&e.selectionEnd===e.value.length),true);
  await page.locator('#share-close').click();checks.push('Hosted link strips unrelated parameters and restores the selected template; native file share preserves click activation; cancel, permission denial and clipboard denial have usable recovery');

  for(const lang of ['zh-CN','zh-TW','ja','en']){
    await page.locator('#language').selectOption(lang);await openViewShare();
    assert.equal(await page.locator('#share-native').isDisabled(),false);
    const missing=await page.evaluate(()=>[...document.querySelectorAll('#share-dialog button, #share-dialog label, #share-intro, #share-link-note')].filter(e=>e.getClientRects().length).filter(e=>document.documentElement.lang==='en'&&/[\u3400-\u9fff]/.test(e.textContent)).map(e=>e.textContent));assert.deepEqual(missing,[]);
    await page.locator('#share-close').click();
  }
  await page.setViewportSize({width:320,height:740});await openViewShare();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await page.locator('#share-dialog').evaluate(d=>d.scrollWidth<=d.clientWidth),true);
  await page.screenshot({path:output('share-mobile-en.png')});await page.keyboard.press('Escape');checks.push('Four languages render; 320 px mobile dialog scrolls without horizontal overflow');

  await page.evaluate(()=>{const original=HTMLCanvasElement.prototype.toBlob;window.restorePoster=()=>HTMLCanvasElement.prototype.toBlob=original;HTMLCanvasElement.prototype.toBlob=function(callback,...args){if(this.width===1200)callback(null);else original.call(this,callback,...args);};});
  await (await studioControl(page,'#share-scene')).click();await page.locator('#share-retry').waitFor();assert.equal(await page.locator('#share-native').isDisabled(),true);
  await page.evaluate(()=>restorePoster());await page.locator('#share-retry').click();await poster();await page.locator('#share-close').click();
  checks.push('Poster encoding failure preserves the work and can be retried');

  await page.setViewportSize({width:1440,height:960});await page.locator('#watch-mode').click();await page.waitForFunction(()=>!sugarStudio.getState().playing);
  await page.locator('#finish').click();await page.locator('#share-work').click();await poster();await page.locator('#share-close').click();assert.equal((await page.evaluate(()=>sugarStudio.getState())).presentation.mode,'held');
  await page.locator('#pin-current').click();await confirmFinishedSave(page);await page.locator('#rack-items button').first().click();await page.locator('#share-work').click();await poster();
  const archiveLink=await page.locator('#share-link').inputValue();assert.match(archiveLink,/pattern=butterfly/);
  await page.locator('#share-close').click();assert.equal((await page.evaluate(()=>sugarStudio.getState())).presentation.mode,'inspect');checks.push('Finished work and archived work share directly while preserving their presentation');
  assert.deepEqual(errors,[]);
  const result={ok:true,checks,errors,nativeSharing:'API stub only; real device share sheets remain unverified'};fs.writeFileSync(output('share-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
