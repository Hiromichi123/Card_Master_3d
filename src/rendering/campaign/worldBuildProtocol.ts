import { BufferAttribute,BufferGeometry } from 'three';
import type { PropInstance,WorldProps } from './worldGeometry';

export interface GeometryData {
  readonly attributes:Record<string,{readonly array:Float32Array;readonly itemSize:number}>;
  readonly index:Uint16Array|Uint32Array|null;
}
export interface TreeData {readonly wood:GeometryData;readonly lights:GeometryData;readonly leaves:readonly PropInstance[]}
export interface DemonData {readonly stone:GeometryData;readonly trim:GeometryData;readonly glow:GeometryData;readonly abyss:GeometryData}
export type WorldBuildPart =
  | {readonly kind:'shore';readonly distances:Float32Array;readonly owners:Uint8Array}
  | {readonly kind:'terrain';readonly terrain:GeometryData;readonly sea:GeometryData}
  | {readonly kind:'tree';readonly tree:TreeData}
  | {readonly kind:'demon';readonly demon:DemonData}
  | {readonly kind:'props';readonly props:Partial<WorldProps>}
  | {readonly kind:'done'}
  | {readonly kind:'error';readonly message:string};
export interface WorldBuildRequest {readonly generation:number;readonly detail:number}
export type WorldBuildMessage=WorldBuildPart&{readonly generation:number};
export function packGeometry(geometry:BufferGeometry):GeometryData {
  const attributes:GeometryData['attributes']={};
  for(const [key,attribute] of Object.entries(geometry.attributes)){
    attributes[key]={array:new Float32Array(attribute.array),itemSize:attribute.itemSize};
  }
  const source=geometry.getIndex();
  const index=source?new Uint32Array(source.array):null;
  geometry.dispose();return {attributes,index};
}
export function unpackGeometry(data:GeometryData):BufferGeometry {
  const geometry=new BufferGeometry();
  for(const [key,attribute] of Object.entries(data.attributes))geometry.setAttribute(key,new BufferAttribute(attribute.array,attribute.itemSize));
  if(data.index)geometry.setIndex(new BufferAttribute(data.index,1));
  geometry.computeBoundingSphere();return geometry;
}
export function geometryTransfers(data:GeometryData):ArrayBuffer[] {
  return [...Object.values(data.attributes).map(a=>a.array.buffer as ArrayBuffer),...(data.index?[data.index.buffer as ArrayBuffer]:[])];
}
export function emptyWorldProps():WorldProps {
  return {trunks:[],crowns:[],pines:[],branches:[],houses:[],roofs:[],basalt:[],snowPeaks:[],sacredPeaks:[],clouds:[],grasses:[],rocks:[],flowers:[],windows:[],doors:[],beams:[],snowCaps:[],crystals:[],shoreRocks:[]};
}
