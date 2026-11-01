import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),require=createRequire(path.resolve(root,'../su7-ultra-product/vendor/teardown/package.json'));
const {build}=require('esbuild');
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
  const trial=speed=>{const radii=[];const source=new SugarPour(new Scene(),(a,b,volume,radius)=>{if(source.time>.6)radii.push(radius);});source.reset(new Vector3(-2,0,0));for(let i=0;i<144;i++){source.setTarget(new Vector3(-2+speed*i/120,0,0),true);source.step(1/120,false);}return radii.reduce((a,b)=>a+b,0)/radii.length;};
  assert.ok(trial(.9)>trial(3.6)*1.25);checks.push('Faster hand motion produces a narrower deposit at the same flow rate');
  layer.reset([], .04);assert.equal(layer.stats().volume,0);checks.push('Reset removes all previous deposits');
  let heldMass=0;
  const held=new SugarPour(new Scene(),(a,b,volume,radius)=>{heldMass+=volume;layer.deposit(a,b,volume,radius,false);});held.reset(new Vector3(0,0,0));held.setTarget(new Vector3(0,0,0),true);
  for(let i=0;i<240;i++)held.step(1/120,false);
  const pool=layer.stats();assert.ok(pool.maxDepth<=.100001);assert.ok(Math.abs(pool.volume-heldMass)<heldMass*1e-5);checks.push('Holding the spoon for two seconds creates a bounded round pool and conserves all sugar');
  const result={ok:true,checks,parcels:count,mass,errors:[]};fs.writeFileSync(path.join(root,'artifacts','flow-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{fs.unlinkSync(out);}
