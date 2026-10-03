/**
 * «صورة توضيحية» — the mark every generated picture of a landmark carries.
 *
 * A generated picture is a picture OF a place, not a photograph of it, and the
 * site says so wherever one is shown: on the slideshow, on a card and at the
 * top of a place page. The owner picked this style on the 3 October canvas
 * (T1): a solid dark chip with white text, which reads the same over a bright
 * sky and a night scene, and which audit:color can measure — text laid
 * straight on a picture is the one thing it cannot.
 *
 * aria-hidden, because where it appears the picture is decorative (the link
 * beside it already names the place) or its alt already says it in words.
 * Placed by the caller: `className` carries the position.
 */
export default function IllustrativeTag({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-illustrative
      className={`pointer-events-none absolute z-[1] rounded-full bg-ink-900 px-1.5 py-px text-2xs font-semibold whitespace-nowrap text-white ${className}`}
    >
      صورة توضيحية
    </span>
  );
}
