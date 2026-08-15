// MEN — the owner's double-biceps silhouette extruded into a graphite statue,
// standing on a glossy floor, ember glow behind, warm key from front-right.
// uTex: signed distance field of the silhouette (0.5 = edge, 60px range).
const vec3 CAM_POS    = vec3(-0.6, 1.35, -5.4);
const vec3 CAM_TARGET = vec3(0.35, 1.30, 0.0);
const float CAM_ZOOM  = 2.35;
const vec3 KEY_POS    = vec3(3.6, 3.4, -3.0);
const vec3 GLOW_DIR   = vec3(0.55, 0.30, 1.0);
const float GLOW_STRENGTH = 0.95;
const float EXPOSURE = 0.66;
const float RIM_STRENGTH  = 1.45;

vec2 opU(vec2 a, vec2 b){ return a.x<b.x ? a : b; }

const float FIG_H = 2.55;                 // world height of the visible torso
const float TEX_W = 548.0;
const float TEX_H = 394.0;
const float FIG_W = FIG_H * (TEX_W/TEX_H);
const float FIG_X0 = 0.15;                // left edge of figure bbox
const float FIG_Z  = 0.35;

float sdFigure(vec3 p){
  float u = (p.x - FIG_X0) / FIG_W;
  float v = 1.0 - (p.y + 0.22) / FIG_H;
  vec2 uv = clamp(vec2(u, v), 0.001, 0.999);
  float dpx = (texSDF(uv) - 0.5) * 220.0;
  float d2d = dpx * (FIG_H / TEX_H);
  // organic inflation: thickest deep inside the mass, thin at the edges
  float inflate = clamp(-d2d / 0.55, 0.0, 1.0);
  float halfT = 0.34 * pow(inflate, 0.72) + 0.02;
  vec2 w = vec2(d2d, abs(p.z - FIG_Z) - halfT);
  float d = min(max(w.x, w.y), 0.0) + length(max(w, 0.0));
  // outside the texture bbox, fall back to distance to the bbox
  if (p.y > FIG_H || p.x < FIG_X0 - 0.2 || p.x > FIG_X0 + FIG_W + 0.2){
    d = max(d, length(max(abs(vec2(p.x - (FIG_X0 + FIG_W*0.5), p.y - FIG_H*0.5)) - vec2(FIG_W*0.5, FIG_H*0.5), 0.0)) - 0.05);
  }
  return d * 0.55;   // Lipschitz safety: the inflated extrusion is not a true
                     // distance bound, and honest sphere tracing needs the margin
}

vec2 map(vec3 p){
  vec2 res = vec2(p.y, 2.0);
  res = opU(res, vec2(sdFigure(p), 1.0));
  return res;
}
