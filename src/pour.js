import * as THREE from 'three';

// The hand controls the source, not the contact point. Parcels retain the
// source position at their emission time and take time to reach the stone.
export class SugarPour {
  constructor(scene,onDeposit,heightAt=()=>0) {
    this.onDeposit=onDeposit;this.heightAt=heightAt;this.time=0;this.height=1.55;this.amount=.04;this.g=28;this.v0=4;
    this.source=new THREE.Vector3();this.target=new THREE.Vector3();this.velocity=new THREE.Vector3();
    this.history=[];this.flow=false;this.gate=0;this.previousContact=null;this.contact=new THREE.Vector3();this.coilRadius=0;this.coilPhase=0;
    this.rings=64;this.sides=12;this.active=false;this.flowing=false;this.sequence=0;this.totalDeposited=0;
    const positions=new Float32Array((this.rings+1)*(this.sides+1)*3),thicknesses=new Float32Array((this.rings+1)*(this.sides+1));
    const indices=[];
    for(let i=0;i<this.rings;i++)for(let j=0;j<this.sides;j++){
      const a=i*(this.sides+1)+j,b=a+this.sides+1;indices.push(a,b,a+1,b,b+1,a+1);
    }
    this.geometry=new THREE.BufferGeometry();this.geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('flowThickness',new THREE.BufferAttribute(thicknesses,1).setUsage(THREE.DynamicDrawUsage));this.geometry.setIndex(indices);
    const material=new THREE.MeshPhysicalMaterial({color:'#fffdf6',transmission:1,metalness:0,roughness:.13,ior:1.49,thickness:.04,attenuationColor:new THREE.Color('#f3a43b'),attenuationDistance:.052,envMapIntensity:.8,specularIntensity:.8});
    material.onBeforeCompile=shader=>{
      shader.vertexShader='attribute float flowThickness;varying float parcelThickness;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nparcelThickness=flowThickness;');
      shader.fragmentShader='varying float parcelThickness;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <transmission_fragment>',THREE.ShaderChunk.transmission_fragment.replace('material.thickness = thickness;','material.thickness = parcelThickness;'));
    };
    this.mesh=new THREE.Mesh(this.geometry,material);this.mesh.frustumCulled=false;this.mesh.visible=false;this.mesh.name='有飞行时间的下落糖流';scene.add(this.mesh);
  }

  get flightTime() {return (Math.sqrt(this.v0*this.v0+2*this.g*this.height)-this.v0)/this.g;}
  get flux() {return .0068*(this.amount/.04)**2;}

  reset(point) {
    this.source.copy(point);this.target.copy(point);this.velocity.set(0,0,0);this.history=[];this.gate=0;this.flow=false;
    this.previousContact=null;this.active=false;this.flowing=false;this.mesh.visible=false;this.totalDeposited=0;this.coilRadius=0;this.coilPhase=0;
  }
  setTarget(point,flow=true) {this.target.copy(point);this.flow=flow;}

  sample(time) {
    const list=this.history;if(!list.length||time<list[0].t)return null;
    let lo=0,hi=list.length-1;
    while(lo<hi){const mid=Math.floor((lo+hi+1)/2);if(list[mid].t<=time)lo=mid;else hi=mid-1;}
    const a=list[lo],b=list[Math.min(lo+1,list.length-1)],t=b.t>a.t?THREE.MathUtils.clamp((time-a.t)/(b.t-a.t),0,1):0;
    return {x:THREE.MathUtils.lerp(a.x,b.x,t),z:THREE.MathUtils.lerp(a.z,b.z,t),vx:THREE.MathUtils.lerp(a.vx,b.vx,t),vz:THREE.MathUtils.lerp(a.vz,b.vz,t),h:THREE.MathUtils.lerp(a.h,b.h,t),flow:THREE.MathUtils.lerp(a.flow,b.flow,t)};
  }

  step(dt,update=true) {
    const count=Math.max(1,Math.ceil(dt*120)),h=dt/count;
    for(let i=0;i<count;i++)this.integrate(h);
    if(update)this.updateMesh();
  }

  integrate(dt) {
    this.time+=dt;
    const ax=(this.target.x-this.source.x)*110-this.velocity.x*21;
    const az=(this.target.z-this.source.z)*110-this.velocity.z*21;
    this.velocity.x+=ax*dt;this.velocity.z+=az*dt;this.source.addScaledVector(this.velocity,dt);
    this.gate=THREE.MathUtils.damp(this.gate,this.flow?1:0,this.flow?28:35,dt);
    this.history.push({t:this.time,x:this.source.x,z:this.source.z,vx:this.velocity.x,vz:this.velocity.z,h:this.height,flow:this.gate});
    while(this.history.length>2&&this.history[1].t<this.time-1.0)this.history.shift();
    const parcel=this.sample(this.time-this.flightTime);
    this.flowing=!!(parcel&&parcel.flow>.035);
    if(this.flowing){
      // Inherited horizontal motion bends a moving thread, instead of keeping
      // a rigid vertical cylinder attached to the mouse.
      const x=parcel.x+parcel.vx*this.flightTime*.12,z=parcel.z+parcel.vz*this.flightTime*.12;
      const speed=Math.hypot(parcel.vx,parcel.vz);
      const coilTarget=.022*THREE.MathUtils.smoothstep(.6-speed,0,.6);
      this.coilRadius=THREE.MathUtils.damp(this.coilRadius,coilTarget,12,dt);this.coilPhase+=30*dt;
      const cx=x+Math.cos(this.coilPhase)*this.coilRadius,cz=z+Math.sin(this.coilPhase)*this.coilRadius;
      this.contact.set(cx,.004+this.heightAt(cx,cz),cz);
      const volume=this.flux*parcel.flow*dt;
      if(this.previousContact){
        const distance=Math.hypot(this.contact.x-this.previousContact.x,this.contact.z-this.previousContact.z),contactSpeed=distance/Math.max(dt,.0001);
        const radius=THREE.MathUtils.clamp(Math.sqrt(this.flux/(Math.max(.8,contactSpeed)*2.0)),.026,.062);
        this.onDeposit(this.previousContact.clone(),this.contact.clone(),volume,radius);
        this.totalDeposited+=volume;
      }
      this.previousContact=this.contact.clone();
    } else {this.previousContact=null;this.coilRadius=0;}
    this.active=this.flow||this.gate>.025||this.history.some(p=>p.t>=this.time-this.flightTime&&p.flow>.035);
  }

  updateMesh() {
    const points=[],radii=[],flags=[],position=this.geometry.attributes.position,thickness=this.geometry.attributes.flowThickness;
    if(this.flowing)this.contact.y=.004+this.heightAt(this.contact.x,this.contact.z);
    let first=this.rings+1,last=-1;
    for(let i=0;i<=this.rings;i++){
      const u=i/this.rings,age=this.flightTime*u,parcel=this.sample(this.time-age);
      let point,flow=0;
      if(parcel){
        const y=Math.max(.004,parcel.h-this.v0*age-.5*this.g*age*age)+(this.flowing?Math.max(0,this.contact.y-.004)*THREE.MathUtils.smoothstep(u,.82,1):0);
        point=new THREE.Vector3(parcel.x+parcel.vx*age*.12,y,parcel.z+parcel.vz*age*.12);flow=parcel.flow;
        if(i===this.rings&&this.flowing)point.copy(this.contact);
      } else point=this.source.clone().setY(this.height*(1-u));
      const fallingSpeed=this.v0+this.g*age;
      const radius=Math.sqrt(this.flux*Math.max(.04,flow)/(Math.PI*fallingSpeed));
      points.push(point);radii.push(Math.max(.002,radius*1.18));flags.push(flow);
      if(flow>.035){first=Math.min(first,i);last=Math.max(last,i);}
    }
    const up=new THREE.Vector3(0,0,1),tangent=new THREE.Vector3(),right=new THREE.Vector3(),side=new THREE.Vector3();
    for(let i=0;i<=this.rings;i++){
      tangent.copy(points[Math.min(this.rings,i+1)]).sub(points[Math.max(0,i-1)]).normalize();
      right.crossVectors(tangent,up).normalize();side.crossVectors(right,tangent).normalize();
      for(let j=0;j<=this.sides;j++){
        const k=i*(this.sides+1)+j,a=j/this.sides*Math.PI*2;
        const p=points[i].clone().addScaledVector(right,Math.cos(a)*radii[i]).addScaledVector(side,Math.sin(a)*radii[i]);
        position.setXYZ(k,p.x,p.y,p.z);thickness.setX(k,radii[i]*2);
      }
    }
    position.needsUpdate=true;thickness.needsUpdate=true;this.geometry.computeVertexNormals();
    this.geometry.setDrawRange(Math.min(first,this.rings)*this.sides*6,Math.max(0,last-first)*this.sides*6);
    this.mesh.visible=last>first;
  }

  stats() {
    return {active:this.active,flowing:this.flowing,commanded:this.flow,flightTime:this.flightTime,source:[this.source.x,this.height,this.source.z],contact:this.flowing?this.contact.toArray():null,flux:this.flux,deposited:this.totalDeposited,threadVisible:this.mesh.visible};
  }
}
