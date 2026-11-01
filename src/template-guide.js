import * as THREE from 'three';

// The same SVG-to-world mapping is used by the presets and their printed guide.
// This mask is sampled by the marble material, so it stays on the stone and
// appears underneath the actual translucent sugar, including in angled views.
export class TemplateGuide {
  constructor() {
    this.width=9.1;this.depth=7.5;this.pattern=null;this.inkPixels=0;
    this.canvas=document.createElement('canvas');this.canvas.width=1024;this.canvas.height=844;
    this.context=this.canvas.getContext('2d',{willReadFrequently:true});
    this.texture=new THREE.CanvasTexture(this.canvas);this.texture.flipY=false;
    this.texture.minFilter=THREE.LinearMipmapLinearFilter;this.texture.magFilter=THREE.LinearFilter;
    this.uniforms={guideMask:{value:this.texture},guideEnabled:{value:0},guideOpacity:{value:.5},guideInk:{value:new THREE.Color('#526b70')}};
    this.clearMask();
  }
  clearMask() {
    const ctx=this.context;ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#000000';ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
  }
  setPattern(pattern) {
    this.pattern=pattern;this.clearMask();
    const ctx=this.context,sx=.083*pattern.scale*this.canvas.width/this.width,sy=.083*pattern.scale*this.canvas.height/this.depth;
    ctx.setTransform(sx,0,0,sy,this.canvas.width/2-50*sx,this.canvas.height/2-46*sy);
    ctx.strokeStyle='#ffffff';ctx.lineWidth=.026/(.083*pattern.scale);ctx.lineCap='round';ctx.lineJoin='round';
    for(const path of pattern.paths)ctx.stroke(new Path2D(path));
    ctx.setTransform(1,0,0,1,0,0);const pixels=ctx.getImageData(0,0,this.canvas.width,this.canvas.height).data;
    this.inkPixels=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>20)this.inkPixels++;
    this.texture.needsUpdate=true;
  }
  setVisible(visible) {this.uniforms.guideEnabled.value=visible?1:0;}
  setOpacity(value) {this.uniforms.guideOpacity.value=THREE.MathUtils.clamp(value,.15,.85);}
  get visible() {return this.uniforms.guideEnabled.value===1;}
  stats() {return {pattern:this.pattern?.id||null,visible:this.visible,opacity:this.uniforms.guideOpacity.value,paths:this.pattern?.paths.length||0,inkPixels:this.inkPixels};}
}
