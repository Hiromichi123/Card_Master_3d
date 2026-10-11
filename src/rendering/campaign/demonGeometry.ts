import { BoxGeometry,BufferGeometry,Color,ConeGeometry,CylinderGeometry,Float32BufferAttribute,IcosahedronGeometry,Matrix4,Quaternion,TorusGeometry,Vector3 } from 'three';
import { DEMON_PIT_FLOOR,DEMON_PIT_RADIUS,DEMON_SITES,type DemonStageId } from './demonLayout';
import { terrainHeight,WORLD_EXPANSION } from './worldGeometry';
import { DEMON_ROADS,DEMON_ROAD_HALF_WIDTH } from './demonScenery';
import { appendDemonSettlement } from './demonSettlementGeometry';
import { buildTerrainRoads } from './terrainRoadGeometry';

export interface DemonGeometry {stone:BufferGeometry;trim:BufferGeometry;glow:BufferGeometry;abyss:BufferGeometry}
type Point=readonly [number,number,number];
interface Parts {stone:Builder;trim:Builder;glow:Builder;abyss:Builder}
const up=new Vector3(0,1,0);

class Builder {
  private readonly positions:number[]=[];private readonly colors:number[]=[];private readonly indices:number[]=[];
  private readonly uvs:number[]=[];private readonly kinds:number[]=[];private readonly sites:number[]=[];
  constructor(readonly site:number=0){}
  append(shape:BufferGeometry,color:string,position:Point,scale:Point=[1,1,1],rotation=0,kind=0,site=this.site):void {
    const matrix=new Matrix4().compose(new Vector3(...position),new Quaternion().setFromAxisAngle(up,rotation),new Vector3(...scale));
    shape.applyMatrix4(matrix);
    const p=shape.getAttribute('position'),uv=shape.getAttribute('uv'),index=shape.getIndex(),offset=this.positions.length/3,tint=new Color(color);
    for(let i=0;i<p.count;i++){
      this.positions.push(p.getX(i),p.getY(i),p.getZ(i));this.colors.push(tint.r,tint.g,tint.b);
      this.uvs.push(uv?.getX(i)??0,uv?.getY(i)??0);this.kinds.push(kind);this.sites.push(site);
    }
    if(index)for(let i=0;i<index.count;i++)this.indices.push(offset+index.getX(i));
    else for(let i=0;i<p.count;i++)this.indices.push(offset+i);
    shape.dispose();
  }
  quad(points:readonly [Point,Point,Point,Point],color:string,site:number,kind=0):void {
    const offset=this.positions.length/3,c=new Color(color);
    for(let i=0;i<4;i++){this.positions.push(...points[i]!);this.colors.push(c.r,c.g,c.b);this.kinds.push(kind);this.sites.push(site);}
    this.uvs.push(0,0,1,0,1,1,0,1);this.indices.push(offset,offset+1,offset+2,offset,offset+2,offset+3);
  }
  finish():BufferGeometry {
    const geometry=new BufferGeometry();
    geometry.setAttribute('position',new Float32BufferAttribute(this.positions,3));
    geometry.setAttribute('color',new Float32BufferAttribute(this.colors,3));
    geometry.setAttribute('uv',new Float32BufferAttribute(this.uvs,2));
    geometry.setAttribute('aKind',new Float32BufferAttribute(this.kinds,1));
    geometry.setAttribute('aSite',new Float32BufferAttribute(this.sites,1));
    geometry.setIndex(this.indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();return geometry;
  }
}
function box(b:Builder,p:Point,size:Point,color:string,site:number,rotation=0):void {b.append(new BoxGeometry(1,1,1),color,p,size,rotation,0,site);}
function ring(b:Builder,p:Point,radius:number,tube:number,color:string,site:number,vertical=false):void {
  const g=new TorusGeometry(radius,tube,5,64);if(!vertical)g.rotateX(Math.PI/2);b.append(g,color,p,[1,1,1],0,0,site);
}
function base(id:DemonStageId):Point {const p=DEMON_SITES[id].center;return [p[0]*WORLD_EXPANSION,terrainHeight(p[0]*WORLD_EXPANSION,p[1]*WORLD_EXPANSION),p[1]*WORLD_EXPANSION];}

/** The top is level; every skirt vertex meets the actual perimeter terrain, not only its center. */
export function demonFoundation(x:number,z:number,width:number,depth:number,scale=1):{top:number;edge:readonly Point[]} {
  const edge:Point[]=[];let top=-Infinity;
  for(let side=0;side<4;side++)for(let step=0;step<12;step++){
    const t=step/12;
    const px=x+(side===0?-width/2+width*t:side===1?width/2:side===2?width/2-width*t:-width/2);
    const pz=z+(side===0?-depth/2:side===1?-depth/2+depth*t:side===2?depth/2:depth/2-depth*t);
    const h=terrainHeight(px,pz);edge.push([px,h-.04,pz]);top=Math.max(top,h);
  }
  for(let i=0;i<=8;i++)for(let j=0;j<=8;j++)top=Math.max(top,terrainHeight(x-width/2+width*i/8,z-depth/2+depth*j/8));
  return {top:top+.14*scale,edge};
}
function foundation(b:Builder,x:number,z:number,width:number,depth:number,site:number,color:string,scale=1):number {
  const {top,edge}=demonFoundation(x,z,width,depth,scale);
  for(let i=0;i<edge.length;i++){
    const p=edge[i]!,q=edge[(i+1)%edge.length]!;
    b.quad([p,[p[0],top,p[2]],[q[0],top,q[2]],q],color,site);
  }
  box(b,[x,top+.08*scale,z],[width,.16*scale,depth],color,site);return top+.16*scale;
}
function stair(b:Builder,x:number,z:number,start:number,end:number,length:number,width:number,count:number,color:string,site:number,scale=1):void {
  for(let i=0;i<count;i++){
    const t=(i+.5)/count,pz=z+length*(1-t),top=start+(end-start)*(i+1)/count;
    const ground=Math.max(terrainHeight(x-width/2,pz),terrainHeight(x+width/2,pz),terrainHeight(x,pz));
    const bottom=Math.min(top-.06*scale,ground-.06);
    box(b,[x,(top+bottom)/2,pz],[width,top-bottom,length/count+.018*scale],color,site);
  }
}
function gateway(parts:Parts):void {
  const [x,,z]=base('2-1'),site=1,s=DEMON_SITES['2-1'].modelScale;
  const y=foundation(parts.stone,x,z,4.4*s,3*s,site,'#302b32',s);
  const point=(dx:number,dy:number,dz:number):Point=>[x+dx*s,y+dy*s,z+dz*s];
  const block=(b:Builder,p:Point,size:Point,color:string):void=>box(b,point(...p),[size[0]*s,size[1]*s,size[2]*s],color,site);
  // Scale architecture about the new platform, never scale the underlying terrain.
  for(const side of [-1,1]){
    for(let i=0;i<9;i++)block(parts.stone,[side*1.44,.32+i*.59,-.2],[.58,.56,.68],i%2?'#49444b':'#383740');
    block(parts.stone,[side*1.44,.15,-.2],[.85,.3,.94],'#66616a');
    block(parts.glow,[side*1.12,2.75,.16],[.064,5.14,.07],'#ffbc76');
    block(parts.glow,[side*1.105,2.75,.205],[.023,5.14,.045],'#fff4cb');
  }
  block(parts.stone,[0,5.63,-.2],[3.63,.55,.88],'#54484b');
  block(parts.stone,[0,5.98,-.2],[3.84,.16,.98],'#6c6164');
  block(parts.glow,[0,5.33,.16],[2.29,.075,.09],'#ffe7b3');
  parts.glow.quad([point(-1.09,.2,-.1),point(1.09,.2,-.1),point(1.09,5.32,-.1),point(-1.09,5.32,-.1)],'#ffffff',site,1);
  for(let i=0;i<4;i++){
    const px=x+(i<2?-2.55:2.55)*s,pz=z+(-.8+(i%2)*1.5)*s,h=(1.05+(i%3)*.53)*s;
    const py=terrainHeight(px,pz);
    parts.stone.append(new CylinderGeometry(.17*s,.26*s,h,7),'#605760',[px,py+h/2,pz],[1,1,1],i,0,site);
    box(parts.stone,[px,py+.1*s,pz],[.62*s,.2*s,.6*s],'#37323b',site);
  }
  stair(parts.stone,x,z+1.28*s,terrainHeight(x,z+2.25*s)+.06*s,y,s,2.1*s,6,'#49414a',site,s);
}
function tower(parts:Parts):void {
  const [x,,z]=base('2-2'),site=2,s=DEMON_SITES['2-2'].modelScale;
  const y=foundation(parts.stone,x,z,6.6*s,6.2*s,site,'#37313c',s);
  const point=(dx:number,dy:number,dz:number):Point=>[x+dx*s,y+dy*s,z+dz*s];
  const block=(b:Builder,p:Point,size:Point,color:string):void=>box(b,point(...p),[size[0]*s,size[1]*s,size[2]*s],color,site);
  for(let tier=0;tier<5;tier++){
    const width=5.6-tier*.84,depth=4.7-tier*.68,py=tier*2.55;
    block(parts.stone,[0,py+1.2,0],[width,2.4,depth],tier%2?'#443842':'#35313b');
    block(parts.trim,[0,py+.12,0],[width+.15,.12,depth+.13],'#a77d41');
    block(parts.trim,[0,py+2.42,0],[width+.19,.16,depth+.18],'#ba995e');
    for(const side of [-1,1])for(const offset of [-.32,.32]){
      const px=side*(width/2+.12),pz=depth*offset;
      block(parts.stone,[px,py+1.45,pz],[.28,2.9,.38],'#777078');
      parts.stone.append(new ConeGeometry(.3,.95,4),'#36303a',point(px,py+3.35,pz),[s,s,s],Math.PI/4,0,site);
      block(parts.trim,[px,py+1.48,pz+.22],[.055,2.4,.035],'#d3b278');
    }
    for(const side of [-1,1]){
      const px=side*width*.24;
      block(parts.trim,[px,py+1.4,depth/2+.02],[.1,1.8,.04],'#c3a16a');
      block(parts.stone,[px,py+1.4,depth/2+.05],[.35,1.45,.045],'#1c1b25');
      block(parts.glow,[px,py+1.4,depth/2+.084],[.046,1.23,.018],'#cf6139');
    }
  }
  // The narrow uninterrupted stair rises through the stepped facade to the altar.
  stair(parts.stone,x,z+.68*s,y+.04*s,y+12.65*s,4.52*s,1.24*s,56,'#817079',site,s);
  for(const side of [-1,1])for(let i=0;i<14;i++){
    const t=(i+.5)/14;
    block(parts.trim,[side*.7,.14+12.65*t,.68+4.52*(1-t)],[.09,.09,.3],'#c3a66a');
  }
  parts.glow.append(new IcosahedronGeometry(.42,1),'#ff5335',point(0,13.15,0),[s,1.2*s,s],0,0,site);
  parts.stone.append(new ConeGeometry(.28,2.35,5),'#4a3941',point(0,14.4,0),[s,s,s],0,0,site);
  parts.glow.append(new CylinderGeometry(.025,.09,5.2,8),'#ff3c25',point(0,16.15,0),[s,s,s],0,2,site);
  parts.stone.append(new IcosahedronGeometry(1.15,2),'#160a16',point(0,19.2,0),[s,s,s],0,0,site);
  ring(parts.glow,point(0,19.2,0),1.24*s,.06*s,'#bb2726',site,true);
  ring(parts.trim,point(0,8.75,1.8),.45*s,.035*s,'#d2ab62',site,true);
}
function temple(parts:Parts):void {
  const [x,,z]=base('2-3'),site=3,y=foundation(parts.stone,x,z,7.8,6.8,site,'#724838');
  for(let tier=0;tier<7;tier++){
    const width=7.5-tier*.84,depth=6.4-tier*.68,py=y+tier*.58;
    box(parts.stone,[x,py+.27,z],[width,.54,depth],tier%2?'#875342':'#684137',site);
    box(parts.trim,[x,py+.54,z],[width+.07,.06,depth+.07],'#b98554',site);
    for(const side of [-1,1])for(let j=0;j<4;j++)box(parts.stone,[x+side*(width/2+.025),py+.22,z+(j-1.5)*depth/4],[.075,.35,.08],'#4e3430',site);
  }
  stair(parts.stone,x,z+.65,terrainHeight(x,z+5.45)+.06,y+4.08,4.8,1.55,30,'#a57b57',site);
  box(parts.stone,[x,y+4.27,z],[1.5,.42,1.28],'#ae8156',site);
  parts.glow.append(new CylinderGeometry(.035,.1,10.2,8),'#fff6c6',[x,y+9.7,z],[1,1,1],0,2,site);
  ring(parts.glow,[x,y+5.65,z],2.1,.036,'#ffeabb',site);
  ring(parts.glow,[x,y+8.25,z],1.16,.03,'#fff2ce',site);
  for(let i=0;i<10;i++){
    const a=i/10*Math.PI*2,r=7.4+.3*Math.sin(i*3),px=x+Math.cos(a)*r,pz=z+Math.sin(a)*r,py=terrainHeight(px,pz)+1.05;
    const w=1.65+.35*Math.sin(i*2),d=.65;
    parts.glow.quad([[px-w,py,pz-d],[px-w,py,pz+d],[px+w,py,pz+d],[px+w,py,pz-d]],'#c4c5c9',site,3);
  }
  for(let i=0;i<25;i++){
    const a=i/25*Math.PI*2,r=8.25+Math.sin(i*4.7)*.48,px=x+Math.cos(a)*r,pz=z+Math.sin(a)*r;
    // Open the southern approach so the stair and flag do not disappear behind a cliff wall.
    if(Math.sin(a)>.83)continue;
    const h=.65+(Math.sin(i*2.3)*.5+.5)*1.15,py=terrainHeight(px,pz);
    parts.stone.append(new IcosahedronGeometry(1,0),i%3?'#66504b':'#896054',[px,py+h*.28,pz],[.72,h,.62],a,0,site);
  }
}
function abyss(parts:Parts):void {
  const [x,,z]=base('2-4'),site=4,maxRadius=DEMON_PIT_RADIUS*WORLD_EXPANSION;
  for(let strand=0;strand<5;strand++)for(let i=0;i<220;i++){
    const point=(t:number,side:number):Point=>{
      const r=.7+t*(maxRadius-.82)+side*.027,a=strand*Math.PI*2/5+t*8.8;
      const px=x+Math.cos(a)*r,pz=z+Math.sin(a)*r;
      return [px,terrainHeight(px,pz)+.11,pz];
    };
    if((i+strand*13)%37<5)continue;
    const t=i/220,next=(i+1)/220;
    parts.abyss.quad([point(t,-1),point(next,-1),point(next,1),point(t,1)],strand%2?'#aa64e5':'#7550c9',site);
  }
  // The core is sealed above the map's support; it is not a water disc or a flat lid across the pit.
  const centerHeight=terrainHeight(x,z);
  parts.stone.append(new CylinderGeometry(.52,.52,.028,48),'#080510',[x,Math.max(DEMON_PIT_FLOOR+.06,centerHeight+.065),z],[1,1,1],0,0,site);
  for(let i=0;i<34;i++){
    const a=i/34*Math.PI*2,r=maxRadius-.27+.08*Math.sin(i*3),px=x+Math.cos(a)*r,pz=z+Math.sin(a)*r;
    const h=.2+.25*(.5+.5*Math.sin(i*7));
    parts.stone.append(new IcosahedronGeometry(1,0),i%2?'#3b294c':'#281c39',[px,terrainHeight(px,pz)+.12,pz],[.35,h,.26],a,0,site);
  }
}

/** CPU-only merged meshes: generation belongs in the worker, never the scene's render path. */
export function buildDemonGeometry(terrain?:BufferGeometry):DemonGeometry {
  const parts:Parts={stone:new Builder(),trim:new Builder(),glow:new Builder(),abyss:new Builder()};
  gateway(parts);tower(parts);temple(parts);abyss(parts);
  appendDemonSettlement(parts.stone,parts.trim,(x,z,w,d)=>foundation(parts.stone,x,z,w,d,0,'#504343',.5));
  if(terrain){
    const roads=DEMON_ROADS.map(points=>points.map(([x,z])=>[x*WORLD_EXPANSION,z*WORLD_EXPANSION] as const));
    parts.stone.append(buildTerrainRoads(terrain,roads,DEMON_ROAD_HALF_WIDTH),'#b59577',[0,0,0],[1,1,1],0,0,0);
  }
  return {stone:parts.stone.finish(),trim:parts.trim.finish(),glow:parts.glow.finish(),abyss:parts.abyss.finish()};
}
