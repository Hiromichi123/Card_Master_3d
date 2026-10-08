import { BufferGeometry, Float32BufferAttribute, Vector2, Vector4 } from 'three';

export const STATUS_NOISE_GLSL = `
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);}
  float fbm(vec2 p){float sum=0.;float amp=.5;for(int i=0;i<5;i++){sum+=noise(p)*amp;p=mat2(.8,-.6,.6,.8)*p*2.03+vec2(2.7,6.1);amp*=.5;}return sum;}
`;

export const MAX_BURN_SEGMENTS = 112;
/** Irregular molten paths, random lengths/forks, bounded to 92% of the card face.
 * The network is generated once per mounted status and retained throughout its reveal and breathing. */
export function burnCrackSegments(seedValue=Math.random()*10000): { segments: Vector4[]; count: number } {
  const segments:Vector4[]=[];
  let seed=seedValue;
  const random=()=>{const n=Math.sin(seed++*12.9898)*43758.5453;return n-Math.floor(n);};
  const walk=(x:number,y:number,heading:number,steps:number,length:number):{x:number;y:number;angle:number}[]=>{
    let angle=heading;
    const nodes=[{x,y,angle}];
    const curve=(random()-.5)*.50;
    for(let i=0;i<steps&&segments.length<MAX_BURN_SEGMENTS;i++){
      angle+=curve+(random()-.5)*.72;
      angle+=(heading-angle)*.035;
      const step=length*(.65+random()*.65);
      const nx=x+Math.cos(angle)*step,ny=y+Math.sin(angle)*step;
      segments.push(new Vector4(x,y,nx,ny));x=nx;y=ny;nodes.push({x,y,angle});
    }
    return nodes;
  };
  // Uneven bearings and independent reach: no six-spoke star or fixed branch spacing.
  for(let arm=0;arm<6;arm++){
    const angle=random()*Math.PI*2;
    const nodes=walk((random()-.5)*.06,(random()-.5)*.06,angle,4+Math.floor(random()*5),.04+random()*.06);
    const branchCount=1+Math.floor(random()*3);
    for(let branch=0;branch<branchCount&&nodes.length>2;branch++){
      const node=nodes[1+Math.floor(random()*(nodes.length-2))]!;
      const sign=random()<.5?-1:1;
      const fork=walk(node.x,node.y,node.angle+sign*(.30+random()*1.30),1+Math.floor(random()*4),.026+random()*.045);
      if(fork.length>3&&random()<.25){
        const twig=fork[1+Math.floor(random()*(fork.length-2))]!;
        walk(twig.x,twig.y,twig.angle+(random()<.5?-1:1)*(.5+random()),1+Math.floor(random()*2),.018+random()*.027);
      }
    }
  }
  const extentX=Math.max(.0001,...segments.flatMap((s)=>[Math.abs(s.x),Math.abs(s.z)]));
  const extentY=Math.max(.0001,...segments.flatMap((s)=>[Math.abs(s.y),Math.abs(s.w)]));
  for(const s of segments){s.x*=.46/extentX;s.z*=.46/extentX;s.y*=.69/extentY;s.w*=.69/extentY;}
  const count=segments.length;
  while(segments.length<MAX_BURN_SEGMENTS)segments.push(new Vector4(2,2,2,2));
  return {segments,count};
}

export const BURN_CRACK_GLSL = `
  uniform vec4 uCracks[112]; uniform int uCrackCount; uniform float uReveal;
  vec4 burnCracks(vec2 uv,float time){
    vec2 p=(uv-.5)*vec2(1.,1.5);float d=10.;
    for(int i=0;i<112;i++){
      if(i>=uCrackCount)break;
      vec2 a=uCracks[i].xy,b=uCracks[i].zw;
      if(length(a)>uReveal*.90)continue;
      vec2 ba=b-a;float t=clamp(dot(p-a,ba)/max(dot(ba,ba),.000001),0.,1.);
      d=min(d,length(p-a-ba*t));
    }
    float width=.012+noise(p*24.)*.006;
    float core=exp(-pow(d/width,2.));float halo=exp(-d*58.);
    float pulse=.78+.22*sin(length(p)*31.-time*2.6);
    vec3 color=mix(vec3(.72,.035,.004),vec3(1.,.47,.015),core*pulse);
    color=mix(color,vec3(1.2,.82,.20),pow(core,4.)*pulse*.65);
    float breath=.55+.50*(.5+.5*sin(time*1.9));
    return vec4(color*breath,(core*.94+halo*.25)*(.65+.35*breath)*smoothstep(0.,.10,uReveal));
  }
`;

/** Same cells for the thin surface mask and its detached fragments. */
export const CARD_FRACTURE_SEEDS: readonly (readonly [number,number])[] = [
  [-.29,-.33],[.09,-.36],[.34,-.14],[-.34,.01],[.015,.03],[-.20,.34],[.18,.34],[.35,.17],
];
export const FRACTURE_GLSL = `
  uniform vec2 uCells[8];
  float fractureEdge(vec2 uv){
    float first=10.,second=10.;vec2 p=(uv-.5)*vec2(1.,1.5);
    for(int i=0;i<8;i++){
      float d=length(p-uCells[i]*vec2(1.,1.5));
      if(d<first){second=first;first=d;}else second=min(second,d);
    }
    return 1.-smoothstep(.002,.009,second-first);
  }
`;
export const fractureUniforms = (): Vector2[] => CARD_FRACTURE_SEEDS.map(([x,y])=>new Vector2(x,y));

/** Clip each Voronoi cell to the card rectangle, triangulate in the original face UVs. */
export function cardMaskFragments(width:number,height:number): {geometry:BufferGeometry;center:Vector2}[] {
  const seeds=CARD_FRACTURE_SEEDS.map(([x,y])=>new Vector2(x*width,y*height));
  return seeds.map((seed,index)=>{
    let polygon=[new Vector2(-width/2,-height/2),new Vector2(width/2,-height/2),new Vector2(width/2,height/2),new Vector2(-width/2,height/2)];
    for(let j=0;j<seeds.length;j++){
      if(j===index)continue;
      const other=seeds[j]!,normal=other.clone().sub(seed);
      const limit=(other.lengthSq()-seed.lengthSq())*.5;
      const clipped:Vector2[]=[];
      for(let k=0;k<polygon.length;k++){
        const a=polygon[k]!,b=polygon[(k+1)%polygon.length]!;
        const da=a.dot(normal)-limit,db=b.dot(normal)-limit;
        if(da<=0)clipped.push(a);
        if((da<=0)!==(db<=0))clipped.push(a.clone().lerp(b,da/(da-db)));
      }
      polygon=clipped;
    }
    const center=polygon.reduce((sum,p)=>sum.add(p),new Vector2()).multiplyScalar(1/Math.max(1,polygon.length));
    const positions:number[]=[],uvs:number[]=[];
    for(let k=1;k<polygon.length-1;k++)for(const p of [polygon[0]!,polygon[k]!,polygon[k+1]!]){
      positions.push((p.x-center.x)*.985,(p.y-center.y)*.985,0);
      uvs.push(p.x/width+.5,p.y/height+.5);
    }
    const geometry=new BufferGeometry();
    geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
    geometry.setAttribute('uv',new Float32BufferAttribute(uvs,2));geometry.computeVertexNormals();
    return {geometry,center};
  });
}
