# Reference stills

```bash
npm run dev                    # in one shell
npm run shots                  # in another
npm run shots -- night noon    # just those
npm run shots -- --w 3840      # at 4K
```

Eight images: `menu`, `night`, `dawn`, `noon`, `dusk`, `coast`, `city`,
`drift`.

These are test images in the useful sense — every one is a **known
state**, not a lucky frame. The hour, the position on the lap and the
quality tier are pinned, traffic and the rival are parked half a lap
away, and the car is stopped. That last one matters more than it looks:
the camera carries a speed-scaled rumble, so a still taken at road speed
is framed slightly differently every run and two captures cannot be
compared. Each shot is also staged twice, because one pass still carries
the previous shot's state — the same lesson the grading test learned.

So a change can be checked by re-running this and flicking between the
old file and the new one. Nothing else in the suite answers "does it
still *look* right".

## What the first capture found

`noon.png` is not noon. At 12:30 the sky is dusk-blue, the street lamps
are still glowing, the car's headlights are washing the road, and the
city towers are black silhouettes with lit windows — at midday.

The towers are `MeshStandardMaterial` with a window texture whose facade
is authored dark for night use, so sunlight has nothing to lift: a dark
albedo stays dark however bright the key light gets. The lamps and
headlights are a separate question — the photocell reports them off at
noon while they are visibly on.

Both are open. The images are the evidence.
