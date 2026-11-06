import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,firefox,webkit} from 'playwright';

export async function launchBrowser(engine='chromium',options={},driver={chromium,firefox,webkit}) {
  fs.mkdirSync(new URL('./artifacts/',import.meta.url),{recursive:true});
  const type=driver[engine];if(!type)throw new Error(`未知测试引擎：${engine}`);
  const launch=engine==='chromium'?{headless:true,channel:'chromium',args:[...(process.platform==='win32'?['--use-angle=d3d11']:[]),'--ignore-gpu-blocklist','--enable-webgl']}:{headless:true};
  if(engine==='chromium'&&process.env.SUGAR_TEST_BROWSER_EXECUTABLE)launch.executablePath=process.env.SUGAR_TEST_BROWSER_EXECUTABLE;
  if(engine==='chromium'&&process.env.SUGAR_TEST_SOFTWARE_GPU==='1')launch.args=['--use-angle=swiftshader','--enable-unsafe-swiftshader'];
  if(engine!=='chromium'){const downloads=fileURLToPath(new URL(`./artifacts/downloads-${engine}/`,import.meta.url));fs.mkdirSync(downloads,{recursive:true});launch.downloadsPath=downloads;}
  if(!fs.existsSync(type.executablePath())){
    const parts=type.executablePath().split(path.sep),index=parts.findIndex(part=>new RegExp(`^${engine}-\\d+$`).test(part));
    if(index>=0){const cache=path.join(path.dirname(fileURLToPath(import.meta.url)),'.cache','browsers'),executable=path.join(cache,...parts.slice(index));if(fs.existsSync(executable)&&fs.existsSync(path.join(cache,parts[index],'INSTALLATION_COMPLETE')))launch.executablePath=executable;}
  }
  return type.launch({...launch,...options});
}

// Tests that edit a drawing after management return through the unified rack.
export async function openRackManagement(page) {
  await page.locator('#rack-open').click();
  await page.locator('#rack-manage').click();
}
export async function closeRackManagement(page) {
  await page.locator('#gallery-close').click();
  await page.locator('#resume-drawing').click();
}

// Follow the visible disclosure controls when a tool is tucked into a menu.
export async function studioControl(page,selector) {
  if(selector==='#undo'||selector==='#redo'){
    const quick=page.locator(selector==='#undo'?'#scene-undo':'#scene-redo');if(await quick.isVisible())return quick;
  }
  const control=page.locator(selector);
  const menus=await control.evaluate(element=>{const ids=[];for(let parent=element.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS'&&!parent.open)ids.unshift(parent.id);return ids;});
  for(const id of menus)await page.locator(`#${id} > summary`).click();
  return control;
}
export async function setStudioLocale(page,locale) {
  await (await studioControl(page,'#language')).selectOption(locale);
}

export async function saveCurrentWork(page,name) {
  if(!await page.locator('#save-work-dialog').evaluate(dialog=>dialog.open))await (await studioControl(page,'#gallery-save')).click();
  await page.locator('#work-name').fill(name);
  await page.locator('#save-work-submit').click();
  await page.waitForFunction(()=>!document.querySelector('#save-work-dialog').open||!document.querySelector('#save-work-submit').disabled);
}

export async function confirmFinishedSave(page,name) {
  await page.locator('#save-work-dialog').waitFor({state:'visible'});
  if(name)await page.locator('#work-name').fill(name);
  await page.locator('#save-work-submit').click();
  await page.waitForFunction(()=>!document.querySelector('#save-work-dialog').open||!document.querySelector('#save-work-submit').disabled);
}

export async function inspectCurrentWork(page) {
  const mode=await page.evaluate(()=>sugarStudio.getState().presentation.mode);
  if(mode==='replay'){await page.locator('#replay-back').click();return;}
  if(mode==='inspect')return;
  if(mode!=='rack'){
    if(await page.evaluate(()=>sugarStudio.getState().mode)==='watch'){
      await page.locator('#finish').click();await page.locator('#pin-current').click();await confirmFinishedSave(page);
    }else{
      await saveCurrentWork(page,'过程练习');
      await page.waitForFunction(()=>document.querySelector('#toast').textContent==='已存入糖画架。');
      await page.locator('#rack-open').click();
    }
  }
  await page.locator('#rack-items button').first().click();
}

// waitForFunction in the pinned driver treats an async predicate's Promise as
// truthy before it resolves. Await asynchronous storage reads on the Node side.
export async function waitForAsync(page,predicate,arg,timeout=10000) {
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){const result=await page.evaluate(predicate,arg);if(result)return result;await page.waitForTimeout(25);}
  throw new Error('异步浏览器状态等待超时');
}
