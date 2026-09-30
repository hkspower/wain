/* Sporta — make the Track button say something when the box is empty.
 *
 * ---------------------------------------------------------------- THE DEFECT
 *
 * /track has one field and one button. Press the button with the field empty
 * and NOTHING happens: no message, no hint, no outline. Measured, not guessed
 * — the button rig pressed it and recorded no navigation, no DOM change, no
 * request, no geometry, no stored state.
 *
 * The button is not broken. Give it an order number and it looks the order up
 * correctly. What is missing is the refusal: the input carries no `required`,
 * so the browser has nothing to say either, and the page simply sits there
 * while the customer presses it again.
 *
 * That is the worst shape a form can fail in. A visible error is a thing to
 * read; silence is a thing to blame yourself for, and the customer's next move
 * is WhatsApp or nothing.
 *
 * --------------------------------------------------------- WHY A SCRIPT, HERE
 *
 * The storefront is a built React bundle whose source is not in this
 * repository, so the field cannot be given `required` where it is written.
 * This is the same answer contact.js and returns-link.js reached, and it is
 * the pattern this shop already uses: DOM surgery, loaded from index.html,
 * reverted by deleting one <script> tag.
 *
 * IT ADDS THE ATTRIBUTE RATHER THAN INTERCEPTING THE SUBMIT. `required` is
 * what the browser already knows how to enforce — it blocks the submit, moves
 * focus to the field, scrolls it into view and paints its own bubble, in the
 * visitor's own language, on every browser, with no JavaScript of ours in the
 * path when it matters. Handling the submit ourselves would mean
 * reimplementing all of that and getting between the customer and a working
 * button. The only thing added on top is the message text, because the
 * browser's default says "fill out this field" and this shop can say what the
 * field is.
 *
 * ------------------------------------------------------------------ FRAGILITY
 *
 * Same class of thing as contact.js, same failure mode, and it is scoped
 * tightly on purpose:
 *
 *   - only on /track, so no other form in the shop is touched;
 *   - only a form whose control is a single text input, so if the page is
 *     rebuilt with a different shape this finds nothing and does nothing;
 *   - it never blocks a submit that the browser would have allowed.
 *
 * If the storefront is rebuilt, check that /track still has one text input in
 * one form. If it does not, this stops applying and the page is exactly as it
 * was — which is the failure mode to want.
 */
(function () {
  'use strict';

  // THE PATH IS CHECKED ON EVERY RUN, not once at load. This is a single-page
  // app: arriving at /track from the header link is a route change, not a
  // page load, so a script that only looked at location once would apply on a
  // hard refresh and never on the way a customer actually gets there.
  var PATH = /^\/track\/?$/;

  var MSG = {
    ar: 'اكتب رقم الطلب أولًا — يبدأ بـ SP.',
    en: 'Enter your order number first — it starts with SP.'
  };

  function lang() {
    return (document.documentElement.getAttribute('lang') || 'ar')
      .slice(0, 2).toLowerCase() === 'en' ? 'en' : 'ar';
  }

  function apply() {
    if (!PATH.test(location.pathname)) return;

    var forms = document.querySelectorAll('form');
    for (var i = 0; i < forms.length; i++) {
      var form = forms[i];
      var inputs = form.querySelectorAll('input');
      // ONE text input, or leave it alone. A form with two fields is not the
      // one this was written for, and guessing which of them is the order
      // number is how a script starts breaking pages it was never aimed at.
      if (inputs.length !== 1) continue;
      var input = inputs[0];
      if (input.type !== 'text' && input.type !== 'search') continue;
      if (input.dataset.sportaGuarded === '1') continue;

      input.dataset.sportaGuarded = '1';
      input.required = true;

      // WHITESPACE IS NOT AN ORDER NUMBER, and `required` alone accepts it —
      // a space satisfies the attribute and the form submits with nothing in
      // it, which is the original bug wearing a hat. The pattern demands at
      // least one non-space character; the browser enforces it in the same
      // breath as required, with the same bubble.
      if (!input.getAttribute('pattern')) {
        input.setAttribute('pattern', '.*\\S.*');
      }

      // The browser's own wording is "Please fill out this field", which is
      // true and says nothing about WHAT field. Replaced with the shop's, in
      // the shop's language — and cleared on every keystroke, because a
      // custom validity message that is never cleared makes the field
      // permanently invalid and the form permanently unsubmittable. That is a
      // far worse bug than the one being fixed, and it is the usual way this
      // API is got wrong.
      var say = function () {
        input.setCustomValidity(input.validity.valueMissing ||
                                input.validity.patternMismatch ? MSG[lang()] : '');
      };
      input.addEventListener('invalid', say);
      input.addEventListener('input', function () { input.setCustomValidity(''); });
    }
  }

  var run = function () { try { apply(); } catch (e) { /* never break the page */ } };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }

  // The app renders after this file runs and re-renders on every route change,
  // so the form does not exist yet the first time and is replaced wholesale
  // afterwards. A MutationObserver is how the other override scripts follow
  // that, and it is why the guarded flag above is stored on the element: a new
  // input is a new element and gets the attribute again, while the existing
  // one is not re-processed on every unrelated DOM change in the shop.
  if (window.MutationObserver) {
    new MutationObserver(run).observe(document.documentElement, {
      childList: true, subtree: true
    });
  }
})();
