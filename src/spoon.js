import * as THREE from 'three';

// Inner wall, from the bottom of the bowl to its rolled rim.
const innerProfile=[[0,.10],[.18,.12],[.26,.18],[.29,.26],[.32,.30]];
const rings=8,sides=48,bridgeRings=20,bridgeSides=10;
const liquidNormal=new THREE.Vector3(),down=new THREE.Vector3();
const start=new THREE.Vector3(),controlA=new THREE.Vector3(),controlB=new THREE.Vector3();
const point=new THREE.Vector3(),tangent=new THREE.Vector3(),right=new THREE.Vector3(),cross=new THREE.Vector3();
const forward=new THREE.Vector3(0,0,1);

function wallHeight(radius) {
  for(let i=1;i<innerProfile.length;i++){
    const a=innerProfile[i-1],b=innerProfile[i];
    if(radius<=b[0])return THREE.MathUtils.lerp(a[1],b[1],(radius-a[0])/(b[0]-a[0]));
  }
  return .30;
}

function gridGeometry(rows,columns) {
  const geometry=new THREE.BufferGeometry(),indices=[];
  geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array((rows+1)*(columns+1)*3),3).setUsage(THREE.DynamicDrawUsage));
  for(let i=0;i<rows;i++)for(let j=0;j<columns;j++){
    const a=i*(columns+1)+j,b=a+columns+1;indices.push(a,b,a+1,b,b+1,a+1);
  }
  geometry.setIndex(indices);return geometry;
}

export function createPouringSpoon(copper,bamboo) {
  const spoon=new THREE.Group();spoon.name='倾勺浇糖';spoon.scale.setScalar(2.2);
  const profile=[[0,0],[.10,.012],[.22,.07],[.32,.18],[.35,.26],[.35,.29],[.32,.30],[.29,.26],[.26,.18],[.18,.12],[0,.10]].map(p=>new THREE.Vector2(...p));
  const cup=new THREE.Mesh(new THREE.LatheGeometry(profile,48),copper);cup.name='铜勺碗';cup.castShadow=true;cup.receiveShadow=true;spoon.add(cup);
  const lip=new THREE.Object3D();lip.name='铜勺出糖口';
  // The free thread starts outside the metal, after syrup has crossed the rim.
  lip.position.set(.384,.278,0);cup.add(lip);
  const syrup=new THREE.MeshPhysicalMaterial({color:'#df9a2f',roughness:.18,metalness:0,transmission:.30,thickness:.14,ior:1.49,attenuationColor:new THREE.Color('#b9650d'),attenuationDistance:.12,clearcoat:1});
  const surfaceGeometry=gridGeometry(rings,sides),indices=surfaceGeometry.index;
  for(let i=0;i<indices.count;i+=3){const a=indices.getX(i);indices.setX(i,indices.getX(i+2));indices.setX(i+2,a);}
  const surface=new THREE.Mesh(surfaceGeometry,syrup);surface.name='随重力保持水平的勺内糖液';surface.frustumCulled=false;surface.receiveShadow=true;cup.add(surface);
  const overflow=new THREE.Mesh(gridGeometry(bridgeRings,bridgeSides),syrup);overflow.name='越过勺沿的糖浆';overflow.frustumCulled=false;overflow.visible=false;cup.add(overflow);
  const handle=(a,b,r,material)=>{
    const delta=b.clone().sub(a),rod=new THREE.Mesh(new THREE.CylinderGeometry(r,r,delta.length(),12),material);
    rod.position.copy(a).add(b).multiplyScalar(.5);rod.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());rod.castShadow=true;rod.receiveShadow=true;spoon.add(rod);
  };
  handle(new THREE.Vector3(0,.22,-.28),new THREE.Vector3(.05,.82,-1.72),.045,copper);
  handle(new THREE.Vector3(.05,.82,-1.72),new THREE.Vector3(.08,1.02,-2.2),.075,bamboo);
  spoon.userData.pouring={cup,lip,surface,overflow};
  return {spoon,lip};
}

export function updateSpoonLiquid(spoon,gate,amount=.04) {
  const model=spoon.userData.pouring;if(!model)return;
  const {cup,lip,surface,overflow}=model,m=cup.matrixWorld.elements;
  // A horizontal world-space surface clipped against the actual inner bowl.
  liquidNormal.set(m[1],m[5],m[9]).normalize();
  const slopeX=-liquidNormal.x/liquidNormal.y,slopeZ=-liquidNormal.z/liquidNormal.y;
  const tipping=THREE.MathUtils.smoothstep(gate,0,.16);
  const level=THREE.MathUtils.lerp(.222,.301-slopeX*.32,tipping);
  const vertices=surface.geometry.attributes.position;
  for(let j=0;j<=sides;j++){
    const angle=j/sides*Math.PI*2,c=Math.cos(angle),s=Math.sin(angle);
    let lo=0,hi=.32;
    for(let k=0;k<16;k++){
      const radius=(lo+hi)/2,y=level+(slopeX*c+slopeZ*s)*radius;
      if(y>wallHeight(radius))lo=radius;else hi=radius;
    }
    const edge=(lo+hi)/2;
    for(let i=0;i<=rings;i++){
      const r=edge*i/rings,x=c*r,z=s*r;
      vertices.setXYZ(i*(sides+1)+j,x,level+slopeX*x+slopeZ*z,z);
    }
  }
  vertices.needsUpdate=true;surface.geometry.computeVertexNormals();
  overflow.visible=gate>.035;if(!overflow.visible)return;
  start.set(.255,level+slopeX*.255,0);
  // A broad wet lip narrows to a thread; its end tangent follows gravity.
  controlA.set(.315,.330,0);
  down.copy(liquidNormal).negate();controlB.copy(lip.position).addScaledVector(down,-.043);
  const curve=new THREE.CubicBezierCurve3(start,controlA,controlB,lip.position);
  const bridge=overflow.geometry.attributes.position;
  const worldScale=spoon.getWorldScale(point).y;
  const threadRadius=Math.sqrt((.0068*(amount/.04)**2)*Math.max(.04,gate)/(Math.PI*4))*1.18/worldScale;
  for(let i=0;i<=bridgeRings;i++){
    const t=i/bridgeRings;curve.getPoint(t,point);curve.getTangent(t,tangent);
    right.crossVectors(tangent,forward).normalize();cross.crossVectors(right,tangent).normalize();
    const radius=THREE.MathUtils.lerp(.029*Math.sqrt(gate),Math.max(.002,threadRadius),t);
    for(let j=0;j<=bridgeSides;j++){
      const angle=j/bridgeSides*Math.PI*2,c=Math.cos(angle)*radius,s=Math.sin(angle)*radius;
      bridge.setXYZ(i*(bridgeSides+1)+j,point.x+right.x*c+cross.x*s,point.y+right.y*c+cross.y*s,point.z+right.z*c+cross.z*s);
    }
  }
  bridge.needsUpdate=true;overflow.geometry.computeVertexNormals();
}
