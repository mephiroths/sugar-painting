import * as THREE from 'three';

function patchSolidMaterial(shader) {
  shader.vertexShader='attribute float sugarDepth;varying float solidDepth;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nsolidDepth=sugarDepth;');
  shader.fragmentShader='varying float solidDepth;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <transmission_fragment>',THREE.ShaderChunk.transmission_fragment.replace('material.thickness = thickness;','material.thickness = max(.002, solidDepth * 1.45);'));
  shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=.08+.02*smoothstep(.02,.12,solidDepth);');
}

function solidMaterial(base) {
  const material=new THREE.MeshPhysicalMaterial({color:base.color.clone(),metalness:0,roughness:base.roughness,transmission:1,thickness:.1,ior:base.ior,attenuationColor:base.attenuationColor.clone(),attenuationDistance:base.attenuationDistance,envMapIntensity:base.envMapIntensity,specularIntensity:base.specularIntensity});
  material.onBeforeCompile=patchSolidMaterial;material.customProgramCacheKey=()=> 'sugar-solid-local-depth-v1';return material;
}

export function createSugarSolid(layer) {
  const {field,nx,nz,dx,dz,width,depth}=layer,threshold=.0015,thresholdFloat=Math.fround(threshold),stride=nx*nz*8;
  let [x0,x1,z0,z1]=layer.bounds;
  x0=Math.max(0,x0);x1=Math.min(nx-2,x1);z0=Math.max(0,z0);z1=Math.min(nz-2,z1);
  if(x0>x1||z0>z1)return null;
  const positions=[],normals=[],depths=[],indices=[],gridVertices=new Uint32Array(nx*nz),crossings=new Map(),boundary=new Map();
  const normalAt=index=>{
    const x=Math.max(1,Math.min(nx-2,index%nx)),z=Math.max(1,Math.min(nz-2,Math.floor(index/nx))),i=z*nx+x;
    const a=(field[i-1]-field[i+1])/(2*dx),b=(field[i-nx]-field[i+nx])/(2*dz),length=Math.hypot(a,1,b);return[a/length,1/length,b/length];
  };
  const pair=(x,z,h,normal)=>{
    const index=positions.length/3;x=Math.fround(x);z=Math.fround(z);h=Math.fround(h);
    positions.push(x,h,z,x,0,z);normals.push(...normal,0,-1,0);depths.push(h,h);return index;
  };
  const gridVertex=index=>{
    if(gridVertices[index])return gridVertices[index]-1;
    const vertex=pair(index%nx*dx-width/2,Math.floor(index/nx)*dz-depth/2,field[index],normalAt(index));gridVertices[index]=vertex+1;return vertex;
  };
  const crossing=(a,b)=>{
    const key=Math.min(a,b)*(nx*nz)+Math.max(a,b);if(crossings.has(key))return crossings.get(key);
    const t=(threshold-field[a])/(field[b]-field[a]),ax=a%nx*dx-width/2,az=Math.floor(a/nx)*dz-depth/2,bx=b%nx*dx-width/2,bz=Math.floor(b/nx)*dz-depth/2;
    const x=Math.fround(ax+(bx-ax)*t),z=Math.fround(az+(bz-az)*t);
    // At the exact Float32 cutoff, share the original grid vertex instead of
    // creating coincident intersections on the two adjacent grid edges.
    if(field[a]===thresholdFloat&&x===Math.fround(ax)&&z===Math.fround(az))return gridVertex(a);
    if(field[b]===thresholdFloat&&x===Math.fround(bx)&&z===Math.fround(bz))return gridVertex(b);
    const na=normalAt(a),nb=normalAt(b),normal=na.map((value,i)=>value+(nb[i]-value)*t),length=Math.hypot(...normal);
    const vertex=pair(x,z,threshold,normal.map(value=>value/length));crossings.set(key,vertex);return vertex;
  };
  const edge=(a,b)=>{
    const key=Math.min(a,b)*stride+Math.max(a,b);
    if(boundary.has(key))boundary.delete(key);else boundary.set(key,[a,b]);
  };
  const cap=(a,b,c)=>{
    if(a===b||b===c||a===c)return;
    const area=(positions[b*3]-positions[a*3])*(positions[c*3+2]-positions[a*3+2])-(positions[b*3+2]-positions[a*3+2])*(positions[c*3]-positions[a*3]);
    if(Math.abs(area)<1e-14)return;
    indices.push(a,b,c,a+1,c+1,b+1);edge(a,b);edge(b,c);edge(c,a);
  };
  const triangle=(a,b,c)=>{
    const inside=[field[a]>=threshold,field[b]>=threshold,field[c]>=threshold];
    if(!inside[0]&&!inside[1]&&!inside[2])return;
    if(inside[0]&&inside[1]&&inside[2]){cap(gridVertex(a),gridVertex(b),gridVertex(c));return;}
    const corners=[a,b,c],polygon=[];
    for(let i=0;i<3;i++){
      const previous=(i+2)%3;
      if(inside[previous]!==inside[i])polygon.push(crossing(corners[previous],corners[i]));
      if(inside[i])polygon.push(gridVertex(corners[i]));
    }
    for(let i=1;i<polygon.length-1;i++)cap(polygon[0],polygon[i],polygon[i+1]);
  };
  for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
    const i=z*nx+x;if(Math.max(field[i],field[i+1],field[i+nx],field[i+nx+1])<threshold)continue;
    triangle(i,i+nx,i+nx+1);triangle(i,i+nx+1,i+1);
  }
  if(!indices.length)return null;
  // The remaining oriented edges are exactly the top surface's outer and hole
  // contours. Close them to the flat underside, including the slab boundary.
  for(const [a,b]of boundary.values()){
    const ax=positions[a*3],az=positions[a*3+2],bx=positions[b*3],bz=positions[b*3+2],ha=depths[a],hb=depths[b],vx=bx-ax,vz=bz-az,length=Math.hypot(vx,vz);
    if(!length)continue;
    const start=positions.length/3;
    positions.push(ax,0,az,bx,0,bz,bx,hb,bz,ax,ha,az);
    for(let i=0;i<4;i++)normals.push(-vz/length,0,vx/length);
    depths.push(ha,hb,hb,ha);indices.push(start,start+1,start+2,start,start+2,start+3);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('sugarDepth',new THREE.Float32BufferAttribute(depths,1));geometry.setIndex(indices);geometry.computeBoundingSphere();geometry.computeBoundingBox();
  const solid=new THREE.Mesh(geometry,solidMaterial(layer.material));solid.name='凝固的糖画';return solid;
}
