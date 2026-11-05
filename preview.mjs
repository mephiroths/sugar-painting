import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));

export function previewOptions(args) {
  let lan=false,port=5178;
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==='--lan'){lan=true;continue;}
    if(arg==='--help')return{help:true};
    if(arg==='--port'||arg.startsWith('--port=')){
      const value=arg==='--port'?args[++i]:arg.slice(7);
      if(!/^\d+$/.test(value||'')||Number(value)>65535)throw new Error('端口应为 0 到 65535 的整数');port=Number(value);continue;
    }
    throw new Error(`未知参数：${arg}`);
  }
  return{lan,host:lan?'0.0.0.0':'127.0.0.1',port};
}

export function createPreviewServer() {
  const target=path.join(root,'糖画铺.html');if(!fs.existsSync(target))throw new Error('请先运行 npm run build 生成糖画铺.html');
  const html=fs.readFileSync(target),license=fs.readFileSync(path.join(root,'vendor/THREE-LICENSE.txt')),pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const info=Object.freeze({app:pkg.name,version:pkg.version,sha256:createHash('sha256').update(html).digest('hex'),bytes:html.length});
  const server=http.createServer((req,res)=>{
    const send=(status,body,type='text/plain; charset=utf-8',extra={})=>{
      const data=Buffer.isBuffer(body)?body:Buffer.from(body);res.writeHead(status,{'Content-Type':type,'Content-Length':data.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra});res.end(req.method==='HEAD'?undefined:data);
    };
    if(!['GET','HEAD'].includes(req.method)){send(405,'Method not allowed',undefined,{'Allow':'GET, HEAD'});return;}
    try {
      const pathname=decodeURIComponent(new URL(req.url||'/','http://127.0.0.1').pathname);
      if(['/', '/index.html', '/糖画铺.html'].includes(pathname)){send(200,html,'text/html; charset=utf-8');return;}
      if(pathname==='/preview-info.json'){send(200,JSON.stringify(info),'application/json; charset=utf-8');return;}
      if(pathname==='/third-party-license.txt'){send(200,license);return;}
      send(404,'Not found');
    } catch {send(400,'Bad request');}
  });
  server.requestTimeout=server.headersTimeout=15000;server.keepAliveTimeout=1000;server.previewInfo=info;return server;
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try {
    const options=previewOptions(process.argv.slice(2));
    if(options.help)console.log('用法：node preview.mjs [--lan] [--port=5178]');
    else {
      const server=createPreviewServer();server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'端口已占用，可用 --port=其他端口 重新启动。':error.message);process.exitCode=1;});
      server.listen(options.port,options.host,()=>{
        const port=server.address().port;console.log(`电脑预览：http://127.0.0.1:${port}/`);console.log(`构建标识：${server.previewInfo.sha256.slice(0,12)}`);
        if(options.lan){
          const addresses=[...new Set(Object.values(os.networkInterfaces()).flat().filter(address=>address&&!address.internal&&(address.family==='IPv4'||address.family===4)).map(address=>address.address))];
          for(const address of addresses)console.log(`手机地址：http://${address}:${port}/?mode=template`);
          if(!addresses.length)console.log('未发现局域网 IPv4 地址，可检查当前网络连接。');
        } else console.log(`安卓 USB 转发：adb reverse tcp:${port} tcp:${port}（需要手机已授权调试）`);
        console.log('此预览只提供构建页面、构建标识和第三方声明。Ctrl+C 停止。');
      });
      const stop=()=>server.close(()=>process.exit(0));process.once('SIGINT',stop);process.once('SIGTERM',stop);
    }
  } catch(error){console.error(error.message);process.exitCode=1;}
}
