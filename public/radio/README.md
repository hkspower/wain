# Car radio stations

`stations.json` is the tuner's station list. The game reads it at start
and adds every entry that has a `url` to the dash, after its own
built-in station.

## Why the URLs are empty

These are Kuwait's real public radio services, and their names ship with
the game. Their streams do not.

Carrying a broadcaster's live stream inside a game is a rights question,
and it belongs to whoever ships the build rather than to the code: the
terms differ per service, and permission is something a person obtains,
not something a program can assume. So the list arrives named and
unwired. Put in the streams you have the right to carry and each one
appears on the dash.

## Filling it in

```json
{ "id": "kw-general",
  "name": "Radio Kuwait · General",
  "ar": "إذاعة الكويت · البرنامج العام",
  "url": "https://example.invalid/stream" }
```

An entry with no `url`, or an empty one, is skipped — it is a name
waiting for a stream, and tuning onto a silent station is worse than not
listing it.

## CORS, and why a station might not duck

Audio can only reach the game's mix through WebAudio, and WebAudio can
only read a cross-origin stream if the server sends
`Access-Control-Allow-Origin`. Most radio streams do not.

Each station is tried with CORS first. If that works the stream lands
inside the mix: it ducks under a voice line and passes through the
master limiter with everything else. If it fails, the stream is played
as a plain audio element instead — audible, but outside the mix, so it
ducks in a step rather than a ramp and the limiter never sees it.

`radio.current().mode` reports which happened: `mixed`, `direct`, or
`synth` for the built-in station. If a stream sounds like it is fighting
the rest of the game, that field is the first thing to look at.

## Offline

The first station is always the game's own synthesised music, which
needs no network. This ships as an offline Electron/Steam build, and a
radio that went silent without a connection would be a dead control on
the dash for anyone playing on a plane.
