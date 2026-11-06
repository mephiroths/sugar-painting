import {setText,setLabel} from './i18n.js';

const $=id=>document.getElementById(id);
let ready=false;
export function restoreSettingsFocus(opener) {
  let target=opener;
  for(let parent=opener?.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS'&&!parent.open)target=parent.querySelector(':scope > summary');
  target?.focus({preventScroll:true});
}
export function installStudioSettings() {
  const menu=$('view-menu'),summary=menu.querySelector(':scope > summary'),panel=menu.querySelector(':scope > .popover-body');
  menu.classList.add('settings-menu');menu.id='view-menu';summary.id='settings-trigger';
  summary.replaceChildren();setText(summary,'设置');
  panel.className='popover-body settings-panel';panel.removeAttribute('aria-label');
  const header=document.createElement('div');header.className='settings-heading';
  const title=document.createElement('h2');title.id='settings-title';setText(title,'设置');
  const close=document.createElement('button');close.type='button';close.id='settings-close';close.className='icon-button';close.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19"/></svg>';setLabel(close,'aria-label','关闭设置');
  close.onclick=()=>{menu.open=false;summary.focus();};header.append(title,close);
  const sound=document.createElement('section');sound.className='settings-sound';
  sound.append($('music-toggle'));
  const view=document.createElement('details');view.id='settings-view';view.className='settings-disclosure';
  const viewTitle=document.createElement('summary');setText(viewTitle,'画面');
  const viewBody=document.createElement('div');viewBody.className='settings-content settings-views';
  viewBody.append($('angle-view'),$('top-view'),$('pour-view'),$('detail-view'),$('focus-view'),document.querySelector('.speed-row'));
  const focusLabel=document.createElement('span');setText(focusLabel,'专注模式');viewBody.querySelector('#focus-view').append(focusLabel);
  view.append(viewTitle,viewBody);
  const drawing=$('drawing-settings'),board=$('board-menu');
  for(const [group,name] of [[drawing,'绘画调节'],[board,'作品操作']]){
    group.className='settings-disclosure';group.open=false;setText(group.querySelector('summary'),name);
    group.querySelector('.paper-panel-heading')?.remove();group.querySelector('.popover-body').classList.add('settings-content');
  }
  drawing.querySelector('.settings').append($('navigate-drawing'));
  board.querySelector('.popover-body').append($('finish'),$('save'),$('share-scene'));
  // Undo/redo already have direct buttons on the board; keep one visible pair.
  for(const id of ['undo','redo'])$(id).hidden=true;
  const credit=document.querySelector('.music-credit');credit.classList.add('settings-credit');
  panel.replaceChildren(header,sound,drawing,view,board,credit);
  document.querySelector('.mast-actions').append(menu);
  ready=true;
}
export function syncStudioSettings(state,presentation) {
  if(!ready)return;
  document.body.dataset.playing=String(state.playing);
  const editing=state.mode!=='watch'&&!presentation;
  document.querySelector('.scene-quick-controls').hidden=!editing||state.playing;
  $('playback-exit').hidden=!editing||!state.playing;
  $('drawing-settings').hidden=!!presentation;
  $('board-menu').hidden=!!presentation;
  // Playback and drawing tools must never occupy the same footer.
  document.querySelector('.pattern-rail').hidden=true;
}
