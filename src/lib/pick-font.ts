import { Platform } from 'react-native';

/**
 * "Choose a font file" — web only, deliberately.
 *
 * expo-image-picker is the project's only cross-platform file picker and it
 * is IMAGE-ONLY; there is no expo-document-picker dependency here (checked
 * package.json). Rather than add one for a panel screen, this follows
 * pick-images.ts's own web path — a plain hidden <input type="file">, which
 * needs no library and no permission prompt.
 *
 * NATIVE IS NOT BUILT. The owner uploads fonts from the panel in a browser,
 * same as the brand-logo and product-photo uploaders started; a native
 * picker can be added later without touching the server, which validates
 * the bytes rather than trusting where they came from.
 */

export class NotSupported extends Error {
  constructor() {
    super('font upload is web-only');
    this.name = 'NotSupported';
  }
}

export interface PickedFont {
  /** The file name without its extension, as a starting point for the family
   *  name field — never sent to the server as-is. */
  suggestedName: string;
  /** Base64 of the raw bytes, no data: prefix — what admin.ts's uploadFont()
   *  sends, and what admin.php's store_font_mime() checks before storing. */
  base64: string;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.onload = () => {
      // data:<mime>;base64,<data> — only the part after the comma is the
      // payload admin.php's base64_decode() expects.
      const s = String(reader.result ?? '');
      const i = s.indexOf(',');
      resolve(i === -1 ? '' : s.slice(i + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function pickFont(): Promise<PickedFont | null> {
  if (Platform.OS !== 'web') return Promise.reject(new NotSupported());

  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    // The four formats a browser actually loads with @font-face — matching
    // store_font_mime()'s own list, so a rejected file is rejected here
    // too rather than after a wasted upload.
    input.accept = '.woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf';
    input.style.display = 'none';

    let done = false;
    const finish = (v: PickedFont | null) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(v);
    };
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (!f) return finish(null);
      readAsBase64(f)
        .then((base64) => finish({ suggestedName: f.name.replace(/\.[^.]+$/, ''), base64 }))
        .catch(reject);
    });
    input.addEventListener('cancel', () => finish(null));
    window.addEventListener('focus', () => setTimeout(() => finish(null), 500), { once: true });

    document.body.appendChild(input);
    input.click();
  });
}
