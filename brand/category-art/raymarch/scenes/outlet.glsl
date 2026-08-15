// OUTLET — a premium dark retail wall: three shelf slabs stocked with folded
// stacks, shoeboxes, trainers and bottles, warm strip light under each shelf
// edge, goods sinking darker toward the floor. Quiet left third.
const vec3 CAM_POS    = vec3(-1.5, 1.6, -5.6);
const vec3 CAM_TARGET = vec3(0.9, 1.42, 0.0);
const float CAM_ZOOM  = 2.1;
const vec3 KEY_POS    = vec3(4.6, 5.0, -1.6);
const vec3 GLOW_DIR   = vec3(1.05, 0.32, 0.75);
const float GLOW_STRENGTH = 0.8;
const float EXPOSURE = 0.7;
const float RIM_STRENGTH  = 0.9;

vec2 opU(vec2 a, vec2 b){ return a.x<b.x ? a : b; }

float sdStack(vec3 p, vec3 at, float s){
  vec3 q = rotY(p - at, 0.1);
  float d = sdRoundBox(q - vec3(0.0, 0.07*s, 0.0), vec3(0.30*s, 0.062*s, 0.24*s), 0.03*s);
  d = min(d, sdRoundBox(rotY(q, -0.14) - vec3(0.02*s, 0.20*s, 0.0), vec3(0.27*s, 0.058*s, 0.22*s), 0.03*s));
  d = min(d, sdRoundBox(rotY(q, 0.10) - vec3(-0.02*s, 0.32*s, 0.0), vec3(0.24*s, 0.052*s, 0.20*s), 0.03*s));
  return d;
}
float sdShoebox(vec3 p, vec3 at, float ang, float s){
  vec3 q = rotY(p - at, ang);
  float box = sdRoundBox(q - vec3(0.0, 0.14*s, 0.0), vec3(0.34*s, 0.13*s, 0.22*s), 0.02*s);
  float lid = sdRoundBox(q - vec3(0.0, 0.285*s, 0.0), vec3(0.355*s, 0.022*s, 0.235*s), 0.02*s);
  return min(box, lid);
}
float sdTrainer(vec3 p, vec3 at, float s){
  vec3 q = rotY(p - at, -0.18);
  float sole = sdRoundBox(q - vec3(0.0, 0.045*s, 0.0), vec3(0.30*s, 0.04*s, 0.10*s), 0.03*s);
  vec3 u = q - vec3(0.03*s, 0.16*s, 0.0);
  float upper = sdEllipsoid(u, vec3(0.26*s, 0.13*s, 0.095*s));
  upper = smin(upper, sdEllipsoid(u - vec3(-0.17*s, 0.045*s, 0.0), vec3(0.11*s, 0.13*s, 0.085*s)), 0.05*s);
  return min(sole, upper);
}
float sdBottleS(vec3 p, vec3 at, float s){
  vec3 q = p - at;
  float body = sdCappedCyl(q - vec3(0.0, 0.20*s, 0.0), 0.20*s, 0.065*s);
  float lid = sdCappedCyl(q - vec3(0.0, 0.43*s, 0.0), 0.035*s, 0.038*s);
  return min(body, lid);
}

// one shelf: slab + goods + warm strip under the front lip
vec2 shelf(vec3 p, float y, float bright){
  float slab = sdRoundBox(p - vec3(3.1, y, 0.75), vec3(2.6, 0.045, 0.62), 0.02);
  vec2 res = vec2(slab, 1.0);
  float strip = sdRoundBox(p - vec3(3.1, y - 0.075, 0.16), vec3(2.45, 0.012, 0.015), 0.008);
  res = opU(res, vec2(strip, 4.0));
  return res;
}

vec2 map(vec3 p){
  vec2 res = vec2(p.y, 2.0);
  // back wall
  res = opU(res, vec2(-(p.z - 1.45), 5.0));
  res = opU(res, shelf(p, 0.85, 1.0));
  res = opU(res, shelf(p, 1.75, 1.0));
  res = opU(res, shelf(p, 2.65, 1.0));
  // goods on top of each shelf (shelf tops at y+0.045)
  float g = sdStack(p, vec3(1.20, 0.90, 0.75), 1.25);
  g = min(g, sdShoebox(p, vec3(2.10, 0.90, 0.80), 0.12, 1.05));
  g = min(g, sdTrainer(p, vec3(3.05, 0.90, 0.72), 1.1));
  g = min(g, sdBottleS(p, vec3(3.80, 0.90, 0.78), 1.0));
  g = min(g, sdBottleS(p, vec3(4.03, 0.90, 0.70), 0.9));
  g = min(g, sdShoebox(p, vec3(4.75, 0.90, 0.80), -0.1, 1.0));
  g = min(g, sdShoebox(p, vec3(1.35, 1.80, 0.82), -0.15, 0.95));
  g = min(g, sdStack(p, vec3(2.30, 1.80, 0.76), 0.95));
  g = min(g, sdTrainer(p, vec3(3.30, 1.80, 0.72), 1.0));
  g = min(g, sdStack(p, vec3(4.30, 1.80, 0.78), 1.05));
  g = min(g, sdBottleS(p, vec3(4.95, 1.80, 0.75), 1.0));
  g = min(g, sdStack(p, vec3(1.65, 2.70, 0.78), 0.9));
  g = min(g, sdShoebox(p, vec3(2.75, 2.70, 0.80), 0.18, 0.9));
  g = min(g, sdTrainer(p, vec3(3.75, 2.70, 0.74), 0.95));
  g = min(g, sdShoebox(p, vec3(4.65, 2.70, 0.80), -0.14, 0.85));
  res = opU(res, vec2(g, 1.0));
  return res;
}
