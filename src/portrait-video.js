import { t } from './i18n.js';
import * as THREE from 'three';

// Reuse a camera per renderer: Three.js retains a transmission render target
// for each camera, so creating one for every recording would grow GPU memory.
const cameras=new WeakMap();

export function createPortraitCamera() {
  const camera=new THREE.PerspectiveCamera(36,9/16,.1,100),target=new THREE.Vector3(0,.8,0),direction=new THREE.Vector3(.12,1.8,1).normalize();
  camera.position.copy(target).add(direction);camera.lookAt(target);camera.updateMatrixWorld();
  const inverse=camera.quaternion.clone().invert(),tanY=Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),tanX=tanY*camera.aspect;
  let distance=0;
  // The entire slab and the working height of the spoon stay inside the frame.
  for(const x of [-4.9,4.9])for(const y of [-.05,3.4])for(const z of [-4,4]){
    const p=new THREE.Vector3(x,y,z).sub(target).applyQuaternion(inverse);
    distance=Math.max(distance,p.z+Math.abs(p.x)/(tanX*.9),p.z+Math.abs(p.y)/(tanY*.72));
  }
  camera.position.copy(target).addScaledVector(direction,distance);camera.lookAt(target);camera.updateMatrixWorld();return camera;
}

export class PortraitVideo {
  constructor(renderer,scene,title) {
    this.renderer=renderer;this.scene=scene;this.title=title;this.brand=t('糖画铺');this.tagline=t('以糖为墨，以勺为笔');this.disposed=false;
    this.canvas=document.createElement('canvas');this.canvas.width=720;this.canvas.height=1280;this.context=this.canvas.getContext('2d');
    if(!this.context)throw new Error('竖屏画布不可用');
    if(!cameras.has(renderer))cameras.set(renderer,createPortraitCamera());this.camera=cameras.get(renderer);
    this.viewport=new THREE.Vector4();this.scissor=new THREE.Vector4();
    this.originalRatio=renderer.getPixelRatio();
    const size=renderer.getSize(new THREE.Vector2()),limit=Math.min(2048,renderer.capabilities.maxTextureSize),cap=Math.max(this.originalRatio,limit/Math.max(size.x,size.y));
    const ratio=Math.min(cap,Math.max(this.originalRatio,720/size.x,1280/size.y));
    try {renderer.setPixelRatio(ratio);}catch(error){renderer.setPixelRatio(this.originalRatio);throw error;}
  }

  render() {
    if(this.disposed)return;
    const renderer=this.renderer,source=renderer.domElement,ratio=renderer.getPixelRatio(),height=Math.min(source.height,Math.floor(source.width*16/9)),width=Math.floor(height*9/16),ctx=this.context;
    renderer.getViewport(this.viewport);renderer.getScissor(this.scissor);const scissorTest=renderer.getScissorTest();
    try {
      // Render into a portrait viewport of the existing buffer, then restore
      // the screen viewport. No buffer resize or CPU readback is needed per frame.
      renderer.setViewport(0,0,width/ratio,height/ratio);renderer.setScissor(0,0,width/ratio,height/ratio);renderer.setScissorTest(true);
      renderer.render(this.scene,this.camera);
      ctx.drawImage(source,0,source.height-height,width,height,0,0,720,1280);
      ctx.fillStyle='#f3ead9';ctx.font='36px KaiTi, STKaiti, serif';ctx.fillText(this.brand,48,100,624);
      ctx.fillStyle='#cbb7a0';ctx.font='20px KaiTi, STKaiti, serif';ctx.fillText(this.title,48,139,624);
      ctx.fillText(this.tagline,48,1190,624);
    } finally {renderer.setViewport(this.viewport);renderer.setScissor(this.scissor);renderer.setScissorTest(scissorTest);}
  }

  dispose() {
    if(this.disposed)return;this.disposed=true;this.renderer.setPixelRatio(this.originalRatio);
  }
}
