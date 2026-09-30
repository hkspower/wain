import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

/**
 * Drop a photograph on the page, or paste one — on the web, and only there.
 *
 * WHY. lib/pick-images opens a file dialog, and its own comment says the plain
 * <input type="file" multiple> is what "makes drag-and-drop behave the way a
 * shop owner expects". That is true of an input the browser RENDERS. This one
 * is created in script, clicked, and never attached — so there has never been
 * anywhere on the page to drop a file, and nothing in src/ listened for one.
 * The claim was right about the element and wrong about this use of it.
 *
 * It matters for the job in hand. Forty-six garments need photographing, and
 * the desktop way to do that is a folder open beside the browser: select six,
 * drag them over, repeat. A file dialog per garment is the same work with a
 * modal in front of it.
 *
 * PASTE IS THE OTHER HALF and costs three lines: a photograph copied from
 * Preview, Photos, a message, or cropped in any editor arrives on the
 * clipboard, and Ctrl/Cmd-V is where a person's hand already is.
 *
 * WEB ONLY, and it returns immediately on native rather than pretending. There
 * is no drag-and-drop on a phone and no clipboard image event in React Native;
 * the native path is expo-image-picker, which pick-images already handles.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not filter by MIME type. The same
 * reasoning as pick-images' `accept="image/*"`: what may be dropped is
 * whatever the BROWSER can decode, not what the server stores, and
 * shrinkImage() re-encodes the pixels anyway. A dropped PDF fails one step
 * later with a sentence that says so, which is better than a drop that appears
 * to do nothing.
 */

interface Options {
  /** Called with everything dropped or pasted. Already capped to `limit`. */
  onFiles: (files: File[]) => void;
  /** How many MORE the garment can take. A drop of ten with room for three
   *  takes the first three rather than being refused whole — the owner
   *  selected a folder, they did not count it. */
  limit: number;
  /** Off while uploading, and while no garment is chosen. A file dropped with
   *  nowhere to put it is worse than one that bounces. */
  enabled: boolean;
}

export function useImageDrop({ onFiles, limit, enabled }: Options) {
  /** The listeners are attached once and read the CURRENT values through this,
   *  so a drop during an upload sees `enabled: false` rather than the value
   *  captured when the screen first rendered. */
  const live = useRef({ onFiles, limit, enabled });
  live.current = { onFiles, limit, enabled };

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const take = (files: File[]) => {
      const { onFiles: cb, limit: max, enabled: on } = live.current;
      if (!on || max <= 0 || !files.length) return;
      cb(files.slice(0, max));
    };

    /* EVERY dragover must be prevented, not just the ones over the drop zone.
       The browser's default for a dropped file is to NAVIGATE TO IT — the page
       is replaced by the photograph, and any queue not yet uploaded is gone.
       Preventing it only over a target leaves the rest of the window armed
       with that, which is a worse trap than having no drag-and-drop at all. */
    const over = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = live.current.enabled ? 'copy' : 'none';
    };

    const drop = (e: DragEvent) => {
      e.preventDefault();
      const dt = e.dataTransfer;
      if (!dt) return;
      /* items, not files, when it is there: a drag from another BROWSER TAB
         carries no File at all, and reading .files gives an empty list that
         looks exactly like a cancelled drag. */
      const files = dt.items
        ? [...dt.items].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean) as File[]
        : [...dt.files];
      take(files);
    };

    const paste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files = [...items]
        .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
        .map((i) => i.getAsFile())
        .filter(Boolean) as File[];
      /* Only swallow the paste when there WAS an image on the clipboard.
         Otherwise Ctrl-V in the SKU search box would stop working, which is a
         strange thing to break while adding a convenience. */
      if (!files.length) return;
      e.preventDefault();
      take(files);
    };

    document.addEventListener('dragover', over);
    document.addEventListener('drop', drop);
    document.addEventListener('paste', paste);
    return () => {
      document.removeEventListener('dragover', over);
      document.removeEventListener('drop', drop);
      document.removeEventListener('paste', paste);
    };
  }, []);
}
