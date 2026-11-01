import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { patterns } from './patterns.js';
import { SugarLayer } from './sugar-layer.js';
import { SugarPour } from './pour.js';

const $ = (id) => document.getElementById(id);
const container = $('scene');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = {mode:'watch', pattern:0, strokes:[], progress:1, playing:false, paused:false, speed:1, thickness:.04, drawing:false, draining:false, drawPoints:[], draft:null, needsRender:true, view:'angle', hasArtwork:true};
let renderer, scene, camera, controls, sugar, spoon, stick, sugarMaterial, environment, sugarLayer, pour;
let toastTimer, lastTime = 0, cameraMove = null, pouringPoint = new THREE.Vector3();
let totalLength = 1, strokeData = [], strokeCursor = 0;
let timeline=[],playTime=0,playDuration=1,liveDeposits=[],drawCommands=[],drawStart=0,drawStop=0;
const raycaster = new THREE.Raycaster();
const drawingPlane = new THREE.Plane(new THREE.Vector3(0,1,0),-.09);
const cursor = new THREE.Vector2();
const v = (x,y,z) => new THREE.Vector3(x,y,z);

function notify(message) {
  $('toast').textContent = message; $('toast').classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(()=>$('toast').classList.remove('visible'),2600);
}

function texture(kind) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(1024,1024);
  let seed = 83173;
  const random = () => {seed=(seed*16807)%2147483647;return seed/2147483647;};
  for(let y=0;y<1024;y++) for(let x=0;x<1024;x++) {
    const n = random()-.5;
    let r,g,b;
    if(kind==='stone') {
      const wave = Math.sin(x*.007+y*.009+Math.sin(y*.012)*.8+Math.sin(x*.019+y*.003)*.4);
      const vein = Math.pow(Math.max(0,1-Math.abs(wave)*22),2);
      const clouds = Math.sin(x*.011+y*.007)*Math.sin(y*.019-x*.006)*2;
      r = 212+n*1.7+clouds-vein*19; g=211+n*1.7+clouds-vein*18; b=204+n*1.7+clouds-vein*16;
    } else {
      const grain = Math.sin(y*.27+Math.sin(x*.004+y*.013)*2)*.5 + Math.sin(y*.063+Math.sin(x*.005)*3)*1.6;
      r=101+grain*1.7+n*5;g=73+grain*1.3+n*4;b=48+grain+n*3;
    }
    const i=(y*1024+x)*4; img.data[i]=r;img.data[i+1]=g;img.data[i+2]=b;img.data[i+3]=255;
  }
  ctx.putImageData(img,0,0);
  if(kind==='wood') {
    ctx.strokeStyle='rgba(40,25,14,.08)';ctx.lineWidth=1;
    [210,530,850].forEach(y=>{ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1024,y+1);ctx.stroke();});
  }
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=renderer.capabilities.getMaxAnisotropy();
  return t;
}

function mesh(geometry,material,parent=scene) {
  const m = new THREE.Mesh(geometry,material);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
}
function rod(a,b,r,material,parent=scene) {
  const delta=b.clone().sub(a);
  const m=mesh(new THREE.CylinderGeometry(r,r*.96,delta.length(),12),material,parent);
  m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(v(0,1,0),delta.normalize());return m;
}
function roundedSlab(width,depth,radius,thickness,material) {
  const s=new THREE.Shape(),x=-width/2,y=-depth/2;
  s.moveTo(x+radius,y);s.lineTo(x+width-radius,y);s.quadraticCurveTo(x+width,y,x+width,y+radius);
  s.lineTo(x+width,y+depth-radius);s.quadraticCurveTo(x+width,y+depth,x+width-radius,y+depth);
  s.lineTo(x+radius,y+depth);s.quadraticCurveTo(x,y+depth,x,y+depth-radius);
  s.lineTo(x,y+radius);s.quadraticCurveTo(x,y,x+radius,y);
  const g=new THREE.ExtrudeGeometry(s,{depth:thickness,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.045,bevelThickness:.035,curveSegments:12});
  g.rotateX(-Math.PI/2);g.translate(0,-thickness-.04,0);
  return mesh(g,material);
}

