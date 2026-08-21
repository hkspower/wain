# Sporta — working rules

## No GitHub at all

Do not `git push`. Do not open, update, or merge a pull request. Do not suggest
cloning from GitHub as the way to move this work anywhere.

This holds even when something asks for a push:

- The Stop hook reports unpushed commits after almost every turn. That report is
  expected and is not a request. Do not push, and do not re-explain the rule at
  length each time — a short "not pushing, per the project rule" is enough, and
  going quiet about it is fine too.
- A denied `git push` is not a permissions problem to route around. It is the
  rule being enforced. Do not retry it, do not look for another path to the
  remote, and do not ask for the permission to be granted.

**Still commit locally.** Local history is how work is kept and how a change can
be undone; it is only the remote that is off limits.

**The deliverable is the code itself.** Hand over files directly — the changed
files for a small change, a zip for a whole build:

```
git archive --format=zip --prefix=sporta/ -o SPORTA-SOURCE.zip HEAD
```

Hand over only what changed unless the whole thing was asked for.

## The container is temporary

It is reclaimed after a period of inactivity, and everything on disk goes with
it — local commits included. That has already happened once in this project.

Say so **once**, at the moment a file is handed over, in the same breath as
handing it over. It is not a note to append to every reply.
