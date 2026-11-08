const DB_NAME = 'sugar-painting';
const STORE = 'drafts';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('草稿数据库被其他页面占用'));
  });
}

async function read(key) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function write(key, value) {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('保存中断'));
    });
  } finally { db.close(); }
}

export const readDraft = () => read('current');
export const readPreviousDraft = key => read('previous:'+key);

// Starting a new painting and retaining the previous one are a single commit.
// A failed write leaves both the active draft and its recovery copy untouched.
async function replaceWorkspace(key,expected,restore) {
  if(key!=='draw'&&!/^template:\d+$/.test(key))throw new Error('草稿画板不正确');
  const db=await openDatabase();
  try {
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);
      const currentRequest=store.get('current'),previousRequest=store.get('previous:'+key);
      let current,previous,currentReady=false,previousReady=false,result,failure;
      const commit=()=>{
        if(!currentReady||!previousReady)return;
        try {
          if(current&&current.version!==1)throw new Error('草稿版本不兼容');
          if(revision(current,key)!==expected)throw new Error('另一页面已更新草稿，请刷新后再开始新作。');
          const index=key.slice(9),strokes=key==='draw'?current?.own||[]:current?.templates?.[index]||[];
          const outgoing={version:1,workspace:key,updatedAt:Date.now(),strokes,surface:current?.surfaces?.[key]??null};
          if(restore&&(!previous||previous.version!==1||!Array.isArray(previous.strokes)||!previous.strokes.length))throw new Error('没有可恢复的草稿。');
          const incoming=restore?previous:{strokes:[],surface:null};
          const next={...current,version:1,updatedAt:Date.now(),own:current?.own||[],templates:{...current?.templates},surfaces:{...current?.surfaces},revisions:{...current?.revisions}};
          if(key==='draw')next.own=incoming.strokes;else next.templates[index]=incoming.strokes;
          next.surfaces[key]=incoming.surface;next.revisions[key]=revision(current,key)+1;
          if(restore||strokes.length){store.put(outgoing,'previous:'+key);previous=outgoing;}
          store.put(next,'current');
          result={revision:next.revisions[key],strokes:incoming.strokes,surface:incoming.surface,previousAvailable:!!previous?.strokes?.length};
        }catch(error){failure=error;tx.abort();}
      };
      currentRequest.onsuccess=()=>{current=currentRequest.result;currentReady=true;commit();};
      previousRequest.onsuccess=()=>{previous=previousRequest.result;previousReady=true;commit();};
      tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(failure||tx.error);tx.onabort=()=>reject(failure||tx.error||new Error('草稿保存中断'));
    });
  }finally{db.close();}
}
export const startNewDraft = (key,expected) => replaceWorkspace(key,expected,false);
export const restorePreviousDraft = (key,expected) => replaceWorkspace(key,expected,true);
export const readImportedPatterns = () => read('patterns');
export async function addImportedPattern(pattern) {
  const db=await openDatabase();
  try {
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),request=store.get('patterns');let next,failure;
      request.onsuccess=()=>{
        try {
          const current=request.result||[];if(!Array.isArray(current))throw new Error('图案数据不正确。');
          if(current.some(item=>item.id===pattern.id)){next=current;return;}
          if(current.length>=32)throw new Error('已保存 32 张导入图案，暂时无法继续添加。');
          next=[...current,pattern];store.put(next,'patterns');
        } catch(error){failure=error;tx.abort();}
      };
      tx.oncomplete=()=>resolve(next);tx.onerror=()=>reject(failure||tx.error);tx.onabort=()=>reject(failure||tx.error||new Error('图案保存失败。'));
    });
  } finally{db.close();}
}
function revision(record,key) {
  const value=record?.revisions?.[key];return Number.isSafeInteger(value)&&value>=0?value:0;
}

export async function writeDraft(draft,options) {
  if(!options)return write('current',draft);
  const db=await openDatabase();
  try {
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),request=store.get('current');
      let result,failure;
      const fail=error=>{failure=error;tx.abort();};
      request.onsuccess=()=>{
        try {
          const current=request.result;
          if(current&&current.version!==1)throw new Error('草稿版本不兼容');
          const next={...current,version:1,updatedAt:draft.updatedAt,own:current?.own||[],templates:{...current?.templates},surfaces:{...current?.surfaces},revisions:{...current?.revisions}},forks=new Set(options.forks||[]),automatic=new Set(options.autoKeys||[]),copies=[];
          result={revisions:{},forked:[],ignored:[],gallery:null};let changed=false;
          for(const key of options.keys){
            if(key!=='draw'&&!/^template:\d+$/.test(key))throw new Error('草稿画板不正确');
            const index=key.slice(9),strokes=key==='draw'?draft.own||[]:draft.templates?.[index]||[],surface=draft.surfaces?.[key]??null,expected=options.expected?.[key]??0;
            if(!forks.has(key)&&revision(current,key)!==expected&&automatic.has(key)){result.ignored.push(key);continue;}
            if(forks.has(key)||revision(current,key)!==expected){
              const metadata=options.copies?.[key];if(!metadata)throw new Error('缺少页面副本信息');
              copies.push({...metadata,image:typeof metadata.image==='function'?metadata.image():metadata.image,source:'draft-conflict',workspace:key,mode:key==='draw'?'draw':'template',pattern:key==='draw'?0:Number(index),strokes,surface,updatedAt:draft.updatedAt});result.forked.push(key);
            } else {
              if(key==='draw')next.own=strokes;else next.templates[index]=strokes;
              next.surfaces[key]=surface;next.revisions[key]=revision(current,key)+1;result.revisions[key]=next.revisions[key];changed=true;
            }
          }
          const commit=gallery=>{
            if(copies.length){
              if(!Array.isArray(gallery))throw new Error('作品簿格式不正确');
              for(const copy of copies){const index=gallery.findIndex(item=>item.id===copy.id);if(index<0)gallery.unshift(copy);else gallery[index]={...gallery[index],...copy,name:gallery[index].name,createdAt:gallery[index].createdAt};}
              store.put(gallery,'gallery');result.gallery=gallery;
            }
            if(changed)store.put(next,'current');
          };
          if(copies.length){const gallery=store.get('gallery');gallery.onsuccess=()=>{try{commit(gallery.result||[]);}catch(error){fail(error);}};}
          else commit(null);
        } catch(error){fail(error);}
      };
      tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(failure||tx.error);tx.onabort=()=>reject(failure||tx.error||new Error('草稿保存中断'));
    });
  } finally {db.close();}
}
export async function readGallery() {
  const gallery=await read('gallery');if(gallery!=null&&!Array.isArray(gallery))throw new Error('作品簿格式不正确');return gallery;
}
export async function updateGallery(update) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const request = store.get('gallery');
      let next, failure;
      request.onsuccess = () => {
        try {
          next = update(request.result || []);
          store.put(next, 'gallery');
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(next);
      tx.onerror = () => reject(failure || tx.error);
      tx.onabort = () => reject(failure || tx.error || new Error('作品簿更新中断'));
    });
  } finally { db.close(); }
}
