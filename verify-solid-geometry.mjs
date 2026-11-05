import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url)),out=path.join(root,'artifacts','solid-geometry-check.mjs');
fs.mkdirSync(path.dirname(out),{recursive:true});
await build({stdin:{contents:"export {SugarLayer} from './src/sugar-layer.js';export {Scene,Vector3,Raycaster} from 'three';",resolveDir:root},outfile:out,bundle:true,platform:'node',format:'esm',alias:{three:path.join(root,'vendor/three.module.js')}});
try {
  const {SugarLayer,Scene,Vector3,Raycaster}=await import(pathToFileURL(out));
  function inspect(solid) {
    const g=solid.geometry,p=g.attributes.position,n=g.attributes.normal,depth=g.attributes.sugarDepth,index=g.index.array,canonical=[],points=new Map(),edges=new Map();
    assert.equal(depth.count,p.count);assert.equal(n.count,p.count);
    let minDepth=Infinity,maxDepth=0;
    for(let i=0;i<p.count;i++){
      const key=[p.getX(i),p.getY(i),p.getZ(i)].join(',');if(!points.has(key))points.set(key,points.size);canonical[i]=points.get(key);
      assert.ok(Number.isFinite(depth.getX(i))&&depth.getX(i)>.00149);assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-5);
      minDepth=Math.min(minDepth,depth.getX(i));maxDepth=Math.max(maxDepth,depth.getX(i));
    }
    let volume=0;
    for(let i=0;i<index.length;i+=3){
      const ids=[index[i],index[i+1],index[i+2]],a=new Vector3().fromBufferAttribute(p,ids[0]),b=new Vector3().fromBufferAttribute(p,ids[1]),c=new Vector3().fromBufferAttribute(p,ids[2]);
      assert.ok(b.clone().sub(a).cross(c.clone().sub(a)).lengthSq()>0,'no zero-area surface triangles');volume+=a.dot(b.clone().cross(c))/6;
      for(let j=0;j<3;j++){
        const u=canonical[ids[j]],v=canonical[ids[(j+1)%3]],key=Math.min(u,v)*p.count+Math.max(u,v),entry=edges.get(key)||{count:0,winding:0};
        assert.notEqual(u,v);entry.count++;entry.winding+=u<v?1:-1;edges.set(key,entry);
      }
    }
    const invalid=[...edges.values()].filter(edge=>edge.count!==2||edge.winding!==0);assert.equal(invalid.length,0,'every welded edge has two oppositely wound faces');assert.ok(volume>0,'solid has outward winding and positive volume');
    return{vertices:p.count,triangles:index.length/3,volume,minDepth,maxDepth};
  }
  const layer=new SugarLayer(new Scene());assert.equal(layer.createSolid(),null);
  for(let ring=0;ring<2;ring++)for(let i=0;i<128;i++){
    const point=t=>new Vector3((ring?1.15:-1.15)+.85*Math.cos(t*Math.PI*2),0,.85*Math.sin(t*Math.PI*2)),a=point(i/128),b=point((i+1)/128);
    layer.deposit(a,b,(ring?.065:.018)*.06*1.5*a.distanceTo(b),.06,false);
  }
  layer.deposit(new Vector3(-.3,0,0),new Vector3(.3,0,0),.035*.06*1.5*.6,.06,false);
  const before=layer.field.slice(),start=performance.now(),solid=layer.createSolid(),buildMs=performance.now()-start,details=inspect(solid),fieldVolume=layer.stats().volume;
  assert.ok(Buffer.from(before.buffer).equals(Buffer.from(layer.field.buffer)),'creating the solid leaves the drawing surface untouched');
  assert.ok(details.maxDepth-details.minDepth>.04,'thin lines and pooled sugar retain different optical depth');
  assert.ok(Math.abs(details.volume/fieldVolume-1)<.02,'closed mesh volume remains close to deposited volume');
  const p=solid.geometry.attributes.position,h=solid.geometry.attributes.sugarDepth;let interpolatedBoundary=0;
  for(let i=0;i<p.count;i++)if(Math.abs(h.getX(i)-.0015)<1e-7){const gx=(p.getX(i)+layer.width/2)/layer.dx,gz=(p.getZ(i)+layer.depth/2)/layer.dz;if(Math.abs(gx-Math.round(gx))>.05||Math.abs(gz-Math.round(gz))>.05)interpolatedBoundary++;}
  assert.ok(interpolatedBoundary>100,'contour follows interpolated crossings instead of whole-cell steps');
  solid.updateMatrixWorld(true);
  assert.equal(new Raycaster(new Vector3(-1.15,1,0),new Vector3(0,-1,0)).intersectObject(solid).length,0,'ring hole remains open');
  assert.ok(new Raycaster(new Vector3(-2,-1,0),new Vector3(0,1,0)).intersectObject(solid).length>0,'underside is visible from below');
  for(const sample of ['edge','cutoff']){
    const l=new SugarLayer(new Scene()),xStart=sample==='edge'?l.nx-3:380;
    for(let z=310;z<315;z++)for(let x=xStart;x<=Math.min(l.nx-1,xStart+3);x++)l.field[z*l.nx+x]=sample==='edge'?.03:.0015;
    l.bounds=[xStart-2,Math.min(l.nx+1,xStart+5),308,317];inspect(l.createSolid());
  }
  const result={ok:true,buildMs,details,fieldVolume,interpolatedBoundary,checks:['closed outward-wound volume','interpolated contour and open ring holes','local optical thickness','visible underside','slab edge and exact cutoff','working drawing unchanged']};
  fs.writeFileSync(path.join(root,'artifacts','solid-geometry-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {fs.unlinkSync(out);}
