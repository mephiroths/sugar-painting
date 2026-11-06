import {createWorkId} from './work-id.js';

const ns='http://www.w3.org/2000/svg';
const maxBytes=8*1024*1024,maxPoints=24000;
const geometryTags=new Set(['path','line','polyline','polygon','rect','circle','ellipse']);
const attributes=['d','x','y','x1','y1','x2','y2','width','height','rx','ry','cx','cy','r','points','transform'];

function canvas(width=1024,height=844) {
  const result=document.createElement('canvas');result.width=width;result.height=height;return result;
}
function imageFromURL(url) {
  return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('图片无法读取，请重新选择。'));image.src=url;});
}
function maskForPaths(paths) {
  const result=canvas(),ctx=result.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,result.width,result.height);
  const sx=.083*result.width/9.1,sy=.083*result.height/7.5;
  ctx.setTransform(sx,0,0,sy,result.width/2-50*sx,result.height/2-46*sy);
  ctx.strokeStyle='#fff';ctx.lineWidth=.04/.083;ctx.lineCap='round';ctx.lineJoin='round';
  for(const path of paths)ctx.stroke(new Path2D(path));
  return result.toDataURL('image/png');
}

function svgPaths(text) {
  const parsed=new DOMParser().parseFromString(text,'image/svg+xml'),root=parsed.documentElement;
  if(parsed.doctype||parsed.querySelector('parsererror')||root.localName!=='svg')throw new Error('SVG 格式不正确，请重新选择。');
  // Copy geometry only. Never attach the uploaded SVG, scripts, linked assets,
  // CSS, events, foreignObject or animation to the document.
  const vectors=[];let total=0,nodes=0;
  const measurement=document.createElementNS(ns,'svg');measurement.setAttribute('width','100');measurement.setAttribute('height','100');
  measurement.style.cssText='position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none';measurement.setAttribute('aria-hidden','true');document.body.append(measurement);
  const viewBox=(root.getAttribute('viewBox')||'0 0 100 100').trim().split(/[\s,]+/).map(Number);
  const diagonal=viewBox.length===4&&viewBox.every(Number.isFinite)?Math.hypot(viewBox[2],viewBox[3]):141;
  function visit(element,parentMatrix) {
    if(++nodes>1000)throw new Error('图案太复杂，请精简后重试。');
    if(element.getAttribute('display')==='none'||element.getAttribute('visibility')==='hidden')return;
    const tag=element.localName;
    if(!geometryTags.has(tag)&&tag!=='g'&&element!==root)return;
    const shape=document.createElementNS(ns,geometryTags.has(tag)?tag:'g');
    for(const name of attributes)if(element.hasAttribute(name))shape.setAttribute(name,element.getAttribute(name));
    const transform=shape.transform.baseVal.consolidate()?.matrix;
    const matrix=transform?parentMatrix.multiply(new DOMMatrix([transform.a,transform.b,transform.c,transform.d,transform.e,transform.f])):parentMatrix;
    if(geometryTags.has(tag)){
      measurement.append(shape);
      const length=shape.getTotalLength();
      if(!Number.isFinite(length)||length>1e7)throw new Error('图案太复杂，请精简后重试。');
      if(length>.001){
        const count=Math.min(2000,Math.max(16,Math.ceil(length/Math.max(.1,diagonal/600)))),step=length/count;
        let points=[],previous;
        for(let i=0;i<=count;i++){
          const p=shape.getPointAtLength(i*step);
          if(previous&&Math.hypot(p.x-previous.x,p.y-previous.y)>step*4+.001){if(points.length>1)vectors.push(points);points=[];}
          const mapped=new DOMPoint(p.x,p.y).matrixTransform(matrix);
          if(!Number.isFinite(mapped.x)||!Number.isFinite(mapped.y))throw new Error('SVG 格式不正确，请重新选择。');
          points.push([mapped.x,mapped.y]);previous=p;
          if(++total>maxPoints)throw new Error('图案太复杂，请精简后重试。');
        }
        if(points.length>1)vectors.push(points);
      }
    }
    for(const child of element.children)visit(child,matrix);
  }
  try{visit(root,new DOMMatrix());}finally{measurement.remove();}
  if(!vectors.length)throw new Error('SVG 中没有线条，请先将文字或图片转为路径。');
  if(vectors.length>200)throw new Error('图案太复杂，请精简后重试。');
  const points=vectors.flat(),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const scale=Math.min(80/Math.max(.001,maxX-minX),64/Math.max(.001,maxY-minY));
  const paths=vectors.map(line=>line.map(([x,y],i)=>`${i?'L':'M'}${((x-(minX+maxX)/2)*scale+50).toFixed(3)} ${((y-(minY+maxY)/2)*scale+46).toFixed(3)}`).join(' '));
  return paths;
}

