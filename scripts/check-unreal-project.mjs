#!/usr/bin/env node
// The Unreal project, checked as text — no engine, no server, no GPU.
//
//   node scripts/check-unreal-project.mjs
//
// WHY THIS IS ITS OWN CHECK
//
// check:unreal and check:connector both start by fetching the live API,
// and exit before checking anything when there is no server. Everything
// here is a property of the files alone, so it runs anywhere — on this
// Linux box, in CI, on a Mac before the engine is even installed.
//
// And this repository cannot compile the port. Its README says so, and
// says what that has cost: a project that did not build while every check
// stayed green, and five constants generated and verified for months that
// the solver never read. A compiler is not available here; what IS
// available is that most of the ways a UE project fails to build are
// visible in plain text — two targets that disagree about the engine, an
// editor module that leaks into the game target, a header nobody
// included, a module nobody depended on, an ini key in a section that
// does not exist. Those are checked. What is left — whether a 5.8 header
// still declares a member by the name used — needs the editor, and the
// README's "not compiled here" note says so rather than this file
// pretending otherwise.
//
// THE PAINT
//
// The second half checks the car paint against the web build that
// measured it: the finishes and base roughness against mods.ts and
// cars.ts, the per-car factory finish against mods.ts, the declared solid
// paints against paints.ts — and the metalness LAW not by its constants
// but by running it. GRNPaintLaw.h is engine-free, so a bare g++ compiles
// it, and its answers are compared with the web's own paintMetalness on
// every paint, car and rival colour plus a sweep. Without g++ that one
// step is reported as skipped, not passed.

import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const UPROJECT = "unreal/GulfRoadNights.uproject";
const SOURCE = "unreal/Source";
const RUNTIME = "GulfRoadNights";
const EDITOR = "GulfRoadNightsEditor";

let failed = 0;
const fail = (m) => {
  console.error(`✗ ${m}`);
  failed++;
};
const ok = (m) => console.log(`✓ ${m}`);
const note = (m) => console.log(`· ${m}`);
const read = (p) => readFileSync(p, "utf8");

/**
 * Comments out, and string literals out too unless keepStrings. A real
 * scan rather than two regexes: the sources carry URLs in strings, and a
 * `//` comment strip run first eats the rest of `TEXT("http://...")`,
 * closing quote and all, after which every quote in the file pairs with
 * the wrong partner. Newlines survive so line numbers do.
 */
