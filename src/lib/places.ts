export type Category =
  | "Landmarks"
  | "Food & Cafés"
  | "Shopping"
  | "Beaches & Outdoors"
  | "Culture"
  | "Family";

export interface Place {
  slug: string;
  name: string;
  nameAr: string;
  category: Category;
  area: string;
  rating: number;
  priceLevel: 1 | 2 | 3;
  emoji: string;
  gradient: string;
  tagline: string;
  description: string;
  highlights: string[];
  bestTime: string;
  featured?: boolean;
}

export const categories: { name: Category; emoji: string; blurb: string }[] = [
  { name: "Landmarks", emoji: "🗼", blurb: "Icons of the Kuwait skyline" },
  { name: "Food & Cafés", emoji: "☕", blurb: "From machboos to specialty coffee" },
  { name: "Shopping", emoji: "🛍️", blurb: "Malls, souqs, and boutiques" },
  { name: "Beaches & Outdoors", emoji: "🏖️", blurb: "Sun, sea, and green escapes" },
  { name: "Culture", emoji: "🎭", blurb: "Museums, theatres, and heritage" },
  { name: "Family", emoji: "🎡", blurb: "Fun for every age" },
];

export const places: Place[] = [
  {
    slug: "kuwait-towers",
    name: "Kuwait Towers",
    nameAr: "أبراج الكويت",
    category: "Landmarks",
    area: "Kuwait City",
    rating: 4.7,
    priceLevel: 2,
    emoji: "🗼",
    gradient: "from-sky-400 via-cyan-500 to-brand-600",
    tagline: "The icon of Kuwait, 187 metres above the Gulf.",
    description:
      "The three striking towers on the Arabian Gulf shoreline are Kuwait's most recognisable landmark. Ride up to the viewing sphere for a 360° panorama of the city and sea, then stay for dinner in the revolving restaurant.",
    highlights: ["360° viewing sphere", "Revolving restaurant", "Gulf-front promenade"],
    bestTime: "Sunset, when the towers light up",
    featured: true,
  },
  {
    slug: "souq-al-mubarakiya",
    name: "Souq Al-Mubarakiya",
    nameAr: "سوق المباركية",
    category: "Shopping",
    area: "Kuwait City",
    rating: 4.8,
    priceLevel: 1,
    emoji: "🏮",
    gradient: "from-amber-400 via-orange-500 to-sand-700",
    tagline: "Two centuries of trade, spice, and stories.",
    description:
      "One of the oldest souqs in Kuwait, Mubarakiya is a maze of spice stalls, gold shops, date sellers, and tiny restaurants. Come hungry, haggle gently, and finish with tea in the old courtyard.",
    highlights: ["Traditional Kuwaiti food", "Spice & gold markets", "Heritage courtyards"],
    bestTime: "Evenings, after 5 PM",
    featured: true,
  },
  {
    slug: "al-shaheed-park",
    name: "Al Shaheed Park",
    nameAr: "حديقة الشهيد",
    category: "Beaches & Outdoors",
    area: "Kuwait City",
    rating: 4.6,
    priceLevel: 1,
    emoji: "🌳",
    gradient: "from-lime-400 via-emerald-500 to-brand-700",
    tagline: "The green lung of the capital.",
    description:
      "The largest urban park in Kuwait, with botanical gardens, lakes, two museums, jogging tracks, and open-air concerts. A favourite spot for a cool evening walk in the heart of the city.",
    highlights: ["Botanical gardens", "Habitat & Memorial museums", "Lakeside jogging track"],
    bestTime: "Early morning or after sunset",
    featured: true,
  },
  {
    slug: "the-avenues",
    name: "The Avenues",
    nameAr: "الأفنيوز",
    category: "Shopping",
    area: "Al Rai",
    rating: 4.7,
    priceLevel: 3,
    emoji: "🛍️",
    gradient: "from-fuchsia-400 via-purple-500 to-indigo-600",
    tagline: "A city within a city — the Gulf's grandest mall.",
    description:
      "More than 1,100 stores across themed districts that feel like open-air streets. From luxury brands in Prestige to the souq-style Grand Avenue, you could spend a whole day and not see it all.",
    highlights: ["Themed shopping districts", "Global dining", "Indoor strolling boulevards"],
    bestTime: "Weekday mornings to beat the crowds",
    featured: true,
  },
  {
    slug: "grand-mosque",
    name: "The Grand Mosque",
    nameAr: "المسجد الكبير",
    category: "Culture",
    area: "Kuwait City",
    rating: 4.9,
    priceLevel: 1,
    emoji: "🕌",
    gradient: "from-teal-400 via-brand-500 to-brand-800",
    tagline: "Kuwait's largest mosque, a masterpiece of Islamic art.",
    description:
      "Covering 45,000 square metres, the Grand Mosque dazzles with Andalusian-inspired calligraphy, a vast central dome, and serene courtyards. Free guided tours welcome visitors of all backgrounds.",
    highlights: ["Free guided tours", "Stunning calligraphy & dome", "Peaceful courtyards"],
    bestTime: "Morning tour slots",
  },
  {
    slug: "marina-beach",
    name: "Marina Beach & Crescent",
    nameAr: "شاطئ المارينا",
    category: "Beaches & Outdoors",
    area: "Salmiya",
    rating: 4.5,
    priceLevel: 1,
    emoji: "🏖️",
    gradient: "from-cyan-300 via-sky-400 to-blue-600",
    tagline: "Soft sand and seafront dining on the Salmiya coast.",
    description:
      "A clean, family-friendly beach connected to Marina Mall by a pedestrian bridge. Swim, rent a kayak, or just walk the crescent at golden hour and pick a waterfront café for dinner.",
    highlights: ["Swimming & kayaking", "Waterfront cafés", "Marina Crescent promenade"],
    bestTime: "Late afternoon",
  },
  {
    slug: "jacc",
    name: "Sheikh Jaber Cultural Centre",
    nameAr: "مركز الشيخ جابر الثقافي",
    category: "Culture",
    area: "Kuwait City",
    rating: 4.8,
    priceLevel: 2,
    emoji: "🎭",
    gradient: "from-slate-400 via-slate-500 to-brand-900",
    tagline: "The opera house of the Gulf.",
    description:
      "A jewel-like complex of theatres and concert halls wrapped in geometric Islamic patterns. Catch an opera, a symphony, or simply admire the architecture reflecting in the surrounding pools.",
    highlights: ["World-class performances", "Striking architecture", "Evening light shows"],
    bestTime: "Show nights — book ahead",
  },
  {
    slug: "failaka-island",
    name: "Failaka Island",
    nameAr: "جزيرة فيلكا",
    category: "Beaches & Outdoors",
    area: "Arabian Gulf",
    rating: 4.4,
    priceLevel: 2,
    emoji: "⛵",
    gradient: "from-blue-400 via-indigo-500 to-violet-700",
    tagline: "Ancient Greek ruins, a ferry ride from the city.",
    description:
      "Once home to a Bronze Age civilisation and a Hellenistic fort, Failaka mixes archaeology with quiet beaches. Take the ferry from Salmiya, tour the ruins, and stay for a beach barbecue.",
    highlights: ["Hellenistic ruins", "Ferry day trips", "Quiet beaches"],
    bestTime: "Spring & winter weekends",
  },
  {
    slug: "mirror-house",
    name: "The Mirror House",
    nameAr: "بيت المرايا",
    category: "Culture",
    area: "Qadsiya",
    rating: 4.6,
    priceLevel: 1,
    emoji: "🪞",
    gradient: "from-zinc-300 via-slate-400 to-slate-700",
    tagline: "A home covered in mirror mosaics, inside and out.",
    description:
      "Artist Lidia Al-Qattan spent decades covering every surface of her family home in mirror mosaic. The result is one of the most unusual museums in the Middle East — visits are by appointment and personally guided.",
    highlights: ["Mirror mosaic rooms", "Guided by the artist's family", "One-of-a-kind in the Gulf"],
    bestTime: "By appointment",
  },
  {
    slug: "aqua-park",
    name: "Aqua Park Kuwait",
    nameAr: "أكوا بارك",
    category: "Family",
    area: "Kuwait City",
    rating: 4.3,
    priceLevel: 2,
    emoji: "🎢",
    gradient: "from-cyan-400 via-teal-400 to-emerald-600",
    tagline: "The Gulf's first water park, next to Kuwait Towers.",
    description:
      "Slides, wave pools, and lazy rivers spread along the seafront. An easy family day out with food courts and shaded seating, right beside the towers.",
    highlights: ["Wave pool & slides", "Kids' splash zones", "Seafront location"],
    bestTime: "Weekday mornings in summer",
  },
  {
    slug: "tareq-rajab-museum",
    name: "Tareq Rajab Museum",
    nameAr: "متحف طارق رجب",
    category: "Culture",
    area: "Jabriya",
    rating: 4.7,
    priceLevel: 1,
    emoji: "🏺",
    gradient: "from-amber-500 via-sand-600 to-sand-900",
    tagline: "A private treasure house of Islamic art.",
    description:
      "Thousands of pieces of Islamic calligraphy, ceramics, jewellery, and musical instruments collected over fifty years. Quiet, beautifully curated, and famously survived the 1990 invasion hidden behind a false wall.",
    highlights: ["Islamic calligraphy", "Gold & silver jewellery", "Remarkable history"],
    bestTime: "Weekday afternoons",
  },
  {
    slug: "green-island",
    name: "Green Island",
    nameAr: "الجزيرة الخضراء",
    category: "Family",
    area: "Gulf Road",
    rating: 4.2,
    priceLevel: 1,
    emoji: "🏝️",
    gradient: "from-emerald-400 via-green-500 to-teal-700",
    tagline: "An artificial island of gardens and lagoons.",
    description:
      "The first artificial island in the Gulf, linked to the corniche by a walkway. Lawns, a swimming lagoon, a viewing tower, and an amphitheatre make it an easy half-day with kids.",
    highlights: ["Swimming lagoon", "Viewing tower", "Picnic lawns"],
    bestTime: "Cooler months, late afternoon",
  },
];

export function getPlace(slug: string): Place | undefined {
  return places.find((p) => p.slug === slug);
}

export function getFeaturedPlaces(): Place[] {
  return places.filter((p) => p.featured);
}

export function getPlacesByCategory(category: Category): Place[] {
  return places.filter((p) => p.category === category);
}
