import { BoxGeometry,BufferGeometry,Float32BufferAttribute } from 'three';
import { DEMON_HOUSES } from './demonScenery';
import { WORLD_EXPANSION } from './worldLayout';

type Point=readonly [number,number,number];
interface SettlementBuilder {
  append(shape:BufferGeometry,color:string,position:Point,scale?:Point,rotation?:number,kind?:number,site?:number):void;
}
/** Small axis-aligned stone dwellings, sharing the same sampled foundation builder as landmarks. */
export function appendDemonSettlement(stone:SettlementBuilder,trim:SettlementBuilder,foundation:(x:number,z:number,width:number,depth:number)=>number):void {
  const box=(builder:SettlementBuilder,p:Point,size:Point,color:string):void=>builder.append(new BoxGeometry(1,1,1),color,p,size,0,0,0);
  DEMON_HOUSES.forEach((house,i)=>{
    const x=house.center[0]*WORLD_EXPANSION,z=house.center[1]*WORLD_EXPANSION,w=house.width,d=house.depth,h=house.height;
    const y=foundation(x,z,w,d);
    box(stone,[x,y+h*.5,z],[w,h,d],i%3?'#55494a':'#6b554d');
    const roof=new BufferGeometry(),rw=w*.62,rd=d*.62,rh=h*.38;
    roof.setAttribute('position',new Float32BufferAttribute([-rw,0,-rd,rw,0,-rd,0,rh,-rd,-rw,0,rd,rw,0,rd,0,rh,rd],3));
    roof.setIndex([0,2,1,3,4,5,0,3,5,0,5,2,2,5,4,2,4,1,0,1,4,0,4,3]);
    stone.append(roof,i%2?'#332f3b':'#44343b',[x,y+h,z],[1,1,1],0,0,0);
    box(trim,[x,y+.2,z+d*.5+.012],[w*.2,.4,.023],'#292331');
    for(const side of [-1,1])box(trim,[x+side*w*.3,y+h*.64,z+d*.5+.016],[w*.12,.13,.025],'#ba8855');
    box(stone,[x+w*.28,y+h+.19,z-d*.21],[.13,.42,.14],'#706059');
  });
}
