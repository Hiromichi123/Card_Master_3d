import { memo,useLayoutEffect,useMemo,useRef,useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color,Euler,Matrix4,Quaternion,Vector3,type BufferGeometry,type InstancedMesh,type Material } from 'three';
import type { PropInstance } from './worldGeometry';
import { nextWorldTileBatch,scheduleWorldTask,splitWorldTiles,type WorldTile } from './worldLoadScheduler';

interface ScatterProps {
  readonly geometry:BufferGeometry;readonly material:Material;readonly records:readonly PropInstance[];
  readonly castShadow?:boolean;readonly maxDistance?:number;readonly nearDistance?:number;
}
/** Spatial tiles allow distant grass to disappear while woodland keeps a sparse silhouette. */
export function WorldScatter({geometry,material,records,castShadow=true,maxDistance=Infinity,nearDistance=170}:ScatterProps){
  const tiles=useMemo(()=>{
    const map=new Map<string,PropInstance[]>();
    for(const record of records){const key=`${Math.floor(record.position[0]/6)}:${Math.floor(record.position[2]/6)}`;
      const group=map.get(key);if(group)group.push(record);else map.set(key,[record]);}
    return splitWorldTiles(map);
  },[records]);
  const [visible,setVisible]=useState<{readonly tiles:readonly WorldTile<PropInstance>[];readonly count:number}>(()=>({tiles,count:0}));
  const count=visible.tiles===tiles?visible.count:0;
  useLayoutEffect(()=>{
    if(!tiles.length){setVisible(previous=>previous.tiles===tiles?previous:{tiles,count:0});return;}
    if(count>=tiles.length)return;
    // Enqueue the next batch only after React commits this one: delayed renders cannot accumulate uploads.
    return scheduleWorldTask(()=>setVisible({tiles,count:nextWorldTileBatch(tiles,count)}));
  },[tiles,count]);
  return <>{tiles.slice(0,count).map(({key,records:group})=><Tile key={key} geometry={geometry} material={material} records={group}
    castShadow={castShadow} maxDistance={maxDistance} nearDistance={nearDistance} detailed={records.length<250}/>)}</>;
}
const Tile=memo(function Tile({geometry,material,records,castShadow,maxDistance,nearDistance,detailed}:Pick<ScatterProps,'geometry'|'material'|'records'>&{readonly castShadow:boolean;readonly maxDistance:number;readonly nearDistance:number;readonly detailed:boolean}){
  const mesh=useRef<InstancedMesh>(null);
  const ordered=useMemo(()=>[...records.filter((_,i)=>i%6===0),...records.filter((_,i)=>i%6!==0)],[records]);
  const args=useMemo<[BufferGeometry,Material,number]>(()=>[geometry,material,ordered.length],[geometry,material,ordered]);
  const worldCenter=useMemo(()=>new Vector3(),[]);
  useLayoutEffect(()=>{
    if(!mesh.current)return;
    const m=new Matrix4(),p=new Vector3(),s=new Vector3(),q=new Quaternion(),e=new Euler(),c=new Color();
    ordered.forEach((record,i)=>{
      p.set(...record.position);s.set(...record.scale);e.set(record.rotation?.[0]??0,record.rotation?.[1]??0,record.rotation?.[2]??0);q.setFromEuler(e);
      mesh.current!.setMatrixAt(i,m.compose(p,q,s));mesh.current!.setColorAt(i,c.set(record.color));
    });
    mesh.current.instanceMatrix.needsUpdate=true;if(mesh.current.instanceColor)mesh.current.instanceColor.needsUpdate=true;
    mesh.current.computeBoundingSphere();
  },[ordered,args]);
  useFrame(({camera})=>{
    const object=mesh.current,sphere=object?.boundingSphere;if(!object||!sphere)return;
    worldCenter.copy(sphere.center).applyMatrix4(object.matrixWorld);
    const distance=Math.max(0,camera.position.distanceTo(worldCenter)-sphere.radius*object.matrixWorld.getMaxScaleOnAxis());
    object.visible=distance<=(maxDistance??Infinity);
    object.count=detailed||distance<(nearDistance??170)?ordered.length:Math.ceil(ordered.length/6);
  });
  return <instancedMesh ref={mesh} args={args} dispose={null} castShadow={castShadow} receiveShadow raycast={()=>{}}/>;
});
