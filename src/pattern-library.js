import {patterns} from './patterns.js';
import {readImportedPatterns,addImportedPattern} from './draft-store.js';
import {importPatternFile,hydrateImportedPattern,serializeImportedPattern} from './pattern-import.js';
import {t,setText,setLabel,releaseTranslations} from './i18n.js';

const ns='http://www.w3.org/2000/svg',builtInCount=patterns.length;
const $=id=>document.getElementById(id);
let pending=null,busy=false,request=0;

export async function loadPatternLibrary() {
  const records=await readImportedPatterns()||[];
  if(!Array.isArray(records)||records.length>32)throw new Error('图案数据不正确。');
  const hydrated=await Promise.all(records.map(hydrateImportedPattern));
  patterns.splice(builtInCount,patterns.length-builtInCount,...hydrated);
}
export async function saveImportedPattern(pattern) {
  const records=await addImportedPattern(serializeImportedPattern(pattern));
  for(const record of records)if(!patterns.some(item=>item.id===record.id))patterns.push(record.id===pattern.id?pattern:await hydrateImportedPattern(record));
  return patterns.findIndex(item=>item.id===pattern.id);
}
export function importedDefinition(index) {
  const pattern=patterns[index];return pattern?.imported?serializeImportedPattern(pattern):undefined;
}

export function renderPatternLibrary() {
  const list=$('patterns'),levels={simple:'入门',medium:'进阶',advanced:'挑战',custom:'我的图案'};
  releaseTranslations(list);list.replaceChildren();
  for(const [index,pattern] of patterns.entries()){
    const button=document.createElement('button');button.type='button';button.className='pattern';button.dataset.index=String(index);button.setAttribute('aria-pressed','false');
    setLabel(button,'aria-label',()=>t('画{name}，{level}',{name:t(pattern.name),level:t(levels[pattern.level])}));
    if(pattern.imported){const image=new Image();image.src=pattern.mask;image.alt='';image.width=100;image.height=82;image.className='imported-pattern-image';button.append(image);}
    else {
      const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('aria-hidden','true');
      for(const d of pattern.paths.slice(0,20)){const path=document.createElementNS(ns,'path');path.setAttribute('d',d);svg.append(path);}button.append(svg);
    }
    const label=document.createElement('span'),detail=document.createElement('small');
    setText(label,()=>pattern.name);setText(detail,()=>pattern.kind==='image'?'图片底稿':pattern.kind==='svg'?'SVG · 可示范':levels[pattern.level]);
    button.append(label,detail);list.append(button);
  }
}

export function wirePatternImport(onUse,onChange) {
  const status=message=>setText($('pattern-import-status'),message);
  const controls=()=>{
    $('pattern-import-open').disabled=busy;
    $('pattern-import-trace').disabled=busy||!pending;
    $('pattern-import-watch').disabled=busy||!pending?.paths.length;
    $('pattern-import-preview').setAttribute('aria-busy',String(busy));
  };
  $('pattern-import-open').onclick=()=>$('pattern-import-file').click();
  $('pattern-import-file').onchange=async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;
    const token=++request;busy=true;controls();status('正在读取图案…');
    try {
      const next=await importPatternFile(file);if(token!==request)return;
      pending=next;$('pattern-import-image').src=next.mask;$('pattern-import-name').textContent=next.name;
      setText($('pattern-import-note'),next.paths.length?'SVG 按线条轮廓浇画，顺序以文件为准。':'图片作为描画底稿，不会自动生成糖画笔画。');
      $('pattern-import-preview').hidden=false;status('预览已就绪，选择一种玩法。');
    } catch(error){if(token===request)status(error.message);}
    finally{if(token===request){busy=false;controls();}}
  };
  const use=async mode=>{
    if(busy||!pending)return;busy=true;controls();status('正在保存图案…');
    try {
      const index=await saveImportedPattern(pending);renderPatternLibrary();onChange();
      onUse(index,mode);$('pattern-picker').open=false;$('pattern-trigger').focus({preventScroll:true});
      pending=null;$('pattern-import-preview').hidden=true;status('图片可作底稿，SVG 线稿还可自动浇画。仅保存在本机。');
    } catch(error){status(error.name==='QuotaExceededError'?'本机空间不足，图案未保存。请释放空间后重试。':error.message||'图案保存失败，请重试。');}
    finally{busy=false;controls();}
  };
  $('pattern-import-trace').onclick=()=>use('template');$('pattern-import-watch').onclick=()=>use('watch');controls();
}
