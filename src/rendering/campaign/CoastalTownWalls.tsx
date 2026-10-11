import { useEffect,useMemo } from 'react';
import { CylinderGeometry,MeshStandardMaterial,type BufferGeometry } from 'three';
import { terrainHeight,type PropInstance,WORLD_EXPANSION } from './worldGeometry';
import { TOWN_ANCHOR,TOWN_GATE_HALF_WIDTH,TOWN_RADIUS } from './worldLayout';
import { WorldScatter } from './WorldScatter';

/** Pale circular defenses sit behind the older, darker coastal fortress. */
export function CoastalTownWalls({box}:{readonly box:BufferGeometry}){
  const material=useMemo(()=>new MeshStandardMaterial({color:'#ffffff',roughness:.88}),[]);
  const tower=useMemo(()=>new CylinderGeometry(1,1.08,1,12),[]);
  const records=useMemo(()=>{
    const walls:PropInstance[]=[],towers:PropInstance[]=[];
    const cx=TOWN_ANCHOR[0]*WORLD_EXPANSION,cz=TOWN_ANCHOR[1]*WORLD_EXPANSION;
    const point=(a:number,r=TOWN_RADIUS):readonly [number,number]=>[cx+Math.sin(a)*r,cz+Math.cos(a)*r];
    const gate=Math.asin(TOWN_GATE_HALF_WIDTH/TOWN_RADIUS);
    const segments=64,arc=(Math.PI-2*gate)/(segments/2);
    for(const start of [gate,Math.PI+gate])for(let i=0;i<segments/2;i++){
      const a=start+(i+.5)*arc,[x,z]=point(a),y=terrainHeight(x,z),length=2*TOWN_RADIUS*Math.sin(arc*.5)+.014;
      walls.push({position:[x,y+.25,z],scale:[length,.62,.17],rotation:[0,a,0],color:'#e7e5d9'});
      walls.push({position:[x,y+.6,z],scale:[length*.55,.13,.2],rotation:[0,a,0],color:'#f1eee2'});
      walls.push({position:[x,y+.48,z],scale:[length,.07,.22],rotation:[0,a,0],color:'#d4d4c9'});
    }
    const angles=[gate,Math.PI-gate,Math.PI+gate,Math.PI*2-gate,.72,1.65,2.38,3.94,4.83,5.61];
    angles.forEach(a=>{
      const [x,z]=point(a),y=terrainHeight(x,z);
      towers.push({position:[x,y+.4,z],scale:[.22,.9,.22],color:'#e3e2d7'});
      towers.push({position:[x,y+.86,z],scale:[.255,.12,.255],color:'#eeecdf'});
      for(let i=0;i<6;i++){
        const t=i/6*Math.PI*2;
        walls.push({position:[x+Math.sin(t)*.22,y+.99,z+Math.cos(t)*.22],scale:[.085,.17,.085],rotation:[0,t,0],color:'#f3f0e5'});
      }
    });
    return {walls,towers};
  },[]);
  useEffect(()=>()=>{material.dispose();tower.dispose();},[material,tower]);
  return <><WorldScatter geometry={box} material={material} records={records.walls} nearDistance={Infinity}/>
    <WorldScatter geometry={tower} material={material} records={records.towers} nearDistance={Infinity}/></>;
}
