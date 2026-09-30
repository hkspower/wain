import * as Haptics from 'expo-haptics';

/**
 * A light tap, fired on every Button and Chip press — asked for as "make
 * button touch feel better" alongside the scale change in press.ts. The two
 * are a pair: scale is what a press LOOKS like, this is what it FEELS like,
 * and a button that only had one of them would still read as flat on a
 * phone holding it.
 *
 * ONE PLACE, so a review of "does this app buzz on every tap" is one file to
 * read rather than a grep across every screen that renders a Pressable.
 *
 * FIRE AND FORGET, DELIBERATELY. impactAsync() resolves once the OS has
 * queued the vibration, not once it has finished, and awaiting it before
 * calling onPress would add a real delay in front of every button in the
 * app for a promise that carries no information back. If the haptics engine
 * throws — an emulator with no vibration motor, a browser that revoked the
 * permission mid-session — that must not be the reason a Save button stops
 * working, so the rejection is swallowed here and nowhere else has to guard
 * against it.
 *
 * LIGHT, NOT MEDIUM. This fires on every button in the app, including ones
 * pressed in a fast sequence (the quantity stepper, a filter chip row) —
 * anything stronger would feel like the phone buzzing at you rather than a
 * response to your finger.
 */
export function tapFeedback(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
