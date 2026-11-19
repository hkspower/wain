<?php
/*
 * The size limits for an uploaded product photo, in one place (admin.php product_image_upload, and the tests).
 *
 * Two different limits, on purpose:
 *   - the FILE SIZE (10 MiB) is checked in admin.php before anything is decoded;
 *   - the PIXEL COUNT is checked here, from the header, after the picture is recognised. A PNG of a few hundred kilobytes can
 *     declare a canvas of hundreds of megapixels: it passes every byte limit, and the first thing that decodes it (a browser, the
 *     variants job) must hold the whole picture in memory.
 *
 * A camera photograph is 24 megapixels at most (6000 x 4000). A larger photo is REFUSED, never resized: the owner's rule is that an
 * uploaded photo is written unchanged, so the shop asks for a smaller file rather than changing the one it was given.
 */

const STORE_PHOTO_MAX_SIDE = 6000;
const STORE_PHOTO_MAX_PIXELS = 24000000;

/**
 * True when a picture of this size may be stored. The header gives the size; a zero or missing side is never acceptable.
 */
function store_photo_size_ok(int $width, int $height): bool {
    if ($width < 1 || $height < 1) return false;
    if ($width > STORE_PHOTO_MAX_SIDE || $height > STORE_PHOTO_MAX_SIDE) return false;
    return $width * $height <= STORE_PHOTO_MAX_PIXELS;
}
