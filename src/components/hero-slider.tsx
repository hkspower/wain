import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';

import { RemoteArt } from '@/components/remote-art';
import { press } from '@/components/ui/press';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { heroArt } from '@/lib/assets';
import { HERO_ASPECT, HERO_BANNERS } from '@/lib/hero-art';
import { useLang } from '@/lib/i18n';

const EVERY_MS = 6500;

/**
 * The shop's own banners, one at a time, tapping through to the shop.
 *
 * It replaces a charcoal panel carrying the app's own headline and a Shop now
 * button. The banners already have a headline — set into the photograph, in
 * both languages, with the Sporta mark — so the panel's copy would have been a
 * second one over the first.
 *
 * 6500 ms is the website's own slider interval, not a number picked here.
 *
 * NO SWIPE, deliberately. The band is 156pt tall on a phone and sits at the top
 * of a page that scrolls vertically; a horizontal gesture inside it competes
 * with the scroll and loses often enough to feel broken. The dots say how many
 * there are and a tap goes to the shop, which is the only thing a customer
 * wants from a banner.
 */
export function HeroSlider() {
  const router = useRouter();
  const theme = useTheme();
  const { lang } = useLang();
  const [index, setIndex] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // A banner that changes on its own is motion, and some people have asked
  // their phone to stop doing that. Asked once, and honoured for the session:
  // the alternative is a carousel that ignores an accessibility setting on the
  // one screen everybody lands on.
  const [animate, setAnimate] = useState(true);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => alive && setAnimate(!reduced))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (reduced) =>
      setAnimate(!reduced),
    );
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!animate || HERO_BANNERS.length < 2) return;
    timer.current = setInterval(
      () => setIndex((i) => (i + 1) % HERO_BANNERS.length),
      EVERY_MS,
    );
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [animate]);

  const banner = HERO_BANNERS[index];
  const label = lang === 'ar' ? banner.ar : banner.en;

  const show = useCallback((i: number) => {
    // Tapping a dot stops the rotation. Somebody who has chosen a frame is
    // reading it, and moving it out from under them is the carousel's oldest
    // insult.
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setIndex(i);
  }, []);

  return (
    <View>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={label}
        onPress={() => router.push('/shop')}
        style={press(true)}>
        <RemoteArt
          uri={heroArt(banner.id)}
          bundled={banner.bundled}
          ground={theme.inkSilver}
          style={styles.band}
        />
      </Pressable>

      {/* The dots are BOTH the position and the control. Sized to the 44pt a
          finger needs even though the mark itself is 8pt — the hit area is
          padding, not a bigger dot. */}
      {HERO_BANNERS.length > 1 ? (
        <View style={styles.dots}>
          {HERO_BANNERS.map((b, i) => (
            <Pressable
              key={b.id}
              accessibilityRole="button"
              accessibilityLabel={lang === 'ar' ? b.ar : b.en}
              // `selected` is not valid aria on a button, so the web build
              // dropped it and every dot announced identically — a screen
              // reader could not tell which frame was showing. `pressed` is
              // the attribute for a button that is on; `selected` stays for
              // native, which reads it directly.
              accessibilityState={{ selected: i === index }}
              aria-pressed={i === index}
              onPress={() => show(i)}
              style={press(true, styles.dotHit)}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: i === index ? theme.tint : theme.border },
                ]}
              />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    width: '100%',
    // The artwork's own proportions. A band shorter than this crops the
    // headline out of the picture it is set into.
    aspectRatio: HERO_ASPECT,
    borderRadius: Radius.card,
    overflow: 'hidden',
  },
  dots: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
  },
  dotHit: {
    minHeight: 44,
    minWidth: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: Spacing.two,
    height: Spacing.two,
    borderRadius: 999,
  },
});
