import * as T from 'three';

// Small, seamless physical finish maps. Independent coarse mottling, grain and
// pores keep plaster/stone from looking like either plastic or a tiled image.
export function finishMaps(kind: 'stone' | 'plaster' | 'metal') {
  const size=256, heights=new Float32Array(size*size);
  const hash=(x:number,y:number,n:number)=>{
    const v=Math.sin((x%n+n)%n*127.1+(y%n+n)%n*311.7+41.3)*43758.5453;
    return v-Math.floor(v);
  };
  const noise=(x:number,y:number,n:number)=>{
    const px=x/size*n,py=y/size*n,ix=Math.floor(px),iy=Math.floor(py);
    let u=px-ix,v=py-iy;u=u*u*(3-2*u);v=v*v*(3-2*v);
    return T.MathUtils.lerp(T.MathUtils.lerp(hash(ix,iy,n),hash(ix+1,iy,n),u),T.MathUtils.lerp(hash(ix,iy+1,n),hash(ix+1,iy+1,n),u),v);
  };
  const albedo=new Uint8Array(size*size*4),roughness=new Uint8Array(size*size*4),normal=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=y*size+x,k=i*4,cloud=noise(x,y,4),grain=noise(x,y,32),fine=hash(x,y,size);
    const pores=fine>.965 ? -.13 : 0;
    heights[i]=noise(x,y,16)*.24+grain*.13+fine*.035+pores;
    const shade=kind==='stone'?213+cloud*25+grain*9:kind==='plaster'?226+cloud*15+grain*7:220+cloud*26;
    albedo[k]=albedo[k+1]=albedo[k+2]=shade;albedo[k+3]=255;
    const rough=kind==='metal'?148+cloud*68:kind==='stone'?186+grain*47:211+grain*39;
    roughness[k]=roughness[k+1]=roughness[k+2]=rough;roughness[k+3]=255;
  }
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const sample=(xx:number,yy:number)=>heights[((yy+size)%size)*size+(xx+size)%size];
    const n=new T.Vector3((sample(x-1,y)-sample(x+1,y))*1.6,(sample(x,y-1)-sample(x,y+1))*1.6,1).normalize(),k=(y*size+x)*4;
    normal[k]=(n.x*.5+.5)*255;normal[k+1]=(n.y*.5+.5)*255;normal[k+2]=(n.z*.5+.5)*255;normal[k+3]=255;
  }
  const make=(data:Uint8Array,color=false)=>{const t=new T.DataTexture(data,size,size,T.RGBAFormat);t.wrapS=t.wrapT=T.RepeatWrapping;t.magFilter=T.LinearFilter;t.minFilter=T.LinearMipmapLinearFilter;t.generateMipmaps=true;t.colorSpace=color?T.SRGBColorSpace:T.NoColorSpace;t.needsUpdate=true;return t;};
  return {map:make(albedo,true),normalMap:make(normal),roughnessMap:make(roughness)};
}
