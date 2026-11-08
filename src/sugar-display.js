import * as THREE from 'three';
import {createSugarSolid} from './sugar-solid.js';
import {getStudioPalette} from './studio-palette.js';

const up=new THREE.Vector3(0,1,0);

// A stick overlaps the painting along its spine. Reward separated sugar
// contacts instead of attaching a short handle to the lowest occupied pixel.
export function planSugarMount(layer) {
  const {field,nx,nz,dx,dz,width,depth}=layer;
  let [x0,x1,z0,z1]=layer.bounds;
  x0=Math.max(1,x0);x1=Math.min(nx-2,x1);z0=Math.max(1,z0);z1=Math.min(nz-2,z1);
  const center=(x0+x1)/2,span=Math.max(1,x1-x0);
  let best=null;
  for(const centered of [true,false]) {
  if(best)break;
  for(let x=x0;x<=x1;x+=2) {
    if(centered&&Math.abs(x-center)>Math.max(2,span*.1))continue;
    const hits=[];
    for(let z=z0;z<=z1;z++) if(field[z*nx+x]>.0017)hits.push(z);
    if(!hits.length)continue;
    const reach=hits.at(-1)-hits[0],score=reach*.25+Math.min(hits.length,24)*.5-Math.abs(x-center)*1.4;
    if(!best||score>best.score)best={x,hits,score};
  }}
  if(!best)return null;
  const runs=[];
  for(const z of best.hits){const run=runs.at(-1);if(run&&z-run.at(-1)<=3)run.push(z);else runs.push([z]);}
  const centers=runs.length===1&&(best.hits.at(-1)-best.hits[0])*dz>.25?[best.hits[Math.floor(best.hits.length*.2)],best.hits[Math.floor(best.hits.length*.8)]]:runs.map(run=>run[Math.floor(run.length/2)]);
  const contacts=centers.length<=4?centers:[centers[0],centers[Math.floor(centers.length/3)],centers[Math.floor(centers.length*2/3)],centers.at(-1)];
  const x=best.x*dx-width/2,innerZ=best.hits[0]*dz-depth/2,exitZ=best.hits.at(-1)*dz-depth/2;
  const top=Math.max(...contacts.map(z=>field[z*nx+best.x])),stickY=Math.max(.034,Math.min(.085,top*.5+.022));
  return {x,innerZ,exitZ,tipZ:exitZ+Math.max(1.9,Math.min(3.2,(z1-z0)*dz*.5)),stickY,overlap:exitZ-innerZ,contacts:contacts.map(z=>({x,z:z*dz-depth/2,height:field[z*nx+best.x]}))};
}

function mesh(group,geometry,material) {
  const object=new THREE.Mesh(geometry,material);object.castShadow=true;object.receiveShadow=true;group.add(object);return object;
}
function rod(group,a,b,radius,material) {
  const delta=b.clone().sub(a),object=mesh(group,new THREE.CylinderGeometry(radius,radius*.94,delta.length(),12),material);
  object.position.copy(a).add(b).multiplyScalar(.5);object.quaternion.setFromUnitVectors(up,delta.normalize());return object;
}

export function createMountedSugar(layer) {
  const solid=createSugarSolid(layer),mount=planSugarMount(layer);
  if(!solid||!mount){solid?.geometry.dispose();solid?.material.dispose();return null;}
  const group=new THREE.Group(),body=new THREE.Group();group.add(body);
  body.position.set(-mount.x,0,-mount.tipZ);body.add(solid);
  const bamboo=new THREE.MeshStandardMaterial({color:'#d5b77d',roughness:.78});
  const stick=rod(body,new THREE.Vector3(mount.x,mount.stickY,mount.innerZ-.08),new THREE.Vector3(mount.x,mount.stickY,mount.tipZ),.034,bamboo);
  stick.name='竹签';
  // Small sugar pads make the attachment readable at multiple actual contacts.
  const glue=new THREE.MeshPhysicalMaterial({color:'#ffdf96',roughness:.18,transmission:1,thickness:.12,ior:1.49,attenuationColor:'#e8a13b',attenuationDistance:.15});
  for(const contact of mount.contacts){
    const pad=mesh(body,new THREE.SphereGeometry(1,14,8),glue);
    pad.position.set(contact.x,Math.max(contact.height*.5,mount.stickY-.012),contact.z);
    pad.scale.set(.095,Math.max(.035,mount.stickY+.015),.11);pad.name='粘签糖';
  }
  group.name='带竹签的糖画';group.userData.mount=mount;return group;
}

export function holdSugar(group,baseY=.75) {
  group.rotation.set(Math.PI/2,0,0);group.position.set(0,baseY,0);group.updateMatrixWorld(true);return group;
}

// A pale viewing stage needs enough amber body color for the thinnest lines.
// Change only the inspection copy's optics, never the stored height field.
export function styleInspectionSugar(group) {
  const palette=getStudioPalette();
  group.traverse(object=>{
    if(object.name!=='凝固的糖画')return;
    object.material.color.set(palette.sugar);object.material.transmission=.42;
    object.material.attenuationColor.set(palette.absorption);object.material.attenuationDistance=.025;
    object.material.envMapIntensity=1.05;object.material.specularIntensity=.65;
  });
  return group;
}

// Use the physical bamboo spine, independently of the artwork's silhouette
// and any space reserved for UI beside it.
export function sugarRotationAxis(group,bounds=new THREE.Box3().setFromObject(group)) {
  const stick=group.getObjectByName('竹签');if(!stick)return null;
  stick.updateWorldMatrix(true,false);
  const half=stick.geometry.parameters.height/2;
  const a=stick.localToWorld(new THREE.Vector3(0,-half,0)),b=stick.localToWorld(new THREE.Vector3(0,half,0));
  const direction=b.clone().sub(a).normalize(),center=bounds.getCenter(new THREE.Vector3());
  const pivot=a.clone().addScaledVector(direction,center.sub(a).dot(direction));
  return {pivot,direction,a,b};
}

