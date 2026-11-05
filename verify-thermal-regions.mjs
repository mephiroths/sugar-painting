import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url)),output=path.join(root,'artifacts','thermal-check.mjs');
fs.mkdirSync(path.dirname(output),{recursive:true});
await build({stdin:{contents:"export {SugarLayer} from './src/sugar-layer.js';export {captureSurface,applySurface} from './src/surface-record.js';export {Scene,Vector3} from 'three';",resolveDir:root},outfile:output,bundle:true,platform:'node',format:'esm',alias:{three:path.join(root,'vendor/three.module.js')}});
const {SugarLayer,Scene,Vector3,captureSurface,applySurface}=await import(pathToFileURL(output));

// The previous dense solver is the independent reference. The optimized solver
// must produce identical height values, including pairs crossing thermal tiles.
function denseSettle(dt) {
  this.time+=dt;if(this.time>this.hotUntil||dt===0)return false;
  const [x0,x1,z0,z1]=this.bounds;if(x0>x1)return false;
  const minX=Math.max(1,x0),maxX=Math.min(this.nx-2,x1),minZ=Math.max(1,z0),maxZ=Math.min(this.nz-2,z1);
  const f=this.field,d=this.delta,nx=this.nx;d.fill(0);
  const amount=Math.min(.025,dt*.75),cooling=Math.exp(-dt*8);
  for(let z=minZ;z<=maxZ;z++)for(let x=minX;x<=maxX;x++){
    const idx=z*nx+x,h=f[idx];if(this.heat[idx]<.01&&this.heat[idx+1]<.01&&this.heat[idx+nx]<.01)continue;
    for(const j of [idx+1,idx+nx]){
      const higher=h>=f[j]?idx:j,high=f[higher],heat=this.heat[higher];if(heat<.01||high<.002)continue;
      const mobility=amount*Math.min(1,(high/.075)**2)*heat,transfer=(h-f[j])*mobility;d[idx]-=transfer;d[j]+=transfer;
    }
  }
  for(let z=minZ;z<=maxZ+1;z++)for(let x=minX;x<=maxX+1;x++){
    const i=z*nx+x;f[i]=Math.max(0,f[i]+d[i]);this.heat[i]*=cooling;
  }
  return true;
}
try {
  const actual=new SugarLayer(new Scene()),reference=new SugarLayer(new Scene());reference.settle=denseSettle;
  const both=action=>{action(actual);action(reference);};
  let steps=0;
  function tick(count,dt=1/120) {
    for(let i=0;i<count;i++){
      actual.settle(dt);reference.settle(dt);steps++;
      const equal=Buffer.from(actual.field.buffer).equals(Buffer.from(reference.field.buffer));
      if(!equal){let maxError=0;for(let j=0;j<actual.field.length;j++)maxError=Math.max(maxError,Math.abs(actual.field[j]-reference.field[j]));assert.fail(`height mismatch at step ${steps}: ${maxError}`);}
    }
  }
  const deposit=(point,volume=.0005,radius=.065,hot=true)=>both(layer=>layer.deposit(point,point,volume,radius,hot));
  for(let z=-3.4;z<=3.4;z+=.5)for(let x=-4.2;x<=4.2;x+=.5)deposit(new Vector3(x,0,z),.00002,.04,false);
  deposit(new Vector3(0,0,0));tick(1);
  const [x0,x1,z0,z1]=actual.bounds,denseCells=(x1-x0+1)*(z1-z0+1),sparseCells=actual.lastSettleCells;
  assert.ok(sparseCells<denseCells/50,'a local addition should not scan the entire finished work');tick(65);
  for(const [x,z]of[[16,16],[31,32],[64,127],[383,319],[766,630],[1,630],[766,1]]){
    const point=new Vector3(x*actual.dx-actual.width/2,0,z*actual.dz-actual.depth/2);
    deposit(point,.0006,.07);tick(6);
  }
  deposit(new Vector3(-.2,0,.15),.02,.04);tick(65);
  const snapshot=actual.capture();both(layer=>{layer.reset([],.04);layer.restoreCapture(snapshot);});tick(16);
  const surface=captureSurface(actual,actual.nx,actual.nz);both(layer=>{layer.reset([],.04);applySurface(layer,surface);});tick(30);
  deposit(new Vector3(3.2,0,-2.1));tick(65);
  const volume=actual.stats().volume;tick(30);assert.ok(Math.abs(actual.stats().volume-volume)<volume*1e-6);
  both(layer=>layer.drawSegment(new Vector3(-2.2,0,-1.3),new Vector3(1.8,0,1.3),0,.065));tick(160);
  assert.equal(actual.thermalTiles.size,0,'thermal regions retire after all their cells cross the mobility cutoff');
  deposit(new Vector3(-3.2,0,2.1));tick(40);
  both(layer=>layer.reset([],.04));assert.equal(actual.thermalTiles.size,0);assert.equal(actual.settle(1/120),false);
  const result={ok:true,steps,denseCells,sparseCells,reduction:1-sparseCells/denseCells,checks:['bitwise height parity with the dense solver','tile boundaries and stone edges','overflow pool and separated warm regions','capture and cropped draft restore rebuild thermal activity','local edits skip cold artwork','dense heat and thermal cutoff transitions','mass conserved and reset clears activity']};
  fs.writeFileSync(path.join(root,'artifacts','thermal-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {fs.unlinkSync(output);}
