// Still renders of every car, made inside the game's own Unity project
// with the game's own car code: CarLibrary.LoadNow loads it exactly as the
// game does (the baked prefab in Resources/Cars when there is one, else the
// GLB through CarModel and CarMaterials), and nothing in this folder
// touches a car material. A still is of exactly the car the game drives.
//
//   tools/unity/render-cars.sh                              # both sets, all 17
//   tools/unity/render-cars.sh --mode street --only black-demon
//   Editor menu: Night Racer > Render Car Stills (Studio) / (Night Street)
//
// TWO SETS.
//   studio  press/unity/<id>.png: tools/blender/studio.py's stage rebuilt
//           in URP (StudioStage.cs), the Unity twin of render_cars.py, so
//           a Unity and a Cycles render of one car lie side by side.
//   street  press/unity/street/<id>-hero|side|rear.png: the car parked in
//           the player's lane on the game's night Gulf Road (WorldBuilder),
//           by a lit sodium lamp, with the game's sky, probe and post
//           profile (StreetStage.cs).
// Both merge into press/unity/unity.json: per car and set, the seconds,
// the shots with their levels, and anything that failed.
//
// EDIT MODE, SYNCHRONOUS. Nothing here enters Play mode, so Bootstrap
// never spawns the game. Scenes come from EditorSceneManager, cars from
// CarLibrary.LoadNow, probes from Lightmapping.BakeReflectionProbe and
// frames from RenderPipeline.SubmitRenderRequest, and each call returns
// with its work done. A batch run can therefore pass -quit; Run() ends
// with EditorApplication.Exit regardless, so a failed car exits 1 (and
// bad arguments 2) instead of -quit's 0.
//
//   Unity -batchmode -quit -projectPath unity -logFile press/unity/unity.log \
//     -executeMethod NightRacer.Studio.CarStudio.Run [-mode studio|street|both] ...
//
// Never -nographics: the stills are drawn on the GPU, and with no device
// there is nothing to draw with.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using NightRacer.Cars;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using Debug = UnityEngine.Debug;
using Object = UnityEngine.Object;

namespace NightRacer.Studio
{
    /// <summary>Progress hook for the Editor's progress bar: return true
    /// to cancel.</summary>
    internal delegate bool StillProgress(string info, float fraction);

    internal sealed class CarEntry
    {
        public readonly string Id, Name;
        public CarEntry(string id, string name) { Id = id; Name = name; }
    }

    public static class CarStudio
    {
        internal const string NoSource =
            "no baked prefab and no GLB (npm run cars:export with npm run dev up; or Night Racer > Bake Cars to Assets)";

        internal static void Log(string s) =>
            Debug.LogFormat(LogType.Log, LogOption.NoStacktrace, null, "[render] {0}", s);

        /// <summary>Batch entry: -executeMethod NightRacer.Studio.CarStudio.Run.</summary>
        public static void Run()
        {
            int code;
            try { code = Render(StudioOptions.Parse(Environment.GetCommandLineArgs(), null), null); }
            catch (ArgumentException e)
            {
                Log("bad arguments: " + e.Message);
                code = 2;
            }
            catch (Exception e)
            {
                Debug.LogException(e);
                code = 1;
            }
            EditorApplication.Exit(code);
        }

        [MenuItem("Night Racer/Render Car Stills (Studio)")]
        static void MenuStudio() => Interactive("studio");

        [MenuItem("Night Racer/Render Car Stills (Night Street)")]
        static void MenuStreet() => Interactive("street");

