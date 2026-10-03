// GENERATED — do not edit by hand.
// Produced by scripts/gen-landmarks.mjs. The card strips only: PlaceCard is
// rendered inside client components, so whatever this file holds reaches the
// browser — the slideshow's and the page tops' files are in landmarks.g.ts.
//
// The drawn stand-ins sit behind the preview switch, which next.config.ts
// defines in every build: a normal build folds it to false and drops them, so
// no JavaScript the site ships names a file the export left out.

export interface LandmarkCard {
  slug: string;
  avif: string;
  webp: string;
  src: string;
  width: number;
  height: number;
  source: "ai" | "stand-in";
}

export const LANDMARK_CARDS: readonly LandmarkCard[] = [
  ...(process.env.NEXT_PUBLIC_SHOW_STANDINS === "1"
    ? ([
        {
          slug: "kuwait-towers",
          avif: "/home/landmarks/kuwait-towers-2c4a59f83d-card-480.avif 480w, /home/landmarks/kuwait-towers-2c4a59f83d-card-960.avif 960w",
          webp: "/home/landmarks/kuwait-towers-2c4a59f83d-card-480.webp 480w, /home/landmarks/kuwait-towers-2c4a59f83d-card-960.webp 960w",
          src: "/home/landmarks/kuwait-towers-2c4a59f83d-card-480.webp",
          width: 480,
          height: 160,
          source: "stand-in",
        },
        {
          slug: "liberation-tower",
          avif: "/home/landmarks/liberation-tower-ec4a661edd-card-480.avif 480w, /home/landmarks/liberation-tower-ec4a661edd-card-960.avif 960w",
          webp: "/home/landmarks/liberation-tower-ec4a661edd-card-480.webp 480w, /home/landmarks/liberation-tower-ec4a661edd-card-960.webp 960w",
          src: "/home/landmarks/liberation-tower-ec4a661edd-card-480.webp",
          width: 480,
          height: 160,
          source: "stand-in",
        },
        {
          slug: "seif-palace",
          avif: "/home/landmarks/seif-palace-c86e9931b6-card-480.avif 480w, /home/landmarks/seif-palace-c86e9931b6-card-960.avif 960w",
          webp: "/home/landmarks/seif-palace-c86e9931b6-card-480.webp 480w, /home/landmarks/seif-palace-c86e9931b6-card-960.webp 960w",
          src: "/home/landmarks/seif-palace-c86e9931b6-card-480.webp",
          width: 480,
          height: 160,
          source: "stand-in",
        },
        {
          slug: "al-hamra-tower",
          avif: "/home/landmarks/al-hamra-tower-93c3ab707b-card-480.avif 480w, /home/landmarks/al-hamra-tower-93c3ab707b-card-960.avif 960w",
          webp: "/home/landmarks/al-hamra-tower-93c3ab707b-card-480.webp 480w, /home/landmarks/al-hamra-tower-93c3ab707b-card-960.webp 960w",
          src: "/home/landmarks/al-hamra-tower-93c3ab707b-card-480.webp",
          width: 480,
          height: 160,
          source: "stand-in",
        },
        {
          slug: "sheikh-jaber-causeway",
          avif: "/home/landmarks/sheikh-jaber-causeway-d7fc782256-card-480.avif 480w, /home/landmarks/sheikh-jaber-causeway-d7fc782256-card-960.avif 960w",
          webp: "/home/landmarks/sheikh-jaber-causeway-d7fc782256-card-480.webp 480w, /home/landmarks/sheikh-jaber-causeway-d7fc782256-card-960.webp 960w",
          src: "/home/landmarks/sheikh-jaber-causeway-d7fc782256-card-480.webp",
          width: 480,
          height: 160,
          source: "stand-in",
        },
      ] as LandmarkCard[])
    : []),
];
