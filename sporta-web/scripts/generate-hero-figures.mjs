// Generates src/components/heroFigures.js — the anatomical silhouettes for
// the home hero.
//
// The first hero shipped stick pictograms and the owner asked for "max real,
// not animation". A real photograph is the only truly real answer (and the
// photo slots in HeroSlider are wired for it), but the closest a build can
// get is the sports-poster treatment: a backlit athlete rendered as a filled
// silhouette with genuine human proportions. Stick strokes can never look
// human because limbs are not constant-width — a thigh is twice an ankle. So
// each figure here is a SKELETON (joints) plus a WIDTH PROFILE per limb, and
// this script wraps a smooth tapered outline around every chain and emits
// filled paths. Change a pose by moving joints; the flesh follows.
//
//   node scripts/generate-hero-figures.mjs      (commit the output)
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components', 'heroFigures.js')

// ---------------------------------------------------------------- the maths
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1]]
const mul = (a, k) => [a[0] * k, a[1] * k]
const norm = (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l] }
const perp = (a) => [-a[1], a[0]]
const f = (n) => +n.toFixed(1)

// A tapered outline around a joint chain. Central-difference normals keep the
// two edges smooth through the joints; Catmull-Rom turns the edge points into
// cubic curves; round caps close the ends. The result reads as flesh, not pipe.
function limb(pts, widths) {
  const n = pts.length
  const dirs = pts.map((p, i) =>
    norm(sub(pts[Math.min(i + 1, n - 1)], pts[Math.max(i - 1, 0)])))
  const L = pts.map((p, i) => add(p, mul(perp(dirs[i]), widths[i] / 2)))
  const R = pts.map((p, i) => sub(p, mul(perp(dirs[i]), widths[i] / 2)))
  const tipEnd = add(pts[n - 1], mul(dirs[n - 1], widths[n - 1] / 2))
  const tipStart = sub(pts[0], mul(dirs[0], widths[0] / 2))

  const curve = (ps) => {
    let d = ''
    for (let i = 0; i < ps.length - 1; i++) {
      const p0 = ps[Math.max(i - 1, 0)], p1 = ps[i], p2 = ps[i + 1], p3 = ps[Math.min(i + 2, ps.length - 1)]
      const c1 = add(p1, mul(sub(p2, p0), 1 / 6))
      const c2 = sub(p2, mul(sub(p3, p1), 1 / 6))
      d += ` C ${f(c1[0])} ${f(c1[1])}, ${f(c2[0])} ${f(c2[1])}, ${f(p2[0])} ${f(p2[1])}`
    }
    return d
  }

  return (
    `M ${f(L[0][0])} ${f(L[0][1])}` + curve(L) +
    ` Q ${f(tipEnd[0])} ${f(tipEnd[1])} ${f(R[n - 1][0])} ${f(R[n - 1][1])}` +
    curve([...R].reverse()) +
    ` Q ${f(tipStart[0])} ${f(tipStart[1])} ${f(L[0][0])} ${f(L[0][1])} Z`
  )
}

const circle = ([cx, cy], r) =>
  `M ${f(cx - r)} ${f(cy)} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`

// A figure is a list of parts. Far-side limbs are marked `far` and rendered
// in a slightly lighter OPAQUE fill — transparency was tried first and let
// the rim light bleed through the body, drawing orange seams inside it.
const P = (pts, widths, far = false) => ({ d: limb(pts, widths), ...(far ? { far: true } : {}) })
const C = (c, r, far = false) => ({ d: circle(c, r), ...(far ? { far: true } : {}) })

// ------------------------------------------------------------- the athletes
// Canvas 1440x640, floor at y=580. Proportions from an 8-head canon at a
// standing height of ~440-460 units; joints placed per pose, widths per limb
// (thigh ~2x calf-end, waist narrower than chest, shoulder mass on the men,
// hip emphasis + ponytail on the women — that IS the silhouette gender read).

