// Raymarch renderer: wraps a per-scene GLSL map()/camera in a shared studio
// framework (warm key + cool fill + AO + soft shadows + glossy floor + fog),
// renders once in headless Chromium (SwiftShader), screenshots the canvas.
//   node render.mjs <scene> <outPng> [w] [h]
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'

const [scene, out, W = '1600', H = '1000'] = process.argv.slice(2)
const sceneSrc = readFileSync(new URL(`scenes/${scene}.glsl`, import.meta.url), 'utf8')
let texDataUrl = null
try {
  const texBuf = readFileSync(new URL(`scenes/${scene}.tex.png`, import.meta.url))
  texDataUrl = 'data:image/png;base64,' + texBuf.toString('base64')
} catch {}

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uRes;
uniform sampler2D uTex;
float texSDF(vec2 uv){ vec4 t=texture(uTex,uv); return ((t.r*255.0*256.0)+(t.g*255.0))/65535.0; }

#define MAX_STEPS 160
#define MAX_DIST 60.0
#define EPS 0.0015

float sdSphere(vec3 p, float r){ return length(p)-r; }
float sdRoundBox(vec3 p, vec3 b, float r){ vec3 q=abs(p)-b; return length(max(q,0.0))+min(max(q.x,max(q.y,q.z)),0.0)-r; }
float sdCapsule(vec3 p, vec3 a, vec3 b, float r){ vec3 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0); return length(pa-ba*h)-r; }
float sdEllipsoid(vec3 p, vec3 r){ float k0=length(p/r); float k1=length(p/(r*r)); return k0*(k0-1.0)/k1; }
float sdCappedCyl(vec3 p, float h, float r){ vec2 d=abs(vec2(length(p.xz),p.y))-vec2(r,h); return min(max(d.x,d.y),0.0)+length(max(d,0.0)); }
float sdTorus(vec3 p, vec2 t){ vec2 q=vec2(length(p.xz)-t.x,p.y); return length(q)-t.y; }
float smin(float a, float b, float k){ float h=clamp(0.5+0.5*(b-a)/k,0.0,1.0); return mix(b,a,h)-k*h*(1.0-h); }
vec3 rotY(vec3 p, float a){ float c=cos(a),s=sin(a); return vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z); }
vec3 rotX(vec3 p, float a){ float c=cos(a),s=sin(a); return vec3(p.x,c*p.y-s*p.z,s*p.y+c*p.z); }
vec3 rotZ(vec3 p, float a){ float c=cos(a),s=sin(a); return vec3(c*p.x-s*p.y,s*p.x+c*p.y,p.z); }

// ---- scene: defines map(p) -> vec2(dist, materialId), plus CAM_* constants
${sceneSrc}

vec2 march(vec3 ro, vec3 rd){
  float t=0.0; float m=-1.0;
  for(int i=0;i<MAX_STEPS;i++){
    vec3 p=ro+rd*t;
    vec2 dm=map(p);
    if(dm.x<EPS*t){ m=dm.y; break; }
    t+=dm.x*0.9;
    if(t>MAX_DIST){ m=-1.0; break; }
  }
  return vec2(t,m);
}
vec3 calcNormal(vec3 p){
  const vec2 e=vec2(0.0035,0.0);
  return normalize(vec3(map(p+e.xyy).x-map(p-e.xyy).x, map(p+e.yxy).x-map(p-e.yxy).x, map(p+e.yyx).x-map(p-e.yyx).x));
}
float softShadow(vec3 ro, vec3 rd, float k){
  float res=1.0; float t=0.03;
  for(int i=0;i<40;i++){
    float h=map(ro+rd*t).x;
    if(h<0.001) return 0.0;
    res=min(res,k*h/t);
    t+=clamp(h,0.02,0.4);
    if(t>18.0) break;
  }
  return clamp(res,0.0,1.0);
}
float calcAO(vec3 p, vec3 n){
  float occ=0.0, sca=1.0;
  for(int i=0;i<5;i++){
    float h=0.02+0.13*float(i);
    occ+=(h-map(p+n*h).x)*sca;
    sca*=0.72;
  }
  return clamp(1.0-2.6*occ,0.0,1.0);
}

const vec3 CHARCOAL = vec3(0.030,0.034,0.041);
const vec3 KEY_COL  = vec3(1.0,0.44,0.12);
const vec3 FILL_COL = vec3(0.055,0.068,0.095);

vec3 background(vec3 rd){
  // charcoal room with one warm glow behind the subject (scene sets GLOW_DIR)
  float g = pow(max(dot(normalize(rd), normalize(GLOW_DIR)), 0.0), 11.0);
  float horizon = exp(-abs(rd.y+0.08)*7.0);
  vec3 col = CHARCOAL*0.85 + CHARCOAL*horizon*0.55;
  col += KEY_COL * g * GLOW_STRENGTH * (0.35+0.65*horizon);
  return col;
}

