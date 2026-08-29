// How far a race goes.
//
// WHY A RACE NEEDED A LENGTH AT ALL
//
// A battle here is won on SP: fall behind and yours drains, get ahead
// and theirs does, and it ends when somebody's reaches zero. That is the
// right heart for this game and it has one hole in it — two evenly
// matched cars drain each other at the same rate, so a race between
// equals has no end. It runs until one of them makes a mistake, which on
// a straight, empty corniche can be a very long time.
//
// A distance closes it. The SP fight is unchanged; it now happens over a
// stated length of road, and if neither bar has emptied by the end the
// driver with more SP takes it. So a race is decided the same way it
// always was — by who spent the night in front — and it is guaranteed to
// be decided.
//
// WHY THE PLAYER CHOOSES IT
//
// Because the choice is the interesting part. A sprint rewards the car
// that leaves hardest; a long run rewards the one that still pulls at
// 250 and the driver who can hold a line for ten minutes. Letting the
// player pick turns "which car do I buy" into a question with more than
// one answer, and it lets somebody who has been beaten twice at the
// rival's own distance come back and pick a different fight.
//
// The numbers are in KILOMETRES because the whole game is: the speedo,
// the map, the odometer and the runs all read metric, and a race that
// announced itself in miles would be the only thing on the road that
// did.

export interface RaceDistance {
  id: string;
  km: number;
  name: string;
  ar: string;
  /** One line on the chooser: what this length asks of a car. */
  blurb: string;
}

/**
 * The four lengths, against a lap of 8.5 km.
 *
 * Short enough to be over before the first roundabout, long enough to
 * need more than one, and one that is longer than the circuit so the
 * road repeats — which is a different race again, because you meet the
 * traffic you already passed.
 */
export const RACE_DISTANCES: RaceDistance[] = [
  { id: "sprint", km: 2, name: "Sprint", ar: "قصير", blurb: "Two kilometres. Whoever leaves hardest" },
  { id: "standard", km: 5, name: "Standard", ar: "عادي", blurb: "Five. The corniche and one roundabout" },
  { id: "long", km: 10, name: "Long run", ar: "طويل", blurb: "Ten. Past the lap, into traffic you already passed" },
  { id: "marathon", km: 20, name: "All night", ar: "طول الليل", blurb: "Twenty. Fuel, tyres and patience" },
];

export const DEFAULT_DISTANCE = "standard";

export function distanceById(id: string | undefined): RaceDistance {
  return (
    RACE_DISTANCES.find((d) => d.id === id) ??
    RACE_DISTANCES.find((d) => d.id === DEFAULT_DISTANCE)!
  );
}

/** Metres, which is what the engine counts in. */
export function distanceMetres(id: string | undefined): number {
  return distanceById(id).km * 1000;
}
