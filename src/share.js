import {t, getLocale, setText} from './i18n.js';
import {uiAssets} from './folk-ui.js';

// A studio invitation deliberately carries no local artwork, IDs or tracking data.
export function experienceUrl(href, locale, mode, pattern) {
  const url=new URL(href),host=url.hostname.toLowerCase();
  if(!['https:','http:'].includes(url.protocol)||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.includes(':')||/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host))return null;
  url.search='';url.hash='';url.username='';url.password='';
  url.searchParams.set('lang',locale);
  if(mode==='template'){url.searchParams.set('mode','template');if(pattern)url.searchParams.set('pattern',pattern);}
  else if(mode==='draw')url.searchParams.set('mode','draw');
  return url.href;
}

export function shareFilename(name) {
  return (Array.from(name).slice(0,40).join('').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').trim()||'Sugar-Painting')+'-share.png';
}

function wrapText(ctx,text,x,y,width,lineHeight,maxLines) {
  let line='',row=0;
  const chars=Array.from(text);
  for(let i=0;i<chars.length;i++){
    const char=chars[i];
    if(ctx.measureText(line+char).width>width&&line){
      if(row===maxLines-1){while(line&&ctx.measureText(line+'…').width>width)line=Array.from(line).slice(0,-1).join('');ctx.fillText(line+'…',x,y+row*lineHeight);return;}
      ctx.fillText(line,x,y+row*lineHeight);row++;line='';
    }
    line+=char;
  }
  ctx.fillText(line,x,y+row*lineHeight);
}

export async function createSharePoster(snapshot,name,demonstration=false) {
  const image=new Image();image.src=snapshot;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=1500;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas unavailable');
  const css=getComputedStyle(document.documentElement),ink=css.getPropertyValue('--color-ink').trim(),accent=css.getPropertyValue('--color-accent').trim(),muted=css.getPropertyValue('--color-muted').trim();
  const body=css.getPropertyValue('--font-body').trim(),display=css.getPropertyValue('--font-display').trim();
  ctx.fillStyle=css.getPropertyValue('--color-paper').trim();ctx.fillRect(0,0,1200,1500);
  const paper=new Image(),sign=new Image();paper.src=uiAssets.paper;sign.src=uiAssets.sign;
  await Promise.all([paper.decode(),sign.decode()]);
  ctx.drawImage(paper,0,0,1200,1500);ctx.drawImage(sign,48,30,360,125);
  ctx.fillStyle=muted;ctx.font=`22px ${body}`;ctx.fillText('中国糖画 · SUGAR PAINTING',710,112);
  const scale=Math.min(1080/image.width,900/image.height),w=image.width*scale,h=image.height*scale;
  ctx.drawImage(image,60+(1080-w)/2,186+(900-h)/2,w,h);
  ctx.fillStyle=accent;ctx.font=`23px ${body}`;ctx.fillText(t(demonstration?'糖画演示':'我的糖画'),60,1138);
  ctx.fillStyle=ink;ctx.font=`52px ${display}`;wrapText(ctx,name,60,1207,1080,62,2);
  ctx.fillStyle=muted;ctx.font=`26px ${body}`;wrapText(ctx,t('糖画是中国民间手艺，以糖为材料，用小勺在石板上浇出图案。'),60,1350,1080,38,2);
  ctx.fillStyle=accent;ctx.font=`23px ${body}`;ctx.fillText(t('中国传统糖画 · 数字体验'),60,1450);
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Poster unavailable')),'image/png'));
}

export function createSharing(capture,onError,onClose) {
  const $=id=>document.getElementById(id),dialog=$('share-dialog');
  let generation=0,asset=null,objectUrl=null,source=null,opener=null;
  function status(message){setText($('share-status'),message);}
  function clearAsset(){asset=null;if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;$('share-preview').removeAttribute('src');$('share-preview').hidden=true;$('share-download').removeAttribute('href');$('share-download').setAttribute('aria-disabled','true');$('share-native').disabled=true;}
  async function prepare(){
    const token=++generation;clearAsset();$('share-retry').hidden=true;
    const link=experienceUrl(location.href,getLocale(),source.mode,source.pattern);
    $('share-link').value=link||'';$('share-copy').disabled=!link;$('share-link-row').hidden=!link;
    setText($('share-link-note'),link?'体验链接邀请朋友来画糖，不包含这幅本机作品；请同时发送海报。':'本地预览无法生成公开链接。上线后可复制体验链接，现在可以分享海报。');
    status('正在制作分享海报…');
    try {
      const blob=await createSharePoster(source.snapshot,source.name,source.demonstration);
      if(token!==generation||!dialog.open)return;
      asset=new File([blob],shareFilename(source.name),{type:'image/png'});objectUrl=URL.createObjectURL(blob);
      $('share-preview').src=objectUrl;$('share-preview').hidden=false;
      $('share-download').href=objectUrl;$('share-download').download=asset.name;$('share-download').removeAttribute('aria-disabled');
      let supported=false;try{supported=!!navigator.share&&!!navigator.canShare?.({files:[asset]});}catch{/* File sharing is optional. */}
      $('share-native').disabled=!supported;
      status(supported?'海报已就绪，可分享或下载。':'海报已就绪。当前浏览器不支持文件分享，请下载后发送。');
    }catch{
      if(token!==generation||!dialog.open)return;
      status('海报生成失败，请重试。原作品仍保留。');$('share-retry').hidden=false;
    }
  }
  function open(event){
    if(dialog.open)return;
    try{source=capture();if(!source)return;}
    catch{onError?.();return;}
    opener=event?.currentTarget instanceof HTMLElement?event.currentTarget:document.activeElement;dialog.showModal();prepare();
  }
  $('share-close').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{generation++;clearAsset();source=null;const menu=opener?.closest('details');(menu&&!menu.open?menu.querySelector('summary'):opener)?.focus({preventScroll:true});onClose?.();});
  $('share-retry').onclick=()=>prepare();
  $('share-download').onclick=event=>{if(!asset)event.preventDefault();};
  $('share-native').onclick=async()=>{
    if(!asset)return;
    const token=generation,file=asset;$('share-native').disabled=true;
    try{
      // Call directly from the click: awaiting poster creation loses activation.
      await navigator.share({files:[file],title:source.name,text:t('以勺为笔，把流动的糖画成一份祝福。')});
      if(token===generation&&dialog.open)status('已交给系统分享。');
    }catch(error){if(token===generation&&dialog.open)status(error.name==='AbortError'?'已取消分享，海报仍可下载。':'系统分享未完成，可以下载海报后发送。');}
    finally{if(token===generation&&dialog.open)$('share-native').disabled=false;}
  };
  $('share-copy').onclick=async()=>{
    if(!$('share-link').value)return;
    const token=generation;
    try{await navigator.clipboard.writeText($('share-link').value);if(token===generation&&dialog.open)status('体验链接已复制；发送海报，让朋友看到你的作品。');}
    catch{if(token===generation&&dialog.open){$('share-link').focus();$('share-link').select();status('无法自动复制，请复制已选中的链接。');}}
  };
  $('language').addEventListener('change',()=>{if(dialog.open)prepare();});
  return {open,close:()=>{if(dialog.open)dialog.close();}};
}
