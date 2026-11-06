import * as THREE from 'three';

const lipOffset=new THREE.Vector3(),sourcePosition=new THREE.Vector3();

// Anchor the actual rim after every scale/tilt, rather than guessing a fixed
// offset from the bowl's centre. SugarPour remains the source of truth.
export function positionPouringSpoon(spoon,lip,source,height,gate) {
  spoon.rotation.y=-.65;
  spoon.rotation.z=THREE.MathUtils.lerp(.12,-.12,gate);
  spoon.position.set(0,0,0);
  spoon.updateWorldMatrix(true,true);
  lip.getWorldPosition(lipOffset);
  sourcePosition.set(source.x,height,source.z);
  if(spoon.parent){
    spoon.parent.worldToLocal(lipOffset);
    spoon.parent.worldToLocal(sourcePosition);
  }
  spoon.position.copy(sourcePosition).sub(lipOffset);
  spoon.updateWorldMatrix(false,true);
}