async function rasterMask(file) {
  const url=URL.createObjectURL(file);let image;
  try {image=await imageFromURL(url);}finally{URL.revokeObjectURL(url);}
  if(image.naturalWidth*image.naturalHeight>40000000)throw new Error('图片尺寸过大，请缩小后重试。');
  const result=canvas(),ctx=result.getContext('2d',{willReadFrequently:true});
  const scale=Math.min(result.width*.86/image.naturalWidth,result.height*.86/image.naturalHeight);
  ctx.drawImage(image,(result.width-image.naturalWidth*scale)/2,(result.height-image.naturalHeight*scale)/2,image.naturalWidth*scale,image.naturalHeight*scale);
  const pixels=ctx.getImageData(0,0,result.width,result.height),data=pixels.data;
  let opaque=0,light=0,borderLight=0,borderCount=0;
  const left=(result.width-image.naturalWidth*scale)/2,top=(result.height-image.naturalHeight*scale)/2;
  const right=result.width-left,bottom=result.height-top;
  for(let y=0;y<result.height;y++)for(let x=0;x<result.width;x++){
    const k=(y*result.width+x)*4,luma=.2126*data[k]+.7152*data[k+1]+.0722*data[k+2];
    if(data[k+3]>240){opaque++;light+=luma;}
    if(x>=left&&x<=right&&y>=top&&y<=bottom&&(x<left+4||x>right-4||y<top+4||y>bottom-4)&&data[k+3]>240){borderLight+=luma;borderCount++;}
  }
  const whiteInk=borderCount?borderLight/borderCount<90:opaque>0&&light/opaque>200;
  let ink=0;
  for(let i=0;i<data.length;i+=4){
    const luma=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];
    const value=Math.round((whiteInk?luma:255-luma)*data[i+3]/255);
    data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;if(value>24)ink++;
  }
  if(ink<20)throw new Error('图片中没有清晰图案，请选择线稿或对比鲜明的图片。');
  ctx.putImageData(pixels,0,0);return result.toDataURL('image/png');
}

export async function importPatternFile(file) {
  if(!file||file.size>maxBytes)throw new Error('请选择不超过 8 MB 的图案文件。');
  const svg=/\.svg$/i.test(file.name)||file.type==='image/svg+xml';
  if(!svg&&!/^image\/(png|jpeg|webp)$/.test(file.type))throw new Error('支持 PNG、JPG、WebP 图片和 SVG 线稿。');
  const paths=svg?svgPaths(await file.text()):[];
  const mask=svg?maskForPaths(paths):await rasterMask(file);
  return hydrateImportedPattern({id:'import-'+createWorkId(),name:Array.from(file.name.replace(/\.[^.]+$/,'')).slice(0,36).join('')||'导入图案',kind:svg?'svg':'image',paths,mask});
}

export function serializeImportedPattern(pattern) {
  return {id:pattern.id,name:pattern.name,kind:pattern.kind,paths:pattern.paths,mask:pattern.mask};
}
export async function hydrateImportedPattern(record) {
  if(!record||typeof record.id!=='string'||!/^import-[\w-]{1,100}$/.test(record.id)||typeof record.name!=='string'||record.name.length>100||!['image','svg'].includes(record.kind)||!Array.isArray(record.paths)||record.paths.length>200||typeof record.mask!=='string'||!record.mask.startsWith('data:image/png;base64,')||record.mask.length>6*1024*1024)throw new Error('图案数据不正确。');
  if(record.kind==='svg'&&!record.paths.length||record.kind==='image'&&record.paths.length)throw new Error('图案数据不正确。');
  let points=0;
  for(const path of record.paths){
    if(typeof path!=='string'||path.length>600000||!/^[ML\s\d.\-]+$/.test(path))throw new Error('图案数据不正确。');
    const numbers=path.match(/-?\d+(?:\.\d+)?/g)?.map(Number)||[];points+=numbers.length/2;
    if(numbers.length<4||numbers.length%2||numbers.some(n=>n<0||n>100)||points>maxPoints+200)throw new Error('图案数据不正确。');
  }
  const guideImage=await imageFromURL(record.mask);
  if(guideImage.naturalWidth!==1024||guideImage.naturalHeight!==844)throw new Error('图案数据不正确。');
  return {...serializeImportedPattern(record),imported:true,guideImage,scale:1,stick:[50,78],level:'custom',description:'导入的图案，画一份自己的甜。'};
}