// Share the already uploaded geometry. Only transforms and small material
// objects belong to the inspection view; returning must not dispose the rack.
export function createInspectionCopy(painting) {
  const copy=painting.clone(true),materials=new Map(),appearance=painting.userData.sugarAppearance;
  copy.userData.sharedGeometry=true;copy.scale.setScalar(1);
  const duplicate=material=>{
    if(!materials.has(material)){
      const next=material.clone();next.onBeforeCompile=material.onBeforeCompile;next.customProgramCacheKey=material.customProgramCacheKey;materials.set(material,next);
    }
    return materials.get(material);
  };
  copy.traverse(object=>{
    if(!object.material)return;
    object.material=Array.isArray(object.material)?object.material.map(duplicate):duplicate(object.material);
    if(object.name==='凝固的糖画'&&appearance){object.material.color.setHex(appearance.color);object.material.transmission=appearance.transmission;object.material.attenuationDistance=appearance.attenuationDistance;}
  });
  return holdSugar(styleInspectionSugar(copy));
}

export function rackMatchesEntries(previous,next) {
  if(!previous||previous.length!==next.length)return false;
  return previous.every((item,index)=>{
    const other=next[index];if(item===other)return true;if(item.id!==other.id)return false;
    const a=item.surface,b=other.surface;
    // Compare the exact geometry input, not dates or encoded byte counts.
    // Reopening IndexedDB creates fresh objects even for unchanged paintings.
    if(a&&b)return a.field===b.field&&a.x===b.x&&a.z===b.z&&a.width===b.width&&a.height===b.height&&Array.isArray(a.bounds)&&Array.isArray(b.bounds)&&a.bounds.join(',')===b.bounds.join(',');
    return !a&&!b&&item.strokes===other.strokes;
  });
}

export function fitDistance(size,aspect,fov=36,fill=.76) {
  const tan=Math.tan(THREE.MathUtils.degToRad(fov/2));
  return Math.max(2.5,Math.max(size.y/(2*tan),size.x/(2*tan*Math.max(.15,aspect)))/fill+size.z*.5);
}

export function disposeDisplay(group) {
  if(!group)return;
  const geometries=new Set(),materials=new Set(),textures=new Set();
  group.traverse(object=>{if(object.geometry)geometries.add(object.geometry);for(const material of [object.material].flat().filter(Boolean)){materials.add(material);if(material.map)textures.add(material.map);}});
  if(!group.userData.sharedGeometry){for(const geometry of geometries)geometry.dispose();for(const texture of textures)texture.dispose();}
  for(const material of materials)material.dispose();group.removeFromParent();
}

// Three physical sockets per page keep small screens and GPU memory bounded.
export function createDisplayRack(entries,makePainting) {
  const group=new THREE.Group();group.name='糖画展示架';
  const palette=getStudioPalette(),wood=new THREE.MeshStandardMaterial({color:palette.stand,roughness:.9}),edge=new THREE.MeshStandardMaterial({color:palette.standEdge,roughness:.85});
  const base=mesh(group,new THREE.BoxGeometry(7.4,.28,1.25),wood);base.position.y=.25;
  for(const x of [-2.8,2.8]){const foot=mesh(group,new THREE.BoxGeometry(.5,.14,1.5),edge);foot.position.set(x,.07,0);}
  const sockets=[-2.4,0,2.4];
  for(const x of sockets){
    const hole=mesh(group,new THREE.CylinderGeometry(.095,.095,.014,24),new THREE.MeshStandardMaterial({color:'#70563b',roughness:1}));hole.position.set(x,.397,0);
    const rim=mesh(group,new THREE.TorusGeometry(.10,.018,6,24),edge);rim.rotation.x=Math.PI/2;rim.position.set(x,.404,0);
  }
  const paintings=[],pickTargets=[];
  entries.forEach((entry,index)=>{
    const painting=makePainting(entry);if(!painting)return;
    painting.traverse(object=>{if(object.name==='凝固的糖画')painting.userData.sugarAppearance={color:object.material.color.getHex(),transmission:object.material.transmission,attenuationDistance:object.material.attenuationDistance};});styleInspectionSugar(painting);
    holdSugar(painting,0);const bounds=new THREE.Box3().setFromObject(painting),size=bounds.getSize(new THREE.Vector3());
    const scale=Math.min(4.9/Math.max(.1,size.y),2.05/Math.max(.1,size.x));painting.scale.setScalar(scale);
    painting.position.set(sockets[index],.30,0);painting.userData.workId=entry.id;group.add(painting);
    painting.updateMatrixWorld(true);
    const shown=new THREE.Box3().setFromObject(painting),shownSize=shown.getSize(new THREE.Vector3()),center=shown.getCenter(new THREE.Vector3());
    const target=mesh(group,new THREE.PlaneGeometry(Math.max(.45,shownSize.x+.14),shownSize.y),new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:false,transparent:true,opacity:0,side:THREE.DoubleSide}));
    target.position.copy(center);target.position.z+=.13;target.userData.workId=entry.id;target.castShadow=false;target.receiveShadow=false;target.name='作品点击区域';
    pickTargets.push(target);
    paintings.push({id:entry.id,object:painting,center:shown.getCenter(new THREE.Vector3())});
  });
  group.userData.paintings=paintings;group.userData.pickTargets=pickTargets;return group;
}
