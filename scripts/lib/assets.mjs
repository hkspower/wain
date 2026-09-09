// Where every asset in this repository lives, and which kind it is.
//
// WHY THIS FILE EXISTS
//
// There were two lists and neither was right.
//
// press/README.md opened with "Everything the game has to show for
// itself, in four folders" and named four. There are twenty-seven. That
// is the exact failure the project-structure map already had once — it
// described the place-directory site while a whole racing game grew
// beside it — and check-structure.mjs says why it matters in its own
// comment: a map nobody maintains is worse than no map, because it is
// believed.
//
// The other list was .gitignore, which had grown twenty-odd hand-written
// `/press/xxx/` entries, each with its own paragraph explaining that the
// thing it names is regenerated on demand. That list was more accurate
// than the README and still not complete, and nothing compared the two.
//
// So: one declaration. Every asset family, where it is, what writes it,
// what it is for, and — the question that actually decides everything
// else — whether it is KEPT or SCRATCH.
//
// KEPT vs SCRATCH
//
//   kept     A deliverable. Committed, and expected to be: something
//            outside this repository refers to it, or it exists to be
//            diffed against its own past. Every file in the directory
//            must be tracked.
//   scratch  Instrument output. A tool wrote it to answer a question,
//            the ANSWER was the number it printed, and the pictures are
//            what it looked at. Regenerated on demand, ignored, and no
//            file in it may be tracked.
//
// A family can also be `split`, where the deliverable and the working
// files live in one directory because they are the same shot at two
// fidelities — the encoded film beside the 336 JPEGs it was made from,
// the 4K rig stills beside the lossless PNGs they were compressed out
// of. Those declare what is kept, and everything else in them is
// scratch.

/** @typedef {"kept" | "scratch" | "split"} AssetKind */

/**
 * Every asset directory in the repository.
 *
 * `by` names the script that writes it, so a family whose producer has
 * been deleted is visible as a family nobody can rebuild. `—` means it
 * was made by hand and there is nothing to run.
 */
