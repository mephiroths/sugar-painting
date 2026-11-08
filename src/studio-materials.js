import * as THREE from 'three';
import {getStudioPalette} from './studio-palette.js';

// Keep the real wood grain as a material cue, in the same pale family as the
// gallery stand. It is scene content, not a second page background.
export function createStudioWood(image) {
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;
  const context=canvas.getContext('2d');context.fillStyle=getStudioPalette().wood;context.fillRect(0,0,512,512);
  context.globalAlpha=.10;context.drawImage(image,0,0,512,512);context.globalAlpha=1;
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(21,21);return texture;
}
