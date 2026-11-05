import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createPreviewServer,previewOptions} from './preview.mjs';

const root=path.dirname(fileURLToPath(import.meta.url)),html=fs.readFileSync(path.join(root,'糖画铺.html')),license=fs.readFileSync(path.join(root,'vendor/THREE-LICENSE.txt'),'utf8').trim();
assert.ok(html.toString('utf8').includes(license),'standalone deliverable retains the complete third-party notice');
assert.deepEqual(previewOptions([]),{lan:false,host:'127.0.0.1',port:5178});assert.deepEqual(previewOptions(['--lan','--port=0']),{lan:true,host:'0.0.0.0',port:0});
for(const args of [['--port=-1'],['--port=65536'],['--port'],['--unknown']])assert.throws(()=>previewOptions(args));
const server=createPreviewServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const request=(pathname,method='GET')=>new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:pathname,method,agent:false},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('error',reject);req.end();
});
try {
  for(const route of ['/', '/?mode=template','/index.html',encodeURI('/糖画铺.html')]){const result=await request(route);assert.equal(result.status,200);assert.ok(result.body.equals(html));assert.equal(result.headers['cache-control'],'no-store');assert.equal(result.headers['x-content-type-options'],'nosniff');}
  const head=await request('/','HEAD');assert.equal(head.status,200);assert.equal(head.body.length,0);assert.equal(Number(head.headers['content-length']),html.length);
  const metadata=await request('/preview-info.json'),info=JSON.parse(metadata.body.toString('utf8'));assert.equal(info.sha256,createHash('sha256').update(html).digest('hex'));assert.equal(info.bytes,html.length);assert.equal(metadata.body.includes(Buffer.from(root)),false);
  assert.equal((await request('/third-party-license.txt')).body.toString('utf8').trim(),license);
  for(const route of ['/.env','/.git/config','/.cache/browsers/firefox-1509/firefox/firefox.exe','/src/main.js','/artifacts/gallery-backup.json','/%2e%2e/%2e%2e/.env'])assert.equal((await request(route)).status,404);
  const post=await request('/','POST');assert.equal(post.status,405);assert.equal(post.headers.allow,'GET, HEAD');assert.equal((await request('/bad%')).status,400);
  console.log(JSON.stringify({ok:true,build:info.sha256.slice(0,12),checks:['loopback default and explicit LAN option','standalone routes and no stale cache','build identity matches served bytes','HEAD and read-only methods','project files remain inaccessible','third-party notice is retained']},null,2));
} finally {await new Promise(resolve=>server.close(resolve));}
