// The car asset manager's back end. DEVELOPMENT ONLY.
//
// This endpoint writes to a source file in the repository, which is the
// most dangerous thing any route in this project does. Everything below
// exists to make it defensible, and the shape of the argument matters
// more than any single check:
//
//   The WRITER cannot be made to produce arbitrary source. Values are
//   validated to a primitive and re-serialised (scripts/lib/car-source
//   .mjs); nothing a caller sends is spliced into the file as text. That
//   is the property that means a mistake here is a bad car, not a shell.
//
//   The GATES are three, and each is independently sufficient to keep
//   this off a deployed machine:
//
//     1. Not in production. `next build` sets NODE_ENV=production, so a
//        shipped build answers 404 — not 403, because a 403 tells an
//        attacker the route is real and that the box is running the code
//        they hoped it was.
//     2. Explicitly switched on. GRN_CAR_EDITOR=1 has to be in the
//        environment. A developer who has never heard of this cannot be
//        surprised by it running.
//     3. Loopback only. The Host header has to be localhost or 127.0.0.1
//        — so `next dev` bound to 0.0.0.0 on a shared network does not
//        hand the roster to the room.
//
// tests/carsedit.mjs runs all three as an attacker would, and the writer
// as an attacker would, because a security fix nobody tried to break is
// a comment. The hub's own tests set that standard here.
import { NextResponse } from "next/server";
import { carInventory, inventoryGaps } from "../../../../../scripts/lib/car-assets.mjs";
import { EDITABLE, editCar } from "../../../../../scripts/lib/car-source.mjs";
import { editorGate } from "../../../../../scripts/lib/car-editor-gate.mjs";

/** Reads and writes the working tree, so it can never be cached or
 *  statically rendered. */
export const dynamic = "force-dynamic";

/** Why the door is shut, or null if it is open. The reason is for the
 *  server's own log; the caller only ever gets a 404. */
function shut(req: Request): string | null {
  return editorGate({
    nodeEnv: process.env.NODE_ENV,
    flag: process.env.GRN_CAR_EDITOR,
    host: req.headers.get("host"),
  }) as string | null;
}

/** One answer for every refusal: the route does not exist. */
const notHere = () => NextResponse.json({ error: "not found" }, { status: 404 });

export async function GET(req: Request) {
  const why = shut(req);
  if (why) {
    console.warn(`[car editor] refused a GET: ${why}`);
    return notHere();
  }
  try {
    const cars = carInventory();
    return NextResponse.json({
      cars,
      gaps: inventoryGaps(cars),
      // The schema travels with the data so the editor's form is built
      // from the same rules the writer enforces, rather than from a
      // second copy of them that can drift out of agreement.
      editable: EDITABLE,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const why = shut(req);
  if (why) {
    console.warn(`[car editor] refused a PATCH: ${why}`);
    return notHere();
  }
  let body: { id?: unknown; edits?: unknown; dryRun?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "the body is not JSON" }, { status: 400 });
  }
  const id = body.id;
  const edits = body.edits;
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "which car? send an id" }, { status: 400 });
  }
  if (!edits || typeof edits !== "object" || Array.isArray(edits)) {
    return NextResponse.json({ error: "send edits as an object of field: value" }, { status: 400 });
  }
  try {
    const result = editCar(id, edits as Record<string, unknown>, { dryRun: body.dryRun === true });
    // What the change means beyond this file. The roster is the source
    // every port is generated from, so a saved edit leaves four
    // generated artefacts describing a car that no longer exists —
    // which is exactly the drift the sync checks are there to catch.
    // Better to say so at the moment of the edit than to let a contract
    // test find it later and read as a mystery.
    return NextResponse.json({
      ...result,
      source: undefined,
      thenRun: result.changed
        ? ["npm run sync:unity", "npm run sync:unreal", "npm run sync:models"]
        : [],
    });
  } catch (e) {
    // A rejected edit is the caller's mistake, not a server fault: the
    // message is written to be shown to whoever typed the value.
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
}
