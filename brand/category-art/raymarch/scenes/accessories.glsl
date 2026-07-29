// ACCESSORIES v2 — duffel hero centre-right, bottle right, shaker front-left
// of duffel, cap resting on a towel stack at the cluster's left, one burnt
// orange band leaning flat in front. Quiet left third.
const vec3 CAM_POS    = vec3(-0.3, 1.15, -5.6);
const vec3 CAM_TARGET = vec3(-0.05, 0.48, 0.0);
const float CAM_ZOOM  = 2.6;
const vec3 KEY_POS    = vec3(3.2, 3.6, -2.8);
const vec3 GLOW_DIR   = vec3(0.85, 0.16, 0.9);
const float GLOW_STRENGTH = 0.95;
const float EXPOSURE = 0.72;
const float RIM_STRENGTH  = 1.25;

vec2 opU(vec2 a, vec2 b){ return a.x<b.x ? a : b; }

float sdDuffel(vec3 p){
  vec3 q = rotY(p - vec3(1.05, 0.50, 0.35), 0.30);
  float body = sdRoundBox(q, vec3(0.78, 0.30, 0.26), 0.20);
  body = smin(body, sdEllipsoid(q - vec3(0.80, -0.02, 0.0), vec3(0.24, 0.42, 0.40)), 0.10);
  body = smin(body, sdEllipsoid(q + vec3(0.80, 0.02, 0.0), vec3(0.24, 0.42, 0.40)), 0.10);
  // strap handles hugging the top, small and half-sunk
  vec3 h = q - vec3(0.0, 0.44, 0.0);
  float handles = sdTorus(rotX(h - vec3(-0.30, 0.0, 0.0), 1.5708), vec2(0.17, 0.026));
  handles = min(handles, sdTorus(rotX(h - vec3(0.30, 0.0, 0.0), 1.5708), vec2(0.17, 0.026)));
  handles = max(handles, -(q.y - 0.30));      // keep only the arc above the body
  return min(body, handles);
}

float sdBottle(vec3 p){
  vec3 q = p - vec3(2.45, 0.0, -0.15);
  float body = sdCappedCyl(q - vec3(0.0, 0.50, 0.0), 0.50, 0.165);
  body = smin(body, sdSphere(q - vec3(0.0, 1.00, 0.0), 0.15), 0.07);
  float lid = sdCappedCyl(q - vec3(0.0, 1.13, 0.0), 0.085, 0.088);
  float loop = sdTorus(rotX(q - vec3(0.0, 1.24, 0.0), 0.9), vec2(0.06, 0.016));
  return min(min(body, lid), loop);
}

float sdShaker(vec3 p){
  vec3 q = p - vec3(0.28, 0.0, -0.85);
  // tapered cup: capped cone via two radii lerp — approximate with cyl + smin sphere base
  float body = sdCappedCyl(q - vec3(0.0, 0.34, 0.0), 0.34, 0.185);
  float dome = sdEllipsoid(q - vec3(0.0, 0.70, 0.0), vec3(0.185, 0.13, 0.185));
  float knob = sdSphere(q - vec3(0.0, 0.84, 0.0), 0.05);
  return min(min(body, dome), knob);
}

float sdTowelsAndCap(vec3 p){
  // towel stack
  vec3 t = rotY(p - vec3(-0.85, 0.0, 0.55), 0.15);
  float towels = sdRoundBox(t - vec3(0.0, 0.10, 0.0), vec3(0.44, 0.085, 0.32), 0.05);
  towels = min(towels, sdRoundBox(rotY(t, -0.10) - vec3(0.04, 0.27, 0.0), vec3(0.40, 0.075, 0.29), 0.05));
  // cap on top: crown + clear protruding visor toward camera-left
  vec3 c = rotY(t - vec3(0.0, 0.35, 0.0), 2.55);
  float crown = sdEllipsoid(c - vec3(0.0, 0.17, 0.0), vec3(0.26, 0.185, 0.26));
  crown = max(crown, -(c.y - 0.02));
  vec3 v = rotX(c - vec3(0.0, 0.075, 0.30), -0.22);
  float visor = sdRoundBox(v, vec3(0.19, 0.011, 0.22), 0.030);
  float button = sdSphere(c - vec3(0.0, 0.355, 0.0), 0.032);
  return min(towels, min(min(crown, visor), button));
}

vec2 map(vec3 p){
  vec2 res = vec2(p.y, 2.0);
  res = opU(res, vec2(sdDuffel(p), 1.0));
  res = opU(res, vec2(sdBottle(p), 1.0));
  res = opU(res, vec2(sdShaker(p), 1.0));
  res = opU(res, vec2(sdTowelsAndCap(p), 1.0));
  // burnt orange band: flat on the floor, front centre
  float band = sdTorus(p - vec3(1.35, 0.032, -1.15), vec2(0.30, 0.032));
  res = opU(res, vec2(band, 3.0));
  return res;
}