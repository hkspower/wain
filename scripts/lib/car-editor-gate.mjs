// Whether the car editor's door is open, as a pure function.
//
// Three gates, each independently enough to keep an endpoint that writes
// a source file off a deployed machine. Pulled out of the route because
// a gate that can only be tested by standing up a server is a gate that
// gets tested in one configuration and assumed in the other seven —
// there are nine combinations here and all of them are checkable in a
// millisecond.
//
// The route still has to be shown to USE this, which is a different
// claim and needs a real request; tests/carsedit.mjs makes both.

/** Hosts that mean "this machine". Anything else is somebody else's.
 *  127.0.0.1 is in the set for readability; the whole 127/8 block is
 *  loopback and is matched below. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * The host out of a Host header, without its port.
 *
 * Splitting on the first colon is the obvious way to do this and it is
 * wrong: `[::1]:3000` is a legal Host header and the first colon is
 * inside the address, so the obvious version came back with "[" and
 * locked out the one loopback form nobody tests by hand. A v6 literal
 * is bracketed precisely so the port is unambiguous — read the bracket.
 */
function bareHost(host) {
  const h = String(host ?? "").trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end < 0 ? "" : h.slice(1, end);
  }
  // An unbracketed host with several colons is a v6 address written
  // without its brackets. It has no port to strip.
  if (h.indexOf(":") !== h.lastIndexOf(":")) return h;
  return h.split(":")[0];
}

/** True for localhost and for every address in 127/8. */
function isLoopback(bare) {
  if (LOOPBACK.has(bare)) return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare);
}

/**
 * Returns the reason the door is shut, or null if it is open.
 *
 * The reason is for the server's own log. The caller is always told the
 * same thing — that the route does not exist — because a 403 confirms
 * both that the route is real and that the box is running the code
 * somebody was hoping to find.
 */
export function editorGate({ nodeEnv, flag, host }) {
  if (nodeEnv === "production") return "the build is a production build";
  if (flag !== "1") return "GRN_CAR_EDITOR is not set to 1";
  const bare = bareHost(host);
  if (!isLoopback(bare)) return `the request arrived for host "${bare}", which is not loopback`;
  return null;
}
