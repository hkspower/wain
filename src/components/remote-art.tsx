import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * A picture from the shop, over a ground that is always there.
 *
 * THE PROBLEM THIS REPLACES: every category and every product was an emoji on a
 * flat colour. Emoji are not artwork — they are a different typeface on each
 * platform (Apple's, Noto on Android and web), they cannot be art-directed, and
 * a shop whose entire catalogue is rendered in them looks like a wireframe
 * somebody shipped. expo-image was already a dependency and was not used once.
 *
 * FOUR LAYERS, best available wins, stacked bottom to top:
 *
 *   1. The ground colour, always. It stops a white flash while anything above
 *      decodes, and it is the last thing standing if all else is missing.
 *   2. The emoji, when there is no picture of any kind.
 *   3. The BUNDLED photograph, shipped inside the app. It paints on the first
 *      frame, with no network at all — which is why the tiles are never empty
 *      on a lift or in a basement gym.
 *   4. The photograph from the server, faded in over the top when it arrives.
 *      Uploading to /cats/ still changes the app with no release; failing to
 *      reach it now costs nothing, because layer 3 is already there.
 *
 * The remote layer sits ON TOP rather than replacing the bundled one, so there
 * is no gap and no flicker between them — the bundled art is visible from the
 * first frame and is quietly upgraded, or it simply stays.
 *
 * The layout NEVER depends on the image. The tile's height is set by its
 * content and the picture is absolutely positioned inside it, so an image that
 * arrives late, slowly, or not at all cannot move anything on the page.
 */
export function RemoteArt({
  uri,
  bundled,
  ground,
  emoji,
  emojiSize = 40,
  /** Which side of the frame the subject stands on, so the crop keeps it. */
  focus = 'center',
  style,
  children,
}: {
  /** The photograph on the server. Undefined when the shop has none — the
   *  remote layer is then not rendered at all, rather than requesting a URL
   *  nobody expects to answer. */
  uri?: string;
  /** A `require`d image that ships with the app; painted under the remote one. */
  bundled?: number;
  ground: string;
  emoji?: string;
  emojiSize?: number;
  focus?: 'start' | 'center' | 'end';
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  // `failed` is one-way on purpose. expo-image retries internally; re-showing
  // the image element after an error would let a flaky connection flicker
  // between the photograph and the emoji, which is worse than either.
  const [failed, setFailed] = useState(false);

  return (
    <View style={[{ backgroundColor: ground }, style]}>
      {bundled !== undefined && (
        <Image
          source={bundled}
          accessible={false}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          contentPosition={
            focus === 'center' ? 'center' : focus === 'end' ? 'right center' : 'left center'
          }
        />
      )}
      {uri && !failed && (
        <Image
          source={{ uri }}
          // Decorative: the tile's own Pressable already carries the category
          // name, and a screen reader that reads both says everything twice.
          accessible={false}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          contentPosition={
            focus === 'center' ? 'center' : focus === 'end' ? 'right center' : 'left center'
          }
          transition={220}
          cachePolicy="memory-disk"
          onError={() => setFailed(true)}
        />
      )}
      {/* No picture at all: none on the server, or the one there refused to
          load, and nothing bundled underneath. `!uri` counts the same as a
          failure — a product the shop has no photograph of should show its
          emoji immediately rather than waiting for a request that is never
          made. */}
      {(failed || !uri) && bundled === undefined && emoji ? (
        <View style={styles.emojiWrap} pointerEvents="none">
          <Text style={{ fontSize: emojiSize }}>{emoji}</Text>
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  emojiWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
