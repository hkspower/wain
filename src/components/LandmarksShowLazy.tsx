"use client";

import dynamic from "next/dynamic";

/**
 * LandmarksShow, in a script of its own.
 *
 * The home page's own chunk (`app/page`) is loaded on most other pages too.
 * Next records each client module against the chunks of the first route that
 * included it, and `next/link` was first seen on the home page, so a page
 * whose server markup carries a Link loads the home page's chunk to get it —
 * the 404, /find, /explore, /search, /salem and five more. Whatever the home
 * page imports directly ships to all of them.
 *
 * Measured on 3 October: the rebuilt slideshow put 2.4K gzipped on ten routes
 * while showing on none (it waits for its real pictures). Through `dynamic` its
 * code is a chunk that loads only where the slideshow is rendered; the server
 * still renders its markup, so nothing on the page waits for it.
 */
const LandmarksShow = dynamic(() => import("@/components/LandmarksShow"));

export default LandmarksShow;