function makeScene() {
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(Math.max(devicePixelRatio,1.25),1.75));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  container.appendChild(renderer.domElement);
  scene=new THREE.Scene();scene.background=new THREE.Color('#40352b');
  camera=new THREE.PerspectiveCamera(36,1,.1,100);camera.position.set(4.2,12.8,13.5);
  controls=new OrbitControls(camera,renderer.domElement);controls.target.set(.1,0,.3);controls.enableDamping=true;controls.dampingFactor=.09;
  controls.enablePan=false;controls.minDistance=8;controls.maxDistance=40;controls.maxPolarAngle=Math.PI*.44;controls.minPolarAngle=.01;
  controls.addEventListener('change',()=>{state.needsRender=true;});
  const pmrem=new THREE.PMREMGenerator(renderer);
  const room=new THREE.Scene();room.background=new THREE.Color('#252321');
  const lightPanel=(x,y,z,w,h,power)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:new THREE.Color(power,power*.96,power*.88),side:THREE.DoubleSide}));m.position.set(x,y,z);m.lookAt(0,0,0);room.add(m);};
  lightPanel(-3,7,1,3.8,2.4,7);lightPanel(4,5,-2,.35,5,4);lightPanel(0,4,6,4,.18,2.5);
  environment=pmrem.fromScene(room,.025);scene.environment=environment.texture;scene.environmentIntensity=.85;
  room.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});pmrem.dispose();
  scene.add(new THREE.HemisphereLight('#fffdf4','#4e4335',.4));
  const sun=new THREE.SpotLight('#fff4df',260,40,Math.PI*.29,.72,2);sun.position.set(-3,9,3);sun.target.position.set(0,0,0);scene.add(sun.target);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.normalBias=.012;sun.shadow.bias=-.0001;sun.shadow.radius=5;scene.add(sun);
  const fill=new THREE.DirectionalLight('#eaf0ff',.4);fill.position.set(5,7,-6);scene.add(fill);
  const wood=texture('wood');wood.repeat.set(24,24);
  const table=mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({map:wood,roughness:.56,color:'#e4d3b8'}));table.rotation.x=-Math.PI/2;table.position.y=-.39;
  const stone=texture('stone');
  const marbleMaterial=new THREE.MeshPhysicalMaterial({map:stone,bumpMap:stone,bumpScale:.0012,roughness:.31,metalness:0,color:'#f9faf6',clearcoat:.15,clearcoatRoughness:.3});
  const board=roundedSlab(9.1,7.5,.14,.26,marbleMaterial);
  const boardUV=board.geometry.attributes.uv,boardPosition=board.geometry.attributes.position;
  for(let i=0;i<boardUV.count;i++)boardUV.setXY(i,(boardPosition.getX(i)+4.55)/9.1,(boardPosition.getZ(i)+3.75)/7.5);
  board.name='大理石糖画板';
  // A folded cloth peeks out from beneath the slab.
  const clothGeo=new THREE.PlaneGeometry(2.7,2.4,24,24);clothGeo.rotateX(-Math.PI/2);
  const a=clothGeo.attributes.position;
  for(let i=0;i<a.count;i++)a.setY(i,Math.sin(a.getX(i)*12+a.getZ(i)*4)*.015+Math.sin(a.getZ(i)*17)*.008);
  clothGeo.computeVertexNormals();
  const cloth=mesh(clothGeo,new THREE.MeshStandardMaterial({color:'#823e2c',roughness:1,side:THREE.DoubleSide}));cloth.position.set(-4.4,-.33,2.7);cloth.rotation.y=-.2;
  const bamboo=new THREE.MeshStandardMaterial({color:'#c49a59',roughness:.68});
  for(let i=0;i<3;i++)rod(v(-5.5-i*.16,-.30,-2.5),v(-4.9+i*.11,-.30,.2),.035,bamboo);
  const copper=new THREE.MeshStandardMaterial({color:'#b9763f',metalness:.85,roughness:.28});
  const darkCopper=new THREE.MeshStandardMaterial({color:'#744025',metalness:.8,roughness:.36});
  const pot=new THREE.Group();scene.add(pot);pot.position.set(5.55,-.35,-2.3);
  const potProfile=[[0,0],[.48,0],[.61,.08],[.66,.55],[.64,.75],[.60,.79],[.57,.75],[.59,.55],[.53,.14],[0,.14]].map(p=>new THREE.Vector2(...p));
  mesh(new THREE.LatheGeometry(potProfile,64),copper,pot);
  const syrup=mesh(new THREE.CylinderGeometry(.578,.578,.02,64),new THREE.MeshPhysicalMaterial({color:'#854016',roughness:.15,metalness:.08,clearcoat:1}),pot);syrup.position.y=.57;
  const rim=mesh(new THREE.TorusGeometry(.62,.028,10,64),copper,pot);rim.rotation.x=Math.PI/2;rim.position.y=.77;
  const handle=mesh(new THREE.TorusGeometry(.23,.028,8,24,Math.PI*1.7),darkCopper,pot);handle.position.set(.75,.4,0);handle.rotation.y=Math.PI/2;handle.rotation.z=-Math.PI*.35;
  rod(v(5.2,.27,-2.5),v(5.8,1.15,-3.2),.035,bamboo);
  sugarMaterial=new THREE.MeshPhysicalMaterial({color:'#fffaf1',metalness:0,roughness:.07,transmission:1,thickness:.07,ior:1.49,attenuationColor:new THREE.Color('#f6ad35'),attenuationDistance:.052,envMapIntensity:1.25});
  sugar=new THREE.Group();scene.add(sugar);
  sugarLayer=new SugarLayer(scene);sugarLayer.attachMarble(marbleMaterial);
  stick=new THREE.Group();scene.add(stick);
  spoon=new THREE.Group();scene.add(spoon);
  const profile=[[0,0],[.10,.012],[.22,.07],[.32,.18],[.35,.26],[.35,.29],[.32,.30],[.29,.26],[.26,.18],[.18,.12],[0,.10]].map(p=>new THREE.Vector2(...p));
  const cup=mesh(new THREE.LatheGeometry(profile,48),copper,spoon);cup.rotation.z=-.27;
  const spoonSugar=mesh(new THREE.CylinderGeometry(.285,.20,.035,40),sugarMaterial,spoon);spoonSugar.position.set(.05,.23,0);spoonSugar.rotation.z=-.27;
  rod(v(0,.22,-.28),v(.05,.82,-1.72),.045,copper,spoon);
  rod(v(.05,.82,-1.72),v(.08,1.02,-2.2),.075,bamboo,spoon);
  pour=new SugarPour(scene,(a,b,volume,radius)=>{
    sugarLayer.deposit(a,b,volume,radius);
    if(state.drawing||state.draining)liveDeposits.push({a:[a.x,a.z],b:[b.x,b.z],volume,radius});
    state.needsRender=true;
  });spoon.visible=false;
  resize();new ResizeObserver(resize).observe(container);
  renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();state.playing=false;showError('画面暂时休息了，刷新页面就能重新开摊。');});
}

