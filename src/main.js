import {createMountedSugar,holdSugar,sugarRotationAxis,fitDistance,createDisplayRack,createInspectionCopy,rackMatchesEntries,disposeDisplay} from './sugar-display.js';
import { t, getLocale, localize, setText, setLabel, releaseTranslations } from './i18n.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { patterns } from './patterns.js';
import { SugarLayer } from './sugar-layer.js';
import { SugarPour } from './pour.js';
import { positionPouringSpoon } from './spoon-pose.js';
import { createPouringSpoon } from './spoon.js';
import {loadPatternLibrary,renderPatternLibrary,wirePatternImport,importedDefinition,saveImportedPattern} from './pattern-library.js';
import {hydrateImportedPattern} from './pattern-import.js';
import { TemplateGuide } from './template-guide.js';
import { guideCoverage } from './guide-progress.js';
import { readDraft, writeDraft, readGallery, updateGallery } from './draft-store.js';
import { captureSurface, applySurface, encodeSurface, decodeSurface } from './surface-record.js';
import { PortraitVideo } from './portrait-video.js';
import { createWorkId } from './work-id.js';
import { mergeGalleryBackup } from './gallery-merge.js';
import { createDraftPreview } from './draft-preview.js';
import { StudioMusic } from './music.js';
import { createSharing } from './share.js';
import {installFolkUI,syncFolkUI,uiAssets,confirmDelete} from './folk-ui.js';
import {restoreSettingsFocus} from './studio-settings.js';

const $ = (id) => document.getElementById(id);
localize();
const container = $('scene');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = {mode:'watch', pattern:0, templatePattern:0, templateVisible:true, templateStrokes:{}, strokes:[], progress:1, playing:false, paused:false, speed:1, thickness:.04, drawing:false, draining:false, drawPoints:[], draft:null, needsRender:true, view:'pour', hasArtwork:true, contextLost:false, navigating:false};
let renderer, scene, camera, controls, sugar, spoon, spoonLip, stick, sugarMaterial, environment, sugarLayer, pour, templateGuide;
let toastTimer, lastTime = 0, cameraMove = null, pouringPoint = new THREE.Vector3();
let totalLength = 1, strokeData = [], strokeCursor = 0;
let timeline=[],playTime=0,playDuration=1,liveDeposits=[],drawCommands=[],drawStart=0,drawStop=0;
const histories = {};
let saveTimer, saveChain=Promise.resolve(), saveRevision=0, replayRecorded=false;
const dirtyWorkspaces=new Map(),draftForks=new Set(),draftCopyIds={};let draftRevisions={},draftEditSequence=0;
const workspaceEdits=new Map(),savedWorkspaceEdits=new Map();
let gallery=[];
let rackExamples=null,rackCollection='examples';
try {if(localStorage.getItem('sugar-painting-rack-collection')==='personal')rackCollection='personal';}catch { /* Optional viewing preference. */ }
let galleryQueue=Promise.resolve();
let galleryBusy=0,galleryFeedbackSequence=0,galleryFocus=null;
let pendingWork=null,workSaving=false,workSavePaused=false,workSaveFocus=null;
let videoCapture=null,videoUrl=null,videoStarting=false;
let finishedSugar=null,finishedSize=null,finishStarted=0;
let presentationMode=null,rackRoot=null,inspectedSugar=null,rackPage=0,selectedDisplayId=null,pinnedWorkId=null,pinBusy=false;
let completedWorkspaceCleared=false;
let workbenchObjects=[],hiddenWorkbench=null,rackRequest=0,workbenchTable,displayGround;
let replaySurface=null;
let savedReplay=null,replayRequest=0;
let tutorialStep=0;
let guideStep=0;
let guideFinished=false;
let guideEvaluation=null;
let drawingPointer=null,drawingTime=0;
let workspaceSurfaces={},strokeStartSurface=null,coolingPending=null,historySequence=0;
const folkTextures={};
const music=new StudioMusic(renderMusicControl);
const sharing=createSharing(()=>{
  if(state.contextLost||videoCapture||videoStarting||(!state.hasArtwork&&!presentationMode))return null;
  if(state.drawing||state.draining)finishStroke(true);
  const work=findDisplayedWork(selectedDisplayId);
  const pattern=patterns[work?.pattern??(state.mode==='template'?state.templatePattern:state.pattern)];
  const mode=work?.mode??state.mode;
  return {snapshot:captureShareArtwork(),name:(work?.builtin?t(work.name):work?.name)??t(mode==='draw'?'我的糖画':pattern.name),mode,pattern:pattern.imported?null:pattern.id,demonstration:work?.demonstration??mode==='watch'};
},()=>notify('海报生成失败，请重试。原作品仍保留。'),()=>{state.needsRender=true;if(renderer&&!state.contextLost)renderer.render(scene,camera);});
const raycaster = new THREE.Raycaster();
const drawingPlane = new THREE.Plane(new THREE.Vector3(0,1,0),-.09);
const cursor = new THREE.Vector2();
const v = (x,y,z) => new THREE.Vector3(x,y,z);

function notify(message) {
  if($('gallery').open){galleryMessage(message);return;}
  setText($('toast'),()=>message); $('toast').classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(()=>$('toast').classList.remove('visible'),2600);
}
function closeToolPopovers() {for(const menu of document.querySelectorAll('.tool-popover[open]'))menu.open=false;}
function renderMusicControl() {
  const button=$('music-toggle');if(!button)return;
  button.setAttribute('aria-pressed',String(music.enabled));button.dataset.enabled=String(music.enabled);
  button.disabled=!music.supported||!!videoCapture||videoStarting;
  setText(button.querySelector('span'),()=>!music.supported?'配乐不可用':music.failed?'配乐未加载':music.enabled?'配乐：开':'配乐：关');
  setLabel(button,'aria-label',()=>music.enabled?'关闭配乐':'开启配乐');
  setLabel(button,'title',()=>!music.supported?'浏览器不支持配乐':videoCapture||videoStarting?'视频生成期间保持当前配乐设置':music.failed?'配乐未能加载，可关闭后重新开启':!music.unlocked?'开始制作后播放配乐':music.enabled?'关闭配乐':'开启配乐');
}
function syncMusic() {music.setActive(!document.hidden&&!state.contextLost&&(!presentationMode||presentationMode==='replay')&&(!state.playing||!state.paused)&&(state.mode!=='watch'||state.playing)&&(presentationMode!=='replay'||state.playing));}
function setTutorial(step) {
  tutorialStep=step;$('tutorial').hidden=step===0;
  document.querySelector('.workbench').dataset.tutorial=String(step>0);
  if(!step){if($('tutorial-continue'))$('tutorial-continue').hidden=true;return;}
  const text=['','从圆圈起笔，按住沿深色线慢慢画。','按住不放，沿着印记慢慢移动。','松开，等空中的余糖落完。','第一笔落好了，继续沿印记描画。随时可以拿起来看看，再返回修改。'];
  setText($('tutorial-title'),()=>step===4?'第一笔完成':t('练习 {step} / 3',{step}));
  setText($('tutorial-text'),()=>text[step]);$('tutorial-finish').hidden=step!==4;
  if($('tutorial-continue'))$('tutorial-continue').hidden=step!==4;
}

