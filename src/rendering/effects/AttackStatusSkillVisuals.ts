import {
  AdditiveBlending, BufferGeometry, Camera, Color, DoubleSide, Group,
  InstancedBufferAttribute, InstancedMesh, Mesh, NormalBlending, Object3D,
  PlaneGeometry, ShaderMaterial, SphereGeometry, Vector3, type Material,
} from 'three';
import type { SkillVisualHandle, SkillVisualSpec, VisualPhase } from './SkillVisualPool';
import { createCrystalGeometry } from './vendor/linear-native/assets/ProceduralGeometry.js';
import { createIceMaterial } from './vendor/linear-native/materials/IceMaterial.js';
import { RibbonGeometry, RibbonMode } from './vendor/linear-native/effects/RibbonGeometry.js';
import { frame } from './vendor/linear-native/core/FrameUniforms.js';
import { attackStatusTiming } from './attackStatusTiming';
import {
  FRACTURE_GLSL, STATUS_NOISE_GLSL, cardMaskFragments, fractureUniforms,
} from '../cards/statusPatterns';

export function usesAttackStatusVisual(template: string): boolean {
  return ['frostRetaliation','burnMark','poisonLance','poisonCloud','frostShatter','burnBurst','poisonBurst','grievousPulse'].includes(template);
}