const FIGURES = {
  // Slide 1 — a man mid-deadlift (side on; the loaded bar reads as one big
  // plate disc down its axis) and a woman locking out an overhead press.
  deadliftMan: [
    P([[1216, 580], [1206, 484], [1218, 398]], [13, 25, 33], true),  // far leg
    P([[1224, 582], [1186, 586]], [11, 7], true),                    // far foot
    P([[1198, 578], [1186, 480], [1206, 396]], [14, 26, 34]),        // near leg
    P([[1206, 580], [1166, 584]], [12, 8]),                          // near foot
    P([[1208, 396], [1158, 360], [1102, 330]], [38, 46, 40]),        // hinged back
    P([[1100, 330], [1078, 306]], [19, 15]),                         // neck
    C([1064, 292], 27),                                              // head
    P([[1116, 340], [1110, 424], [1104, 500]], [16, 12, 9], true),   // far arm
    P([[1104, 336], [1098, 420], [1094, 502]], [16, 12, 9]),         // near arm
  ],
  pressWoman: [
    P([[946, 578], [940, 468], [946, 352]], [11, 21, 27], true),     // far leg
    P([[952, 580], [918, 584]], [10, 6], true),
    P([[932, 578], [928, 468], [940, 350]], [12, 22, 28]),           // near leg
    P([[938, 580], [904, 584]], [11, 7]),
    P([[942, 348], [948, 292], [932, 242]], [31, 22, 26]),           // arched torso
    P([[932, 242], [929, 226]], [13, 11]),                           // neck
    C([928, 210], 24),                                               // head
    P([[944, 204], [968, 220], [974, 246]], [11, 7, 2]),             // ponytail
    P([[942, 240], [960, 182], [970, 126]], [14, 10, 7], true),      // far arm to its grip
    P([[930, 238], [904, 180], [882, 126]], [14, 10, 7]),            // near arm to its grip
  ],

  // Slide 2 — two sprinters at full stride, the woman a stride ahead.
  sprintWoman: [
    P([[1190, 398], [1262, 468], [1316, 544]], [27, 21, 11], true),  // rear leg
    P([[1316, 546], [1346, 558]], [10, 6], true),
    P([[1190, 400], [1108, 440], [1120, 526]], [28, 22, 12]),        // knee drive
    P([[1124, 528], [1094, 542]], [11, 7]),
    P([[1192, 400], [1152, 352], [1112, 308]], [31, 25, 27]),        // leaning torso
    P([[1112, 308], [1098, 288]], [14, 11]),
    C([1088, 272], 24),
    P([[1102, 256], [1132, 248], [1158, 260]], [11, 7, 2]),          // ponytail streaming
    P([[1122, 320], [1174, 344], [1198, 306]], [12, 9, 6], true),    // far arm back
    P([[1114, 314], [1062, 352], [1086, 396]], [13, 10, 7]),         // near arm drive
  ],
  sprintMan: [
    P([[912, 396], [982, 464], [1030, 540]], [29, 22, 12], true),    // rear leg
    P([[1030, 542], [1060, 554]], [11, 7], true),
    P([[912, 398], [836, 444], [852, 528]], [30, 23, 13]),           // knee drive
    P([[856, 530], [826, 544]], [12, 8]),
    P([[914, 398], [876, 352], [840, 310]], [33, 28, 34]),           // torso, heavier
    P([[840, 310], [826, 290]], [16, 13]),
    C([816, 274], 26),
    P([[846, 322], [894, 346], [918, 310]], [13, 10, 7], true),      // far arm back
    P([[838, 316], [788, 352], [812, 396]], [14, 11, 8]),            // near arm drive
  ],

  // Slide 3 — a footballer through the strike, a kickboxer at head height,
  // a swimmer mid-stroke (his waterline is drawn by the scene).
  striker: [
    P([[1252, 390], [1246, 470], [1242, 556]], [29, 22, 13]),        // plant leg
    P([[1246, 558], [1212, 564]], [12, 8]),
    P([[1252, 388], [1180, 420], [1120, 352]], [29, 22, 12], true),  // strike leg
    P([[1118, 350], [1090, 330]], [11, 9], true),                    // boot
    P([[1254, 388], [1268, 336], [1272, 264]], [33, 28, 34]),        // lean-back torso
    P([[1272, 264], [1277, 246]], [15, 12]),
    C([1280, 230], 25),
    P([[1266, 270], [1210, 294], [1164, 270]], [13, 10, 7]),         // balance arm
    P([[1278, 274], [1318, 316], [1332, 364]], [12, 9, 6], true),    // far arm
  ],
  kicker: [
    P([[918, 400], [924, 478], [926, 556]], [26, 20, 11]),           // support leg
    P([[930, 558], [898, 564]], [10, 7]),
    P([[916, 396], [852, 380], [788, 340]], [26, 20, 11], true),     // roundhouse
    P([[784, 338], [758, 322]], [10, 8], true),
    P([[918, 400], [924, 350], [914, 300]], [29, 22, 25]),           // torso
    P([[914, 300], [910, 284]], [12, 10]),
    C([908, 268], 23),
    P([[924, 252], [946, 262], [952, 288]], [9, 6, 2]),              // ponytail
    P([[910, 304], [864, 318], [846, 288]], [12, 10, 9]),            // lead guard
    C([842, 280], 13),                                               // glove
    P([[920, 308], [948, 330], [938, 356]], [11, 9, 8], true),       // rear guard
    C([940, 362], 12, true),                                         // glove
  ],
  swimmer: [
    P([[1004, 586], [1058, 592], [1114, 600]], [27, 24, 22]),        // torso along water
    C([970, 578], 21),                                               // capped head
    P([[1006, 582], [952, 536], [898, 570]], [13, 10, 7]),           // recovery arm
    P([[1114, 600], [1162, 592], [1204, 580]], [20, 14, 8]),         // kick
  ],
}

const js = `// GENERATED by scripts/generate-hero-figures.mjs — do not hand-edit.
// Anatomical silhouettes for the home hero: each athlete is a skeleton plus a
// width profile, wrapped into smooth filled outlines by the generator. To
// change a pose, edit the generator and re-run it.
export const FIGURES = ${JSON.stringify(FIGURES, null, 1)}
`
writeFileSync(out, js)
console.log(`heroFigures.js written — ${Object.keys(FIGURES).length} figures, ${Object.values(FIGURES).flat().length} parts`)
