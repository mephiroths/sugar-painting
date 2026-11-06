import * as THREE from 'three';

// The same SVG-to-world mapping is used by the presets and their printed guide.
// This mask is sampled by the marble material, so it stays on the stone and
// appears underneath the actual translucent sugar, including in angled views.
export class TemplateGuide {
  constructor() {
    this.width=9.1;this.depth=7.5;this.pattern=null;this.inkPixels=0;this.step=null;
    this.canvas=document.createElement('canvas');this.canvas.width=1024;this.canvas.height=844;
    this.context=this.canvas.getContext('2d',{willReadFrequently:true});
    this.texture=new THREE.CanvasTexture(this.canvas);this.texture.flipY=false;
    this.texture.minFilter=THREE.LinearMipmapLinearFilter;this.texture.magFilter=THREE.LinearFilter;
    this.uniforms={guideMask:{value:this.texture},guideEnabled:{value:0},guideOpacity:{value:.85},guideInk:{value:new THREE.Color('#291b13')}};
    this.clearMask();
  }
  clearMask() {
    const ctx=this.context;ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#000000';ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
  }
  setPattern(pattern) {
    this.pattern=pattern;this.step=null;this.drawMask();
  }
  setStep(index) {
    this.step=index===null?null:THREE.MathUtils.clamp(index,0,this.pattern.paths.length-1);
    this.drawMask();
  }
  drawMask() {
    const pattern=this.pattern;if(!pattern)return;this.clearMask();
    const ctx=this.context,sx=.083*pattern.scale*this.canvas.width/this.width,sy=.083*pattern.scale*this.canvas.height/this.depth;
    ctx.setTransform(sx,0,0,sy,this.canvas.width/2-50*sx,this.canvas.height/2-46*sy);
    ctx.strokeStyle='#ffffff';ctx.lineWidth=.026/(.083*pattern.scale);ctx.lineCap='round';ctx.lineJoin='round';
    for(let i=0;i<pattern.paths.length;i++){
      ctx.globalAlpha=this.step===null||this.step===i?1:.65;
      ctx.lineWidth=(this.step===i?.085:.04)/(.083*pattern.scale);
      ctx.stroke(new Path2D(pattern.paths[i]));
    }
    if(this.step!==null){
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',pattern.paths[this.step]);
      const start=path.getPointAtLength(0),radius=.16/(.083*pattern.scale);
      ctx.globalAlpha=1;ctx.lineWidth=.025/(.083*pattern.scale);ctx.beginPath();ctx.arc(start.x,start.y,radius,0,Math.PI*2);ctx.stroke();
    }
    ctx.globalAlpha=1;
    ctx.setTransform(1,0,0,1,0,0);const pixels=ctx.getImageData(0,0,this.canvas.width,this.canvas.height).data;
    this.inkPixels=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>20)this.inkPixels++;
    this.texture.needsUpdate=true;
  }
  setVisible(visible) {this.uniforms.guideEnabled.value=visible?1:0;}
  setOpacity(value) {this.uniforms.guideOpacity.value=THREE.MathUtils.clamp(value,.15,.85);}
  get visible() {return this.uniforms.guideEnabled.value===1;}
  stats() {return {pattern:this.pattern?.id||null,visible:this.visible,opacity:this.uniforms.guideOpacity.value,paths:this.pattern?.paths.length||0,inkPixels:this.inkPixels,step:this.step};}
}
