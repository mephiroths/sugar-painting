import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
const out=path.join(root,'artifacts','flow-check.mjs');
await build({stdin:{contents:"export {SugarPour} from './src/pour.js';export {SugarLayer} from './src/sugar-layer.js';export {Scene,Vector3} from 'three';",resolveDir:root},outfile:out,bundle:true,platform:'node',format:'esm',alias:{three:path.join(root,'vendor/three.module.js')}});
const {SugarPour,SugarLayer,Scene,Vector3}=await import(pathToFileURL(out));
const checks=[];
try {
  const scene=new Scene(),layer=new SugarLayer(scene);let mass=0,count=0;
  const p=new SugarPour(scene,(a,b,volume,radius)=>{layer.deposit(a,b,volume,radius,true);mass+=volume;count++;});
  p.reset(new Vector3(-1,0,0));p.setTarget(new Vector3(-1,0,0),true);
  p.step(p.flightTime*.8);assert.equal(count,0);checks.push('No sugar reaches the stone before its flight time');
  for(let i=0;i<90;i++){p.setTarget(new Vector3(-1+i/90*2,0,0),true);p.step(1/120);}
  assert.ok(count>20);assert.ok(p.source.distanceTo(p.contact)>.1);assert.ok(p.mesh.visible);
  checks.push('Moving source and landed contact remain separated by a visible physical lag');
  let stats=layer.stats();assert.ok(Math.abs(stats.volume-mass)<mass*1e-5);assert.ok(stats.maxDepth<.2);checks.push('Deposited field volume equals emitted parcel volume, without a broad brush stamp');
  const low=p.flightTime;p.height=2.3;assert.ok(p.flightTime>low);checks.push('Raising the spoon increases fall time');
  p.flow=false;for(let i=0;i<120;i++)p.step(1/120);assert.equal(p.active,false);assert.equal(p.mesh.visible,false);
  const stopped=mass;for(let i=0;i<30;i++)p.step(1/120);assert.equal(mass,stopped);checks.push('Released stream drains completely and then stops depositing');
  const before=layer.stats().volume;for(let i=0;i<60;i++)layer.settle(1/120);const after=layer.stats().volume;assert.ok(Math.abs(after-before)<before*1e-5);
  checks.push('Cooling does not lose deposited sugar volume');
  const symmetric=new SugarLayer(new Scene()),cx=380,cz=310,center=new Vector3(cx*symmetric.dx-symmetric.width/2,0,cz*symmetric.dz-symmetric.depth/2);
  symmetric.deposit(center,center,.001,.08,true);
  const symmetricVolume=symmetric.stats().volume;
  for(let i=0;i<60;i++)symmetric.settle(1/120);
  let asymmetry=0;
  for(let dz=-12;dz<=12;dz++)for(let dx=0;dx<=12;dx++){
    const field=symmetric.field,nx=symmetric.nx;
    asymmetry=Math.max(asymmetry,Math.abs(field[(cz+dz)*nx+cx+dx]-field[(cz+dz)*nx+cx-dx]),Math.abs(field[(cz+dx)*nx+cx+dz]-field[(cz-dx)*nx+cx+dz]));
  }
  assert.ok(asymmetry<1e-7,'cooling spreads equally on opposite sides');
  assert.ok(Math.abs(symmetric.stats().volume-symmetricVolume)<symmetricVolume*1e-5,'symmetric cooling conserves volume');
  checks.push('Cooling spreads symmetrically around a stationary deposit');
  const trial=speed=>{const radii=[];const source=new SugarPour(new Scene(),(a,b,volume,radius)=>{if(source.time>.6)radii.push(radius);});source.reset(new Vector3(-2,0,0));for(let i=0;i<144;i++){source.setTarget(new Vector3(-2+speed*i/120,0,0),true);source.step(1/120,false);}return radii.reduce((a,b)=>a+b,0)/radii.length;};
  assert.ok(trial(.9)>trial(3.6)*1.25);checks.push('Faster hand motion produces a narrower deposit at the same flow rate');
  layer.reset([], .04);assert.equal(layer.stats().volume,0);assert.equal(layer.mesh.geometry.drawRange.count,0);checks.push('Reset removes all previous deposits');
  let heldMass=0;
  const held=new SugarPour(new Scene(),(a,b,volume,radius)=>{heldMass+=volume;layer.deposit(a,b,volume,radius,false);});held.reset(new Vector3(0,0,0));held.setTarget(new Vector3(0,0,0),true);
  for(let i=0;i<240;i++)held.step(1/120,false);
  const pool=layer.stats();assert.ok(pool.maxDepth<=.100001);assert.ok(Math.abs(pool.volume-heldMass)<heldMass*1e-5);assert.ok(layer.mesh.geometry.drawRange.count>0&&layer.mesh.geometry.drawRange.count<layer.mesh.geometry.index.count/4);checks.push('Holding the spoon for two seconds creates a bounded round pool and conserves all sugar');
  const resting=new SugarPour(new Scene(),()=>{});resting.reset(new Vector3(0,0,0));resting.setTarget(new Vector3(0,0,0),true);
  while(!resting.flowing)resting.step(1/120,false);
  assert.ok(Math.hypot(resting.contact.x,resting.contact.z)<.004,'coiling starts gradually');
  let maxOffset=0;for(let i=0;i<120;i++){resting.step(1/120,false);maxOffset=Math.max(maxOffset,Math.hypot(resting.contact.x,resting.contact.z));}
  assert.ok(maxOffset>.015&&maxOffset<.023,'stationary coil stays close to the contact point');
  checks.push('Stationary coiling grows gradually and remains close to the landing point');
  const raised=new SugarPour(new Scene(),()=>{},()=>.06);raised.reset(new Vector3(0,0,0));raised.setTarget(new Vector3(0,0,0),true);
  for(let i=0;i<60;i++)raised.step(1/120);assert.ok(Math.abs(raised.contact.y-.064)<1e-8);
  const positions=raised.geometry.attributes.position;let endY=0;
  for(let j=0;j<raised.sides;j++)endY+=positions.getY(raised.rings*(raised.sides+1)+j);
  assert.ok(Math.abs(endY/raised.sides-raised.contact.y)<1e-5,'thread ends on the raised surface');
  assert.equal(layer.heightAt(100,100),0);checks.push('Falling thread meets raised sugar and remains bounded outside the board');
  const capture=layer.capture(),point=new Vector3(0,0,-3.55);
  layer.deposit(point,point,.0001,.06,false);point.z=3.55;layer.deposit(point,point,.0001,.06,false);
  const range=layer.mesh.geometry.drawRange,firstRow=range.start/(layer.cellsX*6),lastRow=firstRow+range.count/(layer.cellsX*6);
  for(let z=0;z<layer.nz;z++)for(let x=0;x<layer.nx;x++)if(layer.field[z*layer.nx+x]>0){
    const meshRow=z/(layer.nz-1)*layer.cellsZ;assert.ok(meshRow>=firstRow&&meshRow<=lastRow,'all occupied rows remain within draw range');
  }
  layer.restoreCapture(capture);assert.ok(layer.mesh.geometry.drawRange.count<layer.mesh.geometry.index.count/4);
  checks.push('Draw range covers both board edges and follows restored snapshots');
  const result={ok:true,checks,parcels:count,mass,errors:[]};fs.writeFileSync(path.join(root,'artifacts','flow-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{fs.unlinkSync(out);}
