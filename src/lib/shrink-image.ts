import { Platform } from 'react-native';

/**
 * A photograph, made small enough for the server to accept.
 *
 * WHY THIS EXISTS AT ALL. `?r=product_image_add` takes a data: URI and refuses
 * anything over about 900 kB of base64 — roughly 675 kB of image. A photograph
 * off a modern phone is 3 to 6 MB, so EVERY upload would be refused, and the
 * refusal would arrive as `logo_too_large` after the whole file had been read,
 * encoded and sent. Shrinking is not an optimisation here; without it the
 * feature does not work once.
 *
 * 1400px AND WEBP are the server's own numbers — store.php's comment beside
 * STORE_PRODUCT_IMAGE_MAX says "the admin downscales to 1400px WebP; this is
 * the floor under that, not the target". The website's picker already does
 * exactly this, and two admins producing different-sized images for the same
 * shop is how a gallery ends up with one crisp photograph and five soft ones.
 *
 * THE LONGEST EDGE, not the width. A product shot may be portrait or square,
 * and capping the width alone lets a tall photograph through at 1400 x 2400 —
 * larger than the landscape one it was meant to match.
 *
 * QUALITY IS NEGOTIATED DOWN, not fixed. A flat garment on white compresses to
 * almost nothing at 0.82; a busy model shot on a gym floor does not, and a
 * fixed quality would refuse it. So it re-encodes at falling quality until the
 * result fits, and only gives up when even the lowest is too big — which for a
 * 1400px WebP means something is wrong with the file, not with the setting.
 */

/** The server's cap, in bytes of BASE64 — store.php, STORE_PRODUCT_IMAGE_MAX.
 *  Base64 is 4 bytes per 3, so the real image budget is about 675 kB. */
export const MAX_BASE64 = 900_000;

/** How many photographs one garment may carry — store.php's
 *  STORE_PRODUCT_IMAGE_LIMIT. Mirrored so the picker can stop at the limit
 *  instead of shrinking ten images and meeting too_many_images on the
 *  eleventh, which is a lot of work to throw away. */
export const MAX_PHOTOS = 24;

const LONGEST_EDGE = 1400;
const QUALITIES = [0.82, 0.72, 0.62, 0.5, 0.4];

export interface Shrunk {
  /** data:image/webp;base64,… — what addProductImage() takes. */
  dataUri: string;
  width: number;
  height: number;
  /** Before and after, so the screen can show what it saved. */
  fromBytes: number;
  toBytes: number;
}

export class TooBig extends Error {
  constructor(bytes: number) {
    super(`still ${Math.round(bytes / 1024)} kB at the lowest quality`);
    this.name = 'TooBig';
  }
}

/** The scaled size, longest edge capped, aspect kept, never scaled UP — a
 *  600px photograph blown to 1400 is a bigger file that looks worse. */
function fit(w: number, h: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= LONGEST_EDGE) return { w, h };
  const k = LONGEST_EDGE / longest;
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

// ------------------------------------------------------------------- web
//
// Canvas, because it is there. No library, no worker: the whole job is decode,
// draw at the new size, and ask for a WebP.
async function shrinkWeb(file: File): Promise<Shrunk> {
  // DECODE IS THE STEP THAT CAN FAIL ON A PHONE, so it says so in words.
  //
  // createImageBitmap throws a bare DOMException — "The source image could not
  // be decoded" — which reached the screen through String(e) and told the
  // owner nothing they could act on. The case that matters is HEIC: every
  // iPhone photograph is one, Safari can decode them and Chrome cannot, so the
  // same picture works on one phone and fails on another with no clue why.
  //
  // The advice is real and specific: iOS can be told to hand over JPEG instead
  // (Settings, Camera, Formats, "Most Compatible") and everything after that
  // works everywhere.
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    const heic = /\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type);
    throw new Error(heic
      ? 'this browser cannot open HEIC photographs — on the iPhone, Settings → Camera → Formats → Most Compatible saves them as JPEG instead'
      : 'this file is not a picture this browser can open');
  }
  const { w, h } = fit(bitmap.width, bitmap.height);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('this browser cannot resize images');
  // A PNG with transparency drawn straight onto a canvas keeps its alpha, and
  // WebP carries it — so a cut-out garment stays cut out rather than gaining a
  // black background, which is what happens if you flatten onto an unpainted
  // canvas and encode as JPEG.
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  let last = 0;
  for (const q of QUALITIES) {
    const uri = canvas.toDataURL('image/webp', q);
    // A browser that cannot encode WebP silently hands back a PNG data URI
    // instead of failing — Safari did this for years. The server accepts PNG,
    // so this is not fatal, but the size check below is what decides.
    last = uri.length;
    if (uri.length <= MAX_BASE64) {
      return { dataUri: uri, width: w, height: h, fromBytes: file.size, toBytes: uri.length };
    }
  }
  throw new TooBig(last);
}

// ---------------------------------------------------------------- native
//
// expo-image-manipulator. Same numbers, same order of attempts, so a
// photograph uploaded from the phone and the same photograph uploaded from a
// computer end up the same size in the database.
async function shrinkNative(uri: string, fileSize: number): Promise<Shrunk> {
  const ImageManipulator = await import('expo-image-manipulator');

  // The context has to be told the target explicitly; unlike canvas there is
  // no cheap way to read the source dimensions first, so the resize is given
  // only the longest edge it may occupy and the library keeps the aspect.
  //
  // `width` alone would be wrong for a portrait shot — see the note at the top
  // — so both are passed and the library fits inside the box.
  let last = 0;
  for (const q of QUALITIES) {
    const ctx = ImageManipulator.ImageManipulator.manipulate(uri);
    ctx.resize({ width: LONGEST_EDGE });
    const rendered = await ctx.renderAsync();
    const out = await rendered.saveAsync({
      compress: q,
      format: ImageManipulator.SaveFormat.WEBP,
      base64: true,
    });
    if (!out.base64) throw new Error('the image could not be re-encoded');
    const dataUri = `data:image/webp;base64,${out.base64}`;
    last = dataUri.length;
    if (dataUri.length <= MAX_BASE64) {
      return {
        dataUri,
        width: out.width,
        height: out.height,
        fromBytes: fileSize,
        toBytes: dataUri.length,
      };
    }
  }
  throw new TooBig(last);
}

/** One photograph. `source` is a File in the browser and a local uri on a
 *  phone — the two platforms hand back different things and neither can be
 *  turned into the other cheaply. */
export function shrinkImage(
  source: File | { uri: string; fileSize?: number },
): Promise<Shrunk> {
  if (Platform.OS === 'web') return shrinkWeb(source as File);
  const s = source as { uri: string; fileSize?: number };
  return shrinkNative(s.uri, s.fileSize ?? 0);
}