        /// <summary>From the menu: every car, re-rendered whatever its PNG's
        /// date (the GLB's date says nothing about the car code just
        /// edited), with a progress bar that can cancel, and the scenes
        /// that were open put back afterwards.</summary>
        static void Interactive(string mode)
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            var scenes = EditorSceneManager.GetSceneManagerSetup();
            StudioOptions o = null;
            try
            {
                o = StudioOptions.Parse(Environment.GetCommandLineArgs(), mode);
                o.Force = true;
                Render(o, (info, t) => EditorUtility.DisplayCancelableProgressBar("Night Racer stills", info, t));
            }
            catch (Exception e) { Debug.LogException(e); }
            finally
            {
                EditorUtility.ClearProgressBar();
                if (scenes.Length > 0 && scenes.All(s => !string.IsNullOrEmpty(s.path)))
                    EditorSceneManager.RestoreSceneManagerSetup(scenes);
            }
            if (o != null && Directory.Exists(o.Out)) EditorUtility.RevealInFinder(o.Out);
        }

        static int Render(StudioOptions o, StillProgress progress)
        {
            if (SystemInfo.graphicsDeviceType == GraphicsDeviceType.Null)
            {
                Log("no graphics device (was -nographics passed?): the stills are drawn on the GPU");
                return 1;
            }
            var cars = CarList(o);
            if (cars.Count == 0)
            {
                Log($"no cars: no {o.CarsJson}, no GLB and no baked prefab");
                return 1;
            }
            Directory.CreateDirectory(o.Out);
            Log($"{cars.Count} car(s), mode {o.Mode}, {o.Width}x{o.Height} supersampled x{o.Supersample}, " +
                $"MSAA up to {o.Msaa} -> {o.Out}");

            var report = new Report(o);
            var pipelines = new Pipelines();
            bool asyncShaders = ShaderUtil.allowAsyncCompilation;
            var clock = Stopwatch.StartNew();
            try
            {
                // In the Editor a shader variant not compiled yet draws with
                // a cyan stand-in until a background compile lands. A still
                // waits for the real one.
                ShaderUtil.allowAsyncCompilation = false;
                pipelines.FindGame();
                bool going = true;
                if (o.Studio)
                {
                    pipelines.Use(pipelines.Studio());
                    going = StudioStage.RenderAll(o, cars, report, progress);
                }
                if (o.Street && going)
                {
                    pipelines.Use(pipelines.Street());
                    StreetStage.RenderAll(o, cars, report, progress);
                }
            }
            finally
            {
                // Out of the last stage's scene first: its probe holds a
                // texture in the cache that is about to be deleted.
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                pipelines.Restore();
                ShaderUtil.allowAsyncCompilation = asyncShaders;
                Stills.DropProbeCache();
                report.Write();
            }
            Log($"{report.Rendered} rendered, {report.Skipped} up to date, {report.Failed} failed, " +
                $"in {clock.Elapsed.TotalMinutes:0.0} min -> {o.Out}");
            return report.Failed == 0 ? 0 : 1;
        }