export const ASSETS = [
  // ---- Shipped to the browser. All of it is loaded at runtime, all of
  // it must be committed, and none of it is optional in the sense the
  // press kit is.
  { path: "public/cars", kind: "kept", ships: true, by: "tools/shots/cardthumbs.mjs",
    what: "Shop card thumbnails, one per car, derived from the press renders." },
  { path: "public/game", kind: "kept", ships: true, by: "—",
    what: "Icons, the manifest and the install art the browser asks for." },
  { path: "public/models", kind: "kept", ships: true, by: "scripts/export-car-profiles.mjs",
    what: "Blender-authored shells, wheels, palms and the driver, plus build.json." },
  { path: "public/music", kind: "kept", ships: true, by: "scripts/generate-music.mjs",
    what: "The station beds the radio plays." },
  { path: "public/radio", kind: "kept", ships: true, by: "—",
    what: "Station idents." },
  { path: "public/sfx", kind: "kept", ships: true, by: "tools/elevenlabs/generate-sfx.mjs",
    what: "Sampled effects and the manifest naming them. See sfx.ts: the manifest maps a NAME to a FILE and they are not the same string." },
  { path: "public/textures", kind: "kept", ships: true, by: "—",
    what: "The few bitmaps the world does not draw on a canvas." },
  { path: "public/voices", kind: "kept", ships: true, by: "scripts/generate-voices.mjs",
    what: "Rival voice lines and their manifest." },

  // ---- The press kit. Committed, never shipped, referenced from
  // outside the repo or kept to be diffed against its own past.
  { path: "press/cars", kind: "kept", by: "tools/shots/cars.mjs",
    what: "A press render of every car on the menu's own turntable." },
  { path: "press/logo", kind: "kept", by: "press/logo/render.mjs",
    what: "The identity: both marks and the poster plate, with the faces they need vendored beside them." },
  { path: "press/shots", kind: "kept", by: "tools/shots/capture.mjs",
    what: "Reference stills of the game in known states, kept to be compared against their own history." },
  { path: "press/social", kind: "kept", by: "—",
    what: "Share cards." },
  { path: "press/stories", kind: "kept", by: "scripts/story-cards.mjs",
    what: "The story cards and the page that lays them out." },
  { path: "press/map", kind: "kept", by: "—", what: "The circuit, drawn." },
  { path: "press/flags", kind: "kept", by: "tools/shots/flags.mjs",
    what: "The flag decal, at the size it is worn." },

  // ---- Measurements that were worth keeping. Each of these is a
  // before-and-after or a reference plate that a comment somewhere
  // cites; they are small, and deleting them would orphan the argument.
  { path: "press/blur", kind: "kept", by: "tools/shots/nightlook.mjs", what: "Building blur, before and after." },
  { path: "press/sharp", kind: "kept", by: "tools/shots/sharpness.mjs", what: "Edge sharpness at each resolution step." },
  { path: "press/paint", kind: "kept", by: "tools/shots/paint.mjs", what: "Paint under the street lights, per finish." },
  { path: "press/shadow", kind: "kept", by: "tools/shots/shadows.mjs", what: "The contact shadow, close up." },
  { path: "press/menus", kind: "kept", by: "tools/shots/menus.mjs", what: "Every menu at the sizes the gutters check." },
  { path: "press/stripe", kind: "kept", by: "—", what: "The full-length side graphic on each silhouette." },
  { path: "press/texels", kind: "kept", by: "tools/shots/texels.mjs", what: "Decal density, magnified." },
  { path: "press/type", kind: "kept", by: "tools/shots/type.mjs", what: "The HUD's numerals, held still." },
  { path: "press/volume", kind: "kept", by: "tools/shots/volume.mjs", what: "The car's own silhouette against the light." },
  { path: "press/audio", kind: "kept", by: "tools/shots/audioglitch.mjs", what: "The glitch report, as a file." },

  // ---- Split: the deliverable and the working files share a folder
  // because they are the same shot at two fidelities.
  { path: "press/film", kind: "split", by: "tools/shots/exportfilm.mjs",
    // Two encodings and a poster, not one: the .webm is what a browser
    // that will not take H.264 plays, and dropping it from this list is
    // what the check caught the first time it ran.
    keep: ["*.mp4", "*.webm", "t*.png", "versus-poster.png"],
    what: "The pre-race film, both encodings, and its poster frames. The 336 JPEGs it was made from are not the artefact." },
  { path: "press/ik", kind: "split", by: "tools/shots/ik4k.mjs",
    keep: ["*.jpg", "*.json", "*.md"],
    what: "The rig at 4K. The JPEGs are the deliverable; the lossless PNGs beside them are 13 MB each." },

  // ---- Scratch. A tool wrote it to answer a question, and the answer
  // was the number it printed.
  { path: "press/views", kind: "scratch", by: "tools/shots/car-views.mjs", what: "Car elevations, rendered on demand." },
  { path: "press/decals", kind: "scratch", by: "tools/shots/decals.mjs", what: "Decal artwork, dumped to look at." },
  { path: "press/levels", kind: "scratch", by: "tools/shots/levels.mjs", what: "Level histograms and the frames behind them." },
  { path: "press/shop", kind: "scratch", by: "tools/shots/shopsmoke.mjs", what: "Shop screenshots." },
  { path: "press/grid", kind: "scratch", by: "tools/shots/grid.mjs", what: "Overhead grid shots." },
  { path: "press/situations", kind: "scratch", by: "tools/shots/situations.mjs", what: "Grade frames per situation." },
  { path: "press/glare", kind: "scratch", by: "tools/shots/glare.mjs", what: "Glare falloff frames." },
  { path: "press/exhaust", kind: "scratch", by: "—", what: "Exhaust tip frames." },
  { path: "press/hud", kind: "scratch", by: "tools/shots/hudtype.mjs", what: "The per-run HUD type report; viewport-dependent." },

  // ---- Scratch that is not on disk in this checkout.
  //
  // These are ignored and declared but absent, and that is the normal
  // state for most of them: the directory appears the first time its
  // tool runs and nobody has run it here. `optional` is what stops the
  // map calling them phantoms — the alternative was deleting nine
  // .gitignore entries that are doing exactly their job, which would
  // have been a tidy-up that reintroduced the bug.
  { path: "press/dark", kind: "scratch", optional: true, by: "tools/shots/dark.mjs", what: "Dark-area scan frames." },
  { path: "press/edges", kind: "scratch", optional: true, by: "tools/shots/edges.mjs", what: "Edge-quality frames." },
  { path: "press/framing", kind: "scratch", optional: true, by: "tools/shots/framing.mjs", what: "Framing frames at each window size." },
  { path: "press/tint", kind: "scratch", optional: true, by: "tools/shots/tint.mjs", what: "Fifteen captures of one car at fifteen darknesses; the TABLE is the artefact." },
  { path: "press/station", kind: "scratch", optional: true, by: "tools/shots/capture.mjs", what: "Petrol station shots." },
  // Five whose producer could not be found by name. The ignore entries
  // are older than the tools that were once behind them; they stay
  // because an ignore for a directory nobody writes costs nothing and
  // deleting one that something DOES write costs a committed folder of
  // screenshots. Flagged here rather than quietly kept, so the next
  // person can decide with the fact in front of them.
  { path: "press/clock", kind: "scratch", optional: true, by: "—", what: "Clock screenshots. No producer found by name." },
  { path: "press/areas", kind: "scratch", optional: true, by: "—", what: "Area-guide plates. No producer found by name." },
  { path: "press/plants", kind: "scratch", optional: true, by: "—", what: "Roadside planting frames. No producer found by name." },
  { path: "press/limiter", kind: "scratch", optional: true, by: "—", what: "Rev-limiter alert frames. No producer found by name." },
];

/** The families that reach a player's browser. */
export const SHIPPED = ASSETS.filter((a) => a.ships);

/** Look one up by path. */
export function assetAt(path) {
  return ASSETS.find((a) => a.path === path) ?? null;
}