function workspaceKey() { return state.mode==='template'?`template:${state.templatePattern}`:'draw'; }
function history() { return histories[workspaceKey()] ||= {undo:[],redo:[]}; }
function serializeStroke(points) {
  return {points:points.map(p=>[p.x,p.z]),deposits:points.deposits||[],duration:points.duration||0,commands:points.commands||[],amount:points.amount,height:points.height};
}
function deserializeStroke(record) {
  const point=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p.every(n=>Math.abs(n)<10);
  const validTime=t=>Number.isFinite(t)&&t>=0&&t<=3600;
  const parameter=(value,max)=>value==null||(Number.isFinite(value)&&value>0&&value<=max);
  if(!record || !Array.isArray(record.points) || record.points.length<2 || !record.points.every(point) || !Array.isArray(record.deposits) || !record.deposits.every(d=>d&&point(d.a)&&point(d.b)&&Number.isFinite(d.volume)&&d.volume>=0&&Number.isFinite(d.radius)&&d.radius>0&&d.radius<1&&(d.t==null||validTime(d.t))) || (record.duration!=null&&!validTime(record.duration)) || (record.commands!=null&&(!Array.isArray(record.commands)||!record.commands.every(c=>c&&validTime(c.t)&&point(c.point)&&(c.flow==null||typeof c.flow==='boolean')&&parameter(c.amount,.1)&&parameter(c.height,4)))) || (record.amount!=null&&(!Number.isFinite(record.amount)||record.amount<=0||record.amount>.1)) || (record.height!=null&&(!Number.isFinite(record.height)||record.height<=0||record.height>4))) throw new Error('草稿格式不正确');
  const points=record.points.map(p=>v(p[0],.105,p[1]));
  Object.assign(points,{deposits:record.deposits,duration:record.duration,commands:record.commands,amount:record.amount,height:record.height});
  return points;
}
function draftSnapshot() {
  saveDrawingWorkspace();
  return {version:1,updatedAt:Date.now(),own:(state.ownStrokes||[]).map(serializeStroke),templates:Object.fromEntries(Object.entries(state.templateStrokes).map(([key,strokes])=>[key,strokes.map(serializeStroke)])),surfaces:Object.fromEntries(Object.entries(workspaceSurfaces).map(([key,surface])=>[key,encodeSurface(surface)]))};
}
function currentSurface() {if(state.drawing||state.draining)return strokeStartSurface;return captureSurface(state.playing&&replaySurface?replaySurface:sugarLayer,sugarLayer.nx,sugarLayer.nz);}
function restoreWorkspaceSurface() {applySurface(sugarLayer,workspaceSurfaces[workspaceKey()]);state.needsRender=true;}
function setDraftStatus(message,failed=false) {
  setText($('draft-status'),()=>message);$('retry-save').hidden=!failed;
  document.querySelector('.autosave-note').hidden=!failed&&!message.includes('另一页面');
}
function scheduleSave(key=state.mode==='watch'?null:workspaceKey(),userEdit=true) {
  if(!key)return;
  dirtyWorkspaces.set(key,++draftEditSequence);
  if(userEdit)workspaceEdits.set(key,draftEditSequence);
  clearTimeout(saveTimer);
  saveRevision++;
  setDraftStatus('正在保存草稿…');
  saveTimer=setTimeout(flushSave,350);
}
function flushSave() {
  if(savedReplay)return saveChain;
  clearTimeout(saveTimer);saveTimer=null;
  const revision=++saveRevision;
  if(state.mode!=='watch'&&coolingPending===workspaceKey())dirtyWorkspaces.set(workspaceKey(),++draftEditSequence);
  setDraftStatus('正在保存草稿…');
  const savedStatus=()=>setDraftStatus(state.mode!=='watch'&&draftForks.has(workspaceKey())?'本页草稿已保存为糖画架副本':'作品已保存在本机');
  if(!dirtyWorkspaces.size)return saveChain.then(saved=>{if(revision===saveRevision){if(saved===false)setDraftStatus('草稿保存失败，请检查浏览器存储空间',true);else savedStatus();}return saved!==false;});
  let draft,pending,pendingEdits,copies;
  try {
    draft=draftSnapshot();pending=new Map(dirtyWorkspaces);pendingEdits=new Map([...pending.keys()].map(key=>[key,workspaceEdits.get(key)||0]));copies={};
    for(const key of pending.keys()){
      const pattern=key==='draw'?null:Number(key.slice(9)),surface=workspaceSurfaces[key];
      copies[key]={id:draftCopyIds[key]||=(createWorkId()),name:t(pattern===null?'自由糖画':patterns[pattern].name)+t('（页面副本）'),createdAt:Date.now(),image:()=>createDraftPreview(surface,sugarLayer),patternDefinition:pattern===null?undefined:importedDefinition(pattern)};
    }
  }
  catch {setDraftStatus('草稿保存失败，请检查浏览器存储空间',true);return Promise.resolve(false);}
  saveChain=saveChain.catch(()=>{}).then(()=>writeDraft(draft,{keys:[...pending.keys()],expected:{...draftRevisions},forks:[...draftForks],autoKeys:[...pending.keys()].filter(key=>pendingEdits.get(key)<=(savedWorkspaceEdits.get(key)||0)),copies})).then(result=>{
    Object.assign(draftRevisions,result.revisions);
    const newCopy=result.forked.some(key=>!draftForks.has(key));for(const key of result.forked)draftForks.add(key);
    for(const [key,generation]of pending)if(dirtyWorkspaces.get(key)===generation)dirtyWorkspaces.delete(key);
    for(const [key,generation]of pendingEdits)savedWorkspaceEdits.set(key,Math.max(savedWorkspaceEdits.get(key)||0,generation));
    if(result.gallery){gallery=result.gallery;updateCopyAccess();if($('gallery').open)renderGallery();}
    if(newCopy)notify('另一页面也修改了这幅画，本页内容已保留为糖画架副本。');
    if(revision===saveRevision){if(state.mode!=='watch'&&result.ignored.includes(workspaceKey()))setDraftStatus('另一页面已更新草稿，继续绘画将另存副本');else savedStatus();}return true;
  },()=>{for(const [key,generation]of pending)if(!dirtyWorkspaces.has(key))dirtyWorkspaces.set(key,generation);if(revision===saveRevision)setDraftStatus('草稿保存失败，请检查浏览器存储空间',true);return false;});
  return saveChain;
}
function updateCopyAccess() {$('draft-copy-open').hidden=!gallery.some(item=>item.source==='draft-conflict');}
function historyEntry(strokes,surface) {return {strokes,surface,sequence:++historySequence};}
function trimHistory() {
  const entries=Object.values(histories).flatMap(h=>[...h.undo,...h.redo]);
  let bytes=entries.reduce((sum,e)=>sum+(e.surface?e.surface.field.byteLength+e.surface.heat.byteLength:0),0);
  while(bytes>32*1024*1024&&entries.length>1){
    entries.sort((a,b)=>a.sequence-b.sequence);const oldest=entries.shift();
    for(const h of Object.values(histories))for(const stack of [h.undo,h.redo]){const index=stack.indexOf(oldest);if(index>=0)stack.splice(index,1);}
    if(oldest.surface)bytes-=oldest.surface.field.byteLength+oldest.surface.heat.byteLength;
  }
}
function recordEdit(before,surface=currentSurface()) {
  const h=history();h.undo.push(historyEntry(before,surface));if(h.undo.length>50)h.undo.shift();h.redo=[];trimHistory();
}
function restoreHistory(from,to) {
  if(state.drawing||state.draining)finishStroke(true);
  const h=history();if(!h[from].length)return;
  h[to].push(historyEntry(state.strokes.slice(),currentSurface()));const entry=h[from].pop();state.strokes=entry.strokes;renderArtwork();applySurface(sugarLayer,entry.surface);trimHistory();scheduleSave();
}
function cancelVideo(message) {
  const capture=videoCapture;if(!capture)return;
  videoCapture=null;clearTimeout(capture.finishTimer);capture.cancelled=true;
  capture.portrait?.dispose();
  capture.audio?.dispose();
  if(capture.recorder.state!=='inactive')capture.recorder.stop();
  capture.stream.getTracks().forEach(track=>track.stop());
  templateGuide.setVisible(!presentationMode&&state.mode==='template'&&state.templateVisible);state.needsRender=true;updateButtons();
  if(message)notify(message);
}
async function beginVideo() {
  if(videoStarting)return;
  if(videoCapture){cancelVideo('已取消录制。');return;}
  if(!selectedDisplayId)return;
  if(!window.MediaRecorder||!renderer.domElement.captureStream){notify('当前浏览器不支持视频录制，可先保存图片。');return;}
  // Firefox rejects an audio track when a WebM MIME only names a video codec.
  // An explicit Opus codec supports both music-on and silent exports.
  const type=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
  if(!type){notify('当前浏览器没有可用的视频编码器，可先保存图片。');return;}
  if(videoUrl){URL.revokeObjectURL(videoUrl);videoUrl=null;}$('download-video').hidden=true;
  let stream,portrait=null,audio=null;
  videoStarting=true;updateButtons();
  try {
    const withMusic=await music.prepareRecording();
    if(!await replaySavedWork())return;
    syncMusic();
    templateGuide.setVisible(false);
    if($('record-format').value==='portrait')portrait=new PortraitVideo(renderer,scene,findDisplayedWork(selectedDisplayId)?.name||t('我的糖画'));
    portrait?.render();renderer.render(scene,camera);
    stream=(portrait?.canvas||renderer.domElement).captureStream(30);if(withMusic){audio=music.startRecording();if(audio)stream.addTrack(audio.track);}
    const recorder=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:5000000});
    const capture={stream,recorder,portrait,audio,chunks:[],cancelled:false,finishTimer:null};videoCapture=capture;
    recorder.ondataavailable=event=>{if(event.data.size)capture.chunks.push(event.data);};
    recorder.onerror=()=>{if(videoCapture===capture)cancelVideo('视频录制失败，请重试。');};
    recorder.onstop=()=>{
      capture.stream.getTracks().forEach(track=>track.stop());
      if(capture.cancelled)return;
      capture.portrait?.dispose();
      capture.audio?.dispose();
      if(videoCapture===capture)videoCapture=null;
      templateGuide.setVisible(false);state.needsRender=true;
      const blob=new Blob(capture.chunks,{type:recorder.mimeType});
      if(blob.size){videoUrl=URL.createObjectURL(blob);const link=$('download-video');link.href=videoUrl;link.download=`${t('糖画铺-浇糖过程')}.${recorder.mimeType.startsWith('video/mp4')?'mp4':'webm'}`;link.hidden=false;$('video-menu').open=true;requestAnimationFrame(()=>{if(!link.hidden&&presentationMode==='replay')link.scrollIntoView({block:'nearest',inline:'nearest'});});notify('录制完成，可以下载视频。');}
      else notify('视频没有录制成功，请重试。');
      updateButtons();
    };
    recorder.start();updateButtons();notify('正在录制浇糖过程。');
  } catch(error) {if(videoCapture)cancelVideo();else {portrait?.dispose();audio?.dispose();stream?.getTracks().forEach(track=>track.stop());templateGuide.setVisible(!presentationMode&&state.mode==='template'&&state.templateVisible);state.needsRender=true;}console.warn('视频录制失败',error);notify('视频录制失败，请检查浏览器支持。');}
  finally{videoStarting=false;updateButtons();}
}
function finishVideo() {
  const capture=videoCapture;if(!capture||capture.finishTimer)return;
  capture.finishTimer=setTimeout(()=>{if(videoCapture===capture&&capture.recorder.state!=='inactive')capture.recorder.stop();},500);
}
function syncPresentationGround() {
  // A handheld painting has no nearby surface on which to cast a floor shadow.
  // The display rack does: put its receiver directly beneath the actual feet.
  displayGround.visible=presentationMode==='rack'&&!workbenchTable.visible&&!!rackRoot?.visible;
  if(displayGround.visible){
    const baseY=new THREE.Box3().setFromObject(rackRoot).min.y;
    displayGround.position.y=baseY-.005;rackRoot.userData.groundBaseY=baseY;
  }
}
function setWorkbenchVisible(visible) {
  if(!visible&&!hiddenWorkbench){scene.background=folkTextures.presentationBackground;workbenchTable.visible=false;hiddenWorkbench=workbenchObjects.map(object=>[object,object.visible]);for(const [object]of hiddenWorkbench)object.visible=false;}
  else if(visible&&hiddenWorkbench){scene.background=new THREE.Color('#40352b');workbenchTable.visible=true;for(const [object,wasVisible]of hiddenWorkbench)object.visible=wasVisible;hiddenWorkbench=null;}
  syncPresentationGround();
}
function presentationUI() {
  syncFolkUI(state,presentationMode,gallery,!!findDisplayedWork(selectedDisplayId)?.builtin);
  const panel=document.querySelector('.scene-panel'),workbench=document.querySelector('.workbench');
  if(presentationMode){panel.dataset.presentation=presentationMode;workbench.dataset.presentation=presentationMode;}else{delete panel.dataset.presentation;delete workbench.dataset.presentation;}
  document.querySelector('.studio-panel').inert=!!presentationMode;
  $('finish-actions').hidden=!['held','inspect'].includes(presentationMode);$('pin-current').hidden=presentationMode!=='held';$('pin-current').disabled=pinBusy;
  $('finish-note').hidden=presentationMode!=='held';
  setText($('finish-note'),()=>state.mode==='watch'?'这是师傅的示范，保存后可在糖画架欣赏。':'还可以返回修改。确认保存后才会清空本幅画板。');
  setText($('pin-current'),()=>'保存并去糖画架');
  const moreActions=$('work-more').querySelector('.popover-body');
  const returnParent=presentationMode==='inspect'?moreActions:presentationMode==='held'?$('finish-actions'):document.querySelector('.scene-panel');
  if($('resume-drawing').parentElement!==returnParent)returnParent.append($('resume-drawing'));
  $('resume-drawing').disabled=pinBusy;
  $('share-work').disabled=pinBusy||state.contextLost||!!videoCapture||videoStarting;
  $('next-painting').hidden=presentationMode!=='held';$('next-painting').disabled=pinBusy;
  $('rack-back').hidden=presentationMode!=='inspect';$('rack-navigation').hidden=presentationMode!=='rack';
  $('rack-tools').hidden=presentationMode!=='rack';
  const reviewing=presentationMode==='inspect'||presentationMode==='replay',work=findDisplayedWork(selectedDisplayId),canReplay=!!work?.strokes?.length;
  setText($('edit-inspected'),()=>work?.builtin?'照着画这一幅':work?.demonstration?'打开作品':'继续修改');
  $('work-process').hidden=!reviewing;
  const videoParent=presentationMode==='replay'?$('work-process'):moreActions;
  if($('video-menu').parentElement!==videoParent)videoParent.append($('video-menu'));
  if(presentationMode==='replay'&&(videoStarting||videoCapture))$('video-menu').open=true;
  for(const id of ['share-work','image-work']){
    const parent=presentationMode==='inspect'?(id==='image-work'?$('work-more').querySelector('.popover-body'):$('work-process')):$('finish-actions');
    if($(id).parentElement!==parent){if(presentationMode==='inspect'&&id==='image-work')parent.insertBefore($(id),$('video-menu'));else parent.append($(id));}
  }
  if(presentationMode==='inspect'&&$('work-process').firstElementChild!==$('share-work')){
    $('work-process').prepend($('share-work'),$('replay-work'));$('work-process').append($('work-more'),$('process-status'));
  }
  if(presentationMode==='inspect')moreActions.append($('edit-inspected'),$('image-work'),$('video-menu'),$('resume-drawing'),$('delete-inspected'));
  $('replay-work').hidden=presentationMode==='replay';$('replay-back').hidden=presentationMode!=='replay';
  $('replay-work').disabled=!canReplay;$('record-video').disabled=!canReplay;
  setText($('process-status'),()=>canReplay?'制作过程已随作品保存':'这幅作品没有制作记录');
  syncPresentationGround();
  $('resume-drawing').hidden=!presentationMode;
  setText($('resume-drawing'),()=>completedWorkspaceCleared?'画下一幅':presentationMode==='held'?'返回修改':'返回工作台');
  setText($('angle-view'),()=>presentationMode&&presentationMode!=='replay'?'正面看':'斜着看');
  setText($('top-view'),()=>presentationMode&&presentationMode!=='replay'?'看背面':'俯着看');
  setText($('pour-view'),()=>presentationMode&&presentationMode!=='replay'?'拿在手里':'看浇糖');
  setLabel($('scene'),'aria-label',()=>presentationMode==='replay'?'制作过程回放。拖动旋转，滚轮或双指缩放，空格暂停。':presentationMode==='rack'?'糖画展示架。点击一幅作品拿近观察，也可使用下面的作品按钮。':presentationMode?'手持糖画。拖动转动作品，滚轮或双指缩放，查看正面与背面。':state.mode==='watch'?'三维糖画。拖动旋转，滚轮或双指缩放。方向键旋转，空格暂停浇糖。':'三维糖画工作台。按住石板浇糖，松开收丝。点击移动画布调整位置和缩放。');
}
function activePresentation() {return presentationMode==='rack'?rackRoot:presentationMode==='inspect'?inspectedSugar:finishedSugar;}
function turntableView() {return presentationMode==='held'||presentationMode==='inspect';}
function presentationSpine() {
  if(!turntableView())return null;const axis=sugarRotationAxis(activePresentation());if(!axis)return null;
  camera.updateMatrixWorld();return {pivot:axis.pivot.toArray(),ends:[axis.a.clone().project(camera).toArray(),axis.b.clone().project(camera).toArray()]};
}
function presentationFrame() {
  const object=activePresentation();if(!object)return null;
  const box=new THREE.Box3().setFromObject(object),points=[];camera.updateMatrixWorld();
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(v(x,y,z).project(camera));
  return {left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.max(...points.map(p=>p.y)),bottom:Math.min(...points.map(p=>p.y))};
}
function fitPresentation(type='angle',instant=false) {
  const object=activePresentation();if(!object)return;
  const heldPosition=object.position.clone(),heldRotation=object.quaternion.clone();if(presentationMode==='held')holdSugar(object);
  const bounds=new THREE.Box3().setFromObject(object),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());finishedSize=size;
  const turntable=turntableView(),axis=turntable?sugarRotationAxis(object,bounds):null;
  if(axis)center.copy(axis.pivot);
  if(presentationMode==='held'){object.position.copy(heldPosition);object.quaternion.copy(heldRotation);object.updateMatrixWorld(true);}
  const rect=container.getBoundingClientRect(),height=container.clientHeight,aspect=container.clientWidth/height;
  const sidePanel=aspect>1.1&&['held','inspect'].includes(presentationMode);
  const topTools=[document.querySelector('.scene-caption'),document.querySelector('.view-tools'),$('rack-tools'),$('rack-back')];
  if(presentationMode!=='inspect')topTools.push($('work-process'));
  const top=sidePanel?80:Math.min(height*.36,Math.max(...topTools.filter(node=>node.getClientRects().length).map(node=>node.getBoundingClientRect().bottom-rect.top))+16);
  const footer=presentationMode==='rack'?$('rack-navigation'):presentationMode==='inspect'?$('work-process'):$('finish-actions'),bottom=sidePanel?40:rect.bottom-footer.getBoundingClientRect().top+16;
  const usable=Math.max(.3,(height-top-bottom)/height),tan=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
  const spanX=turntable?2*Math.max(Math.abs(bounds.min.x-center.x),Math.abs(bounds.max.x-center.x)):size.x;
  const distance=type==='detail'?fitDistance(v(spanX,size.y,size.z),aspect,camera.fov,.95):Math.max(2.5,Math.max(size.y/(2*tan*usable*.92),spanX/(2*tan*aspect*(sidePanel?.59:.85)))+size.z*.5);
  if(turntable){
    // Reframe with the projection, keeping the orbit target on the spine.
    camera.setViewOffset(container.clientWidth,height,sidePanel?container.clientWidth*.115:0,(bottom-top)/2,container.clientWidth,height);
  } else {
    camera.clearViewOffset();
    center.y+=(top+(height-top-bottom)/2-height/2)/height*2*distance*tan;
  }
  const direction=turntable?(type==='top'?v(0,0,-1):v(0,0,1)):v(.13,.14,1);
  const position=center.clone().add(direction.normalize().multiplyScalar(distance));
  controls.minDistance=Math.max(1.5,size.y*.12);controls.maxDistance=Math.max(60,distance*2);controls.minPolarAngle=turntable?Math.PI/2:.04;controls.maxPolarAngle=turntable?Math.PI/2:Math.PI-.04;
  state.view=type;
  for(const [id,key]of [['angle-view','angle'],['top-view','top'],['pour-view','pour'],['detail-view','detail']])$(id).setAttribute('aria-pressed',String(type===key));
  if(instant||reducedMotion){cameraMove=null;camera.position.copy(position);controls.target.copy(center);controls.update();}
  else {if(turntable)controls.target.copy(center);cameraMove={from:camera.position.clone(),to:position,start:performance.now(),target:controls.target.clone(),targetTo:center};}
  state.needsRender=true;
}
function exitFinish() {
  stopSavedReplay();
  if(!finishedSugar&&!presentationMode)return;
  rackRequest++;disposeDisplay(finishedSugar);disposeDisplay(rackRoot);disposeDisplay(inspectedSugar);
  finishedSugar=null;rackRoot=null;inspectedSugar=null;finishedSize=null;presentationMode=null;selectedDisplayId=null;pinnedWorkId=null;completedWorkspaceCleared=false;
  camera.clearViewOffset();
  setWorkbenchVisible(true);sugarLayer.mesh.visible=true;sugarLayer.uniforms.sugarContactEnabled.value=1;
  controls.minPolarAngle=.01;controls.maxPolarAngle=Math.PI*.44;controls.maxDistance=40;
  templateGuide.setVisible(state.mode==='template'&&state.templateVisible);syncDrawingControls();presentationUI();
  setText($('finish'),()=>'完成并欣赏');document.querySelector('.scene-panel').dataset.finished='false';
  setText($('scene-title'),()=>state.mode==='template'?t('描一幅{name}',{name:t(patterns[state.templatePattern].name)}):state.mode==='watch'?patterns[state.pattern].name:'一勺糖，慢慢落');
  setText($('scene-description'),()=>state.mode==='template'?'沿着淡色印记，慢慢落糖。':state.mode==='watch'?patterns[state.pattern].description:'按住浇糖，松开收丝。');
  setText($('hint').lastChild,()=>state.mode==='template'?'沿着印记浇糖，松开收丝':'按住石板画一笔，松开收笔');state.needsRender=true;updateButtons();
}
function resumeDrawing() {exitFinish();container.style.cursor=state.mode==='watch'?'grab':'crosshair';moveView(state.mode==='watch'?'pour':'angle');container.focus({preventScroll:true});}
function showFinished() {
  if(presentationMode){resumeDrawing();return;}
  if(state.drawing||state.draining)finishStroke(true);if(!state.strokes.length||state.contextLost)return;
  if(state.mode==='watch'&&state.playing)renderArtwork();
  state.navigating=false;if(tutorialStep)setTutorial(0);
  if(state.mode!=='watch'&&coolingPending===workspaceKey()){coolingPending=null;scheduleSave(workspaceKey(),false);}
  if(videoCapture)cancelVideo('开始欣赏糖画，视频录制已取消。');
  const original=currentSurface();state.playing=false;state.paused=false;state.progress=1;replaySurface=null;
  pour.reset(pour.source);spoon.visible=false;disposeGroup(sugar);disposeGroup(stick);applySurface(sugarLayer,original);updateProgress();
  finishedSugar=createMountedSugar(sugarLayer);if(!finishedSugar){updateButtons();notify('糖画还太薄，再添几笔试试。');return;}
  scene.add(finishedSugar);presentationMode='held';pinnedWorkId=null;completedWorkspaceCleared=false;
  sugarLayer.mesh.visible=false;sugarLayer.uniforms.sugarContactEnabled.value=0;templateGuide.setVisible(false);
  holdSugar(finishedSugar);syncDrawingControls();presentationUI();container.style.cursor='grab';
  document.querySelector('.scene-panel').dataset.finished='true';setText($('finish'),()=>'返回修改');
  setText($('scene-description'),()=>'竹签已粘牢，拿起来看看这份甜。');setText($('hint').lastChild,()=>'拖动转一转，看看糖画的透光');
  fitPresentation('angle');finishStarted=performance.now();
  if(reducedMotion)setWorkbenchVisible(false);
  else {const mount=finishedSugar.userData.mount;finishedSugar.rotation.x=0;finishedSugar.position.set(mount.x,.004,mount.tipZ);}
  state.needsRender=true;updateButtons();
}
function paintingFromWork(item) {
  try {
    if(item.surface){
      const saved=decodeSurface(item.surface,sugarLayer.nx,sugarLayer.nz),field=new Float32Array(sugarLayer.nx*sugarLayer.nz);
      for(let row=0;row<saved.height;row++)field.set(saved.field.subarray(row*saved.width,(row+1)*saved.width),(saved.z+row)*sugarLayer.nx+saved.x);
      return createMountedSugar({...sugarLayer,field,bounds:saved.bounds});
    }
    const temporary=new SugarLayer(new THREE.Scene());
    try {
      if(item.builtin){
        let length=0;
        const records=item.strokes.map(record=>{const curve=new THREE.CatmullRomCurve3(record.points.map(p=>v(p[0],.105,p[1])),false,'centripetal'),span=curve.getLength(),start=length;length+=span;return {curve,length:span,start};});
        temporary.reset(records,.052);temporary.drawTo(length,false);
      }else for(const record of item.strokes||[])if(record.deposits?.length)temporary.restore(record.deposits);
      return createMountedSugar(temporary);
    }
    finally {temporary.texture.dispose();temporary.mesh.geometry.dispose();temporary.material.dispose();}
  } catch(error){console.warn('展示架作品无法重建',error);return null;}
}
function exampleWorks() {
  return rackExamples??=patterns.slice(0,3).map((pattern,index)=>({id:'example-'+pattern.id,name:pattern.name,mode:'watch',pattern:index,builtin:true,demonstration:true,strokes:pattern.paths.map(path=>serializeStroke(samplePath(path,pattern.scale)))}));
}
function displayedWorks() {return rackCollection==='examples'?exampleWorks():gallery;}
function findDisplayedWork(id) {return id?(gallery.find(item=>item.id===id)||exampleWorks().find(item=>item.id===id)):null;}
function rememberRackCollection(collection) {rackCollection=collection;try{localStorage.setItem('sugar-painting-rack-collection',collection);}catch { /* Artwork storage remains independent. */ }}
function selectRackCollection(collection) {rememberRackCollection(collection);rackPage=0;renderRack();}
function renderRack() {
  stopSavedReplay();
  if(state.contextLost)return;if(state.drawing||state.draining)finishStroke(true);if(videoCapture)cancelVideo('打开展示架，录制已取消。');if(state.playing){state.paused=true;updateProgress();}state.navigating=false;
  disposeDisplay(inspectedSugar);inspectedSugar=null;
  document.body.dataset.rackCollection=rackCollection;
  const works=displayedWorks(),pages=Math.max(1,Math.ceil(works.length/3));rackPage=Math.max(0,Math.min(rackPage,pages-1));
  const entries=works.slice(rackPage*3,rackPage*3+3);
  if(!rackRoot||!rackMatchesEntries(rackRoot.userData.entries,entries)){disposeDisplay(rackRoot);rackRoot=createDisplayRack(entries,paintingFromWork,folkTextures.wood);scene.add(rackRoot);}
  rackRoot.userData.entries=entries;
  rackRoot.visible=true;
  if(finishedSugar)finishedSugar.visible=false;presentationMode='rack';selectedDisplayId=null;setWorkbenchVisible(false);templateGuide.setVisible(false);
  document.querySelector('.scene-panel').dataset.finished='true';syncDrawingControls();presentationUI();
  setText($('scene-title'),()=>rackCollection==='examples'?'示例糖画':'我的糖画架');setText($('scene-description'),()=>rackCollection==='examples'?'先赏一份甜，再亲手画一幅。':works.length?'点一幅糖画，拿近慢慢看。':'把完成的糖画插在这里，留住每一份甜。');
  for(const key of ['examples','personal'])$('rack-'+key).setAttribute('aria-pressed',String(rackCollection===key));
  $('rack-empty-message').hidden=rackCollection!=='personal'||gallery.length>0;
  const list=$('rack-items');releaseTranslations(list);list.replaceChildren();
  for(const item of entries){const button=document.createElement('button');button.type='button';if(item.builtin)setText(button,()=>item.name);else button.textContent=item.name;button.dataset.workId=item.id;button.onclick=()=>inspectDisplayed(item.id);list.append(button);}
  setText($('rack-counter'),()=>t('第 {page} / {total} 组',{page:rackPage+1,total:pages}));$('rack-prev').disabled=rackPage===0;$('rack-next').disabled=rackPage===pages-1;
  fitPresentation('angle',true);
}
async function showRack() {
  stopSavedReplay();
  if(state.contextLost)return;if(state.drawing||state.draining)finishStroke(true);
  if(videoCapture)cancelVideo('打开展示架，录制已取消。');
  if(state.playing){state.paused=true;updateProgress();updateButtons();}
  if(state.mode!=='watch')flushSave();
  const request=++rackRequest;
  try {const items=await readGallery();if(request!==rackRequest)return;gallery=items||[];renderRack();}
  catch {notify('无法读取糖画架，请检查浏览器存储。');}
}
function inspectDisplayed(id) {
  stopSavedReplay();
  const item=findDisplayedWork(id);if(!item||state.contextLost)return;
  const cached=rackRoot?.userData.paintings.find(entry=>entry.id===id);
  const painting=cached?createInspectionCopy(cached.object):paintingFromWork(item);if(!painting){notify('这幅作品暂时无法展示，可以从糖画架重新打开。');return;}
  disposeDisplay(inspectedSugar);inspectedSugar=holdSugar(painting);scene.add(inspectedSugar);
  if(rackRoot)rackRoot.visible=false;if(finishedSugar)finishedSugar.visible=false;
  presentationMode='inspect';selectedDisplayId=id;syncDrawingControls();presentationUI();
  $('download-video').hidden=true;if(videoUrl){URL.revokeObjectURL(videoUrl);videoUrl=null;}
  releaseTranslations($('scene-title'));if(item.builtin)setText($('scene-title'),()=>item.name);else $('scene-title').textContent=item.name;
  setText($('scene-description'),()=>'转一转，看糖的厚薄与竹签的粘接。');fitPresentation('angle');
}
async function replaySavedWork() {
  const id=selectedDisplayId,item=findDisplayedWork(id);
  if(!item?.strokes?.length||state.contextLost)return false;
  if(videoCapture)cancelVideo();
  let strokes;try{strokes=item.builtin?patterns[item.pattern].paths.map(path=>samplePath(path,patterns[item.pattern].scale)):item.strokes.map(deserializeStroke);}catch{notify('这幅作品没有制作记录');return false;}
  if(!savedReplay){
    const request=++replayRequest;await flushSave();
    if(request!==replayRequest||selectedDisplayId!==id||presentationMode!=='inspect'||state.contextLost)return false;
    savedReplay={state:{...state},surface:sugarLayer.capture(),strokeData,totalLength,strokeCursor,timeline,playTime,playDuration,replaySurface,coolingPending,spoon:spoon.visible,stick:stick.visible,amount:pour.amount,height:pour.height};
  }
  if(inspectedSugar)inspectedSugar.visible=false;
  presentationMode='replay';setWorkbenchVisible(true);sugarLayer.mesh.visible=true;sugarLayer.uniforms.sugarContactEnabled.value=1;
  Object.assign(state,{mode:item.mode,strokes,drawing:false,draining:false,navigating:false,playing:false,paused:false,view:'pour'});
  if(item.builtin)Object.assign(state,{pattern:item.pattern,thickness:.052});
  if(item.surface)applySurface(sugarLayer,decodeSurface(item.surface,sugarLayer.nx,sugarLayer.nz));
  renderArtwork(true,true);if(!item.surface)replaySurface=null;
  templateGuide.setVisible(false);presentationUI();moveView('pour',true);resize();
  releaseTranslations($('scene-title'));if(item.builtin)setText($('scene-title'),()=>item.name);else $('scene-title').textContent=item.name;
  setText($('scene-description'),()=>'回看这一幅糖画的制作过程');
  return true;
}
function stopSavedReplay() {
  replayRequest++;
  if(!savedReplay)return;
  if(videoCapture)cancelVideo();
  const saved=savedReplay;savedReplay=null;
  pour.reset(pour.source);Object.assign(state,saved.state);
  ({strokeData,totalLength,strokeCursor,timeline,playTime,playDuration,replaySurface,coolingPending}=saved);
  sugarLayer.restoreCapture(saved.surface);spoon.visible=saved.spoon;stick.visible=saved.stick;
  pour.amount=saved.amount;pour.height=saved.height;
  // Replaying shares the renderer, but never the editable workspace or its history.
  presentationMode='inspect';setWorkbenchVisible(false);if(inspectedSugar)inspectedSugar.visible=true;
  sugarLayer.mesh.visible=false;sugarLayer.uniforms.sugarContactEnabled.value=0;
  templateGuide.setVisible(false);updateProgress();presentationUI();syncDrawingControls();
  setText($('scene-description'),()=>'转一转，看糖的厚薄与竹签的粘接。');fitPresentation('angle',true);updateButtons();
}
async function clearCompletedWorkspace() {
  // The archive has already committed. Clear only this board, keeping other
  // templates and the finished model independent of the editable sugar field.
  const key=state.mode==='watch'?null:workspaceKey();
  state.strokes=[];state.drawPoints=[];state.drawing=false;state.draining=false;
  state.playing=false;state.paused=false;state.progress=0;state.hasArtwork=false;state.navigating=false;
  if(state.mode==='draw')state.ownStrokes=[];
  if(state.mode==='template')state.templateStrokes[state.templatePattern]=[];
  if(key){delete workspaceSurfaces[key];histories[key]={undo:[],redo:[]};}
  coolingPending=null;replaySurface=null;strokeStartSurface=null;guideEvaluation=null;drawingPointer=null;
  liveDeposits=[];drawCommands=[];drawStart=0;drawStop=0;strokeData=[];timeline=[];playTime=0;playDuration=1;totalLength=1;strokeCursor=0;
  guideStep=0;guideFinished=false;sugarLayer.reset([],state.thickness);pour.reset(v(0,0,0));spoon.visible=false;
  disposeGroup(sugar);disposeGroup(stick);updateStepGuide();updateProgress();updateButtons();
  completedWorkspaceCleared=true;state.needsRender=true;
  if(key){scheduleSave(key);await flushSave();}
}
function pinFinished(startNext=false,event) {
  if(presentationMode!=='held'||!finishedSugar||pinBusy||state.contextLost)return;
  saveToGallery(event,startNext?'next':'rack');
}

