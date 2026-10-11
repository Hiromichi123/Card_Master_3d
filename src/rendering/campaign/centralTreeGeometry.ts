import { BufferGeometry,CatmullRomCurve3,Color,Float32BufferAttribute,Vector3 } from 'three';
import { landmarkPoint,rand,terrainHeight,WORLD_EXPANSION,type PropInstance,type Vec3 } from './worldGeometry';
import { coastDistance } from './worldLayout';
import { CENTRAL_TREE_ANCHOR,CENTRAL_TREE_CROWN_RADIUS,CENTRAL_TREE_HEIGHT,CENTRAL_TREE_ROOT_RADIUS } from './worldPlacement';

export interface CentralTreeGeometry {wood:BufferGeometry;leaves:PropInstance[];lights:BufferGeometry}
interface WoodMesh {positions:number[];colors:number[];indices:number[]}
interface TubeOptions {
  readonly points:readonly Vector3[];
  readonly radii:readonly number[];
  readonly color:string;
  readonly seed:number;
  readonly segments:number;
  readonly sides:number;
  readonly ground?:(x:number,z:number)=>number;
}

/** Tapered, fluted cross-sections share one mesh instead of a draw call per root or twig. */
function appendTube(mesh:WoodMesh,{points,radii,color,seed,segments,sides,ground}:TubeOptions):void {
  const curve=new CatmullRomCurve3([...points]),centers:Vector3[]=[],widths:number[]=[];
  for(let i=0;i<=segments;i++){
    const t=i/segments,p=curve.getPoint(t),k=t*(radii.length-1),j=Math.min(radii.length-2,Math.floor(k));
    const radius=radii[j]!+(radii[j+1]!-radii[j]!)*(k-j);
    if(ground)p.y=ground(p.x,p.z)+radius*.15+2.4*(1-t)**10-.12*t**8;
    centers.push(p);widths.push(radius);
  }
  // Ground-following roots need frames computed from their final height samples.
  const framed=new CatmullRomCurve3(centers),frames=framed.computeFrenetFrames(segments,false);
  const offset=mesh.positions.length/3,tint=new Color(color),v=new Vector3();
  for(let i=0;i<=segments;i++)for(let j=0;j<=sides;j++){
    const a=j/sides*Math.PI*2,groove=1+.095*Math.cos(a*5+seed)+.035*Math.sin(i*.62+a*3);
    v.copy(centers[i]!).addScaledVector(frames.normals[i]!,Math.cos(a)*widths[i]!*groove)
      .addScaledVector(frames.binormals[i]!,Math.sin(a)*widths[i]!*groove);
    mesh.positions.push(v.x,v.y,v.z);
    const shade=.84+.16*Math.cos(a*5+seed)+.045*Math.sin(i*.4+seed);
    mesh.colors.push(tint.r*shade,tint.g*shade,tint.b*shade);
    if(i<segments&&j<sides){
      const k=offset+i*(sides+1)+j;
      mesh.indices.push(k,k+1,k+sides+1,k+1,k+sides+2,k+sides+1);
    }
  }
  for(const end of [0,segments]){
    const center=centers[end]!,index=mesh.positions.length/3;
    mesh.positions.push(center.x,center.y,center.z);mesh.colors.push(tint.r,tint.g,tint.b);
    for(let j=0;j<sides;j++){
      const k=offset+end*(sides+1)+j;
      if(end===0)mesh.indices.push(index,k+1,k);else mesh.indices.push(index,k,k+1);
    }
  }
}
function woodGeometry(mesh:WoodMesh):BufferGeometry {
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(mesh.positions,3));
  geometry.setAttribute('color',new Float32BufferAttribute(mesh.colors,3));
  geometry.setIndex(mesh.indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
  return geometry;
}

