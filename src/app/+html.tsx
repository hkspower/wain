import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

const SITE_URL = 'https://sporta.com.kw';
const SITE_NAME = 'Wain?';
const DESCRIPTION =
  'Wain — your guide to the best of Kuwait. Curated landmarks, food, beaches, shopping, culture, and family spots.';

/**
 * Web-only root document for the static export. Wraps every route on
 * sporta.com.kw and injects shared <head> metadata (SEO + social cards).
 * Has no effect on native.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />

        {/* Per-page <title> is set with <Head> in each screen. */}
        <meta name="description" content={DESCRIPTION} />
        <meta name="theme-color" content="#217972" />
        <link rel="canonical" href={SITE_URL} />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={SITE_NAME} />
        <meta property="og:title" content={`${SITE_NAME} — your guide to Kuwait`} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:url" content={SITE_URL} />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={`${SITE_NAME} — your guide to Kuwait`} />
        <meta name="twitter:description" content={DESCRIPTION} />

        {/*
          Disable body scrolling on web so ScrollView components work as
          expected on native. Remove if a global web scroll is preferred.
        */}
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
