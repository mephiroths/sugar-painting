import {createWorkId} from './work-id.js';
import {t} from './i18n.js';

export function mergeGalleryBackup(existing,incoming) {
  const byId=new Map(existing.map(item=>[item.id,item])),bySource=new Map(),signatures=new WeakMap(),added=[];let versionCopies=0;
  const register=item=>{if(typeof item.importedFrom==='string'){if(!bySource.has(item.importedFrom))bySource.set(item.importedFrom,[]);bySource.get(item.importedFrom).push(item);}};
  for(const item of existing)register(item);
  const originalName=item=>typeof item.importedName==='string'?item.importedName:item.name;
  const signature=item=>{
    if(!signatures.has(item))signatures.set(item,JSON.stringify({name:originalName(item),mode:item.mode,pattern:item.pattern,strokes:item.strokes,surface:item.surface??null,recovery:item.source==='draft-conflict'}));
    return signatures.get(item);
  };
  for(const item of incoming){
    const previous=byId.get(item.id);
    if(previous){
      const content=signature(item);
      if(signature(previous)===content||(bySource.get(item.id)||[]).some(version=>signature(version)===content))continue;
      const name=originalName(item),copy={...item,id:createWorkId(),name:Array.from(name).slice(0,34).join('')+t('（导入副本）'),importedFrom:item.id,importedName:name};
      added.push(copy);byId.set(copy.id,copy);register(copy);versionCopies++;
    } else {added.push(item);byId.set(item.id,item);register(item);}
  }
  return{items:[...added,...existing],versionCopies};
}