function scrub(src, { keepStrings = false } = {}) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      const e = src.indexOf("*/", i + 2);
      const end = e < 0 ? n : e + 2;
      out += src.slice(i, end).replace(/[^\n]/g, " ");
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      j++;
      out += keepStrings ? src.slice(i, j) : c + c;
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const includesOf = (src) =>
  [...scrub(src, { keepStrings: true }).matchAll(/^\s*#\s*include\s+"([^"]+)"/gm)].map((m) => m[1]);

// ---- the files -----------------------------------------------------------
const modules = {};
for (const name of [RUNTIME, EDITOR]) {
  const dir = `${SOURCE}/${name}`;
  if (!existsSync(dir)) {
    fail(`${dir} is missing`);
    continue;
  }
  const files = readdirSync(dir).filter((f) => /\.(h|cpp)$/.test(f));
  modules[name] = {
    dir,
    files,
    src: Object.fromEntries(files.map((f) => [f, read(`${dir}/${f}`)])),
    buildCs: existsSync(`${dir}/${name}.Build.cs`) ? read(`${dir}/${name}.Build.cs`) : null,
  };
}

// =========================================================================
// 1. One engine version, said the same way everywhere
// =========================================================================
//
// The .uproject's EngineAssociation picks the engine (and is what
// mac/connect.sh looks for as UE_<ver>); each Target.cs pins the build
// settings and include order that engine was built with. UnrealBuildTool
// refuses a target whose BuildSettingsVersion disagrees with an installed
// engine's, and an IncludeOrderVersion left behind on an engine bump
// quietly keeps the old transitive includes alive until the day it is
// removed. So they are compared, not just read.
//
// The BuildSettingsVersion per engine is not derivable from anything in
// this repository. It is a table, and a bump that is not in it fails here
// until somebody adds the row — which is the point: an engine upgrade is
// a decision, not a side effect.
const BUILD_SETTINGS_FOR = {
  // From third-party 5.8 upgrade write-ups; Epic's page could not be read
  // from the machine this was written on. If 5.8's UBT says otherwise,
  // it says so on the first build — correct it here and in both targets.
  "5.8": "V7",
};
let engineVer = null;
{
  let uproject = null;
  try {
    uproject = JSON.parse(read(UPROJECT));
  } catch (e) {
    fail(`${UPROJECT} is not valid JSON: ${e.message}`);
  }
  if (uproject) {
    engineVer = uproject.EngineAssociation;
    if (!/^\d+\.\d+$/.test(engineVer ?? "")) {
      fail(`EngineAssociation is "${engineVer}" — a launcher build is "major.minor"; a source-build GUID cannot be checked here`);
      engineVer = null;
    }
    const mods = uproject.Modules ?? [];
    const byName = Object.fromEntries(mods.map((m) => [m.Name, m]));
    if (byName[RUNTIME]?.Type !== "Runtime") fail(`${UPROJECT} must list ${RUNTIME} as a Runtime module`);
    if (byName[EDITOR]?.Type !== "Editor") {
      fail(`${UPROJECT} must list ${EDITOR} as an Editor module — any other type ships UnrealEd in the game`);
    }
    for (const m of mods) {
      if (!existsSync(`${SOURCE}/${m.Name}/${m.Name}.Build.cs`)) {
        fail(`${UPROJECT} lists module ${m.Name}, which has no ${SOURCE}/${m.Name}/${m.Name}.Build.cs`);
      }
    }
    for (const d of readdirSync(SOURCE, { withFileTypes: true }).filter((e) => e.isDirectory())) {
      if (!byName[d.name]) fail(`${SOURCE}/${d.name} is a module directory the .uproject does not list`);
    }

    const targets = {
      game: { path: `${SOURCE}/GulfRoadNights.Target.cs` },
      editor: { path: `${SOURCE}/GulfRoadNightsEditor.Target.cs` },
    };
    for (const t of Object.values(targets)) {
      const cs = scrub(read(t.path), { keepStrings: true });
      t.settings = cs.match(/DefaultBuildSettings\s*=\s*BuildSettingsVersion\.(\w+)\s*;/)?.[1];
      t.order = cs.match(/IncludeOrderVersion\s*=\s*EngineIncludeOrderVersion\.(\w+)\s*;/)?.[1];
      t.modules = [...cs.matchAll(/ExtraModuleNames\.Add\(\s*"(\w+)"\s*\)/g)].map((m) => m[1]);
    }
    if (engineVer) {
      const wantOrder = `Unreal${engineVer.replace(".", "_")}`;
      const wantSettings = BUILD_SETTINGS_FOR[engineVer];
      if (!wantSettings) {
        fail(`no BuildSettingsVersion recorded for UE ${engineVer} — add it to BUILD_SETTINGS_FOR in this file`);
      }
      for (const [kind, t] of Object.entries(targets)) {
        if (t.settings === "Latest") {
          fail(`${t.path} uses BuildSettingsVersion.Latest — pin it, so an engine bump cannot change it silently`);
        } else if (wantSettings && t.settings !== wantSettings) {
          fail(`${t.path}: BuildSettingsVersion.${t.settings}, UE ${engineVer} wants ${wantSettings}`);
        }
        if (t.order !== wantOrder) {
          fail(`${t.path}: IncludeOrderVersion ${t.order ?? "(unset)"}, the .uproject asks for UE ${engineVer} (${wantOrder})`);
        }
        void kind;
      }
      if (targets.game.settings !== targets.editor.settings || targets.game.order !== targets.editor.order) {
        fail("the game and editor targets disagree about build settings or include order");
      }
    }
    // The editor module in the editor target and NOT in the game target.
    for (const m of mods) {
      const inGame = targets.game.modules.includes(m.Name);
      const inEditor = targets.editor.modules.includes(m.Name);
      if (m.Type === "Editor" && inGame) fail(`the game target names Editor module ${m.Name} — it would link UnrealEd into the shipping build`);
      if (!inEditor) fail(`the editor target does not name module ${m.Name}`);
      if (m.Type === "Runtime" && !inGame) fail(`the game target does not name Runtime module ${m.Name}`);
    }
    if (!failed) {
      ok(`engine: UE ${engineVer}, BuildSettingsVersion.${targets.game.settings} and ${targets.game.order} in both targets; ` +
        `${EDITOR} in the editor target only`);
    }
  }

  // The READMEs say which engine to install. A README that names the old
  // one sends the next person to the launcher for the wrong version.
  if (engineVer) {
    const before = failed;
    const port = read("unreal/README.md").split("\n").slice(0, 8).join("\n");
    const portVer = port.match(/UE (\d+\.\d+)/)?.[1];
    if (portVer !== engineVer) fail(`unreal/README.md's opening says UE ${portVer ?? "(none)"}, the project asks for ${engineVer}`);
    const rootLine = read("README.md").split("\n").find((l) => l.includes("(unreal/README.md)"));
    const rootVer = rootLine?.match(/Unreal Engine (\d+\.\d+)/)?.[1];
    if (rootVer !== engineVer) fail(`README.md's unreal/ line says Unreal Engine ${rootVer ?? "(none)"}, the project asks for ${engineVer}`);
    if (failed === before) ok(`READMEs name UE ${engineVer}`);
  }
}

// =========================================================================
// 2. Module boundaries and dependencies
// =========================================================================
//
// Which engine module owns each header this port includes. A header from
// a module the Build.cs does not depend on is a link error at best and a
// missing include path at worst — and in a Shared-PCH build it can compile
// for months by accident, through somebody else's dependency, and stop the
// day the PCH changes. Every include must be found here: an include this
// table does not know fails, so the table cannot fall behind the code.
const HEADER_MODULE = [
  [/^(CoreMinimal\.h|CoreGlobals\.h|Containers\/|HAL\/|Modules\/ModuleManager\.h)/, "Core"],
  [/^Misc\/(CommandLine|Parse|OutputDevice|Paths)\.h$/, "Core"],
  [/^Misc\/PackageName\.h$/, "CoreUObject"],
  [/^UObject\//, "CoreUObject"],
  [/^(Engine|Components|Materials|GameFramework|Kismet|Camera|Commandlets)\//, "Engine"],
  [/^(Subsystems\/GameInstanceSubsystem\.h|SceneTypes\.h)$/, "Engine"],
  [/^(HttpModule\.h|Interfaces\/IHttpRequest\.h|Interfaces\/IHttpResponse\.h|GenericPlatform\/GenericPlatformHttp\.h)$/, "HTTP"],
  [/^(Dom\/JsonObject\.h|Serialization\/JsonReader\.h|Serialization\/JsonSerializer\.h)$/, "Json"],
  [/^ProceduralMeshComponent\.h$/, "ProceduralMeshComponent"],
  [/^RenderUtils\.h$/, "RenderCore"],
  [/^RHI\.h$/, "RHI"],
  [/^AssetRegistry\//, "AssetRegistry"],
  [/^EditorSubsystem\.h$/, "EditorSubsystem"],
  [/^MaterialEditingLibrary\.h$/, "MaterialEditor"],
];
// Modules a packaged game cannot link. None may appear in the runtime
// module's Build.cs or be included from its sources outside WITH_EDITOR.
const EDITOR_ONLY_MODULES = new Set([
  "UnrealEd", "MaterialEditor", "EditorSubsystem", "EditorScriptingUtilities", "AssetTools",
  "Kismet", "KismetCompiler", "LevelEditor", "ToolMenus", "EditorStyle", "EditorFramework",
  "ContentBrowser", "PropertyEditor", "Blutility", "MaterialUtilities",
]);
{
  const before = failed;
  // A runtime module MAY name an editor module, if the Build.cs only adds
  // it when the target builds the editor and the source only includes it
  // under WITH_EDITOR — the two halves of the same guard. So dependencies
  // are split into those added unconditionally and those added inside an
  // `if (Target.bBuildEditor ...)` (or `Target.Type == TargetType.Editor`)
  // block, found by brace matching rather than by indentation.
  const depsOf = (cs) => {
    let body = scrub(cs ?? "", { keepStrings: true });
    const guardedText = [];
    for (;;) {
      const m = body.match(/if\s*\(\s*Target\.(?:bBuildEditor|Type\s*==\s*TargetType\.Editor)\b[^)]*\)\s*\{/);
      if (!m) break;
      let depth = 1;
      let j = m.index + m[0].length;
      while (j < body.length && depth) {
        if (body[j] === "{") depth++;
        else if (body[j] === "}") depth--;
        j++;
      }
      guardedText.push(body.slice(m.index, j));
      body = body.slice(0, m.index) + body.slice(j);
    }
    const names = (text) => new Set(
      [...text.matchAll(/(?:Public|Private)DependencyModuleNames\.Add(?:Range)?\(([\s\S]*?)\)\s*;/g)]
        .flatMap((m) => [...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1]))
    );
    return { always: names(body), editorOnly: names(guardedText.join("\n")) };
  };
  const ownerOf = (inc) => HEADER_MODULE.find(([re]) => re.test(inc))?.[1] ?? null;
  for (const [name, mod] of Object.entries(modules)) {
    if (!mod.buildCs) {
      fail(`${mod.dir}/${name}.Build.cs is missing`);
      continue;
    }
    const deps = depsOf(mod.buildCs);
    if (name === RUNTIME) {
      for (const d of deps.always) {
        if (EDITOR_ONLY_MODULES.has(d)) {
          fail(`${name}.Build.cs depends on editor-only ${d} unconditionally — the game target would not link ` +
            `(add it under if (Target.bBuildEditor), or move the code to ${EDITOR})`);
        }
      }
    }
    for (const [f, src] of Object.entries(mod.src)) {
      // The preprocessor nesting, so an include knows whether it sits
      // under WITH_EDITOR (or WITH_EDITORONLY_DATA), which the game target
      // compiles out.
      const stack = [];
      scrub(src, { keepStrings: true }).split("\n").forEach((line, i) => {
        const t = line.trim();
        if (/^#\s*if/.test(t)) stack.push(/WITH_EDITOR/.test(t));
        else if (/^#\s*(else|elif)/.test(t) && stack.length) stack[stack.length - 1] = false;
        else if (/^#\s*endif/.test(t)) stack.pop();
        const inc = t.match(/^#\s*include\s+"([^"]+)"/)?.[1];
        if (!inc || /\.generated\.h$/.test(inc) || mod.files.includes(inc)) return;
        const inEditorBlock = stack.some(Boolean);
        // Another module of this project: its directory name is the module.
        const sibling = Object.entries(modules).find(([n, m]) => n !== name && m.files.includes(inc));
        const owner = sibling ? sibling[0] : ownerOf(inc);
        if (!owner) {
          fail(`${mod.dir}/${f} includes "${inc}", which this check cannot place in a module — add it to HEADER_MODULE`);
          return;
        }
        if (name === RUNTIME && EDITOR_ONLY_MODULES.has(owner) && !inEditorBlock) {
          fail(`${mod.dir}/${f}:${i + 1} includes editor-only "${inc}" outside WITH_EDITOR`);
          return;
        }
        const covered = deps.always.has(owner) || (inEditorBlock && deps.editorOnly.has(owner));
        if (!covered) fail(`${mod.dir}/${f} includes "${inc}" from ${owner}, which ${name}.Build.cs does not depend on`);
      });
    }
  }

  // The editor module may use only what is INLINE in the runtime module's
  // headers. Nothing in GulfRoadNights is exported (no GULFROADNIGHTS_API),
  // so in a modular editor build a call into GRNPaint.cpp from the editor
  // DLL is an unresolved symbol — found at link time, on Windows, by
  // whoever next builds it. GRNPaint.h's out-of-line declarations are read
  // from the header itself, so a new one is covered without editing this.
  {
    const hdr = scrub(read(`${SOURCE}/${RUNTIME}/GRNPaint.h`));
    const ns = hdr.match(/namespace GRNPaint\s*\{([\s\S]*)\}\s*$/)?.[1] ?? "";
    // Lookbehind, not a consumed `[;}]`: a consumed one belongs to the
    // previous match, and every other declaration went unseen.
    // An optional leading const, or `const TCHAR* FinishName(...)` hides.
    const outOfLine = [...ns.matchAll(/(?<=^|[;}])\s*(?!inline\b|constexpr\b)(?:const\s+)?[A-Za-z_][\w:<>]*[\s*&]+(\w+)\s*\([^;{}]*\)\s*;/g)]
      .map((m) => m[1]);
    const editorSrc = Object.values(modules[EDITOR]?.src ?? {}).map((s) => scrub(s)).join("\n");
    for (const fn of outOfLine) {
      if (new RegExp(`\\bGRNPaint::${fn}\\s*\\(`).test(editorSrc)) {
        fail(`${EDITOR} calls GRNPaint::${fn}, which is defined in ${RUNTIME} and not exported — a modular editor build will not link`);
      }
    }
    if (/\bLogGRNPaint\b/.test(editorSrc)) fail(`${EDITOR} logs to LogGRNPaint, which ${RUNTIME} does not export`);
    if (!outOfLine.length) fail("found no out-of-line declarations in GRNPaint.h — this check's pattern no longer matches it");
    else if (failed === before) {
      ok(`modules: every include owned by a declared dependency; ${RUNTIME} has no editor-only module; ` +
        `${EDITOR} uses none of GRNPaint's ${outOfLine.length} unexported functions`);
    }
  }
}

// =========================================================================
// 3. Includes the code needs and used to get by accident
// =========================================================================
//
// Each rule: a use that needs a complete type or a declaration, and the
// header that provides it. Satisfied by the .cpp or by its own .h — the
// rule a strict include order enforces — and not by whatever happens to
// arrive through the shared PCH, which is exactly what an
// IncludeOrderVersion bump takes away.
const NEEDS = [
  [/\bGEngine\b/, "Engine/Engine.h"],
  [/\bFCommandLine::/, "Misc/CommandLine.h"],
  [/\bIConsoleManager::|\bFAutoConsoleCommand\w*\b/, "HAL/IConsoleManager.h"],
  [/\bUStaticMesh\b(?!Component)/, "Engine/StaticMesh.h"],
  [/\bUStaticMeshComponent\b/, "Components/StaticMeshComponent.h"],
  [/\bUSpotLightComponent\b|\bHeadlight->/, "Components/SpotLightComponent.h"],
  [/->Bind(Axis|Action)\s*\(/, "Components/InputComponent.h"],
  [/\bUMaterialInstanceDynamic::Create\b|->Set(Vector|Scalar)ParameterValue\s*\(/, "Materials/MaterialInstanceDynamic.h"],
  [/\bGetWorld\(\)->|\bWorld->/, "Engine/World.h"],
  [/\bPC->/, "GameFramework/PlayerController.h"],
  [/\bUGameplayStatics::/, "Kismet/GameplayStatics.h"],
  [/\bUKismetSystemLibrary::/, "Kismet/KismetSystemLibrary.h"],
  [/\bFSoftObjectPath\b/, "UObject/SoftObjectPath.h"],
  [/\bFPackageName::/, "Misc/PackageName.h"],
  [/\bFParse::/, "Misc/Parse.h"],
  [/\bUMaterialEditingLibrary::/, "MaterialEditingLibrary.h"],
  [/\bFAssetRegistryModule\b/, "AssetRegistry/AssetRegistryModule.h"],
  [/\bIsRunningCommandlet\s*\(/, "CoreGlobals.h"],
  [/\bCanvas->/, "Engine/Canvas.h"],
  [/\bUSplineComponent\b/, "Components/SplineComponent.h"],
  [/\bUInstancedStaticMeshComponent\b/, "Components/InstancedStaticMeshComponent.h"],
  [/->CreateMeshSection\s*\(/, "ProceduralMeshComponent.h"],
  [/\bUCameraComponent\b/, "Camera/CameraComponent.h"],
  [/\bACameraActor\b/, "Camera/CameraActor.h"],
  [/\bULocalLightComponent\b/, "Components/LocalLightComponent.h"],
  [/\bTObjectIterator\b/, "UObject/UObjectIterator.h"],
  [/\bIsRayTracingEnabled\s*\(/, "RenderUtils.h"],
  [/\bGMaxRHIFeatureLevel\b|\bERHIFeatureLevel::/, "RHI.h"],
];
{
  const before = failed;
  let uses = 0;
  for (const mod of Object.values(modules)) {
    for (const f of mod.files.filter((x) => x.endsWith(".cpp"))) {
      const own = f.replace(/\.cpp$/, ".h");
      const incs = new Set([...includesOf(mod.src[f]), ...(mod.src[own] ? includesOf(mod.src[own]) : [])]);
      const code = scrub(mod.src[f]);
      for (const [re, header] of NEEDS) {
        if (!re.test(code)) continue;
        uses++;
        if (!incs.has(header)) fail(`${mod.dir}/${f} uses ${re.source.replace(/\\b|\\/g, "")} but does not include "${header}"`);
      }
      // A .cpp's first include is its own header, where it has one: the
      // rule that makes each header prove it compiles on its own.
      const first = includesOf(mod.src[f])[0];
      if (mod.src[own] && first !== own) fail(`${mod.dir}/${f} includes "${first}" first; its own "${own}" must come first`);
    }
  }
  if (failed === before) ok(`includes: ${uses} uses across both modules, each with the header that declares it, own header first`);
}

// =========================================================================
// 3b. File-local names that would collide in a unity build
// =========================================================================
//
// A unity build pastes a module's .cpp files into a few big translation
// units, and every anonymous namespace in one becomes the SAME anonymous
// namespace — so two files that each keep a private `Cube()` are a
// redefinition error the moment they share a unity file. UnrealBuildTool
// only unity-builds a game module from 32 source files on
// (MinGameModuleSourceFilesForUnityBuild), and this one has fewer, which
// is why the port builds today; -ForceUnity, a lower threshold or the
// module simply growing would break it with nothing in the sources
// having changed. New collisions fail. The ones that predate this check
// are a recorded baseline, printed every run so they stay visible.
const UNITY_BASELINE = {
  [RUNTIME]: { Cube: ["GRNCarFactory.cpp", "GRNDriverRig.cpp"], Cyl: ["GRNCarFactory.cpp", "GRNDriverRig.cpp"], Mid: ["GRNCarFactory.cpp", "GRNDriverRig.cpp"] },
};
/** Names with internal linkage at file scope: anything in an anonymous
 *  namespace, and anything declared `static` outside every block. */
function fileLocalNames(src) {
  // Preprocessor lines out: an #include has no `;`, so it would sit at
  // the front of the next statement and hide a leading `static`.
  const code = scrub(src).replace(/^[ \t]*#.*$/gm, "");
  const names = new Set();
  const stack = []; // "anon" | "ns" | "block", one per open brace
  let head = "";
  let paren = 0;
  let innerBraces = 0; // braces inside parentheses (a lambda in an initialiser)
  const atNamespaceScope = () => stack.every((k) => k !== "block");
  const declared = (text) => {
    const t = text.replace(/^\s*template\s*<[^>]*>/, "").trim();
    if (!t || /^(namespace|using|typedef|#)/.test(t)) return null;
    // An unnamed `enum : uint8 { ... }` declares only its enumerators.
    if (/^enum\s*(:|$)/.test(t)) return null;
    const tag = t.match(/\b(?:enum\s+class|enum|struct|class|union)\s+([A-Za-z_]\w*)/);
    if (tag) return tag[1];
    // Cut an initialiser at the first top-level '=', then brackets.
    let depth = 0;
    let cut = t.length;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (c === "(" || c === "[" || c === "<") depth++;
      else if (c === ")" || c === "]" || c === ">") depth--;
      else if (c === "=" && depth === 0 && t[i + 1] !== "=") { cut = i; break; }
    }
    const decl = t.slice(0, cut).replace(/\[[^\]]*\]/g, "");
    const open = decl.indexOf("(");
    const before = open >= 0 ? decl.slice(0, open) : decl;
    return before.match(/([A-Za-z_]\w*)\s*$/)?.[1] ?? null;
  };
  for (const c of code) {
    if (paren > 0) {
      head += c;
      if (c === "(") paren++;
      else if (c === ")") paren--;
      else if (c === "{") innerBraces++;
      else if (c === "}") innerBraces--;
      continue;
    }
    if (c === "(") { paren++; head += c; continue; }
    if (c === "{" || c === ";") {
      const internal = atNamespaceScope() && (stack.includes("anon") || /^\s*static\b/.test(head));
      if (internal) {
        const n = declared(head);
        if (n) names.add(n);
      }
      if (c === "{") {
        if (/\bnamespace\s*$/.test(head)) stack.push("anon");
        else if (/\bnamespace\s+[\w:]+\s*$/.test(head)) stack.push("ns");
        else stack.push("block");
      }
      head = "";
      continue;
    }
    if (c === "}") { stack.pop(); head = ""; continue; }
    head += c;
  }
  void innerBraces;
  return names;
}
{
  const before = failed;
  const lines = [];
  for (const [name, mod] of Object.entries(modules)) {
    const owners = {};
    for (const f of mod.files.filter((x) => x.endsWith(".cpp"))) {
      for (const n of fileLocalNames(mod.src[f])) (owners[n] ??= []).push(f);
    }
    const base = UNITY_BASELINE[name] ?? {};
    for (const [n, files] of Object.entries(owners)) {
      if (files.length < 2) continue;
      const known = base[n] && files.every((f) => base[n].includes(f)) && files.length <= base[n].length;
      if (known) lines.push(`${n} (${files.join(", ")})`);
      else fail(`${name}: ${files.join(" and ")} each define a file-local ${n} — a unity build of the module would not compile; rename one`);
    }
    for (const [n, files] of Object.entries(base)) {
      if ((owners[n]?.length ?? 0) < 2) note(`unity baseline: ${n} no longer collides (${files.join(", ")}) — remove it from UNITY_BASELINE`);
    }
  }
  const cpp = modules[RUNTIME]?.files.filter((f) => f.endsWith(".cpp")).length ?? 0;
  if (failed === before) {
    ok(`unity: no new file-local name collisions` + (lines.length
      ? `; ${lines.length} recorded from before this check (${lines.join("; ")}), harmless while ${RUNTIME} stays under 32 .cpp files (it has ${cpp})`
      : ""));
  }
}

// =========================================================================
// 4. Config: the keys that matter, in sections that exist
// =========================================================================
function iniSections(path) {
  const out = {};
  let cur = null;
  for (const raw of read(path).split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith(";")) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) {
      cur = sec[1];
      out[cur] ??= [];
      continue;
    }
    if (cur) out[cur].push(line);
  }
  return out;
}
const iniValue = (lines, key) => {
  const hit = (lines ?? []).filter((l) => l.replace(/^[+\-.!]/, "").startsWith(`${key}=`));
  return hit.length ? hit[hit.length - 1].split("=").slice(1).join("=") : undefined;
};
{
  const before = failed;
  const engine = iniSections("unreal/Config/DefaultEngine.ini");
  const rs = engine["/Script/Engine.RendererSettings"];
  const want = {
    "r.MegaLights.EnableForProject": /^(True|1)$/i,
    "r.Substrate": /^(True|1)$/i,
    "r.Substrate.ProjectGBufferFormat": /^[01]$/,
    "r.GenerateMeshDistanceFields": /^(True|1)$/i,
  };
  for (const [k, re] of Object.entries(want)) {
    const v = iniValue(rs, k);
    if (v === undefined) fail(`DefaultEngine.ini [/Script/Engine.RendererSettings] has no ${k}`);
    else if (!re.test(v)) fail(`DefaultEngine.ini ${k}=${v}, expected ${re.source}`);
  }
  // A section the engine does not have is a section nothing reads. The
  // old [/Script/Engine.RendererSettings.RayTracing] carried three keys
  // for as long as this project existed and none of them ever applied.
  for (const s of Object.keys(engine)) {
    if (/^\/Script\/Engine\.RendererSettings\./.test(s)) fail(`DefaultEngine.ini has [${s}] — no such section exists; its keys are never read`);
  }
  // Variables that do nothing on this renderer, anywhere they could be
  // set: the ini files and the strings GRNGraphics runs. Comments may
  // still NAME them, which is how the reason for removing them survives.
  const DEAD = [
    ["r.RayTracing.AmbientOcclusion", "legacy RT AO only ran with Lumen GI off and was dropped in 5.4"],
    ["r.Lumen.TraceMeshSDFs", "software ray-tracing detail traces were deprecated in 5.6"],
  ];
  const inis = readdirSync("unreal/Config").map((f) => [`unreal/Config/${f}`, read(`unreal/Config/${f}`)
    .split("\n").filter((l) => !l.trim().startsWith(";")).join("\n")]);
  const runtimeStrings = Object.entries(modules[RUNTIME]?.src ?? {}).map(([f, s]) => [`${SOURCE}/${RUNTIME}/${f}`, scrub(s, { keepStrings: true })]);
  for (const [cvar, why] of DEAD) {
    for (const [path, text] of [...inis, ...runtimeStrings]) {
      if (text.includes(cvar)) fail(`${path} still sets ${cvar} — ${why}`);
    }
  }

  // The always-cook list must cover what the code loads by string path:
  // the generated paint, and the top folder of every hero-art path.
  const game = iniSections("unreal/Config/DefaultGame.ini");
  const cookDirs = (game["/Script/UnrealEd.ProjectPackagingSettings"] ?? [])
    .map((l) => l.match(/^\+DirectoriesToAlwaysCook=\(Path="([^"]+)"\)$/)?.[1])
    .filter(Boolean);
  const paintPath = read(`${SOURCE}/${RUNTIME}/GRNPaint.h`).match(/MaterialPath = TEXT\("([^"]+)"\)/)?.[1];
  const needCooked = new Set();
  if (paintPath) needCooked.add(paintPath.replace(/\/[^/]+$/, ""));
  else fail("GRNPaint.h no longer declares MaterialPath as this check reads it");
  for (const m of read(`${SOURCE}/${RUNTIME}/GRNHeroArt.cpp`).matchAll(/TEXT\("(\/Game\/[^/"]+)\/[^"]*"\)/g)) needCooked.add(m[1]);
  for (const dir of needCooked) {
    if (!cookDirs.some((c) => dir === c || dir.startsWith(`${c}/`))) {
      fail(`DefaultGame.ini does not always-cook ${dir} — nothing hard-references it, so a packaged build would leave it out`);
    }
  }

  // The game boots at Cinematic. If that rung says no to MegaLights the
  // lamps are unshadowed on every machine, which would be a quiet way to
  // undo the whole feature.
  const scal = iniSections("unreal/Config/DefaultScalability.ini");
  for (const [s, lines] of Object.entries(scal)) {
    if (/@(Cine|4)$/.test(s) && iniValue(lines, "r.MegaLights.Allow") === "0") {
      fail(`DefaultScalability.ini [${s}] turns MegaLights off on the rung the game boots at`);
    }
  }
  if (failed === before) {
    ok(`config: MegaLights, Substrate (GBuffer format ${iniValue(rs, "r.Substrate.ProjectGBufferFormat")}) and distance fields on; ` +
      `no dead sections or variables; always-cook covers ${[...needCooked].join(", ")}`);
  }
}

// =========================================================================
// 5. MegaLights: shadows only where MegaLights is drawing them
// =========================================================================
//
// The first version of this switch read the two variables and nothing
// else, and in this game that was the project switch alone: ApplyMax
// raises scalability to Cinematic before the world is built, so the
// Low/Medium "no" in DefaultScalability.ini was never what it read, and
// nothing asked whether the GPU could run MegaLights. A text check
// cannot run the switch, but it can hold it to its four questions, to
// the one door every lamp and headlight goes through, and to the escape
// hatch the README promises.
{
  const before = failed;
  const rt = modules[RUNTIME]?.src ?? {};
  for (const [f, src] of Object.entries(rt)) {
    const code = scrub(src);
    // Every shadow decision goes through FollowMegaLights, which lives in
    // GRNGraphics.cpp. A light that sets its own shadows is one a change
    // of rung cannot find again: with MegaLights switched off under it,
    // it is a shadow map per lamp.
    if (f !== "GRNGraphics.cpp" && /->SetCastShadows\s*\(/.test(code)) {
      fail(`${f} sets a light's shadows itself — use GRNGraphics::FollowMegaLights() so a change of answer re-lights it`);
    }
    // Movable before RegisterComponent, for every spot light this port
    // makes. A light component defaults to Stationary.
    for (const m of code.matchAll(/(\w+(?:\.\w+)?)\s*=\s*NewObject<USpotLightComponent>/g)) {
      const after = code.slice(m.index);
      const reg = after.search(new RegExp(`${m[1].replace(".", "\\.")}->RegisterComponent\\(`));
      const mob = after.search(new RegExp(`${m[1].replace(".", "\\.")}->SetMobility\\(EComponentMobility::Movable\\)`));
      if (mob < 0 || (reg >= 0 && mob > reg)) fail(`${f}: ${m[1]} must be set Movable before it registers`);
    }
  }
  if (!/GRNGraphics::FollowMegaLights\(\s*Lamp\s*\)/.test(scrub(rt["GRNWorldBuilder.cpp"] ?? ""))) {
    fail("GRNWorldBuilder.cpp: the street lamps' shadows no longer follow GRNGraphics::FollowMegaLights()");
  }
  if (!/GRNGraphics::FollowMegaLights\(\s*Rig\.Headlight\s*\)/.test(scrub(rt["GRNCarFactory.cpp"] ?? ""))) {
    fail("GRNCarFactory.cpp: the headlight's shadows no longer follow GRNGraphics::FollowMegaLights()");
  }

  const gfxCode = scrub(rt["GRNGraphics.cpp"] ?? "", { keepStrings: true });
  /** The body of a function defined in GRNGraphics.cpp, by brace matching. */
  const bodyOf = (sig) => {
    const m = gfxCode.match(sig);
    if (!m) return null;
    let depth = 0;
    for (let j = gfxCode.indexOf("{", m.index); j < gfxCode.length; j++) {
      if (gfxCode[j] === "{") depth++;
      else if (gfxCode[j] === "}" && --depth === 0) return gfxCode.slice(m.index, j + 1);
    }
    return null;
  };
  const active = bodyOf(/\bbool\s+GRNGraphics::MegaLightsActive\s*\(\s*\)/);
  if (!active) fail("GRNGraphics.cpp no longer defines GRNGraphics::MegaLightsActive()");
  else {
    const asks = [
      [/"r\.MegaLights\.EnableForProject"/, "r.MegaLights.EnableForProject (the project switch)"],
      [/"r\.MegaLights\.Allow"/, "r.MegaLights.Allow (device profile, -grnnomegalights, a rung lowered mid-session)"],
      [/\bERHIFeatureLevel::SM6\b/, "the SM6 feature level (MegaLights has no SM5 path on desktop)"],
      [/\bIsRayTracingEnabled\s*\(\s*\)/, "IsRayTracingEnabled() (the lamps' shadow method is ray tracing)"],
    ];
    // Asked AND answered: each must reach the return, directly or
    // through a local initialised from it. A variable read and then left
    // out of the return would pass a presence check and change nothing —
    // which is how a gate that looks present can still never say no.
    const ret = active.match(/\breturn\b([^;]*);/)?.[1] ?? "";
    const locals = [...active.matchAll(/\b(\w+)\s*=\s*([^;]*);/g)].map((m) => [m[1], m[2]]);
    const reaches = (re) => re.test(ret) ||
      locals.some(([name, init]) => re.test(init) && new RegExp(`\\b${name}\\b`).test(ret));
    for (const [re, what] of asks) {
      if (!reaches(re)) fail(`GRNGraphics::MegaLightsActive no longer asks ${what}, or asks and ignores the answer`);
    }
  }
  const follow = bodyOf(/\bbool\s+GRNGraphics::FollowMegaLights\s*\(/);
  if (!follow) fail("GRNGraphics.cpp no longer defines GRNGraphics::FollowMegaLights()");
  else {
    if (!/\bMegaLightsActive\s*\(\s*\)/.test(follow)) fail("GRNGraphics::FollowMegaLights no longer asks MegaLightsActive()");
    if (!/->SetCastShadows\s*\(/.test(follow)) fail("GRNGraphics::FollowMegaLights no longer sets the light's shadows");
    if (!/->ComponentTags\.AddUnique\s*\(/.test(follow)) fail("GRNGraphics::FollowMegaLights no longer tags the light, so a change of answer cannot find it");
    if (!/\bWatchMegaLights\s*\(\s*\)/.test(follow)) fail("GRNGraphics::FollowMegaLights no longer starts watching the MegaLights variables");
  }
  // What re-lights: the watched variables, hooked, and a walk that sets
  // shadows on the tagged lights from the same answer.
  const watch = bodyOf(/\bvoid\s+WatchMegaLights\s*\(\s*\)/);
  if (!watch || !/"r\.MegaLights\.Allow"/.test(watch) || !/->OnChangedDelegate\(\)\.Add\w*\(/.test(watch)) {
    fail("GRNGraphics.cpp: WatchMegaLights no longer hooks r.MegaLights.Allow's change — a rung lowered mid-session would leave the lamps shadowed under no MegaLights");
  }
  const relight = bodyOf(/\bvoid\s+RelightFollowers\s*\(/);
  if (!relight || !/\bMegaLightsActive\s*\(\s*\)/.test(relight) || !/->SetCastShadows\s*\(/.test(relight) || !/\bComponentHasTag\s*\(/.test(relight)) {
    fail("GRNGraphics.cpp: RelightFollowers no longer re-applies MegaLightsActive() to the tagged lights");
  }
  // The escape hatch: parsed where the README says, and doing what it says.
  const readme = read("unreal/README.md");
  if (!/^GulfRoadNights\.exe -grnnomegalights\b/m.test(readme)) fail("unreal/README.md's command-line list no longer documents -grnnomegalights");
  if (!/FParse::Param\(\s*Cmd\s*,\s*TEXT\("grnnomegalights"\)\s*\)\s*\)\s*Run\(\s*WorldContext\s*,\s*TEXT\("r\.MegaLights\.Allow 0"\)\s*\)/.test(gfxCode)) {
    fail("GRNGraphics.cpp: -grnnomegalights no longer sets r.MegaLights.Allow 0");
  }
  if (failed === before) {
    ok("MegaLights: lamps and headlights shadow only through FollowMegaLights, which re-lights them when r.MegaLights.Allow changes; " +
      "MegaLightsActive asks the project, Allow, SM6 and hardware RT; -grnnomegalights wired; every spot light Movable before it registers");
  }
}

// =========================================================================
// 6. The paint: the fallback is there, and the names live in one place
// =========================================================================
const paintH = read(`${SOURCE}/${RUNTIME}/GRNPaint.h`);
const params = Object.fromEntries(
  [...paintH.matchAll(/constexpr const TCHAR\* (Param\w+) = TEXT\("([^"]+)"\);/g)].map((m) => [m[1], m[2]])
);
{
  const before = failed;
  if (Object.keys(params).length < 6) fail(`GRNPaint.h declares ${Object.keys(params).length} paint parameters; expected the six the graph has`);
  const path = paintH.match(/MaterialPath = TEXT\("([^"]+)"\)/)?.[1] ?? "";
  const pm = path.match(/^\/Game\/(?:[\w-]+\/)*([\w-]+)\.([\w-]+)$/);
  if (!pm) fail(`GRNPaint::MaterialPath "${path}" is not /Game/.../Package.Asset`);
  else if (pm[1] !== pm[2]) fail(`GRNPaint::MaterialPath: the asset name after the dot must repeat the package leaf`);
  else if (!/_v\d+$/.test(pm[1])) fail(`GRNPaint::MaterialPath "${pm[1]}" carries no _vN — a changed graph must read as a different asset`);

  // Typed once. `Color` is exempt: it is also the basic-shape material's
  // own parameter, which the trim, glass and lamp MIDs drive, and sharing
  // it is the design (GRNPaint.h). Every other name, and the path, may
  // appear as a literal nowhere but GRNPaint.h.
  const literals = Object.entries(params).filter(([k]) => k !== "ParamColor").map(([, v]) => v);
  if (pm) literals.push(path, path.split(".")[0]);
  for (const [mname, mod] of Object.entries(modules)) {
    for (const [f, src] of Object.entries(mod.src)) {
      if (mname === RUNTIME && f === "GRNPaint.h") continue;
      const code = scrub(src, { keepStrings: true });
      for (const lit of literals) {
        if (code.includes(`"${lit}"`)) fail(`${mod.dir}/${f} spells "${lit}" — use the GRNPaint.h constant, so the graph and the instance cannot disagree`);
      }
    }
  }
  // Every parameter the instance sets is one the graph declares, and the
  // other way round. A parameter on only one side is a silent no-op.
  const builder = scrub(modules[EDITOR]?.src["GRNPaintBuilder.cpp"] ?? "");
  const runtime = scrub(modules[RUNTIME]?.src["GRNPaint.cpp"] ?? "");
  for (const k of Object.keys(params)) {
    if (!new RegExp(`GRNPaint::${k}\\b`).test(builder)) fail(`GRNPaintBuilder.cpp never declares ${k} in the graph`);
    if (!new RegExp(`Set(Scalar|Vector)ParameterValue\\(GRNPaint::${k}\\b`).test(runtime)) fail(`GRNPaint::CreatePaintMid never sets ${k}`);
  }

  // The fallback ladder, rung by rung. Each is a line whose deletion
  // compiles and runs and paints every car with nothing — or crashes a
  // project that never built the asset.
  const rungs = [
    [/FindConsoleVariable\(GRNPaint::SubstrateCVar\)/, "reads r.Substrate before using the asset"],
    [/FPackageName::DoesPackageExist\(GRNPaint::MaterialPackageName\(\)\)/, "asks whether the asset exists before loading it"],
    [/Cast<UMaterialInterface>\(/, "checks the asset is a material"],
    [/UMaterialInstanceDynamic::Create\(BasicBase,/, "falls back to the basic-shape material"],
    [/if \(!BasicBase\) return nullptr;/, "survives having no basic material either"],
  ];
  for (const [re, what] of rungs) if (!re.test(runtime)) fail(`GRNPaint.cpp no longer ${what}`);
  if (!/"GRN\.Paint\.Status"/.test(scrub(modules[RUNTIME]?.src["GRNPaint.cpp"] ?? "", { keepStrings: true }))) {
    fail("GRNPaint.cpp no longer registers GRN.Paint.Status");
  }
  const factory = scrub(modules[RUNTIME]?.src["GRNCarFactory.cpp"] ?? "");
  if (!/Rig\.PaintMid = GRNPaint::CreatePaintMid\(Parent, Cube\(\) \? Cube\(\)->GetMaterial\(0\) : nullptr,/.test(factory)) {
    fail("GRNCarFactory.cpp no longer makes the body paint through GRNPaint::CreatePaintMid with the basic-shape fallback");
  }
  // Only the ladder touches the asset.
  for (const [f, src] of Object.entries(modules[RUNTIME]?.src ?? {})) {
    if (f === "GRNPaint.cpp" || f === "GRNPaint.h") continue;
    if (/GRNPaint::MaterialPath/.test(scrub(src))) fail(`${f} loads the paint asset itself — only GRNPaint.cpp may, so the fallback cannot be skipped`);
  }

  // The commandlet's run name is its class name, and the docs and the
  // game's own messages quote it.
  const cmdH = modules[EDITOR]?.src["GRNBuildPaintCommandlet.h"] ?? "";
  const runName = cmdH.match(/class U(\w+)Commandlet\s*:\s*public UCommandlet/)?.[1];
  if (!runName) fail("GRNBuildPaintCommandlet.h declares no UCommandlet this check can read");
  else {
    const quoting = [["unreal/README.md", read("unreal/README.md")], [`${SOURCE}/${RUNTIME}/GRNPaint.cpp`, modules[RUNTIME].src["GRNPaint.cpp"]]];
    for (const [p, t] of quoting) {
      const runs = [...t.matchAll(/-run=(\w+)/g)].map((m) => m[1]);
      if (!runs.length) fail(`${p} never says how to run the paint commandlet`);
      for (const r of runs) if (r !== runName) fail(`${p} says -run=${r}; the commandlet is U${runName}Commandlet, so it is -run=${runName}`);
    }
    if (!read("unreal/README.md").includes("GRN.Paint.Status")) fail("unreal/README.md does not mention GRN.Paint.Status");
  }
  if (failed === before) {
    ok(`paint: ${Object.keys(params).length} parameters spelled once and used on both sides, the fallback ladder intact, -run=${runName} quoted correctly`);
  }
}

// =========================================================================
// 7. The paint against the web build that measured it
// =========================================================================
const lawPath = resolve(`${SOURCE}/${RUNTIME}/GRNPaintLaw.h`);
const law = read(lawPath);
const modsTs = read("src/game/mods.ts");
const carsTs = read("src/game/cars.ts");
const rivalsTs = read("src/game/rivals.ts");
const paintsTs = read("src/game/paints.ts");
const FINISH_ORDER = ["gloss", "satin", "matte"];
{
  const before = failed;
  // Finishes. mods.ts: `gloss: { clearcoat: 1, clearcoatRoughness: 0.06, roughnessAdd: 0, envScale: 1, metalScale: 1 },`
  const web = {};
  for (const f of FINISH_ORDER) {
    const row = modsTs.match(new RegExp(`\\b${f}: \\{([^}]*)\\}`))?.[1];
    if (!row) { fail(`mods.ts FINISHES has no ${f} row this check can read`); continue; }
    const num = (k) => +row.match(new RegExp(`\\b${k}: (-?[\\d.]+)`))?.[1];
    web[f] = [num("clearcoat"), num("clearcoatRoughness"), num("roughnessAdd"), num("metalScale")];
  }
  const cpp = {};
  for (const m of law.matchAll(/\/\* (Gloss|Satin|Matte) \*\/ \{ ([^}]*) \}/g)) {
    cpp[m[1].toLowerCase()] = m[2].split(",").map((x) => +x.trim().replace(/f$/, ""));
  }
  const NAMES = ["clearcoat", "clearcoatRoughness", "roughnessAdd", "metalScale"];
  for (const f of FINISH_ORDER) {
    if (!cpp[f]) { fail(`GRNPaintLaw.h Finishes has no ${f} row`); continue; }
    NAMES.forEach((n, i) => {
      if (!(Math.abs(cpp[f][i] - web[f]?.[i]) < 1e-9)) fail(`finish ${f} ${n}: GRNPaintLaw.h ${cpp[f][i]} vs mods.ts ${web[f]?.[i]}`);
    });
  }
  // Base roughness. cars.ts: `roughness: 0.18 + FINISHES[...].roughnessAdd`
  const webBase = +carsTs.match(/roughness: ([\d.]+) \+ FINISHES\[/)?.[1];
  const cppBase = +law.match(/BaseRoughness = ([\d.]+)f;/)?.[1];
  if (!(Math.abs(webBase - cppBase) < 1e-9)) fail(`base roughness: GRNPaintLaw.h ${cppBase} vs cars.ts ${webBase}`);

  // The factory finish of every showroom car — both directions.
  const carsBlock = modsTs.match(/export const CARS[^=]*=\s*\[(.*?)\n\];/s)?.[1] ?? "";
  const webCars = carsBlock.split(/\n  \{\n/).slice(1).map((b) => ({
    id: b.match(/\bid: "([^"]+)"/)?.[1],
    color: b.match(/\bcolor: 0x([0-9a-fA-F]{6})/)?.[1],
    finish: b.match(/\bfinish: "(gloss|satin|matte)"/)?.[1] ?? "gloss",
  })).filter((c) => c.id);
  if (webCars.length < 5) fail(`mods.ts CARS parsed to ${webCars.length} cars — this check's pattern no longer matches it`);
  const cppFinish = Object.fromEntries([...law.matchAll(/\{ "([\w-]+)", EGRNFinish::(Gloss|Satin|Matte) \}/g)].map((m) => [m[1], m[2].toLowerCase()]));
  for (const c of webCars) {
    const got = cppFinish[c.id] ?? "gloss";
    if (got !== c.finish) fail(`car ${c.id}: leaves the factory ${c.finish} in mods.ts, ${got} in GRNPaintLaw.h`);
  }
  for (const id of Object.keys(cppFinish)) {
    if (!webCars.some((c) => c.id === id)) fail(`GRNPaintLaw.h lists a finish for ${id}, which is not in the showroom`);
    if (cppFinish[id] === "gloss") fail(`GRNPaintLaw.h lists ${id} as Gloss — gloss is the default, list only the others`);
  }
  if (failed === before) {
    const off = webCars.filter((c) => c.finish !== "gloss");
    ok(`finishes: 3 match mods.ts, base roughness ${cppBase}; ${webCars.length} cars, ${off.length} not gloss ` +
      `(${off.map((c) => `${c.id} ${c.finish}`).join(", ")})`);
  }

  // ---- the metalness law, run on both sides ------------------------------
  const before2 = failed;
  let PAINTS = null;
  let currentPaintHex = null;
  try {
    // Node 22.18+ strips the types itself. paints.ts imports nothing, so
    // this is the web's real table, not a regex's idea of it.
    process.removeAllListeners("warning");
    const m = await import(pathToFileURL(resolve("src/game/paints.ts")).href);
    PAINTS = m.PAINTS;
    currentPaintHex = m.currentPaintHex;
  } catch (e) {
    note(`could not import src/game/paints.ts on this node (${e.message.split("\n")[0]}); reading it as text`);
    PAINTS = [...paintsTs.matchAll(/\{ id: "([\w-]+)", hex: 0x([0-9a-fA-F]{6})([^}]*)\}/g)]
      .map((m) => ({ id: m[1], hex: parseInt(m[2], 16), solid: /solid: true/.test(m[3]) }));
    const retired = Object.fromEntries([...paintsTs.matchAll(/^\s*0x([0-9a-fA-F]{6}): "([\w-]+)",/gm)].map((m) => [parseInt(m[1], 16), m[2]]));
    currentPaintHex = (hex) => (retired[hex] ? PAINTS.find((p) => p.id === retired[hex])?.hex ?? hex : hex);
  }
  // Solids and retired swatches, as sets, both directions.
  const webSolid = new Set(PAINTS.filter((p) => p.solid).map((p) => p.hex));
  const cppSolid = new Set([...(law.match(/SolidHexes\[\] = \{([\s\S]*?)\};/)?.[1] ?? "").matchAll(/0x([0-9a-fA-F]{6})u/g)].map((m) => parseInt(m[1], 16)));
  const hex6 = (h) => h.toString(16).padStart(6, "0");
  for (const h of webSolid) if (!cppSolid.has(h)) fail(`paints.ts declares #${hex6(h)} solid; GRNPaintLaw.h SolidHexes does not`);
  for (const h of cppSolid) if (!webSolid.has(h)) fail(`GRNPaintLaw.h calls #${hex6(h)} solid; paints.ts does not`);
  const webRetired = [...paintsTs.matchAll(/^\s*0x([0-9a-fA-F]{6}): "([\w-]+)",/gm)].map((m) => parseInt(m[1], 16));
  const cppRetired = [...law.matchAll(/\{ 0x([0-9a-fA-F]{6})u, 0x([0-9a-fA-F]{6})u \}/g)].map((m) => [parseInt(m[1], 16), parseInt(m[2], 16)]);
  for (const h of webRetired) {
    const row = cppRetired.find(([from]) => from === h);
    if (!row) fail(`paints.ts retires #${hex6(h)}; GRNPaintLaw.h RetiredSwatches does not`);
    else if (row[1] !== currentPaintHex(h)) fail(`retired #${hex6(h)} maps to #${hex6(row[1])} in GRNPaintLaw.h, #${hex6(currentPaintHex(h))} in paints.ts`);
  }
  if (cppRetired.length !== webRetired.length) fail(`GRNPaintLaw.h retires ${cppRetired.length} swatches, paints.ts ${webRetired.length}`);

  // The web's own function, lifted out of cars.ts. It cannot be imported
  // — cars.ts pulls in three.js and half the game — but its body needs
  // nothing but PAINTS and currentPaintHex.
  const body = carsTs.match(/export function paintMetalness\(hex: number\): number \{\n([\s\S]*?)\n\}\n/)?.[1];
  let webMetal = null;
  if (!body) fail("cars.ts no longer has `export function paintMetalness(hex: number): number` for this check to run");
  else webMetal = new Function("PAINTS", "currentPaintHex", "hex", body).bind(null, PAINTS, currentPaintHex);

  // The colours to compare on: the wall, the retired swatches, the
  // showroom, the rivals, every grey, and a fixed pseudo-random spread.
  const probe = new Set();
  PAINTS.forEach((p) => probe.add(p.hex));
  webRetired.forEach((h) => probe.add(h));
  webCars.forEach((c) => c.color && probe.add(parseInt(c.color, 16)));
  for (const m of rivalsTs.matchAll(/bodyColor: 0x([0-9a-fA-F]{6})/g)) probe.add(parseInt(m[1], 16));
  for (let v = 0; v < 256; v++) probe.add((v << 16) | (v << 8) | v);
  let seed = 0x9e3779b9;
  for (let i = 0; i < 4000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    probe.add(seed & 0xffffff);
  }
  const hexes = [...probe];

  let gpp = null;
  try {
    execFileSync("g++", ["--version"], { stdio: "ignore" });
    gpp = "g++";
  } catch {
    note("no g++ on this machine: the metalness law was NOT run — constants and tables above were still compared");
  }
  if (gpp && webMetal) {
    const dir = mkdtempSync(join(tmpdir(), "grn-paint-law-"));
    try {
      const ids = webCars.map((c) => c.id);
      writeFileSync(join(dir, "law.cpp"), `#include "${lawPath}"
#include <cstdio>
int main(int argc, char** argv)
{
	for (int i = 1; i < argc; ++i)
		std::printf("car %s %d\\n", argv[i], static_cast<int>(GRNPaintLaw::FactoryFinish(argv[i])));
	unsigned int h = 0;
	while (std::scanf("%x", &h) == 1)
		std::printf("m %06x %.17g\\n", h, GRNPaintLaw::Metalness(h));
	return 0;
}
`);
      // -Wshadow and -Werror because UE builds shadowing as an error, and
      // this is the only compiler that will see the header before UE does.
      execFileSync(gpp, ["-std=c++17", "-O1", "-Wall", "-Wextra", "-Wshadow", "-Werror", "-o", join(dir, "law"), join(dir, "law.cpp")], { stdio: "pipe" });
      const out = execFileSync(join(dir, "law"), ids, { input: hexes.map(hex6).join("\n") + "\n" }).toString();
      let worst = 0;
      let compared = 0;
      for (const line of out.split("\n")) {
        const m = line.match(/^m ([0-9a-f]{6}) (\S+)$/);
        if (m) {
          const h = parseInt(m[1], 16);
          const want = webMetal(h);
          const got = +m[2];
          const err = Math.abs(got - want);
          worst = Math.max(worst, err);
          compared++;
          if (err > 1e-12) fail(`metalness #${m[1]}: GRNPaintLaw ${got} vs web ${want}`);
        }
        const c = line.match(/^car (\S+) (\d)$/);
        if (c) {
          const want = webCars.find((x) => x.id === c[1])?.finish;
          if (FINISH_ORDER[+c[2]] !== want) fail(`GRNPaintLaw::FactoryFinish("${c[1]}") is ${FINISH_ORDER[+c[2]]}, mods.ts says ${want}`);
        }
      }
      if (compared !== hexes.length) fail(`the law ran on ${compared} of ${hexes.length} colours`);
      if (failed === before2) {
        const fleet = webCars.map((c) => webMetal(parseInt(c.color, 16)));
        ok(`metalness law: compiled with g++ and run against cars.ts's own paintMetalness on ${compared} colours ` +
          `(${PAINTS.length} paints, ${webCars.length} cars, the rivals, 256 greys, a sweep) — worst difference ${worst.toExponential(1)}; ` +
          `fleet metalness ${Math.min(...fleet).toFixed(2)}..${Math.max(...fleet).toFixed(2)}, ${webSolid.size} declared solids at 0`);
      }
    } catch (e) {
      fail(`could not compile or run GRNPaintLaw.h with g++: ${(e.stderr?.toString() || e.message).split("\n").slice(0, 6).join(" | ")}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

if (failed) {
  console.error(`\n${failed} problem${failed === 1 ? "" : "s"} in the Unreal project. None of this needed a compiler to find.`);
  process.exit(1);
}
console.log("\nThe Unreal project is consistent as text. Compiling it still needs Unreal 5.8 — see unreal/README.md.");
