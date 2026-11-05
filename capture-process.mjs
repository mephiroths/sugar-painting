import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser} from './browser-test.mjs';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const browser=await launchBrowser();
const context=await browser.newContext({viewport:{width:1440,height:960},deviceScaleFactor:1,reducedMotion:'reduce',recordVideo:{dir:path.join(root,'artifacts','process-video'),size:{width:1440,height:960}}});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try {
  await page.goto('http://127.0.0.1:5177',{waitUntil:'networkidle'});await page.waitForFunction(()=>window.sugarStudio);
  await page.locator('#play').click();
  await page.waitForFunction(()=>sugarStudio.getState().pour.flowing&&sugarStudio.getState().material.volume>.008);
  await page.screenshot({path:path.join(root,'artifacts','process-start.png'),fullPage:true});
  await page.waitForFunction(()=>sugarStudio.getState().progress>.14,{},{timeout:30000});
  await page.locator('#pause').click();await page.screenshot({path:path.join(root,'artifacts','process-mid.png'),fullPage:true});
  const state=await page.evaluate(()=>sugarStudio.getState());console.log(JSON.stringify({state,errors},null,2));
  fs.writeFileSync(path.join(root,'artifacts','process-state.json'),JSON.stringify({state,errors},null,2));
  await page.locator('#pause').click();await page.waitForTimeout(1800);
} finally {const video=page.video();await context.close();console.log('VIDEO '+await video.path());await browser.close();}
