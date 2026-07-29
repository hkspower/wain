// WOMEN — the owner's runner silhouette as a graphite statue at full stride,
// running toward the quiet dark left, ember glow low behind her.
const vec3 CAM_POS    = vec3(-0.55, 1.5, -5.6);
const vec3 CAM_TARGET = vec3(0.5, 1.42, 0.0);
const float CAM_ZOOM  = 2.3;
const vec3 KEY_POS    = vec3(3.4, 3.8, -3.0);
const vec3 GLOW_DIR   = vec3(0.7, 0.22, 1.0);
const float GLOW_STRENGTH = 0.95;
const float EXPOSURE = 0.66;
const float RIM_STRENGTH  = 1.45;

vec2 opU(vec2 a, vec2 b){ return a.x<b.x ? a : b; }

const float FIG_H = 3.2;
const float TEX_W = 582.0;
const float TEX_H = 856.0;
const float FIG_W = FIG_H * (TEX_W/TEX_H);
const float FIG_X0 = 0.6;
const float FIG_Z  = 0.35;

float sdFigure(vec3 p){
  float u = (p.x - FIG_X0) / FIG_W;
  float v = 1.0 - (p.y + 0.12) / FIG_H;
  vec2 uv = clamp(vec2(u, v), 0.001, 0.999);
  float dpx = (texSDF(uv) - 0.5) * 220.0;
  float d2d = dpx * (FIG_H / TEX_H);
  float inflate = clamp(-d2d / 0.42, 0.0, 1.0);
  float halfT = 0.26 * pow(inflate, 0.72) + 0.02;
  vec2 w = vec2(d2d, abs(p.z - FIG_Z) - halfT);
  float d = min(max(w.x, w.y), 0.0) + length(max(w, 0.0));
  if (p.y > FIG_H || p.x < FIG_X0 - 0.2 || p.x > FIG_X0 + FIG_W + 0.2){
    d = max(d, length(max(abs(vec2(p.x - (FIG_X0 + FIG_W*0.5), p.y - FIG_H*0.5)) - vec2(FIG_W*0.5, FIG_H*0.5), 0.0)) - 0.05);
  }
  return d * 0.55;
}

vec2 map(vec3 p){
  vec2 res = vec2(p.y, 2.0);
  res = opU(res, vec2(sdFigure(p), 1.0));
  return res;
}
