const fallback='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#f3eddf"/><text x="160" y="108" text-anchor="middle" font-family="KaiTi,serif" font-size="32" fill="#a33927">页面副本</text><text x="160" y="147" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#6c5b44">打开后可继续画</text></svg>');

export function createDraftPreview(surface,grid) {
  try {
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const ctx=canvas.getContext('2d');if(!ctx)return fallback;
    ctx.fillStyle='#f3eddf';ctx.fillRect(0,0,640,480);
    const scale=Math.min(608/grid.width,448/grid.depth),width=grid.width*scale,height=grid.depth*scale,left=(640-width)/2,top=(480-height)/2;
    ctx.fillStyle='#f9faf6';ctx.fillRect(left,top,width,height);
    if(surface){
      const image=ctx.getImageData(0,0,640,480),pixels=image.data;
      for(let y=Math.ceil(top);y<top+height;y++){
        const gz=(y-top)/height*(grid.nz-1)-surface.z;if(gz<0||gz>surface.height-1)continue;
        const z=Math.min(surface.height-1,Math.floor(gz)),nextZ=Math.min(surface.height-1,z+1),fz=gz-z;
        for(let x=Math.ceil(left);x<left+width;x++){
          const gx=(x-left)/width*(grid.nx-1)-surface.x;if(gx<0||gx>surface.width-1)continue;
          const column=Math.min(surface.width-1,Math.floor(gx)),nextX=Math.min(surface.width-1,column+1),fx=gx-column;
          const a=surface.field[z*surface.width+column]*(1-fx)+surface.field[z*surface.width+nextX]*fx,b=surface.field[nextZ*surface.width+column]*(1-fx)+surface.field[nextZ*surface.width+nextX]*fx,h=a*(1-fz)+b*fz;
          if(h<.0015)continue;
          const strength=Math.min(1,h/.07)**.35,index=(y*640+x)*4;
          pixels[index]=249+(168-249)*strength;pixels[index+1]=250+(105-250)*strength;pixels[index+2]=246+(31-246)*strength;
        }
      }
      ctx.putImageData(image,0,0);
    }
    const image=canvas.toDataURL('image/jpeg',.8);return image.startsWith('data:image/')?image:fallback;
  } catch {return fallback;}
}
