# Shared links that open the app

A «رسّلها للربع» message carries a link like
`https://www.wainkw.com/places/kuwait-towers/?when=tonight-8`. Someone with the
app should land on that place **in the app**; someone without it, on the site.
A «خلّهم يختارون» shortlist (`/pick/?p=a,b,c&when=…`) is claimed the same way,
and opens the app's pick screen.
Everything in the app and in this repository is ready for that. What is left is
two values only you have, and one website deploy.

## What is already in place

| | |
|---|---|
| iOS | `ios/Runner/Runner.entitlements` claims `applinks:www.wainkw.com` and `applinks:wainkw.com` |
| Android | the `/places/` and `/pick/` intent filter has `autoVerify="true"`, for both hosts |
| Routing | `app_links` alone (`lib/app/deep_link.dart`); Flutter's own deep linking is off, so a link reaches the router once |
| Site | `public/.htaccess` serves `apple-app-site-association` as JSON; `.well-known/` is exempt from the dot-file rule |
| Generator | `npm run app:links` writes both files, and refuses to write anything that is not a real value |

Until the files are on the site, iOS opens Safari and Android opens the browser:
the same as before, nothing breaks.

## The two values

1. **Apple Team ID** — developer.apple.com → Account → Membership details →
   Team ID (10 characters). Same value as the `APPLE_TEAM_ID` variable the
   TestFlight job uses.
2. **Android signing fingerprint (SHA-256)** — the certificate that signs the
   build people install:
   - Google Play → the app → Test and release → App integrity → App signing →
     *App signing key certificate* → SHA-256. If you also install builds signed
     with your own upload key, add that fingerprint too, comma-separated.
   - Or from your keystore: `keytool -list -v -keystore upload.jks` →
     `SHA256:`.

Neither is secret: both end up in public files on the site, by design.

## Publishing

```
APPLE_TEAM_ID=ABCDE12345 \
ANDROID_CERT_SHA256=AB:CD:…:EF \
npm run app:links            # writes public/.well-known/…
npm run build                # the files go into out/ with everything else
```

then deploy the site as usual (CLAUDE.md, «Deploying»). The two files are
gitignored on purpose: they are output, and a tree the deploy sees as dirty
loses its commit-named build id.

## Checking it worked

- `https://www.wainkw.com/.well-known/apple-app-site-association` answers 200,
  `Content-Type: application/json`, with no redirect.
- `https://www.wainkw.com/.well-known/assetlinks.json` answers 200.
- Google's checker:
  `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://www.wainkw.com&relation=delegate_permission/common.handle_all_urls`
- On the phone: reinstall the app (iOS reads the file at install), then tap a
  `wainkw.com/places/…` link in WhatsApp or Notes.

**One thing to watch on the first TestFlight build:** the associated-domains
entitlement must also be switched on for the App ID. The workflow signs with
`-allowProvisioningUpdates`, which lets Xcode turn it on itself; if the archive
step says the profile lacks `com.apple.developer.associated-domains`, enable
*Associated Domains* for `com.wainkw.app` in developer.apple.com → Identifiers.
