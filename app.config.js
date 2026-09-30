/**
 * Layers on top of app.json, which stays the source of truth.
 *
 * WHY: `expo export --platform web` writes ABSOLUTE paths — /_expo/static/…,
 * /shop, /favicon.ico. Uploaded into public_html/app/ those resolve at the
 * domain root, where the storefront lives, and the app loads nothing. Setting
 * experiments.baseUrl makes the export emit /app/_expo/… instead.
 *
 * It is an environment variable rather than a value in app.json because the
 * repo's own tests serve dist at the root; baking a prefix in would break every
 * one of them to suit one packaging step.
 *
 *   SPORTA_BASE_URL=/app npx expo export --platform web --clear
 */
module.exports = ({ config }) => {
  const baseUrl = process.env.SPORTA_BASE_URL;
  if (!baseUrl) return config;
  return { ...config, experiments: { ...config.experiments, baseUrl } };
};