/** CPU-only generator shared by the map worker and geometry assertions. */
export function buildCentralTree(detail:2|3|4):CentralTreeGeometry {
  const base:Vec3=landmarkPoint(...CENTRAL_TREE_ANCHOR);
  const mesh:WoodMesh={positions:[],colors:[],indices:[]},leaves:PropInstance[]=[];
  const ground=(x:number,z:number):number=>terrainHeight(base[0]+x,base[2]+z)-base[1];
  const trunkColors=['#62513b','#756047','#594832','#80694b','#66553d'];
  const strand=(i:number,t:number):Vector3=>{
    const a=i/5*Math.PI*2+t*2.55,r=1.5+.95*(1-t)**3;
    return new Vector3(Math.cos(a)*r+Math.sin(t*4.4)*1.65,40*t-.45,Math.sin(a)*r+Math.sin(t*3.1)*1.1);
  };
  for(let i=0;i<5;i++){
    const points=Array.from({length:12},(_,j)=>strand(i,j/11));
    appendTube(mesh,{points,radii:[2.05,1.72,1.4,1.02,.43],color:trunkColors[i]!,seed:i,
      segments:detail*12,sides:12});
    // Slender raised bark ribs follow each twisting strand rather than straight vertical stripes.
    for(let rib=0;rib<3;rib++){
      const angle=i/5*Math.PI*2+rib*1.9;
      const ridge=points.map((p,j)=>{
        const t=j/(points.length-1),r=1.95*(1-t)+.35,a=angle+t*2.55;
        return p.clone().add(new Vector3(Math.cos(a)*r,0,Math.sin(a)*r));
      });
      appendTube(mesh,{points:ridge,radii:[.2,.16,.11,.025],color:rib===1?'#9a8056':'#483e2d',seed:i+rib,
        segments:detail*10,sides:5});
    }
  }
  for(let i=0;i<13;i++){
    const angle=i/13*Math.PI*2+(rand(i,721)-.5)*.25;
    let length=(CENTRAL_TREE_ROOT_RADIUS-1.7)*(.72+rand(i,722)*.28);
    // Stop before narrow inlets; both the broad shoulders and the tip stay on this landmass.
    for(let pass=0;pass<16;pass++){
      let dry=true;
      for(let j=1;j<=24;j++){
        const t=j/24,a=angle+Math.sin(t*Math.PI)*.15,r=1.5+length*t;
        const margin=(2.3*(1-t)**1.3+.25)/WORLD_EXPANSION;
        if(coastDistance((base[0]+Math.cos(a)*r)/WORLD_EXPANSION,(base[2]+Math.sin(a)*r)/WORLD_EXPANSION)<margin){dry=false;break;}
      }
      if(dry)break;
      length*=.88;
    }
    const points=Array.from({length:12},(_,j)=>{
      const t=j/11,a=angle+Math.sin(t*Math.PI)*.15,r=1.5+length*t;
      return new Vector3(Math.cos(a)*r,0,Math.sin(a)*r);
    });
    appendTube(mesh,{points,radii:[2.3,1.65,.83,.32,.045],color:trunkColors[i%5]!,seed:i+20,
      segments:detail*16,sides:10,ground});
  }
  for(let i=0;i<16;i++){
    const a=i/16*Math.PI*2+(rand(i,731)-.5)*.32,upper=i%3===0;
    const reach=(upper?13:23)*( .82+rand(i,732)*.18),y=upper?40:31+rand(i,733)*5;
    const start=strand(i%5,upper?.68:.45+rand(i,734)*.19);
    const tip=new Vector3(Math.cos(a)*reach,y,Math.sin(a)*reach);
    appendTube(mesh,{points:[start,new Vector3(Math.cos(a)*5,y-9,Math.sin(a)*5),
      new Vector3(Math.cos(a-.12)*reach*.64,y-3,Math.sin(a-.12)*reach*.64),tip],
      radii:[1.65,1.22,.7,.12],color:trunkColors[i%5]!,seed:i+40,segments:detail*9,sides:9});
    for(let fork=0;fork<2;fork++){
      const side=a+(fork===0?-.34:.34),end=new Vector3(Math.cos(side)*(reach+2),y+2.5,Math.sin(side)*(reach+2));
      appendTube(mesh,{points:[tip.clone().multiplyScalar(.72).add(new Vector3(0,y*.22,0)),tip,end],
        radii:[.58,.35,.035],color:'#756047',seed:i+fork+60,segments:detail*5,sides:7});
    }
  }
  const palette=['#254638','#305640','#3d6647','#486f4b','#557950','#698455'];
  const perTier=detail===2?40:detail===3?54:68;
  for(let tier=0;tier<3;tier++)for(let i=0;i<perTier;i++){
    const seed=tier*101+i,a=i*2.399963+rand(seed,741)*.5;
    const outer=tier===0?27:tier===1?22:13,r=Math.sqrt((i+.5)/perTier)*outer;
    const sx=3.5+rand(seed,742)*3.2,sy=2.15+rand(seed,743)*2.1,sz=3.25+rand(seed,744)*3;
    const maxSize=Math.max(sx,sz),radius=Math.min(r,CENTRAL_TREE_CROWN_RADIUS-maxSize-.1);
    const x=Math.cos(a)*radius,z=Math.sin(a)*radius*.85;
    const y=Math.min(CENTRAL_TREE_HEIGHT-sy-.1,32+tier*5.9+(rand(seed,745)-.5)*2.1);
    leaves.push({position:[x,y,z],scale:[sx,sy,sz],rotation:[0,a+(rand(seed,746)-.5)*.7,0],
      color:palette[Math.min(palette.length-1,Math.floor(rand(seed,747)*4)+Math.floor(tier*.8))]!});
  }
  const lights=new BufferGeometry(),positions:number[]=[],colors:number[]=[],seeds:number[]=[],kinds:number[]=[];
  const color=new Color('#c9edac');
  for(let i=0;i<detail*18;i++){
    const a=rand(i,751)*Math.PI*2,r=4+rand(i,752)*13;
    positions.push(Math.cos(a)*r,5+rand(i,753)*27,Math.sin(a)*r);
    colors.push(color.r,color.g,color.b);seeds.push(rand(i,754));kinds.push(1);
  }
  lights.setAttribute('position',new Float32BufferAttribute(positions,3));
  lights.setAttribute('color',new Float32BufferAttribute(colors,3));
  lights.setAttribute('aSeed',new Float32BufferAttribute(seeds,1));
  lights.setAttribute('aKind',new Float32BufferAttribute(kinds,1));
  lights.computeBoundingSphere();
  if(lights.boundingSphere)lights.boundingSphere.radius+=1.1;
  return {wood:woodGeometry(mesh),leaves,lights};
}
