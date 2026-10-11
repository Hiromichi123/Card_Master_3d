import { buildSea,buildTerrain,buildWorldProps,type WorldProps } from './worldGeometry';
import { buildShoreField } from './worldIslands';
import { buildCentralTree } from './centralTreeGeometry';
import { buildDemonGeometry } from './demonGeometry';
import { geometryTransfers,packGeometry,type WorldBuildMessage,type WorldBuildPart,type WorldBuildRequest } from './worldBuildProtocol';

const scope=self as unknown as {onmessage:((event:MessageEvent<WorldBuildRequest>)=>void)|null;postMessage:(message:WorldBuildMessage,transfer:Transferable[])=>void};
scope.onmessage=({data:{generation,detail}})=>{
  const send=(part:WorldBuildPart,transfer:Transferable[]=[]):void=>scope.postMessage({...part,generation},transfer);
  try{
    // The snapshot is independent of the worker's sampling table.
    const {distances,owners}=buildShoreField();
    send({kind:'shore',distances,owners},[distances.buffer,owners.buffer]);
    const surface=buildTerrain(detail);
    // Roads are clipped to this exact surface before its buffers are packed and transferred.
    const landmarks=buildDemonGeometry(surface);
    const terrain=packGeometry(surface),sea=packGeometry(buildSea(detail));
    send({kind:'terrain',terrain,sea},[...geometryTransfers(terrain),...geometryTransfers(sea)]);
    const demon={stone:packGeometry(landmarks.stone),trim:packGeometry(landmarks.trim),glow:packGeometry(landmarks.glow),abyss:packGeometry(landmarks.abyss)};
    send({kind:'demon',demon},Object.values(demon).flatMap(geometryTransfers));
    const generated=buildCentralTree(detail>=40?4:detail>=28?3:2);
    const tree={wood:packGeometry(generated.wood),lights:packGeometry(generated.lights),leaves:generated.leaves};
    send({kind:'tree',tree},[...geometryTransfers(tree.wood),...geometryTransfers(tree.lights)]);
    const props=buildWorldProps(detail);
    const groups:readonly (readonly (keyof WorldProps)[])[]=[
      ['houses','roofs','windows','doors','beams'],['snowPeaks','sacredPeaks','basalt','crystals','shoreRocks'],
      ['trunks','crowns','pines','branches','snowCaps'],['grasses','flowers','rocks'],['clouds'],
    ];
    for(const keys of groups){
      const part=Object.fromEntries(keys.map(key=>[key,props[key]])) as Partial<WorldProps>;
      send({kind:'props',props:part});
    }
    send({kind:'done'});
  }catch(error){send({kind:'error',message:error instanceof Error?error.message:String(error)});}
};