function displayGalleryWork(id) {
  rememberRackCollection('personal');$('gallery').close();rackPage=Math.max(0,Math.floor(displayedWorks().findIndex(item=>item.id===id)/3));renderRack();inspectDisplayed(id);
}
function openRackManagement() {
  if(state.contextLost)return;
  clearTimeout(toastTimer);$('toast').classList.remove('visible');renderGallery();$('gallery').showModal();
  if(galleryBusy)return;
  const token=beginGallery('正在读取糖画架…');
  runGallery(async()=>{gallery=await readGallery()||[];renderGallery();}).then(()=>endGallery(token),()=>endGallery(token,'无法读取糖画架，请检查浏览器存储后重试。','error'));
}
function galleryImage() {
  const visible=templateGuide.visible;
  try {templateGuide.setVisible(false);renderer.render(scene,camera);return renderer.domElement.toDataURL('image/jpeg',.7);}
  finally {templateGuide.setVisible(visible);state.needsRender=true;}
}
function captureArtwork() {
  const guideVisible=templateGuide.visible,pixelRatio=renderer.getPixelRatio(),size=renderer.getSize(new THREE.Vector2());
  const limit=Math.min(1800,renderer.capabilities.maxTextureSize),ratio=Math.max(pixelRatio,Math.min(3,limit/Math.max(size.x,size.y)));
  try{templateGuide.setVisible(false);renderer.setPixelRatio(ratio);renderer.render(scene,camera);return renderer.domElement.toDataURL('image/png');}
  finally{renderer.setPixelRatio(pixelRatio);templateGuide.setVisible(guideVisible);state.needsRender=true;}
}
// Compose the share image independently of the editing camera and UI panels.
// Restore every renderer/model setting synchronously, even when capture fails.
function captureShareArtwork() {
  const previousTarget=renderer.getRenderTarget(),viewport=renderer.getViewport(new THREE.Vector4());
  let target=null;
  const wasHidden=!!hiddenWorkbench,guideVisible=templateGuide.visible,background=scene.background;
  let temporary=null,object=['held','inspect'].includes(presentationMode)?activePresentation():null;
  const position=object?.position.clone(),rotation=object?.quaternion.clone();
  try {
    setWorkbenchVisible(false);templateGuide.setVisible(false);scene.background=new THREE.Color('#f1e6d2');
    if(!object){temporary=createMountedSugar(sugarLayer);if(!temporary)return captureArtwork();object=temporary;scene.add(object);}
    holdSugar(object);
    const bounds=new THREE.Box3().setFromObject(object),center=bounds.getCenter(new THREE.Vector3()),extent=bounds.getSize(new THREE.Vector3());
    const photo=camera.clone();photo.clearViewOffset();photo.aspect=1080/900;photo.updateProjectionMatrix();
    const tan=Math.tan(THREE.MathUtils.degToRad(photo.fov/2));
    const distance=Math.max(extent.y,extent.x/photo.aspect)/(2*tan*.85)+extent.z;
    photo.position.copy(center).add(v(.04,.015,1).normalize().multiplyScalar(Math.max(2,distance)));photo.lookAt(center);
    target=new THREE.WebGLRenderTarget(1080,900);target.texture.colorSpace=THREE.SRGBColorSpace;
    renderer.setRenderTarget(target);renderer.render(scene,photo);
    const pixels=new Uint8Array(1080*900*4);renderer.readRenderTargetPixels(target,0,0,1080,900,pixels);
    const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=900;
    const context=canvas.getContext('2d'),image=context.createImageData(1080,900);
    for(let y=0;y<900;y++)image.data.set(pixels.subarray((899-y)*1080*4,(900-y)*1080*4),y*1080*4);
    context.putImageData(image,0,0);return canvas.toDataURL('image/png');
  } finally {
    if(temporary)disposeDisplay(temporary);
    else if(object&&position){object.position.copy(position);object.quaternion.copy(rotation);object.updateMatrixWorld(true);}
    if(!wasHidden)setWorkbenchVisible(true);
    scene.background=background;
    templateGuide.setVisible(guideVisible);renderer.setRenderTarget(previousTarget);renderer.setViewport(viewport);target?.dispose();renderer.render(scene,camera);state.needsRender=true;
  }
}
function runGallery(task) {
  const operation=galleryQueue.catch(()=>{}).then(task);
  galleryQueue=operation.catch(()=>{});
  return operation;
}
function galleryMessage(message,kind='info') {setText($('gallery-status'),()=>message);$('gallery-status').dataset.kind=kind;}
function syncGalleryBusy() {
  $('gallery').setAttribute('aria-busy',String(galleryBusy>0));
  for(const button of document.querySelectorAll('.gallery-actions button, #gallery-list button'))button.disabled=galleryBusy>0;
}
function beginGallery(message) {
  galleryFocus=document.activeElement;galleryBusy++;const token=++galleryFeedbackSequence;galleryMessage(message,'busy');syncGalleryBusy();return token;
}
function endGallery(token,message='',kind='info') {
  galleryBusy=Math.max(0,galleryBusy-1);syncGalleryBusy();
  if(token===galleryFeedbackSequence){if(message||$('gallery-status').dataset.kind==='busy')galleryMessage(message,kind);if(!$('gallery').open&&message)notify(message);}
  if(!galleryBusy&&!$('gallery').open&&presentationMode==='rack')renderRack();
  if(!galleryBusy&&$('gallery').open&&(!document.activeElement||document.activeElement===$('gallery')||!$('gallery').contains(document.activeElement))){
    const target=galleryFocus?.isConnected&&$('gallery').contains(galleryFocus)&&galleryFocus.matches('button:not(:disabled)')?galleryFocus:$('gallery-import-open');target.focus({preventScroll:true});
  }
}
function renderGallery() {
  updateCopyAccess();
  const list=$('gallery-list');releaseTranslations(list);list.replaceChildren();
  if(!gallery.length){const empty=document.createElement('p');empty.className='gallery-empty';setText(empty,()=>'糖画架还是空的，画好后可以把作品存进来。');list.append(empty);syncGalleryBusy();return;}
  for(const item of gallery){
    const card=document.createElement('article');card.className='gallery-item';
    const image=document.createElement('img');image.src=item.image;image.alt='';image.loading='lazy';image.decoding='async';
    const info=document.createElement('div');info.className='gallery-item-info';
    const name=document.createElement('strong');name.textContent=item.name;
    const date=document.createElement('small');setText(date,()=>item.source==='draft-conflict'?new Date(item.updatedAt||item.createdAt).toLocaleString(getLocale(),{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}):new Date(item.createdAt).toLocaleDateString(getLocale()));
    const actions=document.createElement('div');actions.className='gallery-item-actions';
    const open=document.createElement('button');open.className='text-button';setText(open,()=>'打开');open.onclick=()=>openGalleryWork(item);
    const remove=document.createElement('button');remove.className='text-button';setText(remove,()=>'删除');remove.onclick=()=>deleteGalleryWork(item);
    const display=document.createElement('button');display.className='text-button';setText(display,()=>'拿近看看');display.onclick=()=>displayGalleryWork(item.id);
    actions.append(open,display,remove);info.append(name,date,actions);card.append(image,info);list.append(card);
  }
  syncGalleryBusy();
}
async function openGalleryWork(item) {
      if(item.patternDefinition){try{item.pattern=await saveImportedPattern(await hydrateImportedPattern(item.patternDefinition));renderPatternLibrary();}catch{notify('图案恢复失败，原作品仍保留。');return;}}
      if(state.drawing||state.draining)finishStroke(true);saveDrawingWorkspace(true);if(dirtyWorkspaces.size)flushSave();
      const key=item.mode==='template'?`template:${item.pattern}`:'draw';
      if(item.source==='draft-conflict'){draftForks.add(key);draftCopyIds[key]=item.id;}else delete draftCopyIds[key];
      const strokes=item.strokes.map(deserializeStroke);
      if(item.demonstration===true){setMode('watch');setPattern(item.pattern,false);}
      else if(item.mode==='template'){setMode('template');setTemplate(item.pattern);recordEdit(state.strokes.slice());state.strokes=strokes;state.templateStrokes[item.pattern]=strokes;renderArtwork();}
      else {setMode('draw');recordEdit(state.strokes.slice());state.strokes=strokes;state.ownStrokes=strokes;renderArtwork();}
      if(item.surface){try{applySurface(sugarLayer,decodeSurface(item.surface,sugarLayer.nx,sugarLayer.nz));}catch(error){console.warn('作品糖层不可用，已从笔画重建',error);}}
      updateButtons();scheduleSave();$('gallery').close();notify('作品已打开，可以继续画。');
}
async function deleteGalleryWork(item) {
      if(!await confirmDelete(item.name))return;
      const token=beginGallery('正在删除作品…');
      try {await runGallery(async()=>{gallery=await updateGallery(items=>items.filter(entry=>entry.id!==item.id));renderGallery();});if(selectedDisplayId===item.id)renderRack();endGallery(token,'作品已删除。');} catch {endGallery(token,'删除失败，请检查浏览器存储后重试。','error');}
}
function saveToGallery(event,finishDestination=null) {
  closeToolPopovers();if(workSaving||$('save-work-dialog').open||state.contextLost)return;
  if(state.drawing||state.draining)finishStroke(true);
  if((state.mode==='watch'&&!finishDestination)||!state.strokes.length){notify('先画一幅糖画，再存入糖画架。');return;}
  if(state.playing){const original=currentSurface();renderArtwork();applySurface(sugarLayer,original);}
  try {
    pendingWork={id:createWorkId(),createdAt:Date.now(),mode:state.mode==='watch'?'template':state.mode,pattern:state.mode==='watch'?state.pattern:state.templatePattern,strokes:state.strokes.map(serializeStroke),surface:encodeSurface(currentSurface()),image:galleryImage(),...(finishDestination?{displayed:true,demonstration:state.mode==='watch'}:{})};
    if(state.mode!=='draw')pendingWork.patternDefinition=importedDefinition(pendingWork.pattern);
    pendingWork.finishDestination=finishDestination;
    const base=t(state.mode==='draw'?'我的糖画':patterns[state.mode==='watch'?state.pattern:state.templatePattern].name);
    let name=base,number=2;while(gallery.some(item=>item.name===name)){const suffix=' · '+number++;name=Array.from(base).slice(0,40-suffix.length).join('')+suffix;}
    $('work-name').value=name;
    setText($('save-work-description'),()=>finishDestination==='rack'?'保存后清空本幅画板，并前往糖画架。':finishDestination==='next'?'保存后清空本幅画板，开始下一幅。':'保存一份作品，当前画板可以继续修改。');
    setText($('save-work-submit'),()=>finishDestination==='rack'?'保存并去糖画架':finishDestination==='next'?'保存并画下一幅':'保存作品');
    setText($('save-work-cancel'),()=>finishDestination?'返回欣赏':'继续画');
    setText($('save-work-status'),'');workSaveFocus=event?.currentTarget instanceof HTMLElement?event.currentTarget:document.activeElement;workSavePaused=state.paused;state.paused=true;
    $('save-work-dialog').showModal();$('work-name').focus();$('work-name').select();
  } catch(error) {pendingWork=null;notify('作品没能保存，画作仍在石板上，可以重试。');}
}
async function submitSavedWork(event) {
  event.preventDefault();if(workSaving||!pendingWork)return;
  const name=$('work-name').value.trim();
  if(!name){setText($('save-work-status'),'请给作品取个名字。');$('work-name').focus();return;}
  const {finishDestination,...snapshot}=pendingWork;const item={...snapshot,name:Array.from(name).slice(0,40).join('')};workSaving=true;
  $('save-work-submit').disabled=true;$('save-work-cancel').disabled=true;$('work-name').readOnly=true;
  setText($('save-work-status'),'正在保存作品…');
  try{
    await runGallery(async()=>{gallery=await updateGallery(items=>[item,...items.filter(work=>work.id!==item.id)]);});rememberRackCollection('personal');
    if(finishDestination){pinnedWorkId=item.id;await clearCompletedWorkspace();}
    $('save-work-dialog').close();
    if(finishDestination==='rack'){rackPage=0;renderRack();$('rack-items').querySelector('button')?.focus({preventScroll:true});notify('已插到展示架，画板已清空。');}
    else if(finishDestination==='next'){resumeDrawing();notify('作品已保存，画板已清空，可以画下一幅。');}
    else notify('已存入糖画架。');
  }catch(error){setText($('save-work-status'),error?.name==='QuotaExceededError'?'糖画架空间不足，请导出备份并清理旧作品后重试。':'作品没能保存，画作仍在石板上，可以重试。');}
  finally{workSaving=false;$('save-work-submit').disabled=false;$('save-work-cancel').disabled=false;$('work-name').readOnly=false;}
}

