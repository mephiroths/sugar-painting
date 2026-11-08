import {t,setText,localize} from './i18n.js';
import {installStudioSettings,syncStudioSettings} from './studio-settings.js';

// Reuses the studio's real controls and state; no second drawing implementation.
export const uiAssets={wood:'./assets/ui/wood-table.png',stone:'./assets/ui/marble-slab.png',copper:'./assets/ui/copper-hammered.png',display:'./assets/ui/display-backdrop.png',paper:'./assets/ui/paper-sheet.png',sign:'./assets/ui/shop-sign.png'};
if(globalThis.__sugarOfflineAssets)for(const key of Object.keys(uiAssets))uiAssets[key]=globalThis.__sugarOfflineAssets[uiAssets[key]]||uiAssets[key];
let rail,watchTools,ready=false;
function positionWorkbenchHint() {
  const picker=document.getElementById('pattern-picker'),modes=document.querySelector('.mode-switch'),hint=document.querySelector('.workbench-status');
  const anchor=picker.getClientRects().length?picker:modes,box=anchor.getBoundingClientRect(),root=document.querySelector('.workbench').getBoundingClientRect();
  hint.style.top=Math.round(box.bottom-root.top+10)+'px';hint.style.left=Math.max(12,Math.round(box.left-root.left))+'px';hint.style.right='24px';
}
export function installFolkUI({patterns,selectPattern,editWork,deleteWork}) {
  const $=id=>document.getElementById(id),workbench=document.querySelector('.workbench');
  const brand=document.querySelector('.brand');brand.replaceChildren();
  const sign=new Image();sign.src=uiAssets.sign;sign.alt='糖画铺';sign.width=320;sign.height=120;brand.append(sign);
  rail=document.createElement('nav');rail.className='pattern-rail';rail.setAttribute('aria-label',t('挑一幅糖画'));workbench.append(rail);
  for(let i=0;i<Math.min(3,patterns.length);i++){
    const original=document.querySelector(`.pattern[data-index="${i}"]`),button=document.createElement('button');button.type='button';button.className='pattern-ticket';button.dataset.pattern=String(i);
    button.append(original.querySelector('svg').cloneNode(true));const label=document.createElement('span');setText(label,()=>patterns[i].name);button.append(label);button.onclick=()=>selectPattern(i);rail.append(button);
  }
  for(const id of ['drawing-settings','board-menu']){
    const heading=document.createElement('div');heading.className='paper-panel-heading';const title=document.createElement('h2');setText(title,()=>id==='drawing-settings'?'调节':'作品');const close=document.createElement('button');close.type='button';setText(close,()=>'关闭');close.onclick=()=>{$(id).open=false;$(id).querySelector('summary').focus();};heading.append(title,close);$(id).querySelector('.popover-body').prepend(heading);
  }
  setText($('save-work-title'),()=>'给这幅糖画起个名');
  const cta=document.createElement('div');cta.className='watch-cta';document.querySelector('.scene-panel').append(cta);cta.append($('beginner'));
  // Keep the internal completion action for existing flows, without a second homepage CTA.
  $('finish').hidden=true;
  const patternIcon=document.createElementNS('http://www.w3.org/2000/svg','svg');patternIcon.setAttribute('viewBox','0 0 24 24');patternIcon.setAttribute('aria-hidden','true');patternIcon.innerHTML='<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>';$('pattern-trigger').prepend(patternIcon);
  $('pattern-trigger').setAttribute('aria-haspopup','dialog');
  const patternPanel=$('pattern-picker').querySelector('.popover-body');patternPanel.setAttribute('role','dialog');patternPanel.setAttribute('aria-labelledby','pattern-heading');
  const hintResize=new ResizeObserver(positionWorkbenchHint);hintResize.observe($('pattern-picker'));hintResize.observe(document.querySelector('.mode-switch'));window.addEventListener('resize',positionWorkbenchHint);
  const completionTitle=document.createElement('h2');completionTitle.className='completion-title';setText(completionTitle,()=>'先看看这份甜');$('finish-actions').prepend(completionTitle);
  const imageWork=document.createElement('button');imageWork.id='image-work';imageWork.type='button';setText(imageWork,()=>'保存图片');imageWork.onclick=()=>$('save').click();$('finish-actions').append(imageWork);
  const finishMore=document.createElement('details');finishMore.id='finish-more';finishMore.className='tool-popover';
  const finishSummary=document.createElement('summary');setText(finishSummary,'更多操作');
  const finishOptions=document.createElement('div');finishOptions.className='popover-body';finishMore.append(finishSummary,finishOptions);$('finish-actions').append(finishMore);finishOptions.append($('next-painting'),imageWork);
  finishMore.addEventListener('click',event=>{if(event.target.closest('button'))finishMore.open=false;});
  watchTools=document.querySelector('.playback');
  const pauseLabel=document.createElement('span');pauseLabel.className='pause-label';pauseLabel.id='pause-label';watchTools.insertBefore(pauseLabel,watchTools.children[1]);
  const replay=document.createElement('button');replay.className='watch-replay';replay.type='button';setText(replay,()=>'重播');replay.onclick=()=>$(document.body.dataset.presentation==='replay'?'replay-work':'play').click();watchTools.append(replay);
  const speedChoices=document.createElement('div');speedChoices.className='speed-choices';speedChoices.setAttribute('role','group');speedChoices.setAttribute('aria-label',t('浇糖速度'));
  for(const [value,label] of [['0.65','慢慢来'],['1','刚刚好'],['1.8','快一点']]){const button=document.createElement('button');button.type='button';button.dataset.speed=value;setText(button,()=>label);button.onclick=()=>{$('speed').value=value;$('speed').dispatchEvent(new Event('change'));};speedChoices.append(button);}
  $('speed').hidden=true;$('speed').parentElement.append(speedChoices);
  for(const [id,label,action] of [['edit-inspected','继续修改',editWork],['delete-inspected','删除作品',deleteWork]]){const button=document.createElement('button');button.id=id;button.type='button';setText(button,()=>label);button.onclick=action;$('work-process').append(button);}
  const note=document.createElement('span');note.className='watch-invitation';setText(note,()=>'看一遍，再亲手试试');watchTools.append(note);
  const empty=document.createElement('div');empty.className='rack-empty-message';empty.id='rack-empty-message';empty.hidden=true;const title=document.createElement('h2');setText(title,()=>'这里还没有糖画');const p=document.createElement('p');setText(p,()=>'亲手做一幅，挂在这里吧');const start=document.createElement('button');start.className='primary-button';setText(start,()=>'去画第一幅');start.onclick=()=>$('resume-drawing').click();empty.append(title,p,start);document.querySelector('.scene-panel').append(empty);
  const exit=document.createElement('button');exit.type='button';exit.className='focus-exit';setText(exit,()=>'退出专注模式');exit.onclick=()=>$('focus-view').click();document.querySelector('.scene-panel').append(exit);
  const patternClose=document.createElement('button');patternClose.type='button';patternClose.className='pattern-close';setText(patternClose,()=>'关闭');patternClose.onclick=()=>{$('pattern-picker').open=false;$('pattern-trigger').focus();};document.querySelector('.pattern-heading').append(patternClose);
  const continuePractice=document.createElement('button');continuePractice.id='tutorial-continue';continuePractice.type='button';continuePractice.hidden=true;continuePractice.className='text-button';setText(continuePractice,()=>'继续描画');$('tutorial').append(continuePractice);
  const more=document.createElement('details');more.id='work-more';more.className='tool-popover';const summary=document.createElement('summary');setText(summary,()=>'更多操作');const actions=document.createElement('div');actions.className='popover-body';more.append(summary,actions);$('work-process').append(more);actions.append($('edit-inspected'),imageWork,$('video-menu'),$('delete-inspected'));
  $('work-process').addEventListener('click',event=>{if(event.target.closest('button'))more.open=false;});
  setText($('template-mode'),()=>'照着画');setText($('scene-finish'),()=>'拿起来看看');
  installStudioSettings();ready=true;localize();
  $('rack-tools').prepend(document.querySelector('.rack-collections'));
}
export function syncFolkUI(state,presentation,gallery,example=false) {
  if(!ready)return;document.body.dataset.mode=state.mode;document.body.dataset.presentation=presentation||'';
  const selected=state.mode==='template'?state.templatePattern:state.pattern;
  rail.hidden=true;
  for(const button of rail.querySelectorAll('.pattern-ticket')){const i=Number(button.dataset.pattern);button.hidden=i>2;button.setAttribute('aria-pressed',String(i===selected));}
  setText(watchTools.querySelector('.pause-label'),()=>!state.playing?'已完成':state.paused?'继续浇糖':'暂停');
  for(const button of document.querySelectorAll('.speed-choices button'))button.setAttribute('aria-pressed',String(Number(button.dataset.speed)===state.speed));
  for(const id of ['edit-inspected','delete-inspected'])document.getElementById(id).hidden=presentation!=='inspect'||(example&&id==='delete-inspected');
  document.getElementById('work-more').hidden=presentation!=='inspect';
  document.getElementById('finish-more').hidden=presentation!=='held';
  document.getElementById('rack-empty-message').hidden=presentation!=='rack'||document.body.dataset.rackCollection!=='personal'||gallery.length>0;
  for(const button of document.querySelectorAll('.board-export'))button.disabled=!state.hasArtwork;
  syncStudioSettings(state,presentation);
  positionWorkbenchHint();
}
export function confirmDelete(name) {
  const dialog=document.getElementById('delete-work-dialog');setText(document.getElementById('delete-work-name'),()=>name);dialog.returnValue='cancel';
  return new Promise(resolve=>{dialog.addEventListener('close',()=>resolve(dialog.returnValue==='delete'),{once:true});dialog.showModal();});
}
