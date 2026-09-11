"use client";

// The car asset manager. Development only — see the route it talks to.
//
// One screen that answers the two questions the roster could not answer
// before: what is this car, and does it have everything a car needs. The
// sixteen cars sit on the left with their assets summarised; the one you
// pick opens on the right with its record, its pictures, and the fields
// you are allowed to change.
//
// The form is built from the schema the SERVER sends, not from a list
// written here. That is the whole reason the endpoint returns `editable`
// alongside the data: a field the writer will refuse must not be
// offered, and a second copy of the rules in this file would drift out
// of agreement with the first the day anybody widened a range.

import { useCallback, useEffect, useState } from "react";

type Spec =
  | { kind: "string"; max: number }
  | { kind: "int" | "number"; min: number; max: number }
  | { kind: "enum"; of: string[] }
  | { kind: "hex" };

type Asset = { path: string; present: boolean; kb?: number };
type Car = {
  id: string;
  fields: Record<string, string | number | boolean>;
  silhouette: string;
  silhouetteShared: number;
  assets: { shop: Asset; press: Asset; pressRear: Asset; shell: Asset & { authored: boolean; tris: number | null } };
};
type Payload = { cars: Car[]; gaps: string[]; editable: Record<string, Spec> };

const money = (n: number) => n.toLocaleString("en-US");

/** A file the page can actually show: public/ is served, press/ is not. */
function servedUrl(path: string): string | null {
  return path.startsWith("public/") ? path.slice("public".length) : null;
}

