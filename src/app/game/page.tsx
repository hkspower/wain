import type { Metadata } from "next";
import { CARS } from "@/game/mods";
import { RIVALS, rivalCar } from "@/game/rivals";
import { RACE_DISTANCES, distanceById } from "@/game/distances";
import { INTRO, NAME, TAGLINE } from "@/lib/gameSite";
import GameSite from "./GameSite";

export const metadata: Metadata = {
  title: `${NAME.en} — ${NAME.ar}`,
  description: INTRO.en,
  keywords: [
    "Gulf Road Nights", "ليالي شارع الخليج", "Kuwait", "racing game",
    "Gulf Road", "شارع الخليج", "browser game", "Arabic",
  ],
  openGraph: {
    title: `${NAME.en} — ${NAME.ar}`,
    description: TAGLINE.en,
    images: ["/game/night.webp"],
    type: "website",
  },
};

/**
 * The site's own view of the game's data.
 *
 * Built HERE, in a server component, from the arrays the game itself
 * ships — so the showroom on the website is the showroom in the game.
 * The alternative is a second copy of fifteen cars and eight rivals kept
 * in a content file, and a second copy is a copy that will be wrong: the
 * cars have been renamed twice already, and the rivals' join to the
 * showroom broke silently the last time it went through a display name.
 *
 * What crosses to the client is flat and serialisable — no functions and
 * nothing the client would have to import src/game to understand.
 */
export default function GamePage() {
  const cars = CARS.map((c) => ({
    id: c.id,
    name: c.name,
    ar: c.ar,
    cls: c.cls,
    price: c.price,
    topSpeedKmh: c.topSpeedKmh,
    lengthM: c.lengthM,
    locked: c.locked?.rivals ?? 0,
  }));

  const rivals = RIVALS.map((r, i) => {
    const car = rivalCar(r);
    const d = distanceById(r.distance);
    return {
      order: i + 1,
      id: r.id,
      name: r.name,
      ar: r.arabicName,
      crew: r.crew,
      area: r.area,
      carName: car?.name ?? "",
      carAr: car?.ar ?? "",
      carId: car?.id ?? "",
      distance: d.name,
      distanceAr: d.ar,
      km: d.km,
      topSpeedKmh: r.topSpeedKmh,
    };
  });

  const distances = RACE_DISTANCES.map((d) => ({
    id: d.id,
    km: d.km,
    name: d.name,
    ar: d.ar,
    blurb: d.blurb,
    blurbAr: d.blurbAr,
  }));

  return <GameSite cars={cars} rivals={rivals} distances={distances} />;
}