vec3 shade(vec3 p, vec3 rd, float m){
  vec3 n = calcNormal(p);
  vec3 keyPos = KEY_POS;
  vec3 ld = normalize(keyPos - p);
  float dif = clamp(dot(n,ld),0.0,1.0);
  float sh  = softShadow(p+n*0.01, ld, 14.0);
  float ao  = calcAO(p,n);
  float fre = pow(clamp(1.0+dot(n,rd),0.0,1.0),3.0);
  // rim from the glow direction (backlight)
  float rim = pow(clamp(dot(n, normalize(GLOW_DIR)),0.0,1.0),2.0);

  vec3 alb; float gloss=0.0;
  if(m<1.5){ alb=vec3(0.045,0.048,0.054); gloss=0.55; }        // graphite object
  else if(m<2.5){ alb=vec3(0.024,0.027,0.033); gloss=0.9; }    // floor
  else if(m<3.5){ alb=vec3(0.55,0.17,0.035); gloss=0.5; }       // brand orange accent
  else if(m>4.5){ alb=vec3(0.020,0.023,0.028); gloss=0.1; }     // deep wall
  else if(m<4.5){ alb=vec3(1.0,0.40,0.10)*1.7; }                          // emissive strip

  if(m>=3.5 && m<4.5) return alb;                                        // emissive: flat

  vec3 col = alb*(FILL_COL*2.2)*(0.45+0.55*ao);
  col += alb*KEY_COL*2.2*dif*sh;
  vec3 hl = normalize(ld-rd);
  col += KEY_COL*pow(clamp(dot(n,hl),0.0,1.0),40.0)*gloss*sh;
  col += KEY_COL*rim*RIM_STRENGTH*(0.25+0.75*fre)*ao;
  col += FILL_COL*fre*0.5*ao;
  return col;
}

void main(){
  vec2 uv=(2.0*gl_FragCoord.xy-uRes)/uRes.y;
  vec3 ro=CAM_POS;
  vec3 ta=CAM_TARGET;
  vec3 f=normalize(ta-ro);
  vec3 r=normalize(cross(vec3(0.0,1.0,0.0),f));
  vec3 u=cross(f,r);
  vec3 rd=normalize(f*CAM_ZOOM + uv.x*r + uv.y*u);

  vec2 tm=march(ro,rd);
  vec3 col;
  if(tm.y<-0.5){ col=background(rd); }
  else{
    vec3 p=ro+rd*tm.x;
    col=shade(p,rd,tm.y);
    // glossy floor: one reflected sample
    if(tm.y>1.5 && tm.y<2.5){
      vec3 n=vec3(0.0,1.0,0.0);
      vec3 rrd=reflect(rd,n);
      vec2 rt=march(p+n*0.02,rrd);
      vec3 rcol = (rt.y<-0.5)? background(rrd)*0.32 : shade(p+rrd*rt.x,rrd,rt.y);
      float fres=pow(clamp(1.0+dot(rd,n),0.0,1.0),2.0);
      col=mix(col,rcol,0.07+0.22*fres);
    }
    col=mix(col,background(rd),smoothstep(18.0,46.0,tm.x));  // fog
  }
  col*=EXPOSURE;
  // ACES-ish tonemap
  col=(col*(2.51*col+0.03))/(col*(2.43*col+0.59)+0.14);
  col=pow(clamp(col,0.0,1.0),vec3(1.0/2.2));
  fragColor=vec4(col,1.0);
}`

const html = `<!doctype html><html><body style="margin:0"><canvas id="c" width="${W}" height="${H}"></canvas>
<script>
const c=document.getElementById('c');
const gl=c.getContext('webgl2',{preserveDrawingBuffer:true});
const vs='#version 300 es\\nin vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
const fs=${JSON.stringify(FRAG)};
function sh(t,s){const o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);
 if(!gl.getShaderParameter(o,gl.COMPILE_STATUS)){window.glError=gl.getShaderInfoLog(o);throw new Error(window.glError);}return o;}
const pr=gl.createProgram();
gl.attachShader(pr,sh(gl.VERTEX_SHADER,vs));gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,fs));
gl.linkProgram(pr);
if(!gl.getProgramParameter(pr,gl.LINK_STATUS)){window.glError=gl.getProgramInfoLog(pr);throw new Error(window.glError);}
gl.useProgram(pr);
const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);
gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
const loc=gl.getAttribLocation(pr,'a');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
gl.uniform2f(gl.getUniformLocation(pr,'uRes'),${W},${H});
const TEX=${JSON.stringify(texDataUrl)};
function draw(){
  gl.viewport(0,0,${W},${H});
  gl.drawArrays(gl.TRIANGLES,0,3);
  gl.finish();
  window.renderDone=true;
}
if(TEX){
  const img=new Image();
  img.onload=()=>{
    const t=gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D,t);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(pr,'uTex'),0);
    draw();
  };
  img.src=TEX;
}else{ draw(); }
</script></body></html>`

const tmp = new URL(`scene-${scene}.html`, import.meta.url).pathname
writeFileSync(tmp, html)

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const pg = await b.newPage({ viewport: { width: +W, height: +H } })
pg.on('pageerror', (e) => { console.error('PAGE ERROR:', e.message); })
await pg.goto('file://' + tmp)
try {
  await pg.waitForFunction('window.renderDone === true || window.glError', { timeout: 300000 })
  const err = await pg.evaluate('window.glError || null')
  if (err) { console.error('GL ERROR:\n' + err); process.exit(1) }
  await pg.locator('#c').screenshot({ path: out })
  console.log('rendered', out)
} finally { await b.close() }
