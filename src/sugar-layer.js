import * as THREE from 'three';
import { createSugarSolid } from './sugar-solid.js';

function addRowRange(rows,z,start,end) {
  if(!rows.has(z))rows.set(z,[]);
  rows.get(z).push([start,end]);
}

function mergeRowRanges(rows) {
  const runs=[];
  for(const [z,ranges]of [...rows].sort((a,b)=>a[0]-b[0])){
    ranges.sort((a,b)=>a[0]-b[0]);
    let [start,end]=ranges[0];
    for(const [left,right]of ranges.slice(1)){
      if(left<=end+1)end=Math.max(end,right);
      else {runs.push([z,start,end]);start=left;end=right;}
    }
    runs.push([z,start,end]);
  }
  return runs;
}

// Sugar is a single height field, rather than overlapping cylinders. Both the
// optical path length and the surface normals come from this same volume.
export class SugarLayer {
  constructor(scene) {
    this.width=9.1;this.depth=7.5;this.nx=768;this.nz=632;
    this.dx=this.width/(this.nx-1);this.dz=this.depth/(this.nz-1);
    const n=this.nx*this.nz;
    this.field=new Float32Array(n);this.base=new Float32Array(n);this.stroke=new Float32Array(n);
    this.heat=new Float32Array(n);this.delta=new Float32Array(n);
    this.thermalTileSize=16;this.thermalColumns=Math.ceil(this.nx/this.thermalTileSize);this.thermalTiles=new Set();this.thermalPeaks=new Float32Array(this.thermalColumns*Math.ceil(this.nz/this.thermalTileSize));this.lastSettleCells=0;this.denseCoolingRows=null;
    this.texture=new THREE.DataTexture(this.field,this.nx,this.nz,THREE.RedFormat,THREE.FloatType);
    this.texture.minFilter=this.texture.magFilter=THREE.LinearFilter;this.texture.generateMipmaps=false;
    this.texture.needsUpdate=true;this.time=0;this.hotUntil=0;this.currentStroke=-1;this.drawn=0;
    this.records=[];this.radius=.065;this.bounds=[this.nx,0,this.nz,0];
    this.uniforms={sugarHeight:{value:this.texture},sugarTexel:{value:new THREE.Vector2(1/this.nx,1/this.nz)},sugarSize:{value:new THREE.Vector2(this.width,this.depth)},sugarContactEnabled:{value:1}};
    // The shader softens the contour with fractional alpha. Blend it over the
    // opaque stone so the canvas keeps alpha=1; overwriting canvas alpha without
    // blending makes its premultiplied color turn into a bright fringe on export.
    this.material=new THREE.MeshPhysicalMaterial({color:'#ffffff',metalness:0,roughness:.13,transmission:1,thickness:.1,ior:1.49,clearcoat:0,attenuationColor:new THREE.Color('#f6b750'),attenuationDistance:.058,envMapIntensity:.7,specularIntensity:.8,transparent:true});
    this.material.onBeforeCompile=shader=>this.patchMaterial(shader);
    this.material.customProgramCacheKey=()=> 'sugar-continuous-volume-v4';
    this.cellsX=512;this.cellsZ=420;
    const geometry=new THREE.PlaneGeometry(this.width,this.depth,this.cellsX,this.cellsZ);
    geometry.rotateX(-Math.PI/2);
    // Plane UV.y increases toward -Z; use explicit field coordinates throughout.
    const uv=geometry.attributes.uv;
    for(let i=0;i<uv.count;i++)uv.setY(i,1-uv.getY(i));
    this.mesh=new THREE.Mesh(geometry,this.material);this.mesh.position.y=.004;
    this.mesh.castShadow=false;this.mesh.receiveShadow=false;this.mesh.frustumCulled=false;this.mesh.name='连续琥珀糖层';scene.add(this.mesh);
    this.updateDrawRange();
  }

  updateDrawRange() {
    const [, ,z0,z1]=this.bounds,geometry=this.mesh.geometry;
    if(z0>z1){geometry.setDrawRange(0,0);return;}
    const first=Math.max(0,Math.floor(z0/(this.nz-1)*this.cellsZ)-2);
    const last=Math.min(this.cellsZ,Math.ceil(z1/(this.nz-1)*this.cellsZ)+2);
    const indicesPerRow=this.cellsX*6;geometry.setDrawRange(first*indicesPerRow,(last-first)*indicesPerRow);
  }

