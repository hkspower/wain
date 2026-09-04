// Rain, and what it does to the road.
//
// The game is set at midnight on a coast, and Kuwait gets its rain in
// short violent bursts between November and April — so a wet night is
// the right weather for it, and a permanently dry one was a choice
// nobody had made on purpose. The wipers have been modelled on every car
// in the fleet since the bodies were built, parked at the base of the
// glass, and nothing has ever asked them to move.
//
// WETNESS IS A STATE, NOT A SWITCH.
//
// The interesting thing about rain in a driving game is not the
// particles, it is that the road takes time to change and much longer to
// change back. Water builds while it falls and drains after it stops,
// and the two rates are nothing like each other: a shower soaks a road
// in a minute or two and it stays greasy for a quarter of an hour. A
// boolean `raining` flag would hand the driver a step change in grip at
// the instant the sky changed, which is a thing no road does.
//
// So `wetness` is the state and rain is the input that drives it. That
// also makes the first minute of a shower the dangerous one, in the way
// it should be: the road is wetting faster than the driver can feel.
//
// WHAT WET ACTUALLY COSTS
//
// One number, applied in one place. Wet asphalt gives a road tyre
// somewhere around two thirds of its dry grip — the rest goes into
// pumping the water film out from under the tread — and everything a
// driver notices follows from that, because this model already derives
// everything from grip. The friction circle narrows, so the car corners
// slower AND brakes shorter into the same corner. The brake solver's
// ceiling is grip-limited, so stopping distances grow. Lock-up arrives
// earlier because the tyre's limit came down. The drift solver breaks
// the tail loose sooner. None of that needs a wet-weather branch: it
// falls out of the one multiplier, which is the whole reason to put the
// loss on grip rather than sprinkle it over the systems that read grip.
//
// Pure functions over a small state object, the way brakes.ts, grip.ts
// and crash.ts are, so tests/weather.mjs can drive it without a browser
// and the UE5 and Unity ports mirror one set of constants.

import { HANDLING as H } from "./handling";

/** Carried between frames. The engine owns one. */
export interface WeatherState {
  /** 0 = bone dry, 1 = standing water. */
  wetness: number;
  /** Seconds since the sky last changed, for the sound bed and the
   *  particle ramp. */
  spellT: number;
  /** Whether rain is falling right now. */
  raining: boolean;
}

export interface WeatherInput {
  dt: number;
  /** Is it raining this frame? The caller decides — a scripted race, a
   *  player setting, a forecast. This module only knows what water does
   *  to a road once it is falling. */
  raining: boolean;
  /** 0..1, how hard. A drizzle wets a road slowly and never fully; a
   *  downpour floods it. Defaults to a steady shower. */
  intensity?: number;
  /** True under the tunnel or a flyover deck, where no rain falls and the
   *  road stays as it was. The world already knows where those are. */
  sheltered?: boolean;
}

export interface WeatherResult {
  wetness: number;
  /** What to multiply the car's dry grip by. */
  gripMult: number;
  /** 0..1 for the rain particles and the sound bed. Zero under shelter
   *  even while it is raining, because you can see it stop hitting the
   *  screen. */
  fall: number;
  /** True on the frame the sky changes, so a caller can start a sound or
   *  a wiper sweep once rather than every frame. */
  changed: boolean;
  spellT: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function newWeatherState(): WeatherState {
  return { wetness: 0, spellT: 0, raining: false };
}

/**
 * One frame of weather.
 *
 * Soaking and drying are both exponential approaches rather than linear
 * ramps, for the same reason the load transfer in grip.ts is: a road does
 * not take on water at a constant rate and then stop dead at full. It
 * approaches saturation, fastest at the start. The two rates differ by an
 * order of magnitude, and that gap is what keeps the road treacherous
 * long after the windscreen has cleared.
 *
 * Drizzle cannot flood a road. The wetness a spell approaches is its
 * intensity, not 1 — so light rain settles at a damp road that never
 * becomes a wet one, and only a downpour reaches standing water.
 */
export function solveWeather(s: WeatherState, i: WeatherInput): WeatherResult {
  const dt = Math.max(0, i.dt);
  const intensity = clamp01(i.intensity ?? H.rainDefaultIntensity);
  const sheltered = i.sheltered ?? false;
  const changed = i.raining !== s.raining;
  if (changed) s.spellT = 0;
  else s.spellT += dt;
  s.raining = i.raining;

  // Under a deck the road neither soaks nor dries: there is no water
  // arriving and no sky to evaporate into.
  const falling = i.raining && !sheltered;
  if (falling) {
    if (s.wetness < intensity) {
      s.wetness += (intensity - s.wetness) * Math.min(1, dt * H.wetSoakRate);
    }
  } else if (!sheltered) {
    s.wetness += (0 - s.wetness) * Math.min(1, dt * H.wetDryRate);
  }
  s.wetness = clamp01(s.wetness);

  return {
    wetness: s.wetness,
    gripMult: wetGripMult(s.wetness),
    // The particles ramp in over a couple of seconds rather than
    // appearing whole: a wall of rain switching on is the same artefact
    // as a step change in grip.
    fall: falling ? intensity * Math.min(1, s.spellT / H.rainFadeS) : 0,
    changed,
    spellT: s.spellT,
  };
}

/**
 * What a wet road multiplies dry grip by.
 *
 * Linear in wetness down to a floor, and the floor is the number that
 * matters: `wetGripLoss` is how much grip a tyre gives up on a fully wet
 * road. At 0.35 the car keeps 65% of dry, which is where a road tyre on
 * wet asphalt sits — enough that a careful driver is still quick and an
 * incautious one is in the barrier.
 *
 * Not applied to downforce. Aero presses the car down whatever the road
 * is made of, and gripAtSpeed adds the wing's contribution AFTER this —
 * so a winged car keeps more of its cornering speed in the wet than a
 * road car does, which is correct, and it falls out of the ordering
 * rather than needing a rule of its own.
 */
export function wetGripMult(wetness: number): number {
  return 1 - H.wetGripLoss * clamp01(wetness);
}