function texture(kind) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(1024,1024);
  let seed = 83173;
  const random = () => {seed=(seed*16807)%2147483647;return seed/2147483647;};
  for(let y=0;y<1024;y++) for(let x=0;x<1024;x++) {
    const n = random()-.5;
    let r,g,b;
    if(kind==='stone') {
      const wave = Math.sin(x*.007+y*.009+Math.sin(y*.012)*.8+Math.sin(x*.019+y*.003)*.4);
      const vein = Math.pow(Math.max(0,1-Math.abs(wave)*22),2);
      const clouds = Math.sin(x*.011+y*.007)*Math.sin(y*.019-x*.006)*2;
      r = 212+n*1.7+clouds-vein*19; g=211+n*1.7+clouds-vein*18; b=204+n*1.7+clouds-vein*16;
    } else {
      const grain = Math.sin(y*.27+Math.sin(x*.004+y*.013)*2)*.5 + Math.sin(y*.063+Math.sin(x*.005)*3)*1.6;
      r=101+grain*1.7+n*5;g=73+grain*1.3+n*4;b=48+grain+n*3;
    }
    const i=(y*1024+x)*4; img.data[i]=r;img.data[i+1]=g;img.data[i+2]=b;img.data[i+3]=255;
  }
  ctx.putImageData(img,0,0);
  if(kind==='wood') {
    ctx.strokeStyle='rgba(40,25,14,.08)';ctx.lineWidth=1;
    [210,530,850].forEach(y=>{ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1024,y+1);ctx.stroke();});
  }
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=renderer.capabilities.getMaxAnisotropy();
  return t;
}

function mesh(geometry,material,parent=scene) {
  const m = new THREE.Mesh(geometry,material);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
}
function rod(a,b,r,material,parent=scene) {
  const delta=b.clone().sub(a);
  const m=mesh(new THREE.CylinderGeometry(r,r*.96,delta.length(),12),material,parent);
  m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(v(0,1,0),delta.normalize());return m;
}
function roundedSlab(width,depth,radius,thickness,material) {
  const s=new THREE.Shape(),x=-width/2,y=-depth/2;
  s.moveTo(x+radius,y);s.lineTo(x+width-radius,y);s.quadraticCurveTo(x+width,y,x+width,y+radius);
  s.lineTo(x+width,y+depth-radius);s.quadraticCurveTo(x+width,y+depth,x+width-radius,y+depth);
  s.lineTo(x+radius,y+depth);s.quadraticCurveTo(x,y+depth,x,y+depth-radius);
  s.lineTo(x,y+radius);s.quadraticCurveTo(x,y,x+radius,y);
  const g=new THREE.ExtrudeGeometry(s,{depth:thickness,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.045,bevelThickness:.035,curveSegments:12});
  g.rotateX(-Math.PI/2);g.translate(0,-thickness-.04,0);
  return mesh(g,material);
}

function rebuildEnvironment() {
  environment?.dispose();
  const pmrem=new THREE.PMREMGenerator(renderer);
  const room=new THREE.Scene();room.background=new THREE.Color('#72604c');
  const lightPanel=(x,y,z,w,h,power)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:new THREE.Color(power,power*.96,power*.88),side:THREE.DoubleSide}));m.position.set(x,y,z);m.lookAt(0,0,0);room.add(m);};
  lightPanel(-3,7,1,3.8,2.4,7);lightPanel(4,5,-2,.35,5,4);lightPanel(0,4,6,4,.18,2.5);
  environment=pmrem.fromScene(room,.025);scene.environment=environment.texture;scene.environmentIntensity=1.05;
  room.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});pmrem.dispose();
}

