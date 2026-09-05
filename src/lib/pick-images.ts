import { Platform } from 'react-native';

/**
 * "Choose photographs" — several at once, on a phone and in a browser.
 *
 * The two platforms have nothing in common here. A browser opens a file dialog
 * and hands back File objects; a phone asks for permission, opens the system
 * photo library and hands back local uris. Neither can be turned into the
 * other, so this returns the union and lib/shrink-image takes it from there.
 *
 * THE BROWSER PATH USES NO LIBRARY. expo-image-picker works on web, but it
 * mounts its own input and its permission model is a no-op there; a plain
 * <input type="file" multiple> is what the browser already has, and it is what
 * makes drag-and-drop and "select all" behave the way a shop owner expects
 * when they are putting twenty photographs in at once.
 */

/** What both platforms hand back, ready for shrinkImage(). */
export type Picked = File | { uri: string; fileSize?: number; fileName?: string };

export class PermissionDenied extends Error {
  constructor() {
    super('permission denied');
    this.name = 'PermissionDenied';
  }
}

function pickWeb(limit: number): Promise<Picked[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    // THE SERVER'S FORMAT LIST IS THE WRONG LIST TO PUT HERE, and it was here.
    //
    // store_data_image() takes png, jpeg and webp and refuses everything else,
    // so those three were named — which reads as careful and is the wrong
    // question. The server never sees the file that is chosen. shrinkImage()
    // decodes it to a canvas and re-encodes the PIXELS as WebP, so whatever
    // goes in comes out as one of the three regardless. What belongs here is
    // the list of things the BROWSER can decode, and that is a longer list.
    //
    // The cost of the short one falls on a phone. An iPhone photographs in
    // HEIC, and a picker filtered to png/jpeg/webp is a picker that greys out
    // the owner's own camera roll — on the device this panel is run from. A
    // format the browser cannot open is a readable error one line later;
    // a photograph that cannot be selected at all has no error and no way on.
    //
    // image/* rather than a longer list of names, because the list keeps
    // growing — HEIC, HEIF, AVIF, JPEG XL — and every addition is another
    // release where the owner cannot pick their own photograph. Anything the
    // canvas refuses is caught and named in shrinkImage; a PDF still cannot
    // get past that, it simply fails a step later than it used to.
    input.accept = 'image/*';
    input.style.display = 'none';

    // CANCEL HAS TO RESOLVE, or the screen sits on "choosing…" forever. There
    // is no reliable cancel event on a file input, so `cancel` is used where
    // it exists (every current browser) and a focus fallback catches the rest.
    let done = false;
    const finish = (files: Picked[]) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish(Array.from(input.files ?? []).slice(0, limit)));
    input.addEventListener('cancel', () => finish([]));
    window.addEventListener('focus', () => setTimeout(() => finish([]), 500), { once: true });

    document.body.appendChild(input);
    input.click();
  });
}

async function pickNative(limit: number): Promise<Picked[]> {
  const ImagePicker = await import('expo-image-picker');

  // ASKED FOR ONLY WHEN THE OWNER TAPS the button, never at screen load. A
  // permission sheet that appears before anyone has asked for anything is the
  // one people decline out of hand, and iOS will not ask twice.
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new PermissionDenied();

  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: limit,
    // NO `quality` AND NO `base64` HERE. The picker's own compression would be
    // a second, differently-tuned shrink on top of the one in
    // lib/shrink-image, and asking for base64 of a 6 MB original would put the
    // whole thing in memory as a string before anything had been resized —
    // which is how a phone runs out of memory choosing eight photographs.
    exif: false,
  });
  if (res.canceled) return [];
  return res.assets.map((a) => ({
    uri: a.uri,
    fileSize: a.fileSize ?? 0,
    fileName: a.fileName ?? undefined,
  }));
}

/** `limit` is how many MORE this garment can take — the server's cap minus
 *  what it already has. Passing it to the picker means the phone's own sheet
 *  stops the owner at the right number, rather than letting them choose
 *  fifteen and refusing five afterwards. */
export function pickImages(limit: number): Promise<Picked[]> {
  if (limit <= 0) return Promise.resolve([]);
  return Platform.OS === 'web' ? pickWeb(limit) : pickNative(limit);
}

/** What to call a picked file on screen before it has been uploaded. */
export function pickedName(p: Picked): string {
  if (typeof File !== 'undefined' && p instanceof File) return p.name;
  const n = p as { uri: string; fileName?: string };
  return n.fileName ?? n.uri.split('/').pop() ?? 'photo';
}