  markThermalTiles(x0,x1,z0,z1,heat=1) {
    if(x0>x1||z0>z1)return;
    const size=this.thermalTileSize;
    for(let z=Math.floor(z0/size);z<=Math.floor(z1/size);z++)for(let x=Math.floor(x0/size);x<=Math.floor(x1/size);x++){
      const tile=z*this.thermalColumns+x;this.thermalTiles.add(tile);this.thermalPeaks[tile]=Math.max(this.thermalPeaks[tile],heat);
    }
  }

  rebuildThermalTiles() {
    this.thermalTiles.clear();this.thermalPeaks.fill(0);this.lastSettleCells=0;
    const [x0,x1,z0,z1]=this.bounds,size=this.thermalTileSize;
    for(let z=Math.max(1,z0);z<=Math.min(this.nz-1,z1);z++)for(let x=Math.max(1,x0);x<=Math.min(this.nx-1,x1);x++){
      const heat=this.heat[z*this.nx+x];if(heat<.01)continue;
      const tile=Math.floor(z/size)*this.thermalColumns+Math.floor(x/size);this.thermalPeaks[tile]=Math.max(this.thermalPeaks[tile],heat);
    }
    for(let tile=0;tile<this.thermalPeaks.length;tile++)if(this.thermalPeaks[tile]>=.01)this.thermalTiles.add(tile);
  }

  thermalRuns() {
    const rows=new Map(),size=this.thermalTileSize,[x0,x1,z0,z1]=this.bounds;
    for(const tile of this.thermalTiles){
      const tx=tile%this.thermalColumns,tz=Math.floor(tile/this.thermalColumns);
      // A pair starts to the left or above a hot cell too. Include that halo,
      // then merge all rows so overlapping tiles never transfer mass twice.
      const left=Math.max(1,x0,tx*size-1),right=Math.min(this.nx-2,x1,(tx+1)*size-1);
      if(left>right)continue;
      for(let z=Math.max(1,z0,tz*size-1);z<=Math.min(this.nz-2,z1,(tz+1)*size-1);z++)addRowRange(rows,z,left,right);
    }
    return mergeRowRanges(rows);
  }

  denseThermalRuns(minX,maxX,minZ,maxZ) {
    const key=[minX,maxX,minZ,maxZ].join(',');
    if(this.denseCoolingRows?.key!==key)this.denseCoolingRows={key,pairs:Array.from({length:maxZ-minZ+1},(_,i)=>[minZ+i,minX,maxX]),updates:Array.from({length:maxZ-minZ+2},(_,i)=>[minZ+i,minX,maxX+1])};
    return this.denseCoolingRows;
  }