        /// <summary>The cars: press/renders/cars.json (the export's
        /// catalogue, with names), or, without it, every car CarLibrary can
        /// load (a GLB, or a prefab baked into Resources/Cars). -only
        /// filters it; an id not in it is a bad argument.</summary>
        static List<CarEntry> CarList(StudioOptions o)
        {
            var all = new List<CarEntry>();
            if (File.Exists(o.CarsJson))
            {
                if (!(MiniJson.Parse(File.ReadAllText(o.CarsJson)) is List<object> records))
                    throw new FormatException(o.CarsJson + " is not a JSON array");
                foreach (var r in records)
                {
                    var id = MiniJson.S(r, "id", null);
                    if (!string.IsNullOrEmpty(id)) all.Add(new CarEntry(id, MiniJson.S(r, "name", id)));
                }
            }
            else
            {
                Log($"no {o.CarsJson}: rendering every car CarLibrary can find");
                var glbs = new[]
                {
                    Path.Combine(Application.streamingAssetsPath, "Cars"),
                    Path.Combine(o.Repo, "press", "renders", "glb"),
                };
                var baked = Path.Combine(Application.dataPath, "Resources", "Cars");
                var ids = glbs.Where(Directory.Exists)
                    .SelectMany(d => Directory.GetFiles(d, "*.glb"))
                    .Select(Path.GetFileNameWithoutExtension);
                if (Directory.Exists(baked))
                    ids = ids.Concat(Directory.GetDirectories(baked).Select(Path.GetFileName)
                        .Where(id => File.Exists(Path.Combine(baked, id, id + ".prefab"))));
                foreach (var id in ids.Distinct().OrderBy(x => x, StringComparer.Ordinal))
                    all.Add(new CarEntry(id, id));
            }
            if (o.Only.Count == 0) return all;
            var unknown = o.Only.Where(id => all.All(c => c.Id != id)).ToList();
            if (unknown.Count > 0) throw new ArgumentException("not in the car list: " + string.Join(", ", unknown));
            return all.Where(c => o.Only.Contains(c.Id)).ToList();
        }
    }

    /// <summary>The command line, as the old studio took it, plus -mode,
    /// -out and the street's knobs. Relative paths are from the repo root.</summary>
    internal sealed class StudioOptions
    {
        /// <summary>tools/blender/studio.py GAME_EXPOSURE_EV: the game
        /// tone-maps with three.js ACESFilmic, which is ACES 1.3 at x / 0.6,
        /// +0.737 EV. URP's ACES is the same RRT+ODT, so the studio set takes
        /// the same lift to sit at the game's (and the Cycles set's) white
        /// level. The old Unity studio's 0 sat 0.74 EV under both.</summary>
        public const float GameExposureEv = 0.737f;

        public string Repo, Out, CarsJson, Mode = "both";
        public List<string> Only = new List<string>();
        public int Width = 2560, Height = 1440, Supersample = 2, Msaa = 8, Lane = 1;
        public bool Force, FlipNose, NoMirror;
        public float LightScale = 1f, Exposure = GameExposureEv, StreetExposure, StreetS = 160f;

        public bool Studio => Mode != "street";
        public bool Street => Mode != "studio";

        /// <param name="mode">Overrides -mode (the menu items).</param>
        public static StudioOptions Parse(string[] argv, string mode)
        {
            var o = new StudioOptions();
            o.Repo = Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));
            string Get(string name)
            {
                int i = Array.IndexOf(argv, "-" + name);
                return i >= 0 && i + 1 < argv.Length ? argv[i + 1] : null;
            }
            bool Has(string name) => Array.IndexOf(argv, "-" + name) >= 0;
            string Abs(string p) => Path.GetFullPath(Path.IsPathRooted(p) ? p : Path.Combine(o.Repo, p));
            int Int(string name, int fallback, int min)
            {
                var s = Get(name);
                if (s == null) return fallback;
                if (!int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) || v < min)
                    throw new ArgumentException($"-{name} {s}: a whole number of at least {min}");
                return v;
            }
            float Float(string name, float fallback)
            {
                var s = Get(name);
                if (s == null) return fallback;
                if (!float.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) || float.IsNaN(v) || float.IsInfinity(v))
                    throw new ArgumentException($"-{name} {s}: a number");
                return v;
            }

            o.Mode = (mode ?? Get("mode") ?? "both").ToLowerInvariant();
            if (o.Mode != "studio" && o.Mode != "street" && o.Mode != "both")
                throw new ArgumentException($"-mode {o.Mode}: studio, street or both");
            o.Out = Abs(Get("out") ?? "press/unity");
            o.CarsJson = Abs(Get("cars") ?? "press/renders/cars.json");
            var only = Get("only");
            if (only != null) o.Only = only.Split(',').Select(x => x.Trim()).Where(x => x.Length > 0).ToList();
            o.Width = Int("width", o.Width, 16);
            o.Height = Int("height", o.Height, 16);
            // A power of two, so the downsample is a chain of exact 2x2
            // boxes (Stills.Shoot); 4 is already 10240 x 5760 at 2560 x 1440.
            int ss = Int("supersample", o.Supersample, 1);
            o.Supersample = ss >= 4 ? 4 : ss >= 2 ? 2 : 1;
            if (o.Supersample != ss) CarStudio.Log($"-supersample {ss} -> {o.Supersample} (1, 2 or 4)");
            o.Msaa = Int("msaa", o.Msaa, 1);
            o.Lane = Int("lane", o.Lane, 0);
            int lanes = global::TrackSpline.Lanes.Length;
            if (o.Lane >= lanes) throw new ArgumentException($"-lane {o.Lane}: the road has lanes 0 to {lanes - 1}");
            o.StreetS = Float("streetS", o.StreetS);
            o.LightScale = Float("lightScale", o.LightScale);
            o.Exposure = Float("exposure", o.Exposure);
            o.StreetExposure = Float("streetExposure", o.StreetExposure);
            o.Force = Has("force");
            o.FlipNose = Has("flipNose");
            o.NoMirror = Has("noMirror");
            return o;
        }
    }

    /// <summary>
    /// Which URP asset draws each set, without touching the game's.
    /// QualitySettings.renderPipeline (which wins over the Graphics
    /// default) is pointed at an in-memory asset for the run and put back
    /// afterwards; the in-memory assets are DontSave, never written to
    /// disk, and the game's GulfRoadURP.asset is never edited.
    /// </summary>
    internal sealed class Pipelines
    {
        const string PostProcessDataPath = "Packages/com.unity.render-pipelines.universal/Runtime/Data/PostProcessData.asset";

        RenderPipelineAsset quality;
        UniversalRenderPipelineAsset game, studio, street;
        bool found;

        /// <summary>The game's URP asset; Night Racer > Setup Rendering
        /// (RenderSetup.Setup) makes it first if none is assigned.</summary>
        public void FindGame()
        {
            quality = QualitySettings.renderPipeline;
            game = Current();
            if (game == null)
            {
                CarStudio.Log("no URP asset assigned: running Night Racer > Setup Rendering (RenderSetup.Setup) first");
                global::RenderSetup.Setup();
                quality = QualitySettings.renderPipeline;
                game = Current();
                if (game == null) throw new InvalidOperationException("RenderSetup.Setup() left no URP asset assigned");
            }
            found = true;
            // URP and every number in both sets assume linear lighting.
            // RenderSetup sets it; an older project may not have run it.
            if (PlayerSettings.colorSpace != ColorSpace.Linear)
            {
                CarStudio.Log("colour space was Gamma; setting Linear, as RenderSetup does");
                PlayerSettings.colorSpace = ColorSpace.Linear;
            }
            CarStudio.Log($"game pipeline: {game.name}");
        }

        static UniversalRenderPipelineAsset Current()
        {
            var q = QualitySettings.renderPipeline;
            return (q != null ? q : GraphicsSettings.defaultRenderPipeline) as UniversalRenderPipelineAsset;
        }

        public void Use(RenderPipelineAsset asset) => QualitySettings.renderPipeline = asset;

        public void Restore()
        {
            if (found) QualitySettings.renderPipeline = quality;
        }

        /// <summary>
        /// The studio's pipeline, the old studio's settings: Forward+ so all
        /// eighteen studio lights reach every pixel (plain Forward stops at
        /// eight per object, and each car body is one renderer), soft
        /// additional-light shadows in an 8K atlas, HDR grading, and
        /// rendering layers on for the rim's floor exclusion and the
        /// mirrored lights (StudioStage).
        /// </summary>
        public UniversalRenderPipelineAsset Studio()
        {
            if (studio != null) return studio;
            var rd = ScriptableObject.CreateInstance<UniversalRendererData>();
            rd.name = "Studio-Renderer";
            rd.hideFlags = HideFlags.DontSave;
            rd.renderingMode = RenderingMode.ForwardPlus;
            // PostProcessData.GetDefaultPostProcessData() is internal in URP
            // 17 (PostProcessData.cs:39); this is the path it loads.
            rd.postProcessData = AssetDatabase.LoadAssetAtPath<PostProcessData>(PostProcessDataPath);
            if (rd.postProcessData == null) CarStudio.Log($"no {PostProcessDataPath}: the studio set renders without post-processing");
            var a = UniversalRenderPipelineAsset.Create(rd);
            a.name = "Studio-URP";
            a.hideFlags = HideFlags.DontSave;
            a.supportsHDR = true;
            a.hdrColorBufferPrecision = HDRColorBufferPrecision._64Bits; // the default R11G11B10 bands dark gradients
            a.msaaSampleCount = 8; // only has to be above 1: the count comes from the target (Stills.Shoot)
            a.renderScale = 1f;
            a.shadowDistance = 80f;
            // These have no public setters in URP 17 (UniversalRenderPipelineAsset.cs:
            // supportsAdditionalLightShadows, supportsSoftShadows and
            // additionalLightsRenderingMode are internal set); the serialized
            // fields (:517-574) have kept their names.
            var so = new SerializedObject(a);
            Set(so, "m_AdditionalLightsRenderingMode", p => p.intValue = (int)LightRenderingMode.PerPixel);
            Set(so, "m_AdditionalLightShadowsSupported", p => p.boolValue = true);
            Set(so, "m_AdditionalLightsShadowmapResolution", p => p.intValue = 8192);
            Set(so, "m_AdditionalLightsShadowResolutionTierHigh", p => p.intValue = 2048);
            Set(so, "m_SoftShadowsSupported", p => p.boolValue = true);
            Set(so, "m_SoftShadowQuality", p => p.intValue = (int)SoftShadowQuality.High);
            Set(so, "m_ColorGradingMode", p => p.intValue = (int)ColorGradingMode.HighDynamicRange);
            Set(so, "m_SupportsLightLayers", p => p.boolValue = true);
            so.ApplyModifiedPropertiesWithoutUndo();
            studio = a;
            return a;
        }

        /// <summary>The game's own pipeline, cloned in memory with two still
        /// settings raised: 64-bit HDR (a night street is all dark
        /// gradient) and MSAA on, which URP needs on the asset before it
        /// takes the target's count. Renderer, post data, lights and
        /// shadows are the game's.</summary>
        public UniversalRenderPipelineAsset Street()
        {
            if (street != null) return street;
            var a = Object.Instantiate(game);
            a.name = game.name + " (stills)";
            a.hideFlags = HideFlags.DontSave;
            a.hdrColorBufferPrecision = HDRColorBufferPrecision._64Bits;
            if (a.msaaSampleCount < 2) a.msaaSampleCount = 4;
            street = a;
            return a;
        }

        static void Set(SerializedObject so, string field, Action<SerializedProperty> set)
        {
            var p = so.FindProperty(field);
            if (p != null) set(p);
            else CarStudio.Log($"URP asset has no {field}; left at its default");
        }
    }

    /// <summary>
    /// press/unity/unity.json, merged by car and set: a -only or one-mode
    /// run replaces what it rendered and keeps the rest, as the Blender
    /// set's renders.json does.
    /// </summary>
    internal sealed class Report
    {
        static readonly string[] Modes = { "studio", "street" };

        readonly string path;
        readonly Dictionary<string, object> old;
        readonly List<object> cars;
        readonly Dictionary<string, object> settings = new Dictionary<string, object>();
        public int Rendered, Skipped, Failed;

        public Report(StudioOptions o)
        {
            path = Path.Combine(o.Out, "unity.json");
            try
            {
                if (File.Exists(path)) old = MiniJson.Parse(File.ReadAllText(path)) as Dictionary<string, object>;
            }
            catch (Exception e)
            {
                CarStudio.Log($"{path} is unreadable ({e.Message}); starting it afresh");
            }
            old = old ?? new Dictionary<string, object>();
            cars = (MiniJson.A(old, "cars") ?? new List<object>()).Where(c => MiniJson.S(c, "id", null) != null).ToList();
        }

        public void Settings(string mode, Dictionary<string, object> s) => settings[mode] = s;

        public void Set(CarEntry car, string mode, double seconds, List<object> shots, List<object> failures, string size)
        {
            var rec = cars.OfType<Dictionary<string, object>>().FirstOrDefault(c => MiniJson.S(c, "id", null) == car.Id);
            if (rec == null)
            {
                rec = new Dictionary<string, object> { ["id"] = car.Id };
                cars.Add(rec);
            }
            rec["name"] = car.Name;
            if (size != null) rec["size"] = size;
            rec[mode] = new Dictionary<string, object>
            {
                ["seconds"] = Math.Round(seconds, 1),
                ["shots"] = shots,
                ["failures"] = failures,
            };
            if (failures.Count > 0) Failed++;
            else Rendered++;
        }

        public void Write()
        {
            var root = new Dictionary<string, object>
            {
                ["renderer"] = $"Unity {Application.unityVersion} URP",
                ["updated"] = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture),
            };
            foreach (var m in Modes)
            {
                if (settings.TryGetValue(m, out var s)) root[m] = s;
                else if (old.TryGetValue(m, out var prev)) root[m] = prev;
            }
            root["cars"] = cars;
            root["failed"] = cars.Where(c => Modes.Any(m => (MiniJson.A(MiniJson.O(c, m), "failures")?.Count ?? 0) > 0))
                                 .Select(c => (object)MiniJson.S(c, "id", "")).ToList();
            foreach (var kv in old)
                if (!root.ContainsKey(kv.Key)) root[kv.Key] = kv.Value;
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path + ".part", Json.Write(root));
            if (File.Exists(path)) File.Delete(path);
            File.Move(path + ".part", path);
        }
    }

    /// <summary>A JSON writer for what MiniJson reads back: dictionaries,
    /// lists, strings, numbers, booleans and null. Lists of scalars stay on
    /// one line.</summary>
    internal static class Json
    {
        public static string Write(object v)
        {
            var sb = new StringBuilder();
            Value(sb, v, 0);
            return sb.Append('\n').ToString();
        }

        static void Value(StringBuilder sb, object v, int depth)
        {
            switch (v)
            {
                case null: sb.Append("null"); return;
                case string s: Str(sb, s); return;
                case bool b: sb.Append(b ? "true" : "false"); return;
                case double d: Num(sb, d); return;
                case float f: Num(sb, f); return;
                case int i: sb.Append(i.ToString(CultureInfo.InvariantCulture)); return;
                case IDictionary<string, object> o:
                {
                    if (o.Count == 0) { sb.Append("{}"); return; }
                    sb.Append("{\n");
                    int k = 0;
                    foreach (var kv in o)
                    {
                        sb.Append(' ', 2 * (depth + 1));
                        Str(sb, kv.Key);
                        sb.Append(": ");
                        Value(sb, kv.Value, depth + 1);
                        sb.Append(++k < o.Count ? ",\n" : "\n");
                    }
                    sb.Append(' ', 2 * depth).Append('}');
                    return;
                }
                case IList<object> a:
                {
                    if (a.Count == 0) { sb.Append("[]"); return; }
                    if (a.All(x => !(x is IDictionary<string, object>) && !(x is IList<object>)))
                    {
                        sb.Append('[');
                        for (int i = 0; i < a.Count; i++)
                        {
                            if (i > 0) sb.Append(", ");
                            Value(sb, a[i], depth);
                        }
                        sb.Append(']');
                        return;
                    }
                    sb.Append("[\n");
                    for (int i = 0; i < a.Count; i++)
                    {
                        sb.Append(' ', 2 * (depth + 1));
                        Value(sb, a[i], depth + 1);
                        sb.Append(i + 1 < a.Count ? ",\n" : "\n");
                    }
                    sb.Append(' ', 2 * depth).Append(']');
                    return;
                }
                default: Str(sb, Convert.ToString(v, CultureInfo.InvariantCulture)); return;
            }
        }

        static void Num(StringBuilder sb, double d)
        {
            if (double.IsNaN(d) || double.IsInfinity(d)) sb.Append("null");
            else sb.Append(Math.Round(d, 4).ToString("0.####", CultureInfo.InvariantCulture));
        }

        static void Str(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }
    }
}
