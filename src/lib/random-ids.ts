/**
 * The random source behind every credential the customer holds: an order's id
 * and track token (orders.ts), and a queue ticket's id and token (queue.ts).
 * Both modules carried a copy of this until now, and the copies had to agree:
 * the `instanceof NoCryptoError` checks that turn a missing random source into
 * «no attempt» only match when there is exactly one NoCryptoError class.
 *
 * Catalogue-free, and imported by those two modules alone.
 */

/**
 * Raised where the browser has no random source. The name is the reason, so a
 * caller can tell this apart from a network failure without reading a message.
 */
export class NoCryptoError extends Error {
  constructor() {
    super("no_crypto");
    this.name = "no_crypto";
  }
}

/**
 * The browser's cryptographic random bytes, or NoCryptoError. There is no
 * Math.random fallback, and that is the rule this module keeps: the token is
 * the customer's only proof of an order or a ticket, and Math.random is not
 * built to resist prediction. The fallback was in orders.ts until the 14
 * October login scan found it. Every browser in scope has getRandomValues, so
 * the branch never ran; a dead fallback with a weak generator behind it is
 * still a weak credential the day a browser lacks the API.
 */
function randomBytes(length: number): Uint8Array {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new NoCryptoError();
  }
  return crypto.getRandomValues(new Uint8Array(length));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A version-4 UUID: the browser's own where it has one, else built from the
 * same random bytes as the token.
 */
export function randomUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Older Safari has getRandomValues but not randomUUID. The id only needs to
  // be unique, not unguessable — that is the token's job — but it is still
  // drawn from the same source as the token.
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 32 hex characters of real randomness. The database requires 20 to 64. */
export function randomToken(): string {
  return hex(randomBytes(16));
}
