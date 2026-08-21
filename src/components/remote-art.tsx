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
 * THREE LAYERS, best available wins, and they are stacked in this order:
 *
 *   1. The photograph, if the server has one. Fetched at runtime, so uploading
 *      /cats/art-men.jpg upgrades the app with no release; deleting it falls
 *      back cleanly.
 *   2. The emoji, which is what the tile has always shown. Not deleted — it is
 *      the honest offline state, and this app is built to work with no signal.
 *   3. The ground colour, underneath both at all times. It is what stops a
 *      white flash while the image decodes, and it is the last thing standing
 *      if everything else is missing.
 *
 * The layout NEVER depends on the image. The tile's height is set by its
 * content and the picture is absolutely positioned inside it, so an image that
 * arrives late, slowly, or not at all cannot move anything on the page.
 */
export function RemoteArt({
  uri,
  ground,
  emoji,
  emojiSize = 40,
  /** Which side of the frame the subject stands on, so the crop keeps it. */
  focus = 'center',
  style,
  children,
}: {
  uri: string;
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
      {!failed && (
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
      {failed && emoji ? (
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
