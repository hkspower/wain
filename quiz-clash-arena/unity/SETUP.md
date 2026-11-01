# Quiz Clash Arena: Unity version

The scripts here were written without a Unity Editor, so **none of it has been compiled or run yet**. Expect to fix a small error or two on the first build.

Run these on the machine that has Unity. They follow the Unity CLI's "bootstrap a new project" recipe.

## 1. Create the project

```bash
unity --version
unity auth status --format json      # if signed out: unity auth login
unity license status --format json   # if none active: unity license activate
```

Install the Editor with the build targets you need. Check the exact module names for your Editor first:

```bash
unity modules --help
unity install lts --module webgl --module linux-il2cpp --yes --accept-eula
unity templates list --editor lts --format json
```

Create the project from the 2D template (use the id that `templates list` printed):

```bash
unity projects create "QuizClashArena" --path ~/UnityProjects \
  --editor-version lts --template com.unity.template.2d
```

## 2. Add the scripts

Copy this folder's `Assets/Scripts` into the new project's `Assets/`:

```bash
cp -r Assets/Scripts ~/UnityProjects/QuizClashArena/Assets/
```

There is nothing to wire up. `QuizClashArena.cs` starts itself in any scene and builds its own screen. Open the project with `unity open ~/UnityProjects/QuizClashArena` and press Play to test.

## 3. Build for the VPS

A game window can't be shown on a headless Linux server, so the build that works on the VPS is **WebGL**, served by nginx:

```bash
unity build ~/UnityProjects/QuizClashArena --editor-version lts \
  --target WebGL --execute-method Builder.BuildWebGL --allow-install
```

The output is `Builds/WebGL/`. Upload that folder to the VPS and serve it with the same nginx idea as `../deploy/docker-compose.yml`, mounting the folder instead of `index.html`. Unity WebGL builds use compressed files, so nginx must send the right headers. Easiest fix: in Player Settings, set WebGL Compression Format to **Disabled** before building.

A native Linux desktop build is also set up (`--target StandaloneLinux64 --execute-method Builder.BuildLinux`), but it is only useful for a Linux desktop, not the VPS.

## Known gaps

- **Arabic is not shaped.** Unity's built-in text draws Arabic letters unjoined and in the wrong order. The game starts in English. Before using the Arabic button for real, add an Arabic shaping package for TextMeshPro and call it from `Shape()` in `QuizClashArena.cs`.
- **No emoji, sound or animation.** The built-in font can't draw emoji, so I used plain words. The web version has beeps and a shake effect that this one doesn't.
- **Untested.** See the note at the top.
