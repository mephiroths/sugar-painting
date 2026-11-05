// Store only the occupied rectangle, while keeping float values lossless.
export function captureSurface(source, nx, nz) {
  const [left,right,top,bottom]=source.bounds;
  if(left>right||top>bottom)return null;
  const x=Math.max(0,left-2),z=Math.max(0,top-2),endX=Math.min(nx-1,right+2),endZ=Math.min(nz-1,bottom+2);
  const width=endX-x+1,height=endZ-z+1,field=new Float32Array(width*height),heat=new Float32Array(width*height);
  for(let row=0;row<height;row++){
    const start=(z+row)*nx+x;
    field.set(source.field.subarray(start,start+width),row*width);
    heat.set(source.heat.subarray(start,start+width),row*width);
  }
  return {x,z,width,height,bounds:source.bounds.slice(),remaining:Math.max(0,source.hotUntil-source.time),field,heat};
}

export function applySurface(layer,surface) {
  if(!surface)return;
  layer.field.fill(0);layer.heat.fill(0);
  for(let row=0;row<surface.height;row++){
    const target=(surface.z+row)*layer.nx+surface.x,offset=row*surface.width;
    layer.field.set(surface.field.subarray(offset,offset+surface.width),target);
    layer.heat.set(surface.heat.subarray(offset,offset+surface.width),target);
  }
  layer.bounds=surface.bounds.slice();layer.time=0;layer.hotUntil=surface.remaining;layer.texture.needsUpdate=true;layer.updateDrawRange?.();
  layer.rebuildThermalTiles?.();
}

function encodeFloats(values) {
  const bytes=new Uint8Array(values.buffer,values.byteOffset,values.byteLength);let binary='';
  for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return btoa(binary);
}

function decodeFloats(encoded,count,max) {
  if(typeof encoded!=='string'||encoded.length!==4*Math.ceil(count*4/3))throw new Error('糖层数据长度不正确');
  const binary=atob(encoded),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  if(bytes.byteLength!==count*4)throw new Error('糖层数据长度不正确');
  const values=new Float32Array(bytes.buffer);
  for(const value of values)if(!Number.isFinite(value)||value<0||value>max)throw new Error('糖层数据不正确');
  return values;
}

export function encodeSurface(surface) {
  if(!surface)return null;
  return {...surface,field:encodeFloats(surface.field),heat:encodeFloats(surface.heat)};
}

export function decodeSurface(record,nx,nz) {
  if(record==null)return null;
  const {x,z,width,height,bounds,remaining}=record;
  if(![x,z,width,height].every(Number.isInteger)||x<0||z<0||width<1||height<1||x+width>nx||z+height>nz||!Array.isArray(bounds)||bounds.length!==4||!bounds.every(Number.isInteger)||bounds[0]<-2||bounds[1]>nx+1||bounds[2]<-2||bounds[3]>nz+1||bounds[0]>bounds[1]||bounds[2]>bounds[3]||!Number.isFinite(remaining)||remaining<0||remaining>5)throw new Error('糖层数据范围不正确');
  return {x,z,width,height,bounds:bounds.slice(),remaining,field:decodeFloats(record.field,width*height,.2),heat:decodeFloats(record.heat,width*height,1.01)};
}
