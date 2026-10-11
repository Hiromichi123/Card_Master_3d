import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferGeometry, CatmullRomCurve3, DoubleSide, Float32BufferAttribute, ShaderMaterial,
  TubeGeometry, UniformsLib, UniformsUtils, Vector3,
} from 'three';

type Clock=Readonly<{current:number}>;
function ribbon(points:readonly (readonly [number,number,number])[],width:number,segments:number):BufferGeometry{
  const curve=new CatmullRomCurve3(points.map(p=>new Vector3(...p)),false,'centripetal');
  const positions:number[]=[],uv:number[]=[];
  for(let i=0;i<segments;i++){
    const a=curve.getPoint(i/segments),b=curve.getPoint((i+1)/segments);
    const ta=curve.getTangent(i/segments),tb=curve.getTangent((i+1)/segments);
    const na=new Vector3(-ta.z,0,ta.x).normalize(),nb=new Vector3(-tb.z,0,tb.x).normalize();
    const al=a.clone().addScaledVector(na,width/2),ar=a.clone().addScaledVector(na,-width/2);
    const bl=b.clone().addScaledVector(nb,width/2),br=b.clone().addScaledVector(nb,-width/2);
    for(const [p,t,v] of [[ar,i/segments,0],[bl,(i+1)/segments,1],[br,(i+1)/segments,0],
      [ar,i/segments,0],[al,i/segments,1],[bl,(i+1)/segments,1]] as const){positions.push(p.x,p.y,p.z);uv.push(t,v);}
  }
  const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));geometry.computeVertexNormals();return geometry;
}
function fallingSheet():BufferGeometry{
  const positions:number[]=[],uv:number[]=[],steps=32;
  for(let i=0;i<steps;i++){
    const a=i/steps,b=(i+1)/steps;
    const point=(t:number,x:number)=>new Vector3(x,-.8-t*4.12,8.43+Math.sin(t*Math.PI/2)*.6);
    for(const [p,t,v] of [[point(a,-.35),a,0],[point(b,-.43),b,0],[point(b,.43),b,1],
      [point(a,-.35),a,0],[point(b,.43),b,1],[point(a,.35),a,1]] as const){positions.push(p.x,p.y,p.z);uv.push(t,v);}
  }
  const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));geometry.computeVertexNormals();return geometry;
}
function waterMaterial(fall=false,pool=false):ShaderMaterial{
  return new ShaderMaterial({
    transparent:true,depthWrite:false,side:DoubleSide,fog:true,toneMapped:false,
    uniforms:UniformsUtils.merge([UniformsLib.fog,{uTime:{value:0},uFall:{value:fall?1:0},uPool:{value:pool?1:0}}]),
    vertexShader:`
      varying vec2 vUv;varying vec3 vNormal;varying vec3 vView;
      #include <fog_pars_vertex>
      void main(){
        vUv=uv;vNormal=normalize(normalMatrix*normal);
        vec4 mvPosition=modelViewMatrix*vec4(position,1.0);vView=-mvPosition.xyz;
        gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader:`
      uniform float uTime,uFall,uPool;varying vec2 vUv;varying vec3 vNormal;varying vec3 vView;
      #include <fog_pars_fragment>
      void main(){
        float flow=vUv.x*(uFall>0.5?25.0:18.0)-uTime*(uFall>0.5?3.2:0.62);
        float ripple=sin(flow*6.283+sin(vUv.y*19.0+uTime)*1.2);
        float fine=sin(vUv.x*193.0-uTime*8.0)*sin(vUv.y*38.0+uTime*1.8);
        float fresnel=pow(1.0-abs(dot(normalize(vNormal),normalize(vView))),2.5);
        float foam=smoothstep(0.72,1.0,abs(vUv.y-0.5)*2.0)*(0.28+fine*0.12);
        float glint=pow(max(0.0,ripple*0.7+fine*0.3),8.0);
        if(uPool>0.5){
          float distance=length((vUv-vec2(0.5,0.5))*vec2(2.8,1.0));
          float rings=pow(max(0.0,sin(distance*49.0-uTime*4.4)),14.0)*exp(-distance*2.1);
          glint=max(glint*0.22,rings*.8);foam*=.2;
        }
        vec3 color=mix(vec3(0.035,0.23,0.72),vec3(0.28,0.66,1.0),fresnel*.7+ripple*.08);
        color+=vec3(0.52,0.57,0.55)*glint+vec3(0.37,0.40,0.38)*foam;
        float alpha=0.66+fresnel*.14+foam*.18+glint*.12;
        if(uFall>0.5){
          float threads=pow(0.5+0.5*sin(vUv.y*83.0+sin(flow)*.7),3.0);
          color+=vec3(0.17,0.20,0.19)*threads;alpha=.48+threads*.23+glint*.20;
        }
        gl_FragColor=vec4(color,clamp(alpha,.2,.92));
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

export function TempleWater({clock}:{readonly clock:Clock}){
  const materials=useMemo(()=>({channel:waterMaterial(),fall:waterMaterial(true),pool:waterMaterial(false,true)}),[]);
  const geometry=useMemo(()=>({
    crossLeft:ribbon([[-.28,-.085,0],[-2.7,-.10,0],[-5.8,-.145,0],[-6.1,-.18,0],[-6.48,-.58,0]],.45,72),
    crossRight:ribbon([[.28,-.085,0],[2.7,-.10,0],[5.8,-.145,0],[6.1,-.18,0],[6.48,-.58,0]],.45,72),
    left:ribbon([[-6.55,-.60,0],[-6.55,-.64,3.2],[-6.55,-.70,7.1]],.46,64),
    right:ribbon([[6.55,-.60,0],[6.55,-.64,3.2],[6.55,-.70,7.1]],.46,64),
    rearLeft:ribbon([[-6.55,-.60,0],[-6.55,-.64,-3.2],[-6.55,-.68,-6.7],[-6.15,-.70,-7.1],[-3.3,-.72,-7.1],[0,-.735,-7.1]],.46,100),
    rearRight:ribbon([[6.55,-.60,0],[6.55,-.64,-3.2],[6.55,-.68,-6.7],[6.15,-.70,-7.1],[3.3,-.72,-7.1],[0,-.735,-7.1]],.46,100),
    frontLeft:ribbon([[-6.55,-.70,7.1],[-3.4,-.73,7.1],[0,-.765,7.1]],.46,48),
    frontRight:ribbon([[6.55,-.70,7.1],[3.4,-.73,7.1],[0,-.765,7.1]],.46,48),
    spout:ribbon([[0,-.765,7.1],[0,-.78,7.8],[0,-.80,8.43]],.67,32),
    jetLeft:new TubeGeometry(new CatmullRomCurve3([new Vector3(0,.16,0),new Vector3(-.10,.59,0),new Vector3(-.33,.43,0),new Vector3(-.58,-.085,0)],false,'centripetal'),40,.034,8,false),
    jetRight:new TubeGeometry(new CatmullRomCurve3([new Vector3(0,.16,0),new Vector3(.10,.59,0),new Vector3(.33,.43,0),new Vector3(.58,-.085,0)],false,'centripetal'),40,.034,8,false),
    fall:fallingSheet(),
  }),[]);
  const splash=useRef<ShaderMaterial>(null);
  const splashUniforms=useMemo(()=>({uTime:{value:0}}),[]);
  useFrame(()=>{
    Object.values(materials).forEach(material=>{material.uniforms['uTime']!.value=clock.current;});
    if(splash.current)splash.current.uniforms['uTime']!.value=clock.current;
  });
  useEffect(()=>()=>{Object.values(materials).forEach(material=>material.dispose());},[materials]);
  useEffect(()=>()=>{Object.values(geometry).forEach(item=>item.dispose());},[geometry]);
  return <>
    {[geometry.crossLeft,geometry.crossRight,geometry.left,geometry.right,geometry.rearLeft,geometry.rearRight,geometry.frontLeft,geometry.frontRight,geometry.spout].map((item,i)=><mesh key={i} geometry={item} material={materials.channel} dispose={null} raycast={()=>{}}/>) }
    {[geometry.jetLeft,geometry.jetRight].map((jet,i)=><mesh key={`jet-${i}`} geometry={jet} material={materials.fall} dispose={null} raycast={()=>{}}/>)}
    <mesh geometry={geometry.fall} material={materials.fall} dispose={null} raycast={()=>{}}/>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-4.92,9.1]} material={materials.pool} raycast={()=>{}}>
      <planeGeometry args={[5.45,1.85]}/>
    </mesh>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-4.895,9.03]} raycast={()=>{}}>
      <planeGeometry args={[1.65,1.1]}/>
      <shaderMaterial ref={splash} uniforms={splashUniforms} transparent depthWrite={false} toneMapped={false}
        vertexShader="varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}"
        fragmentShader={`
          uniform float uTime;varying vec2 vUv;
          void main(){
            vec2 p=(vUv-0.5)*vec2(1.0,1.3);float radius=length(p);
            float rings=pow(max(0.0,sin(radius*62.0-uTime*5.0)),8.0);
            float alpha=(rings*.22+exp(-radius*radius*80.0)*.45)*(1.0-smoothstep(.22,.49,radius));
            gl_FragColor=vec4(vec3(.85,.94,.92),alpha);
            #include <colorspace_fragment>
          }
        `}/>
    </mesh>
  </>;
}