function makeScene() {
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(Math.max(devicePixelRatio,1.25),1.75));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.18;
  container.appendChild(renderer.domElement);
  scene=new THREE.Scene();scene.background=new THREE.Color('#40352b');
  camera=new THREE.PerspectiveCamera(36,1,.1,100);camera.position.set(4.2,12.8,13.5);
  controls=new OrbitControls(camera,renderer.domElement);controls.target.set(.1,0,.3);controls.enableDamping=true;controls.dampingFactor=.09;
  controls.enablePan=false;controls.minDistance=8;controls.maxDistance=40;controls.maxPolarAngle=Math.PI*.44;controls.minPolarAngle=.01;
  controls.listenToKeyEvents(container);
  controls.addEventListener('start',()=>{
    cameraMove=null;container.focus({preventScroll:true});
    if(turntableView()){
      const object=activePresentation();
      if(presentationMode==='held'){holdSugar(object);finishStarted=performance.now()-1150;setWorkbenchVisible(false);}
      const axis=sugarRotationAxis(object);if(axis){camera.position.add(axis.pivot.clone().sub(controls.target));controls.target.copy(axis.pivot);}
    }
    if(state.mode!=='watch'&&!presentationMode){
      if(state.drawing||state.draining)finishStroke(true);
      state.view='custom';
      for(const id of ['angle-view','top-view','pour-view','detail-view'])$(id).setAttribute('aria-pressed','false');
    }
  });
  controls.addEventListener('change',()=>{
    if(state.navigating){
      const x=THREE.MathUtils.clamp(controls.target.x,-4.55,4.55),z=THREE.MathUtils.clamp(controls.target.z,-3.75,3.75);
      camera.position.x+=x-controls.target.x;camera.position.z+=z-controls.target.z;controls.target.x=x;controls.target.z=z;
    }
    state.needsRender=true;
  });
  rebuildEnvironment();
  scene.add(new THREE.HemisphereLight('#fffdf4','#4e4335',.65));
  const sun=new THREE.SpotLight('#fff4df',260,40,Math.PI*.29,.72,2);sun.position.set(-3,9,3);sun.target.position.set(0,0,0);scene.add(sun.target);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.normalBias=.012;sun.shadow.bias=-.0001;sun.shadow.radius=5;scene.add(sun);
  const fill=new THREE.DirectionalLight('#eaf0ff',.4);fill.position.set(5,7,-6);scene.add(fill);
  const wood=folkTextures.wood;wood.wrapS=wood.wrapT=THREE.RepeatWrapping;wood.repeat.set(21,21);wood.anisotropy=renderer.capabilities.getMaxAnisotropy();
  const table=mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({map:wood,roughness:.75,color:'#c9ad91'}));table.rotation.x=-Math.PI/2;table.position.y=-.39;workbenchTable=table;
  displayGround=mesh(new THREE.PlaneGeometry(200,200),new THREE.ShadowMaterial({color:'#493923',opacity:.15}));displayGround.rotation.x=-Math.PI/2;displayGround.position.y=-.39;displayGround.visible=false;displayGround.castShadow=false;
  const stone=folkTextures.stone;stone.anisotropy=renderer.capabilities.getMaxAnisotropy();
  const marbleMaterial=new THREE.MeshPhysicalMaterial({map:stone,bumpMap:stone,bumpScale:.003,roughness:.4,metalness:0,color:'#fff1da',clearcoat:.12,clearcoatRoughness:.3});
  const board=roundedSlab(9.1,7.5,.14,.26,marbleMaterial);
  const boardUV=board.geometry.attributes.uv,boardPosition=board.geometry.attributes.position;
  for(let i=0;i<boardUV.count;i++)boardUV.setXY(i,(boardPosition.getX(i)+4.55)/9.1,(boardPosition.getZ(i)+3.75)/7.5);
  board.name='大理石糖画板';
  // A folded cloth peeks out from beneath the slab.
  const clothGeo=new THREE.PlaneGeometry(2.7,2.4,24,24);clothGeo.rotateX(-Math.PI/2);
  const a=clothGeo.attributes.position;
  for(let i=0;i<a.count;i++)a.setY(i,Math.sin(a.getX(i)*12+a.getZ(i)*4)*.015+Math.sin(a.getZ(i)*17)*.008);
  clothGeo.computeVertexNormals();
  const cloth=mesh(clothGeo,new THREE.MeshStandardMaterial({color:'#823e2c',roughness:1,side:THREE.DoubleSide}));cloth.position.set(-4.4,-.33,2.7);cloth.rotation.y=-.2;
  const bamboo=new THREE.MeshStandardMaterial({color:'#c49a59',roughness:.68});
  for(let i=0;i<3;i++)rod(v(-5.5-i*.16,-.30,-2.5),v(-4.9+i*.11,-.30,.2),.035,bamboo);
  const copper=new THREE.MeshStandardMaterial({color:'#f9d4a5',map:folkTextures.copper,bumpMap:folkTextures.copper,bumpScale:.018,metalness:.72,roughness:.32,envMapIntensity:1.5});
  const darkCopper=new THREE.MeshStandardMaterial({color:'#744025',metalness:.8,roughness:.36});
  const pot=new THREE.Group();scene.add(pot);pot.position.set(4.85,-.35,-3.1);pot.scale.setScalar(1.5);
  const potProfile=[[0,0],[.48,0],[.61,.08],[.66,.55],[.64,.75],[.60,.79],[.57,.75],[.59,.55],[.53,.14],[0,.14]].map(p=>new THREE.Vector2(...p));
  mesh(new THREE.LatheGeometry(potProfile,64),copper,pot);
  const syrup=mesh(new THREE.CylinderGeometry(.578,.578,.02,64),new THREE.MeshPhysicalMaterial({color:'#c68423',roughness:.15,metalness:0,clearcoat:1}),pot);syrup.position.y=.57;
  const rim=mesh(new THREE.TorusGeometry(.62,.028,10,64),copper,pot);rim.rotation.x=Math.PI/2;rim.position.y=.77;
  const handle=mesh(new THREE.TorusGeometry(.23,.028,8,24,Math.PI*1.7),darkCopper,pot);handle.position.set(.75,.4,0);handle.rotation.y=Math.PI/2;handle.rotation.z=-Math.PI*.35;
  rod(v(5.2,.27,-2.5),v(5.8,1.15,-3.2),.035,bamboo);
  sugarMaterial=new THREE.MeshPhysicalMaterial({color:'#fffaf1',metalness:0,roughness:.07,transmission:1,thickness:.07,ior:1.49,attenuationColor:new THREE.Color('#f6ad35'),attenuationDistance:.052,envMapIntensity:1.25});
  sugar=new THREE.Group();scene.add(sugar);
  sugarLayer=new SugarLayer(scene);templateGuide=new TemplateGuide();sugarLayer.attachMarble(marbleMaterial,templateGuide);
  stick=new THREE.Group();scene.add(stick);
  ({spoon,lip:spoonLip}=createPouringSpoon(copper,bamboo));scene.add(spoon);
  pour=new SugarPour(scene,(a,b,volume,radius)=>{
    if(replayRecorded)return;
    sugarLayer.deposit(a,b,volume,radius);
    if(state.drawing||state.draining)liveDeposits.push({a:[a.x,a.z],b:[b.x,b.z],volume,radius,t:pour.time-drawStart});
    state.needsRender=true;
  },(x,z)=>sugarLayer.heightAt(x,z));spoon.visible=false;
  workbenchObjects=scene.children.filter(object=>object!==table&&object!==displayGround&&!object.isLight&&object!==sun.target);
  resize();new ResizeObserver(resize).observe(container);
}

