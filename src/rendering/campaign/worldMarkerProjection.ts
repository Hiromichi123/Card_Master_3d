import { Vector3,type Camera } from 'three';

export function chapterMarkerKey(id:string):string {return `chapter:${id}`;}
export function stageMarkerKey(id:string):string {return `stage:${id}`;}
export interface MarkerProjection {x:number;y:number;visible:boolean}
/** The caller updates camera matrices once, then reuses the output and vector for every label. */
export function projectWorldMarker(point:readonly [number,number,number],camera:Camera,width:number,height:number,out:MarkerProjection,scratch:Vector3):void {
  out.visible=false;
  if(width<=0||height<=0||!Number.isFinite(width+height)||!point.every(Number.isFinite))return;
  scratch.set(...point).applyMatrix4(camera.matrixWorldInverse);
  if(scratch.z>=0)return;
  scratch.applyMatrix4(camera.projectionMatrix);
  if(!Number.isFinite(scratch.x+scratch.y+scratch.z))return;
  out.x=(scratch.x*.5+.5)*width;out.y=(-scratch.y*.5+.5)*height;
  out.visible=scratch.z>=-1&&scratch.z<=1&&Math.abs(scratch.x)<=1&&Math.abs(scratch.y)<=1;
}
