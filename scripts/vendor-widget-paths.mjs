/**
 * Where scripts/vendor-widget.mjs writes the call widget, relative to public/.
 *
 * Kept apart from the script so `audit:shouq-call` can hold it against the
 * URLs src/lib/wain-ai.ts actually loads: the two are written in different
 * languages for different runtimes, and a path that drifts between them is a
 * 404 on the one request a call cannot survive.
 *
 * The version in each directory name is load-bearing — see vendor-widget.mjs.
 */
export const WIDGET_DIR = "convai-widget-embed-0.20.0";
export const SAMPLERATE_DIR = "libsamplerate-js-2.1.2";

export const VENDOR_FILES = {
  widget: `vendor/${WIDGET_DIR}/index.js`,
  rawAudioProcessor: `vendor/${WIDGET_DIR}/raw-audio-processor.js`,
  audioConcatProcessor: `vendor/${WIDGET_DIR}/audio-concat-processor.js`,
  libsamplerate: `vendor/${SAMPLERATE_DIR}/libsamplerate.worklet.js`,
};