function resize() {
  if(!renderer)return;const w=container.clientWidth,h=container.clientHeight;if(!w||!h)return;
  const oldAspect=camera.aspect,newAspect=w/h;
  camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);state.needsRender=true;
  if(presentationMode&&presentationMode!=='replay'&&finishedSize){fitPresentation(state.view,true);return;}
  if(controls&&!state.drawing&&!state.navigating&&['pour','detail','top','angle'].includes(state.view)&&Math.abs(oldAspect-newAspect)>.001){
    moveView(state.view,true);
  }
  if(!state.drawing&&!state.navigating&&controls&&!['detail','pour','custom','top','angle'].includes(state.view)){const distance=camera.position.distanceTo(controls.target);const top=state.view==='top';const minFit=Math.max(top?15.5:17.8,(top?15.8:18.5)/(w/h));if(distance<minFit)camera.position.sub(controls.target).setLength(minFit).add(controls.target);}
}
function disposeGroup(group) {
  while(group.children.length){const child=group.children.pop();child.parent=null;child.geometry?.dispose();if(child.material&&child.material!==sugarMaterial)child.material.dispose();}
}
function samplePath(d,scale=1) {
  const el=document.createElementNS('http://www.w3.org/2000/svg','path');el.setAttribute('d',d);
  const length=el.getTotalLength(),count=Math.max(8,Math.ceil(length*1.35)),out=[];
  for(let i=0;i<=count;i++){const p=el.getPointAtLength(length*i/count);out.push(v((p.x-50)*.083*scale,.105,(p.y-46)*.083*scale));}return out;
}
function renderArtwork(animate=false,fromArchive=false) {
  if(videoCapture)cancelVideo('画面已更改，录制已取消。');
  if(!fromArchive)exitFinish();
  if(state.drawing||state.draining)finishStroke(true);
  if(animate&&state.navigating)setDrawingNavigation(false);
  if(animate&&state.mode!=='watch')replaySurface=state.playing&&replaySurface?replaySurface:sugarLayer.capture();
  else replaySurface=null;
  disposeGroup(sugar);disposeGroup(stick);strokeData=[];totalLength=0;strokeCursor=0;
  for(const points of state.strokes) {
    if(points.length<2)continue;const curve=new THREE.CatmullRomCurve3(points,false,'centripetal');const length=curve.getLength();
    strokeData.push({curve,length,start:totalLength,deposits:points.deposits,duration:points.duration,commands:points.commands,amount:points.amount,height:points.height});totalLength+=length;
  }
  sugarLayer.reset(strokeData,state.thickness);
  state.hasArtwork=state.strokes.length>0;
  if(state.mode==='watch'&&state.hasArtwork) {
    const pattern=patterns[state.pattern];const sx=(pattern.stick[0]-50)*.083*pattern.scale,sz=(pattern.stick[1]-46)*.083*pattern.scale;
    rod(v(sx,.045,Math.min(...state.strokes.flatMap(points=>points.map(point=>point.z)))+.12),v(sx,.045,Math.max(sz+1.9,4.9)),.039,new THREE.MeshStandardMaterial({color:'#d6b57b',roughness:.7}),stick);
  }
  stick.visible=!animate;state.progress=animate?0:state.hasArtwork?1:0;state.playing=animate;state.paused=false;
  pour.amount=state.thickness;pour.height=Number($('height').value);pour.reset(strokeData[0]?.curve.getPointAt(0)||v(0,0,0));spoon.visible=false;
  if(animate){buildTimeline();if(state.view==='angle'||state.view==='top')moveView('pour');}
  else {
    if(strokeData.some(r=>r.deposits)){for(const r of strokeData)if(r.deposits)sugarLayer.restore(r.deposits);}
    else sugarLayer.drawTo(totalLength,false);
  }
  updateProgress();state.needsRender=true;updateButtons();
}
function buildTimeline() {
  timeline=[];playTime=0;let time=0,previous=strokeData[0]?.curve.getPointAt(0)||v(0,0,0);
  for(const r of strokeData){
    const start=r.curve.getPointAt(0),end=r.curve.getPointAt(1),gap=.30+Math.min(.35,start.distanceTo(previous)*.08);
    timeline.push({kind:'travel',start:time,end:time+gap,from:previous.clone(),to:start.clone()});time+=gap;
    const duration=r.deposits?Math.max(.001,r.duration):Math.max(.25,r.length/2.7);
    const tail=r.deposits?.length?Math.max(0,(r.deposits.at(-1).t||duration)-duration):0;
    const eventDuration=duration+tail+(r.deposits?1/120:0);
    timeline.push({kind:'pour',start:time,end:time+eventDuration,flowEnd:time+duration,record:r,depositIndex:0,initialized:false});time+=eventDuration;previous=end;
  }
  playDuration=time;timeline.push({kind:'travel',start:time,end:time+.6,from:previous.clone(),to:previous.clone()});
}
function setPattern(index,animate=true) {
  if(!patterns[index]?.paths.length){setMode('template');setTemplate(index);return;}
  state.pattern=index;const p=patterns[index];state.strokes=p.paths.map(d=>samplePath(d,p.scale));
  setText($('scene-title'),()=>p.name);setText($('scene-description'),()=>p.description);
  document.querySelectorAll('.pattern').forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index)));
  renderArtwork(animate&&!reducedMotion);
}
function saveDrawingWorkspace(leaving=false) {
  if(savedReplay)return;
  if(state.mode==='draw')state.ownStrokes=state.strokes;
  if(state.mode==='template')state.templateStrokes[state.templatePattern]=state.strokes;
  if(state.mode!=='watch'){
    const key=workspaceKey();workspaceSurfaces[key]=currentSurface();
    if(leaving&&coolingPending===key){coolingPending=null;scheduleSave(key,false);}
  }
}
function updatePatternSelection() {
  const index=state.mode==='template'?state.templatePattern:state.pattern;
  document.querySelectorAll('.pattern').forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
}
function filterPatterns() {
  const level=$('pattern-level').value;
  document.querySelectorAll('.pattern').forEach(button=>{button.hidden=level!=='all'&&patterns[Number(button.dataset.index)].level!==level;});
  const selected=state.mode==='template'?state.templatePattern:state.pattern;
  if(level!=='all'&&patterns[selected].level!==level){
    const index=patterns.findIndex(pattern=>pattern.level===level);
    if(index>=0){if(state.mode==='template')setTemplate(index);else if(state.mode==='watch')setPattern(index,false);}
  }
}
function setTemplate(index) {
  if(tutorialStep&&index!==2)setTutorial(0);
  if(state.drawing||state.draining)finishStroke(true);
  saveDrawingWorkspace(true);state.templatePattern=index;state.navigating=false;
  state.strokes=state.templateStrokes[index]||[];
  templateGuide.setPattern(patterns[index]);guideStep=0;guideFinished=false;updateStepGuide();templateGuide.setVisible(state.templateVisible);
  setText($('scene-title'),()=>t('描一幅{name}',{name:t(patterns[index].name)}));
  setText($('scene-description'),()=>'沿着淡色印记，慢慢落糖。');
  updatePatternSelection();renderArtwork();restoreWorkspaceSurface();
}
function updateProgress() {
  $('playback').hidden=(!!presentationMode&&presentationMode!=='replay')||(state.mode!=='watch'&&presentationMode!=='replay'&&!state.playing);
  $('progress').style.transform=`scaleX(${state.progress})`;
  document.querySelector('.progress-track').setAttribute('aria-valuenow',Math.round(state.progress*100));
  setText($('progress-label'),()=>state.paused?'歇一小会':state.progress>=1?'收丝':`${Math.round(state.progress*100)}%`);
}
function updateStepGuide() {
  const pattern=patterns[state.templatePattern],enabled=state.mode==='template'&&$('step-guide').checked&&pattern.paths.length>0;
  $('step-guide').disabled=pattern.paths.length===0;
  guideStep=pattern.paths.length?THREE.MathUtils.clamp(guideStep,0,pattern.paths.length-1):0;
  templateGuide.setStep(enabled?guideStep:null);
  $('step-controls').hidden=!enabled;
  setText($('step-label'),()=>t('第 {step} / {total} 笔',{step:guideStep+1,total:pattern.paths.length}));
  $('step-prev').disabled=guideStep===0;$('step-next').disabled=!pattern.paths.length||guideStep===pattern.paths.length-1;
  state.needsRender=true;
}
function positionSpoon() {
  positionPouringSpoon(spoon,spoonLip,pour.source,pour.height,pour.gate,pour.amount);
  spoon.visible=state.playing||state.drawing||state.draining;
}
function advancePlayback(dt) {
  const n=Math.max(1,Math.ceil(dt*120)),step=dt/n;
  for(let i=0;i<n;i++){
    playTime+=step;
    for(const item of timeline){
      if(item.kind!=='pour'||!item.record.deposits||playTime<item.start)continue;
      const deposits=item.record.deposits,elapsed=playTime-item.start;
      while(item.depositIndex<deposits.length&&(deposits[item.depositIndex].t??item.flowEnd-item.start)<=elapsed){
        const d=deposits[item.depositIndex++];sugarLayer.deposit(v(d.a[0],0,d.a[1]),v(d.b[0],0,d.b[1]),d.volume,d.radius,false);
      }
    }
    const event=timeline.find(e=>playTime>=e.start&&playTime<e.end)||timeline.at(-1);
    if(event){
      const t=THREE.MathUtils.clamp((playTime-event.start)/(event.end-event.start),0,1);
      let target,commandFlow=true,commandAmount,commandHeight;
      if(event.kind==='pour'&&event.record.commands?.length){
        const commands=event.record.commands,elapsed=playTime-event.start;
        let k=0;while(k<commands.length-1&&commands[k+1].t<=elapsed)k++;
        const command=commands[k];target=v(command.point[0],0,command.point[1]);commandFlow=command.flow!==false;commandAmount=command.amount;commandHeight=command.height;
      } else target=event.kind==='pour'?event.record.curve.getPointAt(t):event.from.clone().lerp(event.to,t*t*(3-2*t));
      const recorded=event.kind==='pour'&&!!event.record.deposits;
      if(recorded){
        if(!event.initialized){const first=event.record.commands?.[0]?.point;pour.reset(first?v(first[0],0,first[1]):target);event.initialized=true;}
        pour.amount=commandAmount??event.record.amount??state.thickness;pour.height=commandHeight??event.record.height??Number($('height').value);
      }
      replayRecorded=state.mode!=='watch'&&(event.kind!=='pour'||recorded);
      pour.setTarget(target,commandFlow&&event.kind==='pour'&&playTime<(event.flowEnd??event.end));
    }
    pour.step(step,false);replayRecorded=false;sugarLayer.settle(step);
  }
  pour.updateMesh();positionSpoon();state.progress=Math.min(1,playTime/playDuration);updateProgress();
  if(playTime>=playDuration+.6&&!pour.active){state.playing=false;stick.visible=true;spoon.visible=false;if(replaySurface){sugarLayer.restoreCapture(replaySurface);replaySurface=null;}updateProgress();updateButtons();if(videoCapture)finishVideo();else notify('糖画成了，看看这一口甜。');}
  state.needsRender=true;
}
function updateButtons() {
  document.body.dataset.video=videoStarting||videoCapture?'generating':videoUrl?'ready':'';
  syncFolkUI(state,presentationMode,gallery,!!findDisplayedWork(selectedDisplayId)?.builtin);
  syncDrawingControls();
  renderMusicControl();
  const playParent=document.querySelector('#board-menu .popover-body');
  if($('play').parentElement!==playParent)playParent.append($('play'));
  $('play').disabled=!state.hasArtwork;
  $('record-video').disabled=(!selectedDisplayId||!findDisplayedWork(selectedDisplayId)?.strokes?.length)&&!videoCapture;
  $('record-format').disabled=!!videoCapture||videoStarting;
  $('share-scene').disabled=!!videoCapture||videoStarting||state.contextLost||pinBusy||(!state.hasArtwork&&!presentationMode);
  $('share-work').disabled=!!videoCapture||videoStarting||state.contextLost||pinBusy;
  $('gallery-save').disabled=!state.hasArtwork||workSaving;
  $('beginner').hidden=state.mode!=='watch'||!!presentationMode;
  setText($('pattern-current'),()=>t('图案：{name}',{name:t(patterns[state.mode==='template'?state.templatePattern:state.pattern].name)}));
  setLabel($('pattern-trigger'),'aria-label',()=>t('更换图案，当前为{name}',{name:t(patterns[state.mode==='template'?state.templatePattern:state.pattern].name)}));
  setText($('workflow-hint'),()=>state.mode==='watch'?'看师傅画一幅，再亲手试试。':state.navigating?'移动画布时不会落糖；再点一次回到绘画。':state.strokes.length?'画好了？点“拿起来看看”，还可以返回修改。':state.mode==='template'&&state.templateVisible?($('step-guide').checked&&patterns[state.templatePattern].paths.length?'从圆圈起笔，沿深色线描画；可随时拿起来看看。':'沿着淡色印记，按住石板开始浇糖。'):'按住画糖，移动拉线，松开收丝。');
  $('finish').hidden=state.mode!=='watch'||!!presentationMode;$('finish').disabled=!state.hasArtwork;
  $('play').hidden=state.mode==='watch'&&state.playing;
  setText($('finish'),()=>state.mode==='watch'?'欣赏示范成品':'完成并欣赏');
  setText($('record-video').querySelector('span'),()=>videoCapture?'取消录制':'生成视频');
  setText($('play').querySelector('span'),()=>state.mode!=='watch'?'看我的浇糖过程':'再看一次浇糖');
  setLabel($('pause'),'aria-label',()=>state.paused?'继续浇糖':'暂停浇糖');
  $('pause').disabled=!state.playing;
  $('pause').innerHTML=state.paused?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7Z"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14m8-14v14"/></svg>';
  $('undo').disabled=state.mode==='watch'||history().undo.length===0;
  $('redo').disabled=state.mode==='watch'||history().redo.length===0;
  $('scene-undo').disabled=$('undo').disabled;$('scene-redo').disabled=$('redo').disabled;$('scene-finish').disabled=$('finish').disabled;
  $('clear').disabled=!state.hasArtwork;
  $('drawing-mouse-help').hidden=state.mode==='watch'||!!presentationMode;
  $('pattern-picker').hidden=state.mode==='draw';
  if(presentationMode==='inspect'||presentationMode==='replay')setText($('process-status'),()=>videoCapture?'正在生成视频…':findDisplayedWork(selectedDisplayId)?.strokes?.length?'制作过程已随作品保存':'这幅作品没有制作记录');
}
function syncDrawingControls() {
  const editing=state.mode!=='watch'&&!presentationMode,navigating=editing&&state.navigating;
  controls.enabled=!state.contextLost;
  controls.enablePan=navigating;controls.enableRotate=true;controls.enableDamping=!editing;controls.screenSpacePanning=false;
  controls.mouseButtons.LEFT=editing?(navigating?THREE.MOUSE.PAN:null):THREE.MOUSE.ROTATE;
  controls.mouseButtons.RIGHT=editing?THREE.MOUSE.ROTATE:THREE.MOUSE.PAN;
  if(editing)controls.minDistance=3;
  controls.touches.ONE=navigating?THREE.TOUCH.PAN:THREE.TOUCH.ROTATE;
  container.style.cursor=editing&&!navigating?'crosshair':'grab';renderer.domElement.style.cursor=container.style.cursor;
  $('navigate-drawing').hidden=!editing;$('navigate-drawing').setAttribute('aria-pressed',String(navigating));
  setLabel($('navigate-drawing'),'title',()=>navigating?'拖动平移，滚轮或双指缩放；再次点击继续画糖':'切换到平移和缩放画布');
  setLabel(container,'aria-label',()=>presentationMode==='replay'?'制作过程回放。拖动旋转，滚轮或双指缩放，空格暂停。':presentationMode==='rack'?'糖画展示架。点击一幅作品拿近观察，也可使用下面的作品按钮。':presentationMode?'手持糖画。拖动转动作品，滚轮或双指缩放，查看正面与背面。':navigating?'移动糖画画布。拖动平移，滚轮或双指缩放，方向键微调。再点移动画布返回绘画。':editing?'三维糖画工作台。按住石板浇糖，松开收丝。点击移动画布调整位置和缩放。':'三维糖画。拖动旋转，滚轮或双指缩放。方向键旋转，空格暂停浇糖。');
}
function setDrawingNavigation(enabled) {
  if(state.mode==='watch'||presentationMode||state.contextLost)return;
  if(drawingPointer!==null&&container.hasPointerCapture(drawingPointer))container.releasePointerCapture(drawingPointer);
  if(state.drawing||state.draining)finishStroke(true);
  state.navigating=enabled;cameraMove=null;syncDrawingControls();
  updateButtons();
  setText($('scene-description'),()=>enabled?'拖动平移，双指缩放；再点回到画糖。':state.mode==='template'?'沿着淡色印记，慢慢落糖。':'按住浇糖，松开收丝。');
  setText($('hint').lastChild,()=>enabled?'拖动移动，方向键微调，滚轮或双指缩放':state.mode==='template'?'沿着印记浇糖，松开收丝':'按住石板画一笔，松开收笔');
  container.focus({preventScroll:true});state.needsRender=true;
}
function moveView(type,instant=false) {
  if(presentationMode&&presentationMode!=='replay'){fitPresentation(type,instant);return;}
  camera.clearViewOffset();
  state.view=type;const aspect=container.clientWidth/container.clientHeight;
  const editing=state.mode!=='watch'&&!presentationMode;
  const distance=type==='top'&&editing?Math.max(13.5,16.5/aspect):type==='top'?Math.max(15.5,15.8/aspect):Math.max(18,18.5/aspect);
  const mobile=container.clientWidth<=760;
  const target=type==='pour'?(mobile?v(0,.2,1.7):v(0,.6,0)):type==='detail'?v(.0,0,-.25):v(.1,0,.3);
  const position=type==='pour'?target.clone().add(v(3.3,7.6,10.6)):type==='detail'?v(.8,3.8,5.3):type==='top'?v(.1,distance,.31):v(4.2,12.8,13.5).setLength(distance);
  if(type==='angle'&&editing){
    const direction=v(3.3,7.6,10.6).normalize(),right=v(direction.z,0,-direction.x).normalize(),up=new THREE.Vector3().crossVectors(direction,right);
    const tan=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));let fit=8;
    for(const x of [-4.55,4.55])for(const z of [-3.75,3.75]){
      const point=v(x,.09,z).sub(target),depth=point.dot(direction);
      fit=Math.max(fit,depth+Math.abs(point.dot(right))/(tan*aspect*.88),depth+Math.abs(point.dot(up))/(tan*.88));
    }
    position.copy(target).addScaledVector(direction,fit+.3);
  }
  if(type==='pour')position.sub(target).multiplyScalar(mobile?Math.max(1,.70/aspect):Math.max(1,1.15/aspect)).add(target);
  else if(type==='detail')position.sub(target).multiplyScalar(Math.max(1,1.15/aspect)).add(target);
  $('angle-view').setAttribute('aria-pressed',String(type==='angle'));$('top-view').setAttribute('aria-pressed',String(type==='top'));
  $('detail-view').setAttribute('aria-pressed',String(type==='detail'));controls.minDistance=state.mode!=='watch'?3:type==='detail'?4:8;
  $('pour-view').setAttribute('aria-pressed',String(type==='pour'));
  controls.maxDistance=Math.max(40,position.distanceTo(target)*1.2);
  if(instant||reducedMotion){cameraMove=null;camera.position.copy(position);controls.target.copy(target);controls.update();}
  else cameraMove={from:camera.position.clone(),to:position,start:performance.now(),target:controls.target.clone(),targetTo:target};
  state.needsRender=true;
}
function setMode(mode) {
  closeToolPopovers();
  if(presentationMode){exitFinish();moveView('pour',true);}
  if(state.mode===mode)return;
  if(tutorialStep&&mode!=='template')setTutorial(0);
  $('pattern-level').value='all';document.querySelectorAll('.pattern').forEach(button=>{button.hidden=false;});
  if(state.drawing||state.draining)finishStroke(true);saveDrawingWorkspace(true);state.mode=mode;state.navigating=false;state.playing=false;state.progress=1;
  $('watch-mode').setAttribute('aria-pressed',String(mode==='watch'));$('draw-mode').setAttribute('aria-pressed',String(mode==='draw'));
  $('template-mode').setAttribute('aria-pressed',String(mode==='template'));
  $('pattern-panel').hidden=mode==='draw';$('draw-info').hidden=mode!=='draw';$('template-options').hidden=mode!=='template';$('undo').hidden=mode==='watch';$('redo').hidden=mode==='watch';
  $('gallery-save').hidden=mode==='watch';
  $('finish').hidden=mode==='watch';
  $('beginner').hidden=mode!=='watch';
  setText($('pattern-heading'),()=>mode==='template'?'选一张印记':'挑一幅糖画');
  setText($('clear').lastChild,()=>mode==='template'?'清空糖画':'清空石板');
  document.querySelector('.studio-panel').dataset.mode=mode;
  document.querySelector('.workbench').dataset.mode=mode;
  syncDrawingControls();
  setText($('hint').lastChild,()=>mode==='template'?'沿着印记浇糖，松开收丝':mode==='draw'?'按住石板画一笔，松开收笔':'拖动转一转，滚轮凑近看');
  templateGuide.setVisible(mode==='template'&&state.templateVisible);
  if(mode==='draw') {
    state.strokes=state.ownStrokes||[];
    setText($('scene-title'),()=>'一勺糖，慢慢落');setText($('scene-description'),()=>'按住浇糖，松开收丝。');moveView('angle');renderArtwork();restoreWorkspaceSurface();
  } else if(mode==='template'){
    state.strokes=state.templateStrokes[state.templatePattern]||[];
    templateGuide.setPattern(patterns[state.templatePattern]);
    guideStep=0;guideFinished=false;updateStepGuide();
    setText($('scene-title'),()=>t('描一幅{name}',{name:t(patterns[state.templatePattern].name)}));setText($('scene-description'),()=>'沿着淡色印记，慢慢落糖。');
    renderArtwork();restoreWorkspaceSurface();moveView('angle');
  } else {setPattern(state.pattern,false);moveView('pour');}
  updateStepGuide();updatePatternSelection();
  updateButtons();
}
function boardPoint(event) {
  const rect=container.getBoundingClientRect();cursor.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
  raycaster.setFromCamera(cursor,camera);const p=raycaster.ray.intersectPlane(drawingPlane,new THREE.Vector3());
  return p&&Math.abs(p.x)<4.45&&Math.abs(p.z)<3.68?p:null;
}
function commitStroke() {
  const tutorialLanded=liveDeposits.length>0;
  if(state.drawPoints.length===1)state.drawPoints.push(state.drawPoints[0].clone().add(v(.01,0,.01)));
  if(state.drawPoints.length>=2&&liveDeposits.length){
    const points=state.drawPoints.map(p=>p.clone());points.deposits=liveDeposits;points.duration=Math.max(0,drawStop-drawStart);points.commands=drawCommands;points.amount=pour.amount;points.height=pour.height;
    recordEdit(state.strokes.slice(),strokeStartSurface);state.strokes.push(points);scheduleSave();
    if(state.mode==='template'&&$('step-guide').checked&&!guideFinished&&guideEvaluation?.pattern===state.templatePattern&&guideEvaluation.step===guideStep){
      const pattern=patterns[state.templatePattern];
      if(guideEvaluation.before<.8&&guideCoverage(guideEvaluation.points,sugarLayer)>=.8){
        if(guideStep<pattern.paths.length-1){guideStep++;updateStepGuide();notify('这一笔画好了，继续下一笔。');}
        else {guideFinished=true;notify('最后一笔画好了。');}
      }
    }
  }
  liveDeposits=[];drawCommands=[];strokeStartSurface=null;guideEvaluation=null;state.drawPoints=[];state.draining=false;state.hasArtwork=state.strokes.length>0;spoon.visible=false;updateButtons();state.needsRender=true;
  if(tutorialStep===3){if(tutorialLanded)setTutorial(4);else {setTutorial(1);notify('糖还没落到石板上，再按住一会儿。');}}
}
function advanceDrawing(time=performance.now(),minimum=0) {
  if(!state.drawing&&!state.draining)return;
  const delta=Math.max(minimum,Math.max(0,(time-drawingTime)/1000));drawingTime=Math.max(drawingTime,time);
  if(delta)pour.step(Math.min(delta,.05));
  state.needsRender=true;
}
function finishStroke(immediate=false) {
  if(!state.drawing&&!state.draining)return;
  advanceDrawing();
  if(state.drawing)drawStop=pour.time;
  drawingPointer=null;state.drawing=false;state.draining=true;pour.flow=false;
  if(immediate===true){for(let i=0;i<100&&pour.active;i++)pour.step(1/120,false);pour.updateMesh();commitStroke();}
}
function recordDrawCommand(point=pour.target,flow=pour.flow) {
  drawCommands.push({t:pour.time-drawStart,point:[point.x,point.z],flow,amount:pour.amount,height:pour.height});
}
function adjustSettingShortcut(event) {
  if(event.defaultPrevented||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||state.contextLost||presentationMode||$('gallery').open)return;
  const field=event.target instanceof Element?event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'):null;
  if(field&&!field.matches('input#thickness[type="range"],input#height[type="range"],select#speed'))return;
  const action={KeyQ:['thickness',-1,'出糖量'],KeyW:['thickness',1,'出糖量'],KeyE:['height',-1,'提勺高度'],KeyR:['height',1,'提勺高度'],KeyA:['speed',-1,'浇糖速度'],KeyS:['speed',1,'浇糖速度']}[event.code];
  if(!action)return;
  event.preventDefault();const [id,direction,label]=action,control=$(id),before=control.value;
  if(id==='speed')control.selectedIndex=THREE.MathUtils.clamp(control.selectedIndex+direction,0,control.options.length-1);
  else control.stepUp(direction);
  if(control.value===before){if(!event.repeat)notify(t(direction<0?'{setting}已到最小值':'{setting}已到最大值',{setting:t(label)}));return;}
  control.dispatchEvent(new Event(id==='speed'?'change':'input',{bubbles:true}));
  const value=id==='speed'?control.value+'×':id==='thickness'?Number(control.value).toFixed(3):Number(control.value).toFixed(2);
  notify(t('{setting}：{value}',{setting:t(label),value}));
}
function wireUI() {
  renderMusicControl();
  $('music-toggle').onclick=async()=>{const ok=await music.toggle();if(!ok&&music.enabled)notify('配乐暂时无法播放，可以继续画糖。');};
  const unlockMusic=event=>{if(event.target.closest('#scene, .mode-switch, .pattern, #play, #replay-work, #record-video')&&!event.target.closest('a'))music.unlock();};
  document.addEventListener('pointerdown',unlockMusic,{passive:true,capture:true});
  document.addEventListener('keydown',event=>{if(['Enter','Space'].includes(event.code))unlockMusic(event);});
  renderPatternLibrary();
  wirePatternImport((index,mode)=>{setMode(mode);if(mode==='template'){setTemplate(index);moveView('angle');}else setPattern(index,true);$('template-visible').checked=true;state.templateVisible=true;templateGuide.setVisible(mode==='template');updateButtons();},()=>{$('pattern-level').value='all';updatePatternSelection();});
  $('patterns').addEventListener('click',event=>{const button=event.target.closest('.pattern');if(button){const index=Number(button.dataset.index);if(state.mode==='template')setTemplate(index);else setPattern(index);}});
  $('patterns').addEventListener('click',event=>{if(event.target.closest('.pattern'))$('pattern-picker').open=false;});
  $('pattern-level').onchange=filterPatterns;
  $('watch-mode').onclick=()=>setMode('watch');$('draw-mode').onclick=()=>setMode('draw');
  $('template-mode').onclick=()=>setMode('template');
  $('beginner').onclick=()=>{setMode('template');setTemplate(2);$('height').value='0.85';$('height').dispatchEvent(new Event('input'));$('template-visible').checked=true;$('template-visible').dispatchEvent(new Event('change'));$('step-guide').checked=true;updateStepGuide();moveView('angle',true);setTutorial(state.strokes.length?0:1);container.focus({preventScroll:true});};
  $('tutorial-close').onclick=()=>setTutorial(0);
  document.addEventListener('click',event=>{if(event.target.id==='tutorial-continue'){setTutorial(0);container.focus({preventScroll:true});}});
  $('tutorial-finish').onclick=()=>{setTutorial(0);showFinished();};
  $('template-visible').onchange=event=>{state.templateVisible=event.target.checked;templateGuide.setVisible(!finishedSugar&&!videoCapture&&state.mode==='template'&&state.templateVisible);state.needsRender=true;updateButtons();};
  $('step-guide').onchange=event=>{guideFinished=false;if(event.target.checked&&!state.templateVisible){$('template-visible').checked=true;$('template-visible').dispatchEvent(new Event('change'));}updateStepGuide();updateButtons();};
  $('step-prev').onclick=()=>{guideFinished=false;guideStep--;updateStepGuide();};
  $('step-next').onclick=()=>{guideFinished=false;guideStep++;updateStepGuide();};
  $('template-opacity').oninput=event=>{const value=Number(event.target.value);templateGuide.setOpacity(value);setText($('template-opacity-value'),()=>value<.35?'浅一些':value>.65?'深一些':'适中');state.needsRender=true;};
  $('thickness').oninput=event=>{state.thickness=Number(event.target.value);pour.amount=state.thickness;if(state.drawing||state.draining)recordDrawCommand();setText($('thickness-value'),()=>state.thickness<.035?'少一些':state.thickness>.045?'多一些':'适中');if(state.mode==='watch')renderArtwork();};
  $('height').oninput=event=>{pour.height=Number(event.target.value);if(state.drawing||state.draining)recordDrawCommand();setText($('height-value'),()=>pour.height<1?'低勺':pour.height>1.8?'高勺':'适中');state.needsRender=true;};
  $('speed').onchange=event=>{state.speed=Number(event.target.value);updateButtons();};
  $('play').onclick=()=>{closeToolPopovers();if(state.drawing||state.draining)finishStroke(true);renderArtwork(true);};
  $('record-video').onclick=beginVideo;
  $('replay-work').onclick=replaySavedWork;$('replay-back').onclick=stopSavedReplay;
  $('rack-open').onclick=showRack;$('pin-current').onclick=event=>pinFinished(false,event);$('next-painting').onclick=event=>pinFinished(true,event);$('rack-back').onclick=renderRack;
  $('rack-examples').onclick=()=>selectRackCollection('examples');$('rack-personal').onclick=()=>selectRackCollection('personal');
  $('rack-prev').onclick=()=>{rackPage--;renderRack();};$('rack-next').onclick=()=>{rackPage++;renderRack();};
  let rackPointer=null;container.addEventListener('pointerdown',event=>{rackPointer=presentationMode==='rack'?[event.clientX,event.clientY]:null;});
  container.addEventListener('pointerup',event=>{if(!rackPointer||presentationMode!=='rack'||Math.hypot(event.clientX-rackPointer[0],event.clientY-rackPointer[1])>6){rackPointer=null;return;}rackPointer=null;const rect=container.getBoundingClientRect();cursor.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(cursor,camera);const hit=raycaster.intersectObjects(rackRoot.userData.pickTargets,false)[0];if(hit)inspectDisplayed(hit.object.userData.workId);});
  $('finish').onclick=showFinished;$('resume-drawing').onclick=resumeDrawing;
  $('share-scene').onclick=sharing.open;$('share-work').onclick=sharing.open;
  $('pause').onclick=()=>{state.paused=!state.paused;updateButtons();updateProgress();};
  $('playback-exit').onclick=()=>{if(!state.playing||state.mode==='watch'||presentationMode)return;const original=currentSurface();renderArtwork();applySurface(sugarLayer,original);state.needsRender=true;container.focus({preventScroll:true});};
  $('clear').onclick=()=>{if(state.drawing||state.draining)finishStroke(true);if(state.mode!=='watch')recordEdit(state.strokes.slice());state.strokes=[];renderArtwork();if(state.mode==='template'){guideStep=0;guideFinished=false;updateStepGuide();}if(state.mode!=='watch')scheduleSave();notify(state.mode==='watch'?'石板清好了。':'石板清好了，可以撤销恢复。');};
  $('undo').onclick=()=>restoreHistory('undo','redo');
  $('redo').onclick=()=>restoreHistory('redo','undo');
  $('scene-undo').onclick=()=>$('undo').click();$('scene-redo').onclick=()=>$('redo').click();$('scene-finish').onclick=showFinished;
  $('retry-save').onclick=()=>flushSave();
  $('navigate-drawing').onclick=()=>setDrawingNavigation(!state.navigating);
  $('rack-manage').onclick=openRackManagement;
  $('draft-copy-open').onclick=async()=>{await showRack();if(presentationMode==='rack')openRackManagement();};
  $('gallery-close').onclick=()=>$('gallery').close();
  $('gallery').addEventListener('close',()=>{if(presentationMode==='rack'||(presentationMode==='inspect'&&!gallery.some(item=>item.id===selectedDisplayId)))renderRack();});
  $('gallery-save').onclick=saveToGallery;
  $('save-work-form').onsubmit=submitSavedWork;
  $('save-work-cancel').onclick=()=>{if(!workSaving)$('save-work-dialog').close();};
  $('save-work-dialog').addEventListener('cancel',event=>{if(workSaving)event.preventDefault();});
  $('save-work-dialog').addEventListener('close',()=>{pendingWork=null;state.paused=workSavePaused;state.needsRender=true;if(!state.contextLost)restoreSettingsFocus(workSaveFocus);});
  $('gallery-export').onclick=async()=>{const token=beginGallery('正在生成作品备份…');try {
    await runGallery(async()=>{gallery=await readGallery()||[];renderGallery();});
    const blob=new Blob([JSON.stringify({format:'sugar-painting-gallery',version:1,works:gallery})],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=t('糖画铺-作品备份.json');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    endGallery(token,'备份已生成，可在下载列表中打开。');
  } catch {endGallery(token,'导出失败，请检查浏览器存储后重试。','error');}};
  $('gallery-import-open').onclick=()=>$('gallery-import').click();
  $('gallery-import').onchange=async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;
    const token=beginGallery('正在导入作品备份…');
    try {
      const data=JSON.parse(await file.text());
      if(data.format!=='sugar-painting-gallery'||data.version!==1||!Array.isArray(data.works)||data.works.length>200)throw new Error('格式不正确');
      const definitions=new Map();
      for(const item of data.works){if(!item||typeof item.id!=='string'||typeof item.name!=='string'||!['draw','template'].includes(item.mode)||(item.mode==='template'&&(!Number.isInteger(item.pattern)||(!patterns[item.pattern]&&!item.patternDefinition)))||!Array.isArray(item.strokes)||typeof item.image!=='string'||!item.image.startsWith('data:image/'))throw new Error('格式不正确');item.strokes.forEach(deserializeStroke);if(item.surface)decodeSurface(item.surface,sugarLayer.nx,sugarLayer.nz);if(item.patternDefinition)definitions.set(item.patternDefinition.id,await hydrateImportedPattern(item.patternDefinition));}
      for(const item of data.works)if(item.patternDefinition)item.pattern=await saveImportedPattern(definitions.get(item.patternDefinition.id));
      if(definitions.size)renderPatternLibrary();
      let versionCopies=0;
      await runGallery(async()=>{gallery=await updateGallery(items=>{const merged=mergeGalleryBackup(items,data.works);versionCopies=merged.versionCopies;return merged.items;});renderGallery();});endGallery(token,versionCopies?'备份已导入，不同版本已另存副本。':'作品备份已导入。');
    } catch {endGallery(token,'导入失败，请选择有效的糖画作品备份。','error');}
  };
  $('angle-view').onclick=()=>moveView('angle');$('top-view').onclick=()=>moveView('top');
  $('detail-view').onclick=()=>moveView('detail');
  $('pour-view').onclick=()=>moveView('pour');
  $('focus-view').onclick=()=>{const focus=document.body.classList.toggle('focus');setLabel($('focus-view'),'aria-label',()=>focus?'退出专注模式':'进入专注模式');resize();};
  $('save').onclick=()=>{
    if(videoCapture){notify('录制完成后再保存图片。');return;}
    try {const a=document.createElement('a');const name=state.mode==='template'?t('{name}-我的糖画',{name:t(patterns[state.templatePattern].name)}):t(state.mode==='draw'?'我的糖画':patterns[state.pattern].name);a.download=t('糖画铺-{name}.png',{name});a.href=captureArtwork();a.click();notify('这份甜，已经存成图片。');}
    catch{notify('图片没能保存，请刷新后再试一次。');}
  };
  document.addEventListener('pointerdown',event=>{for(const menu of document.querySelectorAll('.tool-popover[open]'))if(!menu.contains(event.target))menu.open=false;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.querySelector('.tool-popover[open]')){event.preventDefault();event.stopImmediatePropagation();const menu=document.querySelector('.tool-popover[open]');menu.open=false;menu.querySelector('summary').focus();}},true);
  for(const menu of document.querySelectorAll('.tool-popover'))menu.addEventListener('toggle',()=>{if(menu.open){menu.style.setProperty('--popover-top',Math.round(menu.getBoundingClientRect().bottom+8)+'px');for(const other of document.querySelectorAll('.tool-popover[open]'))if(other!==menu&&!other.contains(menu))other.open=false;}});
  $('view-menu').addEventListener('click',event=>{const button=event.target.closest('button');if(button&&['angle-view','top-view','pour-view','detail-view','focus-view','navigate-drawing','gallery-save','clear','play','finish','save','share-scene'].includes(button.id))$('view-menu').open=false;});
  container.addEventListener('pointerdown',e=>{
    // Drawing pointers are handled before OrbitControls can capture them.
    // Right mouse and wheel events still reach the camera controls normally.
    if(state.mode!=='watch'&&!presentationMode&&!state.navigating&&(e.button===0||e.pointerType==='touch'))e.stopPropagation();
    if(state.contextLost||presentationMode||state.mode==='watch'||state.navigating||e.button!==0||state.drawing)return;
    const p=boardPoint(e);if(!p)return;if(state.drawing||state.draining)finishStroke(true);
    if(state.playing){const original=currentSurface();state.playing=false;renderArtwork();applySurface(sugarLayer,original);}
    strokeStartSurface=currentSurface();
    guideEvaluation=null;
    if(state.mode==='template'&&$('step-guide').checked&&!guideFinished&&patterns[state.templatePattern].paths.length){const pattern=patterns[state.templatePattern],points=samplePath(pattern.paths[guideStep],pattern.scale);guideEvaluation={pattern:state.templatePattern,step:guideStep,points,before:guideCoverage(points,sugarLayer)};}
    cameraMove=null;drawingPointer=e.pointerId;drawingTime=performance.now();state.drawing=true;state.drawPoints=[p];liveDeposits=[];drawCommands=[];pour.amount=state.thickness;pour.reset(p);pour.setTarget(p,true);drawStart=pour.time;recordDrawCommand(p,true);
    // Prime a parcel on press, including taps and swipes completed before the next frame.
    advanceDrawing(drawingTime,1/120);
    if(tutorialStep===1)setTutorial(2);
    container.setPointerCapture(e.pointerId);container.focus({preventScroll:true});e.preventDefault();
  },true);
  container.addEventListener('pointermove',e=>{
    if(!state.drawing||e.pointerId!==drawingPointer)return;const p=boardPoint(e);
    if(!p){if(pour.flow){pour.setTarget(pour.target,false);recordDrawCommand(pour.target,false);}return;}
    const prev=state.drawPoints.at(-1);
    if(!pour.flow){pour.setTarget(p,true);recordDrawCommand(p,true);if(p.distanceTo(prev)<.015)return;}
    else if(p.distanceTo(prev)<.015)return;
    state.drawPoints.push(p);pour.setTarget(p,true);advanceDrawing(performance.now(),1/240);recordDrawCommand(p);state.needsRender=true;
    if(tutorialStep===2)setTutorial(3);
    if(state.drawPoints.length>1800){finishStroke(false);notify('这一笔画好了，松手后可以继续下一笔。');}
  });
  const endPointer=e=>{if(e.pointerId===drawingPointer)finishStroke(false);};
  container.addEventListener('pointerup',endPointer);container.addEventListener('pointercancel',endPointer);container.addEventListener('lostpointercapture',endPointer);
  container.addEventListener('keydown',e=>{
    if(e.code==='Space'&&state.playing){e.preventDefault();$('pause').click();}
    if(e.code==='Escape'&&presentationMode==='replay'){e.preventDefault();stopSavedReplay();return;}
    if(e.code==='Escape'&&presentationMode==='inspect'){e.preventDefault();renderRack();return;}
    if(e.code==='Escape'&&presentationMode==='rack'){e.preventDefault();resumeDrawing();return;}
    if(e.code==='Escape'&&document.body.classList.contains('focus')){e.preventDefault();$('focus-view').click();}
    if((state.mode==='watch'||presentationMode)&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)) {
      e.preventDefault();cameraMove=null;const offset=camera.position.clone().sub(controls.target),s=new THREE.Spherical().setFromVector3(offset);
      s.theta+=(e.code==='ArrowLeft'?.12:e.code==='ArrowRight'?-.12:0);s.phi=THREE.MathUtils.clamp(s.phi+(e.code==='ArrowUp'?-.1:e.code==='ArrowDown'?.1:0),controls.minPolarAngle,controls.maxPolarAngle);camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));controls.update();state.needsRender=true;
    }
  });
  document.addEventListener('keydown',adjustSettingShortcut);
  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented||event.key!=='Escape'||!presentationMode||pinBusy||document.querySelector('dialog[open]')||event.target.closest?.('input, textarea, select, [contenteditable="true"]'))return;
    event.preventDefault();
    if(document.body.classList.contains('focus')){$('focus-view').click();return;}
    if(presentationMode==='replay')stopSavedReplay();else if(presentationMode==='inspect')renderRack();else resumeDrawing();
    container.focus({preventScroll:true});
  });
  document.addEventListener('visibilitychange',()=>{syncMusic();if(document.hidden){if(videoCapture)cancelVideo('页面切到后台，录制已取消。');if(state.drawing||state.draining)finishStroke(true);if(saveTimer||dirtyWorkspaces.size||coolingPending)flushSave();}lastTime=0;state.needsRender=true;});
}
function frame(time) {
  const delta=lastTime?Math.min((time-lastTime)/1000,.05):0;lastTime=time;
  syncMusic();
  if(document.hidden||state.contextLost)return;
  const advancing=state.playing&&!state.paused;
  if(advancing)advancePlayback(delta*state.speed);
  if(state.drawing||state.draining){advanceDrawing(time);positionSpoon();if(state.draining&&!pour.active)commitStroke();state.needsRender=true;}
  if(finishedSugar&&presentationMode==='held'){const t=reducedMotion?1:Math.min(1,(time-finishStarted)/1150),lift=THREE.MathUtils.clamp((t-.18)/.82,0,1),ease=1-(1-lift)**3,mount=finishedSugar.userData.mount;finishedSugar.position.set(mount.x*(1-ease),.004+.746*ease,mount.tipZ*(1-ease));finishedSugar.rotation.x=Math.PI/2*ease;if(t>.35)setWorkbenchVisible(false);if(t<1)state.needsRender=true;}
  const movingCamera=!!cameraMove;
  if(cameraMove) {
    const t=Math.min(1,(time-cameraMove.start)/850),ease=1-Math.pow(1-t,4);
    camera.position.lerpVectors(cameraMove.from,cameraMove.to,ease);controls.target.lerpVectors(cameraMove.target,cameraMove.targetTo,ease);state.needsRender=true;if(t===1)cameraMove=null;
  }
  const cooling=!presentationMode&&!advancing&&!state.paused&&sugarLayer.settle(delta);
  if(cooling)state.needsRender=true;
  if(state.mode!=='watch'&&!state.playing&&!presentationMode){
    const key=workspaceKey();
    if(cooling&&state.strokes.length)coolingPending=key;
    else if(!cooling&&coolingPending===key&&!state.drawing&&!state.draining){coolingPending=null;scheduleSave(key,false);}
    else if(coolingPending&&coolingPending!==key)coolingPending=null;
  } else coolingPending=null;
  if(controls.enabled||movingCamera)controls.update();
  if(state.needsRender){
    if(videoCapture?.portrait){try{videoCapture.portrait.render();}catch(error){cancelVideo('竖屏画面录制失败，请重试。');console.warn('竖屏画面录制失败',error);}}
    renderer.render(scene,camera);state.needsRender=false;
  }
}
function lockScene(locked) {
  for(const element of document.querySelectorAll('.studio-panel, .view-tools, .scene-quick-controls, .playback, .tutorial, .step-controls, #scene, #resume-drawing, #navigate-drawing, #work-process'))element.inert=locked;
  $('save').disabled=locked;$('share-scene').disabled=locked;$('share-work').disabled=locked;$('rack-open').disabled=locked;$('rack-manage').disabled=locked;
  syncDrawingControls();
}
function wireContextRecovery() {
  const canvas=renderer.domElement;
  const lost=event=>{
    event?.preventDefault();if(state.contextLost)return;
    stopSavedReplay();
    state.contextLost=true;cameraMove=null;
    sharing.close();
    if($('save-work-dialog').open)$('save-work-dialog').close();
    syncMusic();
    if(drawingPointer!==null&&container.hasPointerCapture(drawingPointer))container.releasePointerCapture(drawingPointer);
    if(state.drawing||state.draining)finishStroke(true);
    if(videoCapture)cancelVideo('画面中断，视频录制已取消。');
    if(state.playing){state.paused=true;updateButtons();updateProgress();}
    if($('gallery').open)$('gallery').close();
    lockScene(true);$('loading').hidden=false;$('reload-scene').hidden=true;
    setText($('loading').querySelector('p'),()=>'画面暂时中断，正在保存草稿并等待恢复。');
    flushSave().then(saved=>{
      if(!state.contextLost)return;
      setText($('loading').querySelector('p'),()=>saved?(draftForks.size?'本页内容已保留为糖画架副本。可等待恢复，或重新打开后从糖画架找回。':'草稿已保存在本机。等待画面恢复，或重新打开画面。'):'画面暂时中断，作品仍在本页。草稿保存失败，请等待画面恢复。');
      $('reload-scene').hidden=!saved;
    });
  };
  canvas.addEventListener('webglcontextlost',lost);
  canvas.addEventListener('webglcontextrestored',()=>{
    if(!state.contextLost)return;
    try {
      rebuildEnvironment();sugarLayer.texture.needsUpdate=true;templateGuide.uniforms.guideMask.value.needsUpdate=true;
      resize();renderer.render(scene,camera);state.contextLost=false;lastTime=0;state.needsRender=true;
      lockScene(false);$('loading').hidden=true;$('reload-scene').hidden=true;updateButtons();
      notify(state.playing?'画面已恢复，按继续浇糖可接着看。':'画面已恢复，可以继续创作。');
    } catch(error) {console.warn('画面恢复失败',error);setText($('loading').querySelector('p'),()=>'画面暂时无法恢复，请等待或在草稿保存后重新打开。');}
  });
  $('reload-scene').onclick=()=>location.reload();
  if(renderer.getContext().isContextLost())lost();
}
function showError(message) {
  $('loading').hidden=false;setText($('loading').querySelector('p'),()=>message);
  document.querySelectorAll('.studio-panel button, .view-tools button, #save').forEach(b=>b.disabled=true);
}
async function start() { try {
  const loader=new THREE.TextureLoader();
  await Promise.all(['wood','stone','copper','display'].map(async key=>{const map=await loader.loadAsync(uiAssets[key]);map.colorSpace=THREE.SRGBColorSpace;folkTextures[key]=map;}));
  folkTextures.presentationBackground=folkTextures.display;
  try {await loadPatternLibrary();}catch(error){console.warn('导入图案读取失败',error);notify('无法读取本机图案，请检查浏览器存储。');}
  makeScene();wireUI();installFolkUI({patterns,selectPattern:index=>state.mode==='template'?setTemplate(index):setPattern(index),editWork:()=>{const work=findDisplayedWork(selectedDisplayId);if(work?.builtin){setMode('template');setTemplate(work.pattern);}else if(work)openGalleryWork(work);},deleteWork:()=>{const work=findDisplayedWork(selectedDisplayId);if(work&&!work.builtin)return deleteGalleryWork(work);}});
  try {
    const draft=await readDraft();
    if(draft?.version===1){draftRevisions={...draft.revisions};state.ownStrokes=(draft.own||[]).map(deserializeStroke);state.templateStrokes=Object.fromEntries(Object.entries(draft.templates||{}).map(([key,strokes])=>[key,strokes.map(deserializeStroke)]));for(const [key,surface] of Object.entries(draft.surfaces||{})){try{workspaceSurfaces[key]=decodeSurface(surface,sugarLayer.nx,sugarLayer.nz);}catch(error){console.warn('草稿糖层不可用，已从笔画重建',error);}}setDraftStatus('作品已保存在本机');}
  } catch(error) {console.warn('草稿恢复失败',error);setDraftStatus('无法读取本机草稿，请检查浏览器存储',true);}
  try {gallery=await readGallery()||[];updateCopyAccess();}catch(error){console.warn('糖画架读取失败',error);notify('无法读取糖画架，请检查浏览器存储。');}
  const initialMode=new URLSearchParams(location.search).get('mode');
  setPattern(0,!reducedMotion&&initialMode!=='template'&&initialMode!=='draw');
  if(initialMode==='template'||initialMode==='draw')setMode(initialMode);
  const initialPattern=new URLSearchParams(location.search).get('pattern'),patternIndex=patterns.findIndex(pattern=>pattern.id===initialPattern);
  if(initialMode==='template'&&patternIndex>=0)setTemplate(patternIndex);
  moveView(state.mode==='watch'?'pour':'angle',true);
  controls.update();renderer.render(scene,camera);
  $('loading').hidden=true;renderer.setAnimationLoop(frame);
  wireContextRecovery();
  // Read-only diagnostics used by the local interaction verification.
  window.sugarStudio={getState:()=>({mode:state.mode,pattern:patterns[state.pattern].id,strokes:state.strokes.length,progress:state.progress,playing:state.playing,paused:state.paused,drawing:state.drawing,draining:state.draining,finished:!!presentationMode,finishedStick:!!activePresentation()?.getObjectByName('竹签'),presentation:{mode:presentationMode,framing:presentationFrame(),ground:{visible:displayGround.visible,y:displayGround.position.y,rackBaseY:rackRoot?.userData.groundBaseY??null},selected:selectedDisplayId,displayed:gallery.length,collection:rackCollection,collectionSize:displayedWorks().length,page:rackPage,mount:(inspectedSugar||finishedSugar)?.userData.mount,normal:(inspectedSugar||finishedSugar)?v(0,1,0).applyQuaternion((inspectedSugar||finishedSugar).quaternion).toArray():null},rackItems:rackRoot?.userData.paintings?.map(item=>{const p=item.center.clone().project(camera),rect=container.getBoundingClientRect();return{id:item.id,x:rect.left+(p.x+1)/2*rect.width,y:rect.top+(1-p.y)/2*rect.height};})||[],view:state.view,camera:{position:camera.position.toArray(),target:controls.target.toArray()},music:music.stats(),drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,material:sugarLayer.stats(),pour:pour.stats(),template:templateGuide.stats(),replay:state.playing?{applied:timeline.reduce((n,e)=>n+(e.depositIndex||0),0),total:timeline.reduce((n,e)=>n+(e.record?.deposits?.length||0),0)}:null}),captureSurface:()=>sugarLayer.field.slice(),projectPoint:(x,z)=>{camera.updateMatrixWorld();const p=v(x,.09,z).project(camera),r=container.getBoundingClientRect();return{x:r.left+(p.x+1)/2*r.width,y:r.top+(1-p.y)/2*r.height};}};
  window.sugarStudio.getPresentationSpine=presentationSpine;
} catch(error) {console.error(error);showError('糖画摊暂时没能开起来，请使用支持 WebGL 的浏览器刷新重试。');} }
start();
