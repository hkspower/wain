# Sporta — Flutter app (iOS + Android)

Native mobile app for the Sporta store: same brand, catalog, cart and KNET
checkout as the website.

## Run
```bash
flutter pub get
flutter run              # device/emulator
flutter build apk        # Android
flutter build ipa        # iOS
```

## Architecture
```
lib/
  main.dart              app + bottom-tab shell (Home · Shop · Bag)
  theme.dart             brand palette, Changa/IBM Plex Arabic fonts
  l10n.dart              bilingual strings (AR/EN, RTL handled by Flutter)
  models/product.dart    Product + CartItem (sizes for apparel)
  services/api.dart      calls the PHP API on Hostinger
  state/app_state.dart   cart, wishlist, language, theme (persisted)
  screens/               home, shop, product, cart, checkout
  widgets/product_card.dart
```

## Backend
Endpoints live at `public_html/knet/api/` (see
`sporta-web/dropin/php-knet/api/index.php`):

| Route | Purpose |
|---|---|
| `GET ?r=products` | catalog from Supabase |
| `POST ?r=order` | creates the order, returns `{track_id, pay_url}` |
| `GET ?r=status&id=` | order payment status |

**Security:** the app never sends prices. The server creates the order and a DB
trigger computes the total from stored product prices, so totals cannot be
tampered with from the client.

**Payment:** checkout is native, but the card step opens the bank's hosted KNET
page — KNET/PCI rules require card entry to stay with the bank. After paying,
the customer returns to the app and the app polls `?r=status`.

## Before shipping
- Set `Api.base` in `lib/services/api.dart` if your domain differs.
- Run `flutter create .` once in this folder to generate the `android/` and
  `ios/` platform projects, then set the bundle id and app icons.
- Add the Sporta logo to `assets/` for the splash/launcher icons.