const VERTEX=`varying vec2 vUv; varying vec3 vWorld;
void main(){vUv=uv;vWorld=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const SMOKE=`varying vec2 vUv;varying vec3 vWorld;uniform float uTime,uFade,uDensity;uniform vec3 uColor;
${STATUS_NOISE_GLSL}
void main(){vec2 p=vUv-.5;float rim=1.-smoothstep(.08,.49,length(p));
vec2 flow=vUv*5.+vWorld.xz*2.7+vec2(uTime*.19,-uTime*.36);
vec2 warp=vec2(fbm(flow+vec2(2.1,7.3)),fbm(flow+vec2(-4.7,1.8)));
float body=fbm(flow+warp*2.8),detail=fbm(flow*3.1-warp*1.7);
float curls=smoothstep(.26/uDensity,.68/sqrt(uDensity),body)*(.58+detail*.42);
float alpha=min(.85,rim*curls*uFade*.34*uDensity);if(alpha<.004)discard;
vec3 col=mix(uColor*.36,uColor*(.72+detail*.38),body);
gl_FragColor=vec4(col,alpha);}`;
const INJECTION=`varying vec2 vUv;varying vec3 vWorld;uniform float uTime,uFade;uniform vec3 uColor;
${STATUS_NOISE_GLSL}
void main(){float across=abs(vUv.y*2.-1.);
vec2 flow=vec2(vUv.x*15.-uTime*3.8,vUv.y*3.);
float curl=fbm(flow+vec2(fbm(flow*.6),fbm(flow*.6+3.))*2.);
float core=exp(-pow(across/.25,2.));float edge=1.-smoothstep(.24,1.,across);
float ends=smoothstep(0.,.05,vUv.x);
float alpha=edge*(.25+curl*.52+core*.16)*ends*uFade;
gl_FragColor=vec4(mix(uColor*.48,uColor*1.15,core*.6+curl*.25),alpha);}`;
const FRAGMENT_MASK=`varying vec2 vUv;uniform float uFade;uniform float uDark;
${STATUS_NOISE_GLSL}${FRACTURE_GLSL}
void main(){float edge=fractureEdge(vUv);float grain=fbm(vUv*18.);
vec3 ice=mix(vec3(.53,.75,.86),vec3(.94,.98,1.),grain);
vec3 wound=mix(vec3(.085,.002,.011),vec3(.30,.012,.03),grain);
vec3 col=mix(ice,wound,uDark);
col=mix(col,mix(vec3(.83,.96,1.),vec3(.60,.04,.075),uDark),edge*.75);
gl_FragColor=vec4(col,(.38+grain*.15+edge*.22)*uFade);}`;
const FIRE=`varying vec2 vUv;varying vec3 vWorld;uniform float uTime,uFade;
${STATUS_NOISE_GLSL}
void main(){vec2 flow=vec2(vUv.x*9.,vUv.y*5.-uTime*1.8);
float n=fbm(flow+vec2(fbm(flow*.7),fbm(flow*.7+3.2))*2.);
float flame=smoothstep(.20,.72,n);float folds=pow(flame,1.6);
vec3 col=mix(vec3(.83,.025,.004),vec3(1.35,.47,.035),flame);
col=mix(col,vec3(1.6,.91,.28),folds*.65);
gl_FragColor=vec4(col,(.15+flame*.65)*uFade);}`;

/** Native actors use the shared skill Timeline and bounded pool. No gameplay changes. */
export class AttackStatusSkillVisuals {
  readonly group=new Group();
  private camera:Camera|null=null;
  private readonly plane=new PlaneGeometry(1,1);
  private readonly hemisphere=new SphereGeometry(1,32,16,0,Math.PI*2,0,Math.PI/2);
  updateCamera(camera:Camera):void {this.camera=camera;}

  create(spec:SkillVisualSpec,worldScale:number):SkillVisualHandle {
    // Burn cracks belong exclusively to the card-local status layer, including their initial reveal.
    if(spec.template==='burnMark')return {update:()=>{},dispose:()=>{}};
    const actor=new Group();this.group.add(actor);actor.name=`attack-status:${spec.template}`;
    const scale=Math.max(.2,worldScale),from=spec.from.clone(),to=spec.to.clone();
    const direction=to.clone().sub(from).setY(0).normalize(),side=new Vector3(-direction.z,0,direction.x);
    const materials:Material[]=[],geometries:BufferGeometry[]=[],cleanups:(()=>void)[]=[];
    const timing=attackStatusTiming(spec.template);
    let visualAge=0,previousPhase:VisualPhase='charge',previousProgress=0;
    let draw:(phase:VisualPhase,t:number)=>void;

    if(spec.template==='frostRetaliation'){
      const material=createIceMaterial({registerShadowCasterWithPatch:(m,patch)=>{
        m.onBeforeCompile=patch;m.customProgramCacheKey=()=> 'card-frost-lance';
      }});materials.push(material);
      const u=material.userData.uniforms;
      u.uColorDeep.value.set('#285c78');u.uColorIce.value.set('#add1dc');u.uColorRim.value.set('#e8f5fa');
      u.uGlow.value=.28;u.uEdgeGlow.value=.36;u.uBirthGlow.value=.48;
      const trailCount=27,batchCount=12,count=trailCount+batchCount*3,slots=count/3;
      const seed=Math.random()*100;
      const random=(i:number,salt:number):number=>{
        const value=Math.sin((seed+i*13.37+salt*47.11)*12.9898)*43758.5453;
        return value-Math.floor(value);
      };
      // Like iceSeal/Glacial Crown: stable random records, no grid, spacing rule or shared direction.
      const records=Array.from({length:batchCount*3},(_,i)=>{
        const height=.17+random(i,1)*.24,width=.048+random(i,2)*.035,depth=.055+random(i,3)*.04;
        const tiltX=(random(i,4)-.5)*.68,tiltZ=(random(i,5)-.5)*.68,yaw=random(i,8)*Math.PI*2;
        // Match Euler XYZ: yaw also turns the leaned tip sideways, so account for all three rotations.
        const tipX=-Math.cos(yaw)*Math.sin(tiltZ);
        const tipZ=Math.sin(tiltX)*Math.cos(tiltZ)+Math.cos(tiltX)*Math.sin(yaw)*Math.sin(tiltZ);
        const footprint=Math.max(width,depth)*1.25;
        const marginX=footprint+height*Math.abs(tipX)+.018;
        const marginZ=footprint+height*Math.abs(tipZ)+.018;
        return {x:(random(i,6)*2-1)*(.5-marginX),z:(random(i,7)*2-1)*(.75-marginZ),
          height,width,depth,tiltX,tiltZ,yaw,
          delay:random(i,9)*.075,rise:.24+random(i,10)*.075};
      });
      const variants=Array.from({length:3},(_,v)=>{
        const geometry=createCrystalGeometry({seed:3.9+v*17.3,sides:5+v,taper:.14+v*.075,roughness:.055+v*.025,bend:.025+v*.025});
        geometries.push(geometry);
        geometry.setAttribute('aSeed',new InstancedBufferAttribute(new Float32Array(slots).map((_,i)=>i*.67+v),1));
        geometry.setAttribute('aBirth',new InstancedBufferAttribute(new Float32Array(slots),1));
        const mesh=new InstancedMesh(geometry,material,slots);mesh.frustumCulled=false;actor.add(mesh);
        cleanups.push(()=>mesh.dispose());return mesh;
      });
      const dummy=new Object3D(),tip=new Vector3();
      draw=(phase,t)=>{
        const front=phase==='travel'?t:phase==='charge'?0:1;
        const opening=phase==='impact'?t:phase==='fade'?1:0;
        const fade=phase==='fade'?1-t:1;material.opacity=.97*fade;
        for(let i=0;i<count;i++){
          const cluster=i>=trailCount,angle=i*2.39996;
          const along=(i+.5)/trailCount;
          const band=cluster?Math.floor((i-trailCount)/batchCount):0;
          const record=cluster?records[i-trailCount]!:null;
          if(record){
            tip.set(to.x+record.x*scale,to.y,to.z+record.z*scale);
          }else{tip.copy(from).lerp(to,along).addScaledVector(side,Math.sin(angle)*.16*scale);tip.y=Math.min(to.y,from.y)*.5;}
          // Three timed batches overlap freely; each crown keeps its own random tilt, height and birth delay.
          const grow=record?Math.min(1,Math.max(0,(opening-band*.27-record.delay)/record.rise)):
            Math.min(1,Math.max(0,(front-along+.10)*9));
          dummy.position.copy(tip);
          dummy.rotation.set(record?.tiltX??Math.sin(angle)*.24,record?.yaw??angle,record?.tiltZ??Math.cos(angle)*.27);
          const height=record?.height??(.065+along*.17);
          const rise=(1-Math.pow(1-grow,3))*fade;
          dummy.scale.set((record?.width??.058)*scale*rise,height*scale*rise,(record?.depth??.078)*scale*rise);
          dummy.updateMatrix();
          const mesh=variants[i%3]!;mesh.setMatrixAt(Math.floor(i/3),dummy.matrix);
          mesh.geometry.getAttribute('aBirth').setX(Math.floor(i/3),Math.max(0,1-grow)*.22);
        }
        for(const mesh of variants){mesh.instanceMatrix.needsUpdate=true;mesh.geometry.getAttribute('aBirth').needsUpdate=true;}
      };
    }else if(spec.template==='frostShatter'||spec.template==='grievousPulse'){
      const dark=spec.template==='grievousPulse';
      const material=new ShaderMaterial({vertexShader:VERTEX,fragmentShader:FRAGMENT_MASK,
        uniforms:{uFade:{value:0},uDark:{value:dark?1:0},uCells:{value:fractureUniforms()}},
        transparent:true,depthWrite:false,side:DoubleSide,blending:NormalBlending,toneMapped:false});materials.push(material);
      const pieces=cardMaskFragments(scale,1.5*scale).map(({geometry,center},i)=>{
        geometries.push(geometry);const mesh=new Mesh(geometry,material);actor.add(mesh);
        const angle=Math.atan2(-center.y,center.x);
        return {mesh,center,angle,lift:.17+(i%3)*.045,spin:(i%2?1:-1)*(.4+i*.09)};
      });
      draw=(phase,t)=>{
        actor.visible=phase==='impact'||phase==='fade';
        const p=phase==='impact'?t*.35:phase==='fade'?.35+t*.65:0;
        const fracture=Math.max(0,(p-.06)/.94);
        material.uniforms['uFade']!.value=phase==='fade'?Math.pow(1-t,1.5):1;
        for(const {mesh,center,angle,lift,spin}of pieces){
          const spread=fracture*.48*scale;
          mesh.position.set(to.x+center.x+Math.cos(angle)*spread,to.y+.008*scale+Math.sin(fracture*Math.PI*.85)*lift*scale,
            to.z-center.y+Math.sin(angle)*spread);
          mesh.rotation.set(-Math.PI/2+fracture*spin,fracture*spin*.4,fracture*spin*.32);
          mesh.scale.setScalar(1-fracture*.18);
        }
      };
    }else if(spec.template==='burnBurst'){
      const material=new ShaderMaterial({vertexShader:VERTEX,fragmentShader:FIRE,
        uniforms:{uTime:{value:0},uFade:{value:0}},transparent:true,depthWrite:false,
        side:DoubleSide,blending:AdditiveBlending,toneMapped:false});materials.push(material);
      const dome=new Mesh(this.hemisphere,material);dome.position.copy(to).y+=.006*scale;actor.add(dome);
      draw=(phase,t)=>{
        actor.visible=phase==='impact'||phase==='fade';
        const expansion=phase==='impact'?1-Math.pow(1-t,2):1+t*.35;
        const radius=(.065+expansion*.72)*scale;
        dome.scale.set(radius,radius*.55,radius);
        material.uniforms['uTime']!.value=visualAge;
        material.uniforms['uFade']!.value=phase==='fade'?Math.pow(1-t,1.5):1;
      };
    }else{
      const cloud=spec.template==='poisonCloud',burst=spec.template==='poisonBurst';
      const injection=spec.template==='poisonLance';
      const color=spec.tint?.clone()??new Color('#49a82b');
      const material=new ShaderMaterial({vertexShader:VERTEX,fragmentShader:SMOKE,
        uniforms:{uTime:{value:0},uFade:{value:0},uDensity:{value:1},uColor:{value:color}},
        transparent:true,depthWrite:false,side:DoubleSide,blending:NormalBlending,toneMapped:false});materials.push(material);
      const wispCount=Math.max(12,Math.min(cloud?96:72,Math.ceil((cloud?64:48)*(spec.countScale??1))));
      const wisps=Array.from({length:wispCount},(_,i)=>{
        const mesh=new Mesh(this.plane,material);actor.add(mesh);
        return {mesh,u:i/(wispCount-1),angle:i*2.39996,seed:(i*17%47)/47};
      });
      const ribbon=injection?new RibbonGeometry(40,{frame:true}):null;
      const stripMaterial=injection?new ShaderMaterial({vertexShader:VERTEX,fragmentShader:INJECTION,
        uniforms:{uTime:{value:0},uFade:{value:0},uColor:{value:color}},transparent:true,
        depthWrite:false,side:DoubleSide,blending:NormalBlending,toneMapped:false}):null;
      const strip=ribbon&&stripMaterial?new Mesh(ribbon.geometry,stripMaterial):null;
      if(strip){actor.add(strip);materials.push(stripMaterial!);cleanups.push(()=>ribbon!.dispose());}
      const path=Array.from({length:41},()=>new Vector3()),pos=new Vector3(),fallbackCamera=new Vector3(0,6,5);
      draw=(phase,t)=>{
        const travelling=phase==='travel'&&!burst,impact=phase==='impact'||phase==='fade';
        const front=injection?Math.min(1,t/.62):t;
        const fade=phase==='fade'?1-t*t:1;actor.visible=travelling||impact;
        material.uniforms['uTime']!.value=frame.uTime.value;
        material.uniforms['uFade']!.value=fade*(travelling?(cloud?1.1:.85):1.30);
        material.uniforms['uDensity']!.value=cloud&&travelling?1.8:1;
        if(strip&&stripMaterial&&ribbon){
          strip.visible=travelling||phase==='impact';
          stripMaterial.uniforms['uTime']!.value=frame.uTime.value;
          stripMaterial.uniforms['uFade']!.value=phase==='impact'?1-t:travelling?1:0;
          const length=travelling?front:1;
          for(let i=0;i<path.length;i++){
            const u=i/(path.length-1),pin=Math.sin(u*Math.PI);
            path[i]!.copy(from).lerp(to,u*length).addScaledVector(side,Math.sin(u*23.-visualAge*5.)*.022*scale*pin);
            path[i]!.y+=Math.cos(u*17.+visualAge*3.)*.017*scale*pin;
          }
          ribbon.build(path,{count:path.length,width:.19*scale,mode:RibbonMode.BILLBOARD,
            cameraPosition:this.camera?.position??fallbackCamera});
        }
        for(const {mesh,u,angle,seed}of wisps){
          let plume=impact;
          if(injection&&travelling){plume=u>.68&&front>=1;mesh.visible=u<=.68||plume;}
          else mesh.visible=true;
          if(travelling&&!plume){
            const along=cloud?t:injection?u*front:Math.max(0,t-u*.30);
            pos.copy(from).lerp(to,along);
            if(cloud)pos.y+=Math.sin(along*Math.PI)*.95*scale;
            pos.addScaledVector(side,Math.sin(angle+visualAge*2.)*(injection?.035:.10)*scale);
            pos.y+=Math.cos(angle)*(injection?.028:.09)*scale;
            if(cloud){pos.x+=Math.cos(angle)*.115*scale;pos.y+=Math.sin(angle*1.7)*.095*scale;pos.z+=Math.sin(angle)*.115*scale;}
          }else{
            const opening=travelling?Math.max(.15,(t-.62)/.38):phase==='impact'?Math.sqrt(t):1;
            const reach=(.10+seed*.43)*opening*scale;
            pos.copy(to);pos.x+=Math.cos(angle+visualAge*.13)*reach;pos.z+=Math.sin(angle+visualAge*.13)*reach*1.40;
            pos.y+=.025*scale+seed*.23*opening*scale;
          }
          mesh.position.copy(pos);if(this.camera)mesh.quaternion.copy(this.camera.quaternion);
          const radius=(travelling&&!plume?(cloud?.27:injection?.10:.14):.20+seed*.36)*scale*(phase==='fade'?1+t*.35:1);
          mesh.scale.set(radius,radius,1);
        }
      };
    }
    actor.traverse((node)=>{node.frustumCulled=false;node.raycast=()=>{};});
    let disposed=false;
    const handle:SkillVisualHandle={update:(phase,t)=>{
      if(disposed)return;
      const duration=phase==='travel'?timing.travel:phase==='impact'?timing.impact:phase==='fade'?timing.fade:0;
      visualAge+=Math.max(0,t-(phase===previousPhase?previousProgress:0))*duration;
      previousPhase=phase;previousProgress=t;draw(phase,t);
    },dispose:()=>{
      if(disposed)return;disposed=true;this.group.remove(actor);
      for(const clean of cleanups)clean();for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();
    }};
    handle.update('charge',0);return handle;
  }
  dispose():void{this.plane.dispose();this.hemisphere.dispose();this.group.clear();}
}
