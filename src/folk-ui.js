import {t,setText,localize} from './i18n.js';

// Reuses the studio's real controls and state; no second drawing implementation.
export const uiAssets={wood:'./assets/ui/wood-table.png',stone:'./assets/ui/marble-slab.png',copper:'./assets/ui/copper-hammered.png',display:'./assets/ui/display-backdrop.png',paper:'./assets/ui/paper-sheet.png',sign:'./assets/ui/shop-sign.png'};
if(globalThis.__sugarOfflineAssets)for(const key of Object.keys(uiAssets))uiAssets[key]=globalThis.__sugarOfflineAssets[uiAssets[key]]||uiAssets[key];
let rail,watchTools,ready=false;
export function installFolkUI({patterns,selectPattern,editWork,deleteWork}) {
  const $=id=>document.getElementById(id),workbench=document.querySelector('.workbench');
  const brand=document.querySelector('.brand');brand.replaceChildren();
  const sign=new Image();sign.src=uiAssets.sign;sign.alt='糖画铺';sign.width=320;sign.height=120;brand.append(sign);
  const musicButton=document.createElement('button');musicButton.type='button';musicButton.className='header-music';musicButton.append($('music-toggle').querySelector('svg').cloneNode(true));const musicLabel=document.createElement('span');musicButton.append(musicLabel);musicButton.onclick=()=>$('music-toggle').click();document.querySelector('.mast-actions').append(musicButton);
  const refreshMusic=()=>{const enabled=$('music-toggle').dataset.enabled==='true';musicButton.setAttribute('aria-pressed',String(enabled));musicButton.disabled=$('music-toggle').disabled;setText(musicLabel,()=>enabled?'配乐：开':'配乐：关');};new MutationObserver(refreshMusic).observe($('music-toggle'),{attributes:true,attributeFilter:['data-enabled','disabled']});refreshMusic();
  rail=document.createElement('nav');rail.className='pattern-rail';rail.setAttribute('aria-label',t('挑一幅糖画'));workbench.append(rail);
  for(let i=0;i<patterns.length;i++){
    const original=document.querySelector(`.pattern[data-index="${i}"]`),button=document.createElement('button');button.type='button';button.className='pattern-ticket';button.dataset.pattern=String(i);
    button.append(original.querySelector('svg').cloneNode(true));const label=document.createElement('span');setText(label,()=>patterns[i].name);button.append(label);button.onclick=()=>selectPattern(i);rail.append(button);
  }
  for(const id of ['drawing-settings','board-menu']){
    const heading=document.createElement('div');heading.className='paper-panel-heading';const title=document.createElement('h2');setText(title,()=>id==='drawing-settings'?'调节':'作品');const close=document.createElement('button');close.type='button';setText(close,()=>'关闭');close.onclick=()=>{$(id).open=false;$(id).querySelector('summary').focus();};heading.append(title,close);$(id).querySelector('.popover-body').prepend(heading);
  }
  for(const [target,label] of [['save','保存图片'],['share-scene','分享这份甜']]){const action=document.createElement('button');action.className='text-button board-export';action.type='button';action.dataset.action=target;setText(action,()=>label);action.onclick=()=>{$('board-menu').open=false;$(target).click();};$('board-menu').querySelector('.popover-body').append(action);}
  setText($('save-work-title'),()=>'给这幅糖画起个名');
  const quick=document.querySelector('.scene-quick-controls');quick.insertBefore($('drawing-settings'),$('scene-finish'));quick.insertBefore($('board-menu'),$('scene-finish'));
  const cta=document.createElement('div');cta.className='watch-cta';document.querySelector('.scene-panel').append(cta);cta.append($('beginner'),$('finish'));
  const completionTitle=document.createElement('h2');completionTitle.className='completion-title';setText(completionTitle,()=>'这幅糖画，做好了');$('finish-actions').prepend(completionTitle);
  const imageWork=document.createElement('button');imageWork.id='image-work';imageWork.type='button';setText(imageWork,()=>'保存图片');imageWork.onclick=()=>$('save').click();$('finish-actions').append(imageWork);
  watchTools=document.querySelector('.playback');
  const pauseLabel=document.createElement('span');pauseLabel.className='pause-label';pauseLabel.id='pause-label';watchTools.insertBefore(pauseLabel,watchTools.children[1]);
  const speed=document.createElement('select');speed.className='watch-speed';speed.setAttribute('aria-label',t('浇糖速度'));speed.innerHTML='<option value="0.65">0.65×</option><option value="1" selected>1×</option><option value="1.8">1.8×</option>';speed.onchange=()=>{$('speed').value=speed.value;$('speed').dispatchEvent(new Event('change'));};watchTools.append(speed);
  const replay=document.createElement('button');replay.className='watch-replay';replay.type='button';setText(replay,()=>'重播');replay.onclick=()=>$(document.body.dataset.presentation==='replay'?'replay-work':'play').click();watchTools.append(replay);
  const speedChoices=document.createElement('div');speedChoices.className='speed-choices';speedChoices.setAttribute('role','group');speedChoices.setAttribute('aria-label',t('浇糖速度'));
  for(const [value,label] of [['0.65','慢慢来'],['1','刚刚好'],['1.8','快一点']]){const button=document.createElement('button');button.type='button';button.dataset.speed=value;setText(button,()=>label);button.onclick=()=>{$('speed').value=value;$('speed').dispatchEvent(new Event('change'));};speedChoices.append(button);}
  $('speed').hidden=true;$('speed').parentElement.append(speedChoices);
  for(const [id,label,action] of [['edit-inspected','继续修改',editWork],['delete-inspected','删除作品',deleteWork]]){const button=document.createElement('button');button.id=id;button.type='button';setText(button,()=>label);button.onclick=action;$('work-process').append(button);}
  const note=document.createElement('span');note.className='watch-invitation';setText(note,()=>'看一遍，再亲手试试');watchTools.append(note);
  const empty=document.createElement('div');empty.className='rack-empty-message';empty.id='rack-empty-message';empty.hidden=true;const title=document.createElement('h2');setText(title,()=>'这里还没有糖画');const p=document.createElement('p');setText(p,()=>'亲手做一幅，挂在这里吧');const start=document.createElement('button');start.className='primary-button';setText(start,()=>'去画第一幅');start.onclick=()=>$('resume-drawing').click();empty.append(title,p,start);document.querySelector('.scene-panel').append(empty);
  const exit=document.createElement('button');exit.type='button';exit.className='focus-exit';setText(exit,()=>'退出专注模式');exit.onclick=()=>$('focus-view').click();document.querySelector('.scene-panel').append(exit);
  const more=document.createElement('button');more.type='button';more.className='ticket-more';setText(more,()=>'选图案');more.onclick=()=>{$('pattern-picker').open=!$('pattern-picker').open;};rail.append(more);
  setText($('template-mode'),()=>'照着画');setText($('scene-finish'),()=>'拿起来看看');
  ready=true;localize();
}
export function syncFolkUI(state,presentation,gallery) {
  if(!ready)return;document.body.dataset.mode=state.mode;document.body.dataset.presentation=presentation||'';
  const selected=state.mode==='template'?state.templatePattern:state.pattern;
  rail.hidden=state.mode==='draw'||!!presentation;
  for(const button of rail.querySelectorAll('.pattern-ticket')){const i=Number(button.dataset.pattern);button.hidden=i>2;button.setAttribute('aria-pressed',String(i===selected));}
  setText(watchTools.querySelector('.pause-label'),()=>!state.playing?'已完成':state.paused?'继续浇糖':'暂停');
  const speed=watchTools.querySelector('.watch-speed');speed.value=String(state.speed);
  for(const button of document.querySelectorAll('.speed-choices button'))button.setAttribute('aria-pressed',String(Number(button.dataset.speed)===state.speed));
  for(const id of ['edit-inspected','delete-inspected'])document.getElementById(id).hidden=presentation!=='inspect';
  document.getElementById('rack-empty-message').hidden=presentation!=='rack'||gallery.length>0;
  for(const button of document.querySelectorAll('.board-export'))button.disabled=!state.hasArtwork;
}
export function confirmDelete(name) {
  const dialog=document.getElementById('delete-work-dialog');setText(document.getElementById('delete-work-name'),()=>name);dialog.returnValue='cancel';
  return new Promise(resolve=>{dialog.addEventListener('close',()=>resolve(dialog.returnValue==='delete'),{once:true});dialog.showModal();});
}
