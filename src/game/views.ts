// Where the camera sits.
//
// There was one view and it never changed: a chase position that pulled
// back and rose with speed. It is a good chase camera — it is anchored
// to the ROAD rather than to the car, so when the tail steps out the
// shot stays behind the trajectory and you watch the car rotate inside
// the frame, which is the whole reason a drift reads at all — but it is
// one shot, and a driving game is a game about where you are looking
// from.
//
// Two kinds of view, and the difference is the whole design:
//
//   ROAD-MOUNTED   chase and close. The camera follows the track's own
//                  frame. The car yaws inside the shot; the horizon
//                  stays level; you can see what the car is doing.
//   CAR-MOUNTED    bonnet, bumper, cockpit. The camera is bolted to the
//                  shell, so it yaws, pitches and rolls with it. Brake
//                  hard and the view dives. Get sideways and you are
//                  looking down the road you are sliding across, not
//                  the one you are travelling along. That is the point
//                  of an in-car view and it is also why it is harder.
//
// The offsets below are in the CAR'S OWN units, not metres, because the
// rig hangs off the body and the body is scaled to the car's real
// length. A bumper cam belongs at the bumper of whatever car it is on.

export type CameraView = "chase" | "close" | "bonnet" | "bumper" | "cockpit";

export interface ViewSpec {
  value: CameraView;
  label: string;
  hint: string;
  /** Bolted to the shell rather than to the road. */
  mounted: boolean;
  /** Base field of view in degrees, before the speed stretch. */
  fov: number;
  /** How far ahead the shot is aimed, in car units. */
  look: number;
  /** Whether the player's own car is drawn. */
  showsCar: boolean;
}

export const VIEWS: ReadonlyArray<ViewSpec> = [
  {
    value: "chase",
    label: "Chase",
    hint: "Behind and high — the whole car, and what it is doing",
    mounted: false,
    fov: 62,
    look: 14,
    showsCar: true,
  },
  {
    value: "close",
    label: "Close",
    hint: "Tucked in behind the boot lid",
    mounted: false,
    fov: 66,
    look: 12,
    showsCar: true,
  },
  {
    value: "bonnet",
    label: "Bonnet",
    hint: "On the wing, ahead of the screen",
    mounted: true,
    fov: 72,
    look: 26,
    showsCar: true,
  },
  {
    value: "bumper",
    label: "Bumper",
    hint: "At the nose, a hand off the asphalt",
    mounted: true,
    fov: 78,
    look: 30,
    showsCar: true,
  },
  {
    value: "cockpit",
    label: "Cockpit",
    hint: "The driver's own eyes, over the wheel",
    mounted: true,
    // Narrower than the outside views. From inside a car the windscreen
    // is a frame, and a wide lens through a frame is a fisheye: the
    // cockpit came out reading like a roof cam until this came down.
    fov: 58,
    look: 24,
    showsCar: true,
  },
];

export function viewSpec(v: CameraView): ViewSpec {
  return VIEWS.find((x) => x.value === v) ?? VIEWS[0];
}

/** The next view round the ring — what the key does. */
export function nextView(v: CameraView): CameraView {
  const i = VIEWS.findIndex((x) => x.value === v);
  return VIEWS[(i + 1) % VIEWS.length].value;
}
