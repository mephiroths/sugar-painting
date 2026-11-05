// Match the guide against deposited sugar, including work from earlier strokes.
export function guideCoverage(points,layer,tolerance=.13) {
  if(!points.length)return 0;
  const {field,nx,nz,width,depth,dx,dz}=layer;
  const rx=Math.ceil(tolerance/dx),rz=Math.ceil(tolerance/dz),limit=tolerance*tolerance;
  let covered=0;
  for(const point of points){
    const gx=(point.x+width/2)/dx,gz=(point.z+depth/2)/dz,cx=Math.round(gx),cz=Math.round(gz);
    let found=false;
    for(let z=Math.max(0,cz-rz);z<=Math.min(nz-1,cz+rz)&&!found;z++)for(let x=Math.max(0,cx-rx);x<=Math.min(nx-1,cx+rx);x++){
      if(field[z*nx+x]>.0015&&((x-gx)*dx)**2+((z-gz)*dz)**2<=limit){found=true;break;}
    }
    if(found)covered++;
  }
  return covered/points.length;
}