  patchMaterial(shader) {
    Object.assign(shader.uniforms,this.uniforms);
    const common=`
      uniform sampler2D sugarHeight;
      uniform vec2 sugarTexel;
      uniform vec2 sugarSize;
      varying vec2 sugarUv;
      float sugarH(vec2 p){return texture2D(sugarHeight,p).r;}
    `;
    shader.vertexShader=common+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',`
      vec2 suv=uv;
      float hl=sugarH(suv-vec2(sugarTexel.x,0.));
      float hr=sugarH(suv+vec2(sugarTexel.x,0.));
      float hb=sugarH(suv-vec2(0.,sugarTexel.y));
      float hf=sugarH(suv+vec2(0.,sugarTexel.y));
      vec3 objectNormal=normalize(vec3((hl-hr)/(2.*sugarTexel.x*sugarSize.x),1.,(hb-hf)/(2.*sugarTexel.y*sugarSize.y)));
    `).replace('#include <begin_vertex>',`
      sugarUv=uv;
      vec3 transformed=vec3(position.x,sugarH(uv),position.z);
    `);
    shader.fragmentShader=common+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',`
      #include <clipping_planes_fragment>
      float syrupDepth=sugarH(sugarUv);
      if(syrupDepth<.0015)discard;
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_begin>',`
      #include <normal_fragment_begin>
      float sx=(sugarH(sugarUv+vec2(2.*sugarTexel.x,0.))-sugarH(sugarUv-vec2(2.*sugarTexel.x,0.)))/(4.*sugarTexel.x*sugarSize.x);
      float sz=(sugarH(sugarUv+vec2(0.,2.*sugarTexel.y))-sugarH(sugarUv-vec2(0.,2.*sugarTexel.y)))/(4.*sugarTexel.y*sugarSize.y);
      vec3 liquidNormal=normalize(vec3(-sx,1.,-sz));
      normal=normalize(mat3(viewMatrix)*liquidNormal);
      nonPerturbedNormal=normal;
    `);
    // Beer-Lambert absorption uses local measured depth, not a constant tint.
    shader.fragmentShader=shader.fragmentShader.replace('#include <transmission_fragment>',THREE.ShaderChunk.transmission_fragment.replace('material.thickness = thickness;','material.thickness = max(.002, syrupDepth * 1.45);'));
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`
      #include <roughnessmap_fragment>
      roughnessFactor=.13+.025*smoothstep(.02,.12,syrupDepth);
    `);
    // Sparse trapped air: small clear centers and fine pale rims, visible only
    // near the surface at macro scale. No decorative glitter or opaque dots.
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
      vec2 bubbleCell=floor(sugarUv*sugarSize*43.);
      float bubbleSeed=fract(sin(dot(bubbleCell,vec2(127.1,311.7)))*43758.5453);
      vec2 bubbleLocal=fract(sugarUv*sugarSize*43.)-.5;
      float bubbleRadius=.09+.14*fract(bubbleSeed*173.);
      float bubbleDistance=length(bubbleLocal);
      float bubbleRing=(1.-smoothstep(.012,.055,abs(bubbleDistance-bubbleRadius)))*step(.956,bubbleSeed)*smoothstep(.025,.065,syrupDepth);
      vec2 bubbleGrid=sugarUv*sugarSize*43.;
      float bubblePixel=max(length(dFdx(bubbleGrid)),length(dFdy(bubbleGrid)));
      float bubbleVisibility=1.-smoothstep(.08,.3,bubblePixel);
      outgoingLight+=vec3(.15,.12,.06)*bubbleRing*bubbleVisibility;
      #include <opaque_fragment>
      gl_FragColor.a*=smoothstep(.0015,.0015+max(fwidth(syrupDepth),.001),syrupDepth);
    `);
  }

  attachMarble(material,guide=null) {
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,this.uniforms);
      if(guide)Object.assign(shader.uniforms,guide.uniforms);
      shader.vertexShader='varying vec3 marbleWorld;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nmarbleWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
      shader.fragmentShader='uniform sampler2D sugarHeight;uniform vec2 sugarSize;uniform vec2 sugarTexel;uniform float sugarContactEnabled;varying vec3 marbleWorld;\n'+shader.fragmentShader;
      if(guide)shader.fragmentShader='uniform sampler2D guideMask;uniform float guideEnabled;uniform float guideOpacity;uniform vec3 guideInk;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`
        #include <color_fragment>
        vec2 honeyUV=marbleWorld.xz/sugarSize+.5;
        if(marbleWorld.y>-.035 && all(greaterThan(honeyUV,vec2(0.))) && all(lessThan(honeyUV,vec2(1.)))){
          float depth=texture2D(sugarHeight,honeyUV+vec2(.003,-.002)).r*sugarContactEnabled;
          float side=texture2D(sugarHeight,honeyUV+vec2(.008,-.004)).r*sugarContactEnabled;
          float amberShadow=1.-exp(-depth*9.);
          diffuseColor.rgb*=mix(vec3(1.),vec3(1.,.79,.43),amberShadow*.32);
          float caustic=clamp(abs(depth-side)*13.,0.,.55);
          diffuseColor.rgb+=vec3(.075,.045,.009)*caustic;
          ${guide?'float printedGuide=texture2D(guideMask,honeyUV).r*guideEnabled*guideOpacity;diffuseColor.rgb=mix(diffuseColor.rgb,guideInk,printedGuide);':''}
        }
      `);
    };
    material.customProgramCacheKey=()=> guide?'marble-sugar-contact-template-v4':'marble-sugar-contact-v3';
  }

  heightAt(x,z) {
    const gx=(x+this.width/2)/this.dx,gz=(z+this.depth/2)/this.dz;
    if(gx<0||gz<0||gx>this.nx-1||gz>this.nz-1)return 0;
    const ix=Math.min(this.nx-2,Math.floor(gx)),iz=Math.min(this.nz-2,Math.floor(gz));
    const fx=gx-ix,fz=gz-iz,i=iz*this.nx+ix;
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(this.field[i],this.field[i+1],fx),THREE.MathUtils.lerp(this.field[i+this.nx],this.field[i+this.nx+1],fx),fz);
  }

  stickAnchor() {
    const [x0,x1,z0,z1]=this.bounds,center=(x0+x1)/2;
    let bottom=-1,bestX=-1,bestZ=-1;
    for(let z=Math.min(this.nz-2,z1);z>=Math.max(1,z0);z--){
      if(bottom>=0&&(bottom-z)*this.dz>.16)break;
      for(let x=Math.max(1,x0);x<=Math.min(this.nx-2,x1);x++){
        if(this.field[z*this.nx+x]<=.006)continue;
        if(bottom<0)bottom=z;
        if(bestX<0||Math.abs(x-center)<Math.abs(bestX-center)){bestX=x;bestZ=z;}
      }
    }
    return bestX<0?null:new THREE.Vector3(bestX*this.dx-this.width/2,.012,bestZ*this.dz-this.depth/2);
  }

  createSolid() {
    return createSugarSolid(this);
  }

  reset(records,radius) {
    this.field.fill(0);this.base.fill(0);this.stroke.fill(0);this.heat.fill(0);
    this.records=records;this.radius=radius;this.drawn=0;this.currentStroke=-1;
    this.bounds=[this.nx,0,this.nz,0];this.hotUntil=0;this.texture.needsUpdate=true;this.updateDrawRange();
    this.thermalTiles.clear();this.thermalPeaks.fill(0);this.lastSettleCells=0;this.denseCoolingRows=null;
  }

  startStroke(index) {
    if(this.currentStroke===index)return;
    this.base.set(this.field);this.stroke.fill(0);this.currentStroke=index;
  }

  stamp(a,b,radius,height,heat=1) {
    const minX=Math.max(1,Math.floor((Math.min(a.x,b.x)-radius+this.width/2)/this.dx));
    const maxX=Math.min(this.nx-2,Math.ceil((Math.max(a.x,b.x)+radius+this.width/2)/this.dx));
    const minZ=Math.max(1,Math.floor((Math.min(a.z,b.z)-radius+this.depth/2)/this.dz));
    const maxZ=Math.min(this.nz-2,Math.ceil((Math.max(a.z,b.z)+radius+this.depth/2)/this.dz));
    const ax=a.x,az=a.z,vx=b.x-ax,vz=b.z-az,len2=vx*vx+vz*vz;
    this.bounds[0]=Math.min(this.bounds[0],minX-2);this.bounds[1]=Math.max(this.bounds[1],maxX+2);this.bounds[2]=Math.min(this.bounds[2],minZ-2);this.bounds[3]=Math.max(this.bounds[3],maxZ+2);
    for(let j=minZ;j<=maxZ;j++)for(let i=minX;i<=maxX;i++){
      const x=i*this.dx-this.width/2,z=j*this.dz-this.depth/2;
      const t=len2>1e-9?THREE.MathUtils.clamp(((x-ax)*vx+(z-az)*vz)/len2,0,1):0;
      const d2=((x-ax-vx*t)**2+(z-az-vz*t)**2)/(radius*radius);
      if(d2>=1)continue;
      const h=height*Math.pow(1-d2,.72),idx=j*this.nx+i;
      if(h<=this.stroke[idx])continue;
      this.stroke[idx]=h;
      // A smooth union makes crossings a single rounded pool, while preserving
      // shallow edges and avoiding the opaque seams of intersecting meshes.
      const base=this.base[idx];this.field[idx]=Math.pow(base**3+h**3,1/3);
      this.heat[idx]=Math.max(this.heat[idx],heat);
    }
    this.hotUntil=this.time+1.4;
    if(heat>=.01)this.markThermalTiles(minX,maxX,minZ,maxZ,heat);
  }

  drawTo(distance,hot=true) {
    if(distance<this.drawn-1e-7){const records=this.records,r=this.radius;this.reset(records,r);}
    for(let index=0;index<this.records.length;index++){
      const rec=this.records[index],end=Math.min(rec.length,distance-rec.start),begin=Math.max(0,this.drawn-rec.start);
      if(end<=begin||end<=0)continue;
      this.startStroke(index);
      const steps=Math.max(1,Math.ceil((end-begin)/.022));
      let prev=rec.curve.getPointAt(begin/rec.length);
      for(let k=1;k<=steps;k++){
        const s=begin+(end-begin)*k/steps,t=THREE.MathUtils.clamp(s/rec.length,0,1);
        const p=rec.curve.getPointAt(t),tangent=rec.curve.getTangentAt(t);
        const near=rec.curve.getTangentAt(Math.max(0,t-.012));
        const curvature=1-THREE.MathUtils.clamp(tangent.dot(near),-1,1);
        const variation=1+.105*Math.sin(s*6.1+index*2.31)+.045*Math.sin(s*19.7+index);
        const slowCorner=1+Math.min(.48,curvature*4.5);
        const startBulb=1+.27*Math.exp(-s/.10),endTaper=.7+.3*Math.min(1,(rec.length-s)/.07);
        const radius=this.radius*1.12*variation*Math.sqrt(slowCorner)*Math.sqrt(startBulb)*endTaper;
        const height=this.radius*1.02*(.93+.14*Math.sin(s*3.1+index))*Math.sqrt(slowCorner);
        this.stamp(prev,p,radius,height,hot?1:0);prev=p;
      }
    }
    this.drawn=distance;this.texture.needsUpdate=true;this.updateDrawRange();
  }

  drawSegment(a,b,index,radius) {
    this.startStroke(index);this.stamp(a,b,radius*1.12,radius*1.02,1);this.texture.needsUpdate=true;this.updateDrawRange();
  }

  deposit(a,b,volume,radius,hot=true) {
    if(volume<=0)return;
    const x0=Math.max(1,Math.floor((Math.min(a.x,b.x)-radius+this.width/2)/this.dx));
    const x1=Math.min(this.nx-2,Math.ceil((Math.max(a.x,b.x)+radius+this.width/2)/this.dx));
    const z0=Math.max(1,Math.floor((Math.min(a.z,b.z)-radius+this.depth/2)/this.dz));
    const z1=Math.min(this.nz-2,Math.ceil((Math.max(a.z,b.z)+radius+this.depth/2)/this.dz));
    const vx=b.x-a.x,vz=b.z-a.z,l2=vx*vx+vz*vz,weights=[];
    let sum=0;
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
      const px=x*this.dx-this.width/2-a.x,pz=z*this.dz-this.depth/2-a.z;
      const t=l2>1e-10?THREE.MathUtils.clamp((px*vx+pz*vz)/l2,0,1):0;
      const d2=((px-vx*t)**2+(pz-vz*t)**2)/(radius*radius);
      if(d2>=1)continue;const weight=Math.pow(1-d2,.72),index=z*this.nx+x;
      weights.push(index,weight);sum+=weight;
    }
    if(sum===0)return;
    const scale=volume/(sum*this.dx*this.dz);
    let excess=0;
    const maxDepth=.10;
    for(let i=0;i<weights.length;i+=2){
      const idx=weights[i],h=this.field[idx]+weights[i+1]*scale;
      this.field[idx]=Math.min(maxDepth,h);excess+=Math.max(0,h-maxDepth);if(hot)this.heat[idx]=1;
    }
    // A lingering hand makes a round pool, never a voxel-height spike. Move
    // excess volume into a wider cap without deleting any of the emitted mass.
    if(excess>0){
      const cx=(a.x+b.x)*.5,cz=(a.z+b.z)*.5;
      let poolRadius=Math.max(.08,radius*1.8);
      for(let pass=0;pass<8&&excess>1e-8;pass++,poolRadius*=1.55){
        const px0=Math.max(1,Math.floor((cx-poolRadius+this.width/2)/this.dx)),px1=Math.min(this.nx-2,Math.ceil((cx+poolRadius+this.width/2)/this.dx));
        const pz0=Math.max(1,Math.floor((cz-poolRadius+this.depth/2)/this.dz)),pz1=Math.min(this.nz-2,Math.ceil((cz+poolRadius+this.depth/2)/this.dz));
        const capacities=[];let capacity=0;
        for(let z=pz0;z<=pz1;z++)for(let x=px0;x<=px1;x++){
          const d2=((x*this.dx-this.width/2-cx)**2+(z*this.dz-this.depth/2-cz)**2)/(poolRadius*poolRadius);
          if(d2>=1)continue;const idx=z*this.nx+x,room=Math.max(0,maxDepth*.85*Math.pow(1-d2,.72)-this.field[idx]);
          if(room>0){capacities.push(idx,room);capacity+=room;}
        }
        const fraction=capacity>0?Math.min(1,excess/capacity):0;
        for(let i=0;i<capacities.length;i+=2){const idx=capacities[i];this.field[idx]+=capacities[i+1]*fraction;if(hot)this.heat[idx]=1;}
        if(hot&&fraction>0)this.markThermalTiles(px0,px1,pz0,pz1);
        excess-=capacity*fraction;
        this.bounds[0]=Math.min(this.bounds[0],px0-2);this.bounds[1]=Math.max(this.bounds[1],px1+2);this.bounds[2]=Math.min(this.bounds[2],pz0-2);this.bounds[3]=Math.max(this.bounds[3],pz1+2);
      }
    }
    this.bounds[0]=Math.min(this.bounds[0],x0-2);this.bounds[1]=Math.max(this.bounds[1],x1+2);this.bounds[2]=Math.min(this.bounds[2],z0-2);this.bounds[3]=Math.max(this.bounds[3],z1+2);
    if(hot){this.hotUntil=this.time+.55;this.markThermalTiles(x0,x1,z0,z1);}this.texture.needsUpdate=true;this.updateDrawRange();
  }

  restore(deposits) {
    for(const d of deposits)this.deposit(new THREE.Vector3(d.a[0],0,d.a[1]),new THREE.Vector3(d.b[0],0,d.b[1]),d.volume,d.radius,false);
  }

  capture() {
    return {field:this.field.slice(),heat:this.heat.slice(),bounds:this.bounds.slice(),time:this.time,hotUntil:this.hotUntil};
  }

  restoreCapture(snapshot) {
    this.field.set(snapshot.field);this.heat.set(snapshot.heat);this.bounds=snapshot.bounds.slice();
    this.time=snapshot.time;this.hotUntil=snapshot.hotUntil;this.texture.needsUpdate=true;this.updateDrawRange();
    this.rebuildThermalTiles();
  }

  settle(dt) {
    this.lastSettleCells=0;this.time+=dt;if(this.time>this.hotUntil||dt===0||!this.thermalTiles.size)return false;
    const [x0,x1,z0,z1]=this.bounds,minX=Math.max(1,x0),maxX=Math.min(this.nx-2,x1),minZ=Math.max(1,z0),maxZ=Math.min(this.nz-2,z1);
    if(minX>maxX||minZ>maxZ)return false;
    // Dense heat is cheaper to scan directly than to sort many overlapping
    // islands. Sparse additions retain the same row-major pair ordering.
    const dense=this.thermalTiles.size*this.thermalTileSize**2>(maxX-minX+1)*(maxZ-minZ+1)/8;
    const rectangle=dense?this.denseThermalRuns(minX,maxX,minZ,maxZ):null;
    const runs=dense?rectangle.pairs:this.thermalRuns(),updates=dense?null:new Map();
    if(!runs.length)return false;
    const f=this.field,d=this.delta,nx=this.nx;d.fill(0);
    const amount=Math.min(.025,dt*.75),cooling=Math.exp(-dt*8.0);
    for(const [z,start,end]of runs){
      this.lastSettleCells+=end-start+1;
      if(updates){addRowRange(updates,z,start,end+1);addRowRange(updates,z+1,start,end+1);}
      for(let x=start;x<=end;x++){
        const idx=z*nx+x,h=f[idx];
        if(this.heat[idx]<.01&&this.heat[idx+1]<.01&&this.heat[idx+nx]<.01)continue;
        for(const j of [idx+1,idx+nx]){
          const higher=h>=f[j]?idx:j,high=f[higher],heat=this.heat[higher];
          if(heat<.01||high<.002)continue;
          const mobility=amount*Math.min(1,(high/.075)**2)*heat;
          const transfer=(h-f[j])*mobility;d[idx]-=transfer;d[j]+=transfer;
        }
      }
    }
    const updateRuns=dense?rectangle.updates:mergeRowRanges(updates);
    for(const [z,start,end]of updateRuns)for(let x=start;x<=end;x++){
      const i=z*nx+x;f[i]=Math.max(0,f[i]+d[i]);this.heat[i]*=cooling;
    }
    // Every active tile's hot cells cool by the same factor. A Float32 upper
    // bound avoids per-cell Set updates and cannot drop a moving cell early.
    for(const tile of this.thermalTiles){this.thermalPeaks[tile]*=cooling;if(this.thermalPeaks[tile]<.01)this.thermalTiles.delete(tile);}
    this.texture.needsUpdate=true;return true;
  }

  stats() {
    let maxDepth=0,volume=0,wetCells=0;
    for(const h of this.field){maxDepth=Math.max(maxDepth,h);volume+=h;if(h>.0015)wetCells++;}
    return {surface:'continuous height field',grid:[this.nx,this.nz],maxDepth,volume:volume*this.dx*this.dz,wetCells,transmission:this.material.transmission,coolingCells:this.lastSettleCells};
  }
}
