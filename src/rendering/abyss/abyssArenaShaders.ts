/** Palette, spiral smoke and lightning follow the existing abyss lobby. All positions are real world space. */
export const ABYSS_NOISE = /* glsl */ `
float hash(vec2 p) { p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p) {
  vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+1.0),f.x),f.y);
}
float fbm(vec2 p) {
  float v=0.0,a=0.52; mat2 turn=mat2(0.8,-0.6,0.6,0.8);
  for(int i=0;i<5;i++){v+=a*noise(p);p=turn*p*2.04+vec2(13.1,7.7);a*=0.48;}return v;
}
`;

export const ABYSS_SURFACE_VERTEX = /* glsl */ `
varying vec3 vLocal;
varying vec2 vUv;
#include <fog_pars_vertex>
void main(){vLocal=position;vUv=uv;vec4 mvPosition=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mvPosition;
#include <fog_vertex>
}
`;

export const ABYSS_FUNNEL_FRAGMENT = /* glsl */ `
uniform float uTime,uFlash,uHasBackground;
uniform sampler2D uBackground;
varying vec2 vUv;
varying vec3 vLocal;
${ABYSS_NOISE}
void main(){
  float angle=vUv.x*6.2831853, depth=vUv.y;
  vec2 p=vec2(angle*2.35+depth*7.2-uTime*.17,depth*7.8+uTime*.03);
  float curl=fbm(p*.64);
  float body=fbm(p+vec2(curl*2.8,-curl*1.4));
  float threads=fbm(vec2(p.x*2.8+body*4.0,p.y*3.2-body*1.8));
  float spiral=.5+.5*sin(angle*6.0+depth*26.0+curl*8.0-uTime*.26);
  float density=smoothstep(.20,.74,body+threads*.16+spiral*.08);
  vec3 pigment=mix(vec3(.045,.019,.09),vec3(.23,.105,.42),density);
  vec2 sourceUv=vec2(.5)+vec2(cos(angle),sin(angle)*.78)*(.17+.29*depth);
  vec3 source=texture2D(uBackground,clamp(sourceUv,vec2(.004),vec2(.996))).rgb;
  pigment=mix(pigment,source*.65,uHasBackground*.5);
  vec3 n=normalize(vec3(-dFdx(density)*100.0,-dFdy(density)*100.0,.7));
  float diffuse=max(dot(n,normalize(vec3(-.45,.8,.9))),0.0);
  float rim=pow(1.0-density,2.0)*smoothstep(.32,.76,threads);
  vec3 color=pigment*(.48+diffuse*.85)+vec3(.4,.18,.72)*rim*.62;
  color+=vec3(.5,.34,.9)*uFlash*(.3+density*.7);
  float mouth=smoothstep(.01,.16,depth), edge=1.0-smoothstep(.83,1.0,depth);
  float alpha=(.42+density*.43)*mouth*edge;
  gl_FragColor=vec4(color,alpha);
  #include <colorspace_fragment>
}
`;

export const ABYSS_SKY_FRAGMENT = /* glsl */ `
uniform float uTime,uFlash,uHasBackground;
uniform sampler2D uBackground;
varying vec2 vUv;
varying vec3 vLocal;
${ABYSS_NOISE}
void main(){
  vec3 direction=normalize(vLocal);
  float angle=atan(direction.z,direction.x);
  vec2 p=vec2(angle*1.8,direction.y*5.0);
  float curl=fbm(p*.72+vec2(-uTime*.013,0.0));
  float clouds=fbm(p+vec2(curl*2.0-uTime*.018,curl*.8));
  float ribbon=.5+.5*sin(angle*3.0+direction.y*14.0+curl*6.0-uTime*.035);
  vec3 color=mix(vec3(.018,.009,.036),vec3(.092,.045,.15),smoothstep(.28,.75,clouds));
  vec2 originalUv=vec2(.5)+vec2(cos(angle),sin(angle)*.78)*(.2+.24*(.5+.5*direction.y));
  color=mix(color,texture2D(uBackground,clamp(originalUv,vec2(.002),vec2(.998))).rgb*.32,uHasBackground*.35);
  color+=vec3(.08,.035,.15)*ribbon*smoothstep(.46,.71,clouds);
  color+=vec3(.14,.1,.24)*uFlash*(.4+clouds*.4);
  gl_FragColor=vec4(color,1.0);
  #include <colorspace_fragment>
}
`;

export const ABYSS_RIFT_FRAGMENT = /* glsl */ `
uniform float uTime,uFlash;
varying vec2 vUv;
varying vec3 vLocal;
${ABYSS_NOISE}
#include <fog_pars_fragment>
void main(){
  vec2 p=vLocal.xz;
  float wisps=fbm(vec2(p.x*.8-uTime*.15,p.y*6.0+uTime*.03));
  float filament=1.0-smoothstep(.035,.17,abs(sin(p.x*3.2+wisps*5.2-uTime*.6)));
  float edge=smoothstep(.0,.18,abs(p.y));
  vec3 color=mix(vec3(.021,.007,.06),vec3(1.05,.36,2.7),edge*.6);
  color+=vec3(1.5,.82,3.5)*filament*(.48+wisps*.9);
  color+=vec3(.22,.12,.43)*uFlash;
  gl_FragColor=vec4(color,1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export const ABYSS_SOUL_VERTEX = /* glsl */ `
attribute vec4 aSoul;
uniform float uTime,uPixelRatio;
varying float vLife;
void main(){
  float t=fract(aSoul.w+uTime*(.014+aSoul.z*.003));
  float angle=aSoul.y+uTime*(.013+aSoul.z*.005);
  float radius=aSoul.x+sin(t*6.283+aSoul.y)*.6;
  vec3 p=vec3(cos(angle)*radius,-23.0+t*33.0,sin(angle)*radius);
  vLife=sin(t*3.14159);
  vec4 view=modelViewMatrix*vec4(p,1.0); gl_Position=projectionMatrix*view;
  gl_PointSize=clamp((.7+aSoul.z*.25)*uPixelRatio*72.0/max(1.0,-view.z),1.0,8.0);
}
`;
export const ABYSS_SOUL_FRAGMENT = /* glsl */ `
varying float vLife;
void main(){
  float r=length(gl_PointCoord-vec2(.5));if(r>.5)discard;
  float glow=pow(max(0.0,1.0-r*2.0),2.5);
  gl_FragColor=vec4(mix(vec3(.23,.12,.5),vec3(.95,.68,1.35),glow),glow*vLife*.63);
  #include <colorspace_fragment>
}
`;