export default function CarManager() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch("/api/dev/cars", { cache: "no-store" });
      if (r.status === 404) {
        setError(
          "The editor is switched off. It runs only outside a production build, " +
            "only with GRN_CAR_EDITOR=1 in the environment, and only over localhost."
        );
        return;
      }
      if (!r.ok) throw new Error(`the server answered ${r.status}`);
      const j: Payload = await r.json();
      setData(j);
      setPick((p) => p ?? j.cars[0]?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const car = data?.cars.find((c) => c.id === pick) ?? null;

  // The draft is cleared when the selection changes: a half-typed price
  // carried onto the next car is a way to edit the wrong one.
  useEffect(() => {
    setDraft({});
    setSaid(null);
  }, [pick]);

  async function save() {
    if (!car || !Object.keys(draft).length) return;
    setSaving(true);
    setSaid(null);
    try {
      const r = await fetch("/api/dev/cars", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: car.id, edits: draft }),
      });
      const j = await r.json();
      if (!r.ok) {
        setSaid(j.error ?? `the server answered ${r.status}`);
        return;
      }
      const changed = Object.keys(j.after ?? {});
      setSaid(
        changed.length
          ? `Saved ${changed.join(", ")}. Now run: ${(j.thenRun ?? []).join(", ")}`
          : "Nothing to change."
      );
      setDraft({});
      await load();
    } catch (e) {
      setSaid((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <main className="mx-auto max-w-2xl p-8 font-sans text-sm leading-relaxed">
        <h1 className="mb-3 text-xl font-bold">Car asset manager</h1>
        <p className="rounded border border-amber-500/40 bg-amber-500/10 p-4">{error}</p>
        <p className="mt-4 opacity-70">
          To open it: <code className="rounded bg-black/30 px-1">GRN_CAR_EDITOR=1 npm run dev</code>, then
          visit this page on localhost.
        </p>
      </main>
    );
  }
  if (!data) return <main className="p-8 font-sans text-sm">Reading the roster…</main>;

  return (
    <main className="mx-auto grid max-w-6xl gap-6 p-6 font-sans text-sm md:grid-cols-[22rem_1fr]">
      <div>
        <h1 className="mb-1 text-xl font-bold">Car asset manager</h1>
        <p className="mb-4 opacity-70">
          {data.cars.length} cars, read from <code>src/game/mods.ts</code>. Edits are written back to it.
        </p>

        {data.gaps.length > 0 && (
          <div className="mb-4 rounded border border-amber-500/40 bg-amber-500/10 p-3">
            <div className="mb-1 font-semibold">Assets to know about</div>
            <ul className="list-disc pl-5 opacity-90">
              {data.gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </div>
        )}

        <ul className="space-y-1">
          {data.cars.map((c) => {
            const missing = [c.assets.shop, c.assets.press].filter((a) => !a.present).length;
            return (
              <li key={c.id}>
                <button
                  onClick={() => setPick(c.id)}
                  className={`flex w-full items-center justify-between rounded border px-3 py-2 text-left ${
                    c.id === pick ? "border-sky-400/70 bg-sky-400/10" : "border-white/10 hover:bg-white/5"
                  }`}
                >
                  <span>
                    <span className="font-semibold">{String(c.fields.name)}</span>
                    <span className="ml-2 opacity-60">{c.silhouette}</span>
                  </span>
                  <span className="tabular-nums opacity-70">
                    {c.fields.price === 0 ? "free" : `${money(Number(c.fields.price))} KD`}
                    {missing > 0 && <span className="ml-2 text-amber-400">{missing} missing</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {car && (
        <div>
          <h2 className="text-lg font-bold">
            {String(car.fields.name)} <span className="opacity-60">{String(car.fields.ar)}</span>
          </h2>
          <p className="mb-4 opacity-60">
            <code>{car.id}</code> · {car.silhouette} silhouette, shared with{" "}
            {car.silhouetteShared - 1} other car{car.silhouetteShared === 2 ? "" : "s"}
          </p>

          <section className="mb-6">
            <h3 className="mb-2 font-semibold">Assets</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  ["Shop image", car.assets.shop],
                  ["Press render", car.assets.press],
                  ["Press, rear", car.assets.pressRear],
                  ["Shell", car.assets.shell],
                ] as const
              ).map(([label, a]) => {
                const url = servedUrl(a.path);
                return (
                  <div key={label} className="rounded border border-white/10 p-2">
                    <div className="mb-1 font-medium">{label}</div>
                    {url && a.present && /\.(webp|png|jpg)$/.test(url) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt={label} className="mb-1 w-full rounded bg-black/30" />
                    ) : null}
                    <div className={a.present ? "opacity-70" : "text-amber-400"}>
                      {a.present ? `${a.kb} kB` : "not present"}
                    </div>
                    {"tris" in a && a.tris ? (
                      <div className="opacity-60">{a.tris.toLocaleString()} tris</div>
                    ) : null}
                    <div className="mt-1 break-all text-2xs opacity-50">{a.path}</div>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="mb-2 font-semibold">Record</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(data.editable).map(([key, spec]) => {
                if (!(key in car.fields)) return null;
                const current = car.fields[key];
                const shown = draft[key] ?? (spec.kind === "hex"
                  ? `#${Number(current).toString(16).padStart(6, "0")}`
                  : String(current));
                return (
                  <label key={key} className="flex flex-col gap-1">
                    <span className="opacity-70">
                      {key}
                      {spec.kind === "int" || spec.kind === "number" ? (
                        <span className="ml-1 opacity-50">
                          ({spec.min}–{spec.max})
                        </span>
                      ) : null}
                    </span>
                    {spec.kind === "enum" ? (
                      <select
                        value={shown}
                        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                        className="rounded border border-white/15 bg-black/30 px-2 py-1"
                      >
                        {spec.of.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={shown}
                        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                        className={`rounded border px-2 py-1 tabular-nums ${
                          key in draft ? "border-sky-400/70 bg-sky-400/10" : "border-white/15 bg-black/30"
                        }`}
                      />
                    )}
                  </label>
                );
              })}
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={() => void save()}
                disabled={saving || !Object.keys(draft).length}
                className="rounded bg-sky-500 px-4 py-2 font-semibold text-black disabled:opacity-40"
              >
                {saving ? "Saving…" : `Save ${Object.keys(draft).length || ""} change${Object.keys(draft).length === 1 ? "" : "s"}`}
              </button>
              {Object.keys(draft).length > 0 && (
                <button onClick={() => setDraft({})} className="opacity-70 underline">
                  discard
                </button>
              )}
              {said && <span className="opacity-80">{said}</span>}
            </div>
            <p className="mt-3 opacity-60">
              Writing here changes the file every port is generated from, so a saved edit leaves the
              Unity data, the Unreal header and the Blender profiles describing a car that no longer
              exists. The reply says which sync to run.
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