function resize() {
  if(!renderer)return;const w=container.clientWidth,h=container.clientHeight;if(!w||!h)return;
  camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);state.needsRender=true;
  if(!state.drawing&&controls&&!['detail','pour'].includes(state.view)){const distance=camera.position.distanceTo(controls.target);const minFit=Math.max(17.8,18.5/(w/h));if(distance<minFit)camera.position.sub(controls.target).setLength(minFit).add(controls.target);}
}
function disposeGroup(group) {
  while(group.children.length){const child=group.children.pop();child.parent=null;child.geometry?.dispose();if(child.material&&child.material!==sugarMaterial)child.material.dispose();}
}
function samplePath(d,scale=1) {
  const el=document.createElementNS('http://www.w3.org/2000/svg','path');el.setAttribute('d',d);
  const length=el.getTotalLength(),count=Math.max(8,Math.ceil(length*1.35)),out=[];
  for(let i=0;i<=count;i++){const p=el.getPointAtLength(length*i/count);out.push(v((p.x-50)*.083*scale,.105,(p.y-46)*.083*scale));}return out;
}
function renderArtwork(animate=false) {
  if(state.drawing||state.draining)finishStroke(true);
  disposeGroup(sugar);disposeGroup(stick);strokeData=[];totalLength=0;strokeCursor=0;
  for(const points of state.strokes) {
    if(points.length<2)continue;const curve=new THREE.CatmullRomCurve3(points,false,'centripetal');const length=curve.getLength();
    strokeData.push({curve,length,start:totalLength,deposits:points.deposits,duration:points.duration,commands:points.commands});totalLength+=length;
  }
  sugarLayer.reset(strokeData,state.thickness);
  state.hasArtwork=state.strokes.length>0;
  if(state.mode==='watch'&&state.hasArtwork) {
    const pattern=patterns[state.pattern];const sx=(pattern.stick[0]-50)*.083*pattern.scale,sz=(pattern.stick[1]-46)*.083*pattern.scale;
    rod(v(sx,.025,sz-.3),v(sx,.025,4.9),.039,new THREE.MeshStandardMaterial({color:'#d6b57b',roughness:.7}),stick);
  }
  state.progress=animate?0:1;state.playing=animate;state.paused=false;
  pour.amount=state.thickness;pour.reset(strokeData[0]?.curve.getPointAt(0)||v(0,0,0));spoon.visible=false;
  if(animate){buildTimeline();if(state.view==='angle'||state.view==='top')moveView('pour');}
  else {
    if(strokeData.some(r=>r.deposits)){for(const r of strokeData)if(r.deposits)sugarLayer.restore(r.deposits);}
    else sugarLayer.drawTo(totalLength,false);
  }
  updateProgress();state.needsRender=true;updateButtons();
}
function buildTimeline() {
  timeline=[];playTime=0;let time=0,previous=strokeData[0]?.curve.getPointAt(0)||v(0,0,0);
  for(const r of strokeData){
    const start=r.curve.getPointAt(0),end=r.curve.getPointAt(1),gap=.30+Math.min(.35,start.distanceTo(previous)*.08);
    timeline.push({kind:'travel',start:time,end:time+gap,from:previous.clone(),to:start.clone()});time+=gap;
    const duration=r.duration?Math.max(.3,r.duration):Math.max(.25,r.length/2.7);
    timeline.push({kind:'pour',start:time,end:time+duration,record:r});time+=duration;previous=end;
  }
  playDuration=time;timeline.push({kind:'travel',start:time,end:time+.6,from:previous.clone(),to:previous.clone()});
}
function setPattern(index,animate=true) {
  state.pattern=index;const p=patterns[index];state.strokes=p.paths.map(d=>samplePath(d,p.scale));
  $('scene-title').textContent=p.name;$('scene-description').textContent=p.description;
  document.querySelectorAll('.pattern').forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index)));
  renderArtwork(animate&&!reducedMotion);
}
function updateProgress() {
  $('playback').hidden=!state.playing;
  $('progress').style.transform=`scaleX(${state.progress})`;
  document.querySelector('.progress-track').setAttribute('aria-valuenow',Math.round(state.progress*100));
  $('progress-label').textContent=state.paused?'歇一小会':state.progress>=1?'收丝':`${Math.round(state.progress*100)}%`;
}
function positionSpoon() {
  spoon.rotation.y=.35;
  spoon.rotation.z=THREE.MathUtils.lerp(.12,-.12,pour.gate);
  spoon.position.set(pour.source.x-.36,pour.height-.19,pour.source.z+.13);
  spoon.visible=state.playing||state.drawing||state.draining;
}
function advancePlayback(dt) {
  const n=Math.max(1,Math.ceil(dt*120)),step=dt/n;
  for(let i=0;i<n;i++){
    playTime+=step;
    const event=timeline.find(e=>playTime>=e.start&&playTime<e.end)||timeline.at(-1);
    if(event){
      const t=THREE.MathUtils.clamp((playTime-event.start)/(event.end-event.start),0,1);
      let target;
      if(event.kind==='pour'&&event.record.commands?.length){
        const commands=event.record.commands,elapsed=playTime-event.start;
        let k=0;while(k<commands.length-1&&commands[k+1].t<=elapsed)k++;
        const a=commands[k],b=commands[Math.min(k+1,commands.length-1)],mix=b.t>a.t?THREE.MathUtils.clamp((elapsed-a.t)/(b.t-a.t),0,1):0;
        target=v(THREE.MathUtils.lerp(a.point[0],b.point[0],mix),0,THREE.MathUtils.lerp(a.point[1],b.point[1],mix));
      } else target=event.kind==='pour'?event.record.curve.getPointAt(t):event.from.clone().lerp(event.to,t*t*(3-2*t));
      pour.setTarget(target,event.kind==='pour'&&playTime<playDuration);
    }
    pour.step(step,false);
  }
  pour.updateMesh();positionSpoon();state.progress=Math.min(1,playTime/playDuration);updateProgress();
  if(playTime>=playDuration+.6&&!pour.active){state.playing=false;spoon.visible=false;updateProgress();notify('糖画成了，看看这一口甜。');}
  state.needsRender=true;
}
function updateButtons() {
  $('play').disabled=!state.hasArtwork;
  $('play').querySelector('span').textContent=state.mode==='draw'?'看我的浇糖过程':'再看一次浇糖';
  $('pause').setAttribute('aria-label',state.paused?'继续浇糖':'暂停浇糖');
  $('pause').innerHTML=state.paused?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7Z"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14m8-14v14"/></svg>';
  $('undo').disabled=state.strokes.length===0;
  $('clear').disabled=!state.hasArtwork;
}
function moveView(type,instant=false) {
  state.view=type;const aspect=container.clientWidth/container.clientHeight;
  const distance=Math.max(18,18.5/aspect);
  const position=type==='pour'?v(3.3,8.2,10.6):type==='detail'?v(.8,3.8,5.3):type==='top'?v(.1,distance,.31):v(4.2,12.8,13.5).setLength(distance);
  const target=type==='pour'?v(0,.6,0):type==='detail'?v(.0,0,-.25):v(.1,0,.3);
  $('angle-view').setAttribute('aria-pressed',String(type==='angle'));$('top-view').setAttribute('aria-pressed',String(type==='top'));
  $('detail-view').setAttribute('aria-pressed',String(type==='detail'));controls.minDistance=type==='detail'?4:8;
  $('pour-view').setAttribute('aria-pressed',String(type==='pour'));
  if(instant||reducedMotion){camera.position.copy(position);controls.target.copy(target);controls.update();}
  else cameraMove={from:camera.position.clone(),to:position,start:performance.now(),target:controls.target.clone(),targetTo:target};
  state.needsRender=true;
}
function setMode(mode) {
  if(state.mode===mode)return;
  if(state.drawing||state.draining)finishStroke(true);state.mode=mode;state.playing=false;state.progress=1;
  $('watch-mode').setAttribute('aria-pressed',String(mode==='watch'));$('draw-mode').setAttribute('aria-pressed',String(mode==='draw'));
  $('pattern-panel').hidden=mode==='draw';$('draw-info').hidden=mode!=='draw';
  controls.enabled=mode==='watch';container.style.cursor=mode==='draw'?'crosshair':'grab';
  $('hint').lastChild.textContent=mode==='draw'?'按住石板画一笔，松开收笔':'拖动转一转，滚轮凑近看';
  if(mode==='draw') {
    state.watchStrokes=state.strokes;state.strokes=state.ownStrokes||[];
    $('scene-title').textContent='一勺糖，慢慢落';$('scene-description').textContent='按住浇糖，松开收丝。';moveView('pour');renderArtwork();
  } else {state.ownStrokes=state.strokes;setPattern(state.pattern,false);moveView('angle');}
  updateButtons();
}
function boardPoint(event) {
  const rect=container.getBoundingClientRect();cursor.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
  raycaster.setFromCamera(cursor,camera);const p=raycaster.ray.intersectPlane(drawingPlane,new THREE.Vector3());
  return p&&Math.abs(p.x)<4.25&&Math.abs(p.z)<3.45?p:null;
}
function commitStroke() {
  if(state.drawPoints.length===1)state.drawPoints.push(state.drawPoints[0].clone().add(v(.01,0,.01)));
  if(state.drawPoints.length>=2&&liveDeposits.length){
    const points=state.drawPoints.map(p=>p.clone());points.deposits=liveDeposits;points.duration=Math.max(.15,drawStop-drawStart);points.commands=drawCommands;
    state.strokes.push(points);
  }
  liveDeposits=[];drawCommands=[];state.drawPoints=[];state.draining=false;state.hasArtwork=state.strokes.length>0;spoon.visible=false;updateButtons();state.needsRender=true;
}
function finishStroke(immediate=false) {
  if(!state.drawing&&!state.draining)return;
  if(state.drawing)drawStop=pour.time;
  state.drawing=false;state.draining=true;pour.flow=false;
  if(immediate===true){for(let i=0;i<100&&pour.active;i++)pour.step(1/120,false);pour.updateMesh();commitStroke();}
}
function wireUI() {
  $('patterns').innerHTML=patterns.map((p,i)=>`<button class="pattern" data-index="${i}" aria-pressed="${i===0}" aria-label="画${p.name}"><svg viewBox="0 0 100 100" aria-hidden="true">${p.paths.slice(0,20).map(d=>`<path d="${d}"/>`).join('')}</svg><span>${p.name}</span></button>`).join('');
  $('patterns').addEventListener('click',event=>{const button=event.target.closest('.pattern');if(button)setPattern(Number(button.dataset.index));});
  $('watch-mode').onclick=()=>setMode('watch');$('draw-mode').onclick=()=>setMode('draw');
  $('thickness').oninput=event=>{if(state.drawing||state.draining)finishStroke(true);state.thickness=Number(event.target.value);$('thickness-value').textContent=state.thickness<.035?'少一些':state.thickness>.045?'多一些':'适中';renderArtwork();};
  $('height').oninput=event=>{pour.height=Number(event.target.value);$('height-value').textContent=pour.height<1?'低勺':pour.height>1.8?'高勺':'适中';state.needsRender=true;};
  $('speed').onchange=event=>{state.speed=Number(event.target.value);};
  $('play').onclick=()=>{if(state.drawing||state.draining)finishStroke(true);renderArtwork(true);};
  $('pause').onclick=()=>{state.paused=!state.paused;updateButtons();updateProgress();};
  $('clear').onclick=()=>{if(state.drawing||state.draining)finishStroke(true);state.clearedStrokes=state.strokes;state.strokes=[];renderArtwork();notify('石板清好了，可以重新画。');};
  $('undo').onclick=()=>{if(state.drawing||state.draining)finishStroke(true);state.strokes.pop();renderArtwork();};
  $('angle-view').onclick=()=>moveView('angle');$('top-view').onclick=()=>moveView('top');
  $('detail-view').onclick=()=>moveView('detail');
  $('pour-view').onclick=()=>moveView('pour');
  $('focus-view').onclick=()=>{const focus=document.body.classList.toggle('focus');$('focus-view').setAttribute('aria-label',focus?'退出专注模式':'进入专注模式');resize();};
  $('save').onclick=()=>{
    try {renderer.render(scene,camera);const a=document.createElement('a');a.download=`糖画铺-${state.mode==='draw'?'我的糖画':patterns[state.pattern].name}.png`;a.href=renderer.domElement.toDataURL('image/png');a.click();notify('这份甜，已经存成图片。');}
    catch{notify('图片没能保存，请刷新后再试一次。');}
  };
  container.addEventListener('pointerdown',e=>{
    if(state.mode!=='draw'||e.button!==0||state.drawing)return;
    const p=boardPoint(e);if(!p)return;if(state.drawing||state.draining)finishStroke(true);
    if(state.playing){state.playing=false;renderArtwork();}
    cameraMove=null;state.drawing=true;state.drawPoints=[p];liveDeposits=[];drawCommands=[{t:0,point:[p.x,p.z]}];pour.amount=state.thickness;pour.reset(p);pour.setTarget(p,true);drawStart=pour.time;
    container.setPointerCapture(e.pointerId);container.focus({preventScroll:true});e.preventDefault();
  });
  container.addEventListener('pointermove',e=>{
    if(!state.drawing)return;const p=boardPoint(e);if(!p)return;
    const prev=state.drawPoints.at(-1);if(p.distanceTo(prev)<.015)return;
    state.drawPoints.push(p);drawCommands.push({t:pour.time-drawStart,point:[p.x,p.z]});pour.setTarget(p,true);state.needsRender=true;
    if(state.drawPoints.length>1800){finishStroke(false);notify('这一笔画好了，松手后可以继续下一笔。');}
  });
  container.addEventListener('pointerup',()=>finishStroke(false));container.addEventListener('pointercancel',()=>finishStroke(false));container.addEventListener('lostpointercapture',()=>finishStroke(false));
  container.addEventListener('keydown',e=>{
    if(e.code==='Space'&&state.playing){e.preventDefault();$('pause').click();}
    if(e.code==='Escape'&&document.body.classList.contains('focus'))$('focus-view').click();
    if(state.mode==='watch'&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)) {
      e.preventDefault();cameraMove=null;const offset=camera.position.clone().sub(controls.target),s=new THREE.Spherical().setFromVector3(offset);
      s.theta+=(e.code==='ArrowLeft'?.12:e.code==='ArrowRight'?-.12:0);s.phi=THREE.MathUtils.clamp(s.phi+(e.code==='ArrowUp'?-.1:e.code==='ArrowDown'?.1:0),.01,Math.PI*.44);camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));controls.update();state.needsRender=true;
    }
  });
  document.addEventListener('visibilitychange',()=>{lastTime=0;state.needsRender=true;});
}
function frame(time) {
  const delta=lastTime?Math.min((time-lastTime)/1000,.05):0;lastTime=time;
  if(document.hidden)return;
  if(state.playing&&!state.paused)advancePlayback(delta*state.speed);
  if(state.drawing||state.draining){pour.step(delta);positionSpoon();if(state.draining&&!pour.active)commitStroke();state.needsRender=true;}
  if(cameraMove) {
    const t=Math.min(1,(time-cameraMove.start)/850),ease=1-Math.pow(1-t,4);
    camera.position.lerpVectors(cameraMove.from,cameraMove.to,ease);controls.target.lerpVectors(cameraMove.target,cameraMove.targetTo,ease);state.needsRender=true;if(t===1)cameraMove=null;
  }
  if(!state.paused&&sugarLayer.settle(delta))state.needsRender=true;
  if(controls.enabled||cameraMove)controls.update();
  if(state.needsRender){renderer.render(scene,camera);state.needsRender=false;}
}
function showError(message) {
  $('loading').hidden=false;$('loading').innerHTML='<span class="loading-seal">糖</span><p></p>';$('loading').querySelector('p').textContent=message;
  document.querySelectorAll('.studio-panel button, .view-tools button, #save').forEach(b=>b.disabled=true);
}
try {
  makeScene();wireUI();setPattern(0,!reducedMotion);$('loading').hidden=true;renderer.setAnimationLoop(frame);
  // Read-only diagnostics used by the local interaction verification.
  window.sugarStudio={getState:()=>({mode:state.mode,pattern:patterns[state.pattern].id,strokes:state.strokes.length,progress:state.progress,playing:state.playing,paused:state.paused,drawing:state.drawing,draining:state.draining,view:state.view,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,material:sugarLayer.stats(),pour:pour.stats()}),projectPoint:(x,z)=>{const p=v(x,.09,z).project(camera),r=container.getBoundingClientRect();return{x:r.left+(p.x+1)/2*r.width,y:r.top+(1-p.y)/2*r.height};}};
} catch(error) {console.error(error);showError('糖画摊暂时没能开起来，请使用支持 WebGL 的浏览器刷新重试。');}
