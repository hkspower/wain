// GENERATED — do not edit by hand.
// Produced by scripts/gen-landmarks.mjs from brand-source/landmarks/; why the
// masters are what they are, and what «stand-in» means, is in that script.
// Re-run `npm run landmarks` after replacing a picture.
//
// Server only: the slideshow's rows are handed to it as props, and the page
// tops are rendered on the server. The cards' strips are in landmark-cards.g.ts.

export type LandmarkSource = "ai" | "stand-in";

export interface LandmarkPicture {
  slug: string;
  avif: string;
  webp: string;
  src: string;
  width: number;
  height: number;
  /** Where the landmark sits, as fractions of the picture's width and height. */
  focus: readonly [number, number];
  /** What the approved picture shows; only a place page's picture uses it. */
  alt: string;
  source: LandmarkSource;
}

export const LANDMARKS: readonly LandmarkPicture[] = [
  {
    slug: "kuwait-towers",
    avif: "/home/landmarks/kuwait-towers-2c4a59f83d-480.avif 480w, /home/landmarks/kuwait-towers-2c4a59f83d-960.avif 960w, /home/landmarks/kuwait-towers-2c4a59f83d-1440.avif 1440w",
    webp: "/home/landmarks/kuwait-towers-2c4a59f83d-480.webp 480w, /home/landmarks/kuwait-towers-2c4a59f83d-960.webp 960w, /home/landmarks/kuwait-towers-2c4a59f83d-1440.webp 1440w",
    src: "/home/landmarks/kuwait-towers-2c4a59f83d-960.webp",
    width: 960,
    height: 640,
    focus: [0.52, 0.42],
    alt: "رسم مؤقت: أبراج الكويت",
    source: "stand-in",
  },
  {
    slug: "liberation-tower",
    avif: "/home/landmarks/liberation-tower-ec4a661edd-480.avif 480w, /home/landmarks/liberation-tower-ec4a661edd-960.avif 960w, /home/landmarks/liberation-tower-ec4a661edd-1440.avif 1440w",
    webp: "/home/landmarks/liberation-tower-ec4a661edd-480.webp 480w, /home/landmarks/liberation-tower-ec4a661edd-960.webp 960w, /home/landmarks/liberation-tower-ec4a661edd-1440.webp 1440w",
    src: "/home/landmarks/liberation-tower-ec4a661edd-960.webp",
    width: 960,
    height: 640,
    focus: [0.5, 0.3],
    alt: "رسم مؤقت: برج التحرير",
    source: "stand-in",
  },
  {
    slug: "grand-mosque",
    avif: "/home/landmarks/grand-mosque-52eeaa6e6b-480.avif 480w, /home/landmarks/grand-mosque-52eeaa6e6b-960.avif 960w, /home/landmarks/grand-mosque-52eeaa6e6b-1440.avif 1440w",
    webp: "/home/landmarks/grand-mosque-52eeaa6e6b-480.webp 480w, /home/landmarks/grand-mosque-52eeaa6e6b-960.webp 960w, /home/landmarks/grand-mosque-52eeaa6e6b-1440.webp 1440w",
    src: "/home/landmarks/grand-mosque-52eeaa6e6b-960.webp",
    width: 960,
    height: 640,
    focus: [0.5, 0.42],
    alt: "رسم مؤقت: المسجد الكبير",
    source: "stand-in",
  },
  {
    slug: "seif-palace",
    avif: "/home/landmarks/seif-palace-c86e9931b6-480.avif 480w, /home/landmarks/seif-palace-c86e9931b6-960.avif 960w, /home/landmarks/seif-palace-c86e9931b6-1440.avif 1440w",
    webp: "/home/landmarks/seif-palace-c86e9931b6-480.webp 480w, /home/landmarks/seif-palace-c86e9931b6-960.webp 960w, /home/landmarks/seif-palace-c86e9931b6-1440.webp 1440w",
    src: "/home/landmarks/seif-palace-c86e9931b6-960.webp",
    width: 960,
    height: 640,
    focus: [0.5, 0.3],
    alt: "رسم مؤقت: قصر السيف",
    source: "stand-in",
  },
  {
    slug: "souq-al-mubarakiya",
    avif: "/home/landmarks/souq-al-mubarakiya-65082f184f-480.avif 480w, /home/landmarks/souq-al-mubarakiya-65082f184f-960.avif 960w, /home/landmarks/souq-al-mubarakiya-65082f184f-1440.avif 1440w",
    webp: "/home/landmarks/souq-al-mubarakiya-65082f184f-480.webp 480w, /home/landmarks/souq-al-mubarakiya-65082f184f-960.webp 960w, /home/landmarks/souq-al-mubarakiya-65082f184f-1440.webp 1440w",
    src: "/home/landmarks/souq-al-mubarakiya-65082f184f-960.webp",
    width: 960,
    height: 640,
    focus: [0.5, 0.45],
    alt: "رسم مؤقت: سوق المباركية",
    source: "stand-in",
  },
  {
    slug: "marina-beach",
    avif: "/home/landmarks/marina-beach-90907ab817-480.avif 480w, /home/landmarks/marina-beach-90907ab817-960.avif 960w, /home/landmarks/marina-beach-90907ab817-1440.avif 1440w",
    webp: "/home/landmarks/marina-beach-90907ab817-480.webp 480w, /home/landmarks/marina-beach-90907ab817-960.webp 960w, /home/landmarks/marina-beach-90907ab817-1440.webp 1440w",
    src: "/home/landmarks/marina-beach-90907ab817-960.webp",
    width: 960,
    height: 640,
    focus: [0.6, 0.62],
    alt: "رسم مؤقت: شاطئ المارينا",
    source: "stand-in",
  },
  {
    slug: "al-hamra-tower",
    avif: "/home/landmarks/al-hamra-tower-93c3ab707b-480.avif 480w, /home/landmarks/al-hamra-tower-93c3ab707b-960.avif 960w, /home/landmarks/al-hamra-tower-93c3ab707b-1440.avif 1440w",
    webp: "/home/landmarks/al-hamra-tower-93c3ab707b-480.webp 480w, /home/landmarks/al-hamra-tower-93c3ab707b-960.webp 960w, /home/landmarks/al-hamra-tower-93c3ab707b-1440.webp 1440w",
    src: "/home/landmarks/al-hamra-tower-93c3ab707b-960.webp",
    width: 960,
    height: 640,
    focus: [0.52, 0.35],
    alt: "رسم مؤقت: برج الحمراء",
    source: "stand-in",
  },
  {
    slug: "sheikh-jaber-causeway",
    avif: "/home/landmarks/sheikh-jaber-causeway-d7fc782256-480.avif 480w, /home/landmarks/sheikh-jaber-causeway-d7fc782256-960.avif 960w, /home/landmarks/sheikh-jaber-causeway-d7fc782256-1440.avif 1440w",
    webp: "/home/landmarks/sheikh-jaber-causeway-d7fc782256-480.webp 480w, /home/landmarks/sheikh-jaber-causeway-d7fc782256-960.webp 960w, /home/landmarks/sheikh-jaber-causeway-d7fc782256-1440.webp 1440w",
    src: "/home/landmarks/sheikh-jaber-causeway-d7fc782256-960.webp",
    width: 960,
    height: 640,
    focus: [0.55, 0.5],
    alt: "رسم مؤقت: جسر الشيخ جابر",
    source: "stand-in",
  },
];

/** The slideshow under the home hero, in the order it plays. */
export const SHOW: readonly string[] = ["kuwait-towers", "liberation-tower", "grand-mosque", "seif-palace", "souq-al-mubarakiya", "marina-beach"];

/** The places whose card and page carry their picture. */
export const PLACE_SLOTS: readonly string[] = ["kuwait-towers", "liberation-tower", "seif-palace", "al-hamra-tower", "sheikh-jaber-causeway"];
