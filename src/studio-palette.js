const defaults={
  gallery:['--scene-canvas','#e7d7bc'],workbench:['--scene-workbench','#d3ba91'],
  wood:['--scene-wood','#d4b68a'],stand:['--scene-stand','#bc925b'],standEdge:['--scene-stand-edge','#967044'],
  sugar:['--scene-sugar','#ad6219'],absorption:['--scene-absorption','#ce8c31']
};

// CSS owns the palette for both the interface and the WebGL scene.
export function getStudioPalette(){
  const css=typeof document==='undefined'?null:getComputedStyle(document.documentElement);
  return Object.fromEntries(Object.entries(defaults).map(([key,[property,fallback]])=>[key,css?.getPropertyValue(property).trim()||fallback]));
}
