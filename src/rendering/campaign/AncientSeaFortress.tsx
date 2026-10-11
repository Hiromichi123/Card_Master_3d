import { useEffect,useMemo } from 'react';
import { MeshStandardMaterial,type BufferGeometry } from 'three';
import { landmarkPoint,type PropInstance } from './worldGeometry';
import { FORTRESS_ANCHOR,rand } from './worldLayout';
import { WorldScatter } from './WorldScatter';

interface FortressProps {readonly box:BufferGeometry;readonly rock:BufferGeometry}
interface FortressParts {readonly masonry:PropInstance[];readonly trim:PropInstance[];readonly recesses:PropInstance[];readonly cliffs:PropInstance[]}

function fortressParts():FortressParts {
  const masonry:PropInstance[]=[],trim:PropInstance[]=[],recesses:PropInstance[]=[],cliffs:PropInstance[]=[];
  const block=(records:PropInstance[],x:number,y:number,z:number,w:number,h:number,d:number,color:string,turn=0,tilt=0):void=>{
    records.push({position:[x,y,z],scale:[w,h,d],rotation:[0,turn,tilt],color});
  };
  const stone=(x:number,y:number,z:number,w:number,h:number,d:number,turn=0):void=>{
    const index=masonry.length;
    block(masonry,x,y,z,w,h,d,index%3===0?'#858173':index%3===1?'#777768':'#8c897b',turn);
  };
  const edging=(x:number,y:number,z:number,w:number,h:number,d:number,turn=0):void=>block(trim,x,y,z,w,h,d,'#a29a84',turn);
  const merlons=(x:number,z:number,length:number,y:number,turn=0):void=>{
    const count=Math.max(3,Math.round(length/.23));
    for(let i=0;i<count;i++){
      const along=-length*.5+(i+.5)*length/count;
      edging(x+Math.cos(turn)*along,y,z-Math.sin(turn)*along,.13,.19,.16,turn);
    }
  };
  const wall=(x:number,z:number,length:number,base:number,height:number,turn=0):void=>{
    stone(x,base+height*.5,z,length,height,.32,turn);
    edging(x,base+.09,z,length+.04,.11,.38,turn);
    edging(x,base+height-.07,z,length+.06,.1,.42,turn);
    merlons(x,z,length,base+height+.065,turn);
    // A few broken horizontal courses read as weathered masonry, not a tiled facade.
    for(let row=1;row<4;row++){
      const y=base+height*row/4;
      block(recesses,x,y,z+.163,length*.96,.012,.012,'#56594f',turn);
    }
  };
  const tower=(x:number,z:number,width:number,depth:number,base:number,height:number):void=>{
    stone(x,base+height*.5,z,width,height,depth);
    edging(x,base+.11,z,width+.12,.18,depth+.12);
    edging(x,base+height-.11,z,width+.18,.16,depth+.18);
    // A sunken roof deck and four parapets leave the tower visibly open at the top.
    block(recesses,x,base+height+.015,z,width-.1,.045,depth-.1,'#535950');
    for(const side of [-1,1]){
      stone(x,base+height+.08,z+side*(depth*.5-.045),width,.16,.09);
      stone(x+side*(width*.5-.045),base+height+.08,z,.09,.16,depth);
      merlons(x,z+side*depth*.5,width,base+height+.24);
      merlons(x+side*width*.5,z,depth,base+height+.24,Math.PI/2);
      // Recessed arrow slits on both outward faces have their own pale stone lintels.
      for(let tier=0;tier<(height>2?3:2);tier++){
        const y=base+.43+tier*(height-.65)/(height>2?3:2);
        block(recesses,x+side*width*.503,y,z,.014,.23,.075,'#333d39');
        block(recesses,x,y,z+side*depth*.503,.075,.23,.014,'#333d39');
        edging(x,y+.13,z+side*(depth*.5+.008),.12,.035,.027);
      }
    }
    for(let row=1;row<Math.floor(height/.34);row++){
      block(recesses,x,base+row*.34,z+depth*.5+.004,width*.93,.011,.014,'#606354');
    }
  };
  const gate=(x:number,z:number,width:number,base:number,top:number):void=>{
    const opening=.66,spring=base+.56,radius=opening*.5,pier=(width-opening)*.5;
    stone(x-(opening+pier)*.5,base+(top-base)*.5,z,pier,top-base,.43);
    stone(x+(opening+pier)*.5,base+(top-base)*.5,z,pier,top-base,.43);
    const archTop=spring+radius+.15;
    stone(x,(archTop+top)*.5,z,opening,top-archTop,.43);
    // Separate arch voussoirs surround an actual opening; there is no opaque door plane.
    for(let i=0;i<11;i++){
      const a=(i+.5)/11*Math.PI,r=radius+.065;
      block(trim,x+Math.cos(a)*r,spring+Math.sin(a)*r,z,.14,.15,.49,'#a49c86',0,a-Math.PI/2);
    }
    for(const side of [-1,1])for(let i=0;i<4;i++)edging(x+side*(radius+.045),base+.07+i*.14,z,.11,.135,.49);
    edging(x,top-.05,z,width+.07,.11,.53);
    merlons(x,z,width,top+.09);
  };

  // Irregular sea cliff below a stepped, load-bearing rock shelf.
  for(let i=0;i<19;i++){
    const a=i/19*Math.PI*2,x=Math.cos(a)*2.07,z=Math.sin(a)*1.65;
    cliffs.push({position:[x,-.11+rand(i,241)*.19,z],scale:[.58+rand(i,242)*.36,.69+rand(i,243)*.5,.58+rand(i,244)*.28],
      rotation:[(rand(i,245)-.5)*.24,rand(i,246)*Math.PI,(rand(i,247)-.5)*.16],color:i%3?'#72756a':'#85857a'});
  }
  stone(0,.22,-.04,4.38,.8,3.48);
  edging(0,.62,-.04,4.53,.1,3.6);
  stone(-.66,.78,-.89,2.88,.28,1.5);
  edging(-.66,.94,-.89,2.98,.07,1.58);
  stone(-1.26,1.1,-1.19,1.45,.27,1.04);
  stone(1.43,.79,-1.04,1.52,.24,1.55);

  // Seaward curtain and projecting square towers form the low front defensive tier.
  wall(0,1.52,4.24,.68,1.04);
  wall(-2.06,.24,2.55,.68,1.07,Math.PI/2);
  // The east flank is open beside the approach/flag rather than concealing it in a tower.
  wall(2.06,1.06,.92,.68,.93,Math.PI/2);
  wall(2.06,-1.04,.97,.68,1.1,Math.PI/2);
  tower(-2.03,1.46,.72,.77,.64,1.43);
  tower(.96,1.53,.67,.7,.64,1.28);
  tower(2.03,1.51,.68,.74,.64,1.4);

  // Inner curtain, a true archway and the tall keep echo the reference's layered silhouette.
  gate(.45,-.65,1.72,.68,2.12);
  wall(-1.19,-.65,1.48,.94,1.03);
  tower(-1.66,-.97,.96,.91,1.22,2.24);
  tower(-.82,-1.15,.57,.68,1.22,2.6);
  tower(1.57,-1.06,.68,.71,.91,1.79);
  wall(-1.32,-1.6,1.66,1.19,1.07);
  gate(.29,-1.62,1.57,.68,1.89);
  wall(1.6,-1.62,1.05,.91,.85);
  // Narrow stone buttresses reinforce the tall keep without changing its square plan.
  for(const x of [-2.15,-1.17])stone(x,2.03,-.84,.105,1.78,.2);
  for(const x of [-1.12,-.52])stone(x,2.43,-1.12,.08,2.15,.76);

  // Stairs connect the inner platforms and the open eastern approach to the lower courtyard.
  for(let i=0;i<6;i++){
    const h=.07*(i+1);
    stone(-.65,.68+h*.5,-.23-i*.11,.48,h,.12);
  }
  for(let i=0;i<7;i++){
    const h=.09*(7-i);
    stone(2.0+i*.075,h*.5,.12,.12,h,.7);
  }
  for(let i=0;i<8;i++){
    const h=.085*(8-i);
    stone(.29,h*.5,-1.8-i*.055,.62,h,.07);
  }
  for(const side of [-1,1]){
    stone(side*1.56,1.07,.76,.18,.73,.3);
    stone(side*1.45,1.07,1.24,.3,.73,.15);
  }
  // Short stone-faced retaining ledges remain visible between the front buttresses.
  for(let i=0;i<8;i++)block(recesses,-1.77+i*.5,.39,1.711,.36,.025,.018,'#535e56');
  return {masonry,trim,recesses,cliffs};
}

/** Original procedural model: silhouette reference is the existing poster/1-1 image. */
export function AncientSeaFortress({box,rock}:FortressProps){
  const parts=useMemo(fortressParts,[]);
  const material=useMemo(()=>new MeshStandardMaterial({color:'#ffffff',roughness:.92}),[]);
  useEffect(()=>()=>material.dispose(),[material]);
  return <group position={[...landmarkPoint(...FORTRESS_ANCHOR)]}>
    <WorldScatter geometry={rock} material={material} records={parts.cliffs} nearDistance={Infinity}/>
    <WorldScatter geometry={box} material={material} records={parts.masonry} nearDistance={Infinity}/>
    <WorldScatter geometry={box} material={material} records={parts.trim} nearDistance={Infinity}/>
    <WorldScatter geometry={box} material={material} records={parts.recesses} nearDistance={Infinity} castShadow={false}/>
  </group>;
}
