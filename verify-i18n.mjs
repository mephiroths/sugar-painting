import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser, openRackManagement, closeRackManagement ,studioControl,saveCurrentWork} from './browser-test.mjs';
import { messages } from './src/locales.js';

for (const [key, translations] of Object.entries(messages)) {
  for (const locale of ['en', 'zh-TW', 'ja']) {
    assert.ok(translations[locale]?.trim(), `${locale}: ${key}`);
    assert.deepEqual([...translations[locale].matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(), [...key.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(), `${locale}: placeholders in ${key}`);
  }
}

const browser = await launchBrowser();
const context = await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const url = pathToFileURL(fileURLToPath(new URL('./糖画铺.html', import.meta.url))).href;
const screenshot = name => fileURLToPath(new URL(`./artifacts/${name}.png`, import.meta.url));
const checks = [];
try {
  await page.goto(url+'?mode=template');
  await page.waitForFunction(()=>window.sugarStudio);
  await page.evaluate(()=>window.originalCanvas=document.querySelector('#scene canvas'));
  for (const [locale, watch, heading, butterfly] of [
    ['en','Watch','Pick a guide','Butterfly'],
    ['ja','お手本','ガイドを選ぶ','蝶'],
    ['zh-TW','看師傅畫','選一張印記','蝶戀花'],
    ['zh-CN','看师傅画','选一张印记','蝶恋花'],
  ]) {
    await page.locator('#language').selectOption(locale);
    assert.equal(await page.locator('html').getAttribute('lang'), locale);
    assert.equal(await page.locator('#watch-mode').innerText(),watch);
    assert.equal(await page.locator('#pattern-heading').textContent(),heading);
    assert.equal(await page.locator('.pattern span').first().textContent(),butterfly);
    assert.equal(await page.evaluate(()=>originalCanvas===document.querySelector('#scene canvas')),true);
    assert.equal(await page.locator('#language').inputValue(),locale);
  }
  checks.push('Four locales update text, patterns, document language and accessible controls without replacing WebGL canvas');
  await page.locator('#language').selectOption('en');
  await (await studioControl(page,'[data-index="2"]')).click();
  await (await studioControl(page,'#step-guide')).check();
  assert.match(await page.locator('#step-label').innerText(),/^Stroke 1 \/ /);
  assert.equal(await page.locator('#scene-title').innerText(),'Trace: Lucky gourd');
  const untranslated = await page.evaluate(()=>{
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT), found=[];
    while(walker.nextNode()) {
      const n=walker.currentNode, p=n.parentElement;
      if(p?.closest('script,style,noscript,.seal,.loading-seal')||!p?.getClientRects().length||p.closest('[hidden]'))continue;
      if(/[\u3400-\u9fff]/.test(n.textContent))found.push(n.textContent.trim());
    }
    return found;
  });
  assert.deepEqual(untranslated,[]);
  await page.locator('#scene').scrollIntoViewIfNeeded();
  const points=await page.evaluate(()=>[sugarStudio.projectPoint(-.5,-.5),sugarStudio.projectPoint(.8,.4)]);
  await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.waitForTimeout(220);
  await page.mouse.move(points[1].x,points[1].y,{steps:16});await page.waitForTimeout(150);await page.mouse.up();
  await page.waitForFunction(()=>!sugarStudio.getState().draining&&sugarStudio.getState().strokes===1);
  assert.equal(await page.evaluate(()=>{
    const before=Array.from(sugarStudio.captureSurface()), select=document.querySelector('#language');
    select.value='ja';select.dispatchEvent(new Event('change',{bubbles:true}));
    const after=Array.from(sugarStudio.captureSurface());
    return before.every((value,i)=>value===after[i])&&originalCanvas===document.querySelector('#scene canvas');
  }),true);
  assert.match(await page.locator('#step-label').innerText(),/筆目$/);
  checks.push('Switching languages preserves drawn sugar, active guide and canvas identity');
  await page.locator('#language').selectOption('en');
  const imageDownload=page.waitForEvent('download');
  await (await studioControl(page,'#save')).click();
  assert.equal((await imageDownload).suggestedFilename(),'Sugar-Studio-Lucky gourd-my-painting.png');
  await saveCurrentWork(page,'蝶恋花 / My 作品');
  await openRackManagement(page);
  await page.waitForFunction(()=>document.querySelectorAll('.gallery-item').length===1);
  await page.locator('#gallery-import').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{}')});
  await page.waitForFunction(()=>document.querySelector('#gallery-status').dataset.kind==='error');
  assert.equal(await page.locator('#gallery-status').innerText(),'Import failed. Choose a valid Sugar Studio backup file.');
  const backupDownload=page.waitForEvent('download');await page.locator('#gallery-export').click();
  assert.equal((await backupDownload).suggestedFilename(),'Sugar-Studio-backup.json');
  await closeRackManagement(page);
  await page.locator('#language').selectOption('ja');
  await openRackManagement(page);
  await page.waitForFunction(()=>document.querySelector('#gallery').getAttribute('aria-busy')==='false');
  assert.equal(await page.locator('.gallery-item strong').innerText(),'蝶恋花 / My 作品');
  assert.equal(await page.locator('.gallery-item-actions button').first().innerText(),'開く');
  await closeRackManagement(page);
  await page.reload();await page.waitForFunction(()=>window.sugarStudio);
  assert.equal(await page.locator('#language').inputValue(),'ja');
  checks.push('Language persists after reload and artwork names retain their original text');
  checks.push('Image and backup exports use localized filenames; import errors use the selected language');
  await page.locator('#language').selectOption('en');
  await page.locator('#watch-mode').click();
  await page.screenshot({path:screenshot('i18n-desktop-en'),fullPage:true});
  for(const width of [320,390,760,900,1280]) {
    await page.setViewportSize({width,height:844});
    for(const locale of ['en','ja','zh-TW','zh-CN']) {
      await page.locator('#language').selectOption(locale);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${locale} at ${width}px`);
      const headerFits=await page.evaluate(()=>[...document.querySelectorAll('.masthead a,.masthead button,.masthead select')].every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}));
      assert.equal(headerFits,true,`header ${locale} at ${width}px`);
      for(const mode of ['watch','draw','template']) {
        await page.locator(`#${mode}-mode`).click();
        const layout=await page.evaluate(()=>{
          const caption=document.querySelector('.scene-caption').getBoundingClientRect(), tools=document.querySelector('.view-tools').getBoundingClientRect();
          const noOverlap=caption.bottom<=tools.top||caption.top>=tools.bottom||caption.right<=tools.left||caption.left>=tools.right;
          const move=document.querySelector('#navigate-drawing'), quick=document.querySelector('.scene-quick-controls');
          const a=move.getBoundingClientRect(),b=quick.getBoundingClientRect();
          return {noOverlap, actionsFit:!a.width||!b.width||a.right<=b.left||a.bottom<=b.top||b.bottom<=a.top};
        });
        assert.equal(layout.noOverlap,true,`caption ${mode} ${locale} at ${width}px`);
        assert.equal(layout.actionsFit,true,`drawing actions ${mode} ${locale} at ${width}px`);
      }
    }
  }
  await page.setViewportSize({width:390,height:844});await page.locator('#language').selectOption('en');
  await page.locator('#watch-mode').click();await page.screenshot({path:screenshot('i18n-mobile-en'),fullPage:true});
  await page.locator('#template-mode').click();await page.locator('#language').selectOption('ja');
  await page.screenshot({path:screenshot('i18n-mobile-ja'),fullPage:true});
  checks.push('All four languages fit 320, 390, 760, 900 and 1280 pixel viewports');
  const forced=await context.newPage();await forced.goto(url+'?lang=en');await forced.waitForFunction(()=>window.sugarStudio);
  assert.equal(await forced.locator('#language').inputValue(),'en');
  await forced.close();
  const blocked=await browser.newContext({viewport:{width:900,height:800},reducedMotion:'reduce'});
  await blocked.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Blocked','SecurityError');}}));
  const blockedPage=await blocked.newPage();await blockedPage.goto(url+'?lang=en');await blockedPage.waitForFunction(()=>window.sugarStudio);
  assert.equal(await blockedPage.locator('html').getAttribute('lang'),'en');
  await blockedPage.locator('#language').selectOption('ja');assert.equal(await blockedPage.locator('html').getAttribute('lang'),'ja');
  await blocked.close();
  checks.push('URL language override and storage-blocked switching work');
  assert.deepEqual(errors,[]);
  const result={ok:true,checks,errors};
  fs.writeFileSync(new URL('./artifacts/i18n-results.json',import.meta.url),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} finally {await browser.close();}
