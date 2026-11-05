import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url)),out=path.join(root,'artifacts','portrait-framing-check.mjs');
fs.mkdirSync(path.dirname(out),{recursive:true});
await build({stdin:{contents:"export {createPortraitCamera} from './src/portrait-video.js';export {Vector3} from 'three';",resolveDir:root},outfile:out,bundle:true,platform:'node',format:'esm',alias:{three:path.join(root,'vendor/three.module.js')}});
try {
  const {createPortraitCamera,Vector3}=await import(pathToFileURL(out)),camera=createPortraitCamera();
  assert.equal(camera.aspect,9/16);let maxX=0,maxY=0;
  for(const x of [-4.9,4.9])for(const y of [-.05,3.4])for(const z of [-4,4]){
    const p=new Vector3(x,y,z).project(camera);maxX=Math.max(maxX,Math.abs(p.x));maxY=Math.max(maxY,Math.abs(p.y));
    assert.ok(Math.abs(p.x)<=.900001&&Math.abs(p.y)<=.720001&&p.z>-1&&p.z<1,'slab and pouring height fit with room for captions');
  }
  console.log(JSON.stringify({ok:true,maxX,maxY,checks:['portrait aspect ratio','all board corners and pouring heights remain in frame']},null,2));
} finally {fs.unlinkSync(out);}
