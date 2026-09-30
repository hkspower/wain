// Studio beauty renders of every car in the catalogue, in Unity (URP).
//
//   tools/unity/render-cars.sh                       # all of them, 2560x1440
//   tools/unity/render-cars.sh --only black-demon    # one, for a look
//
// The Unity twin of tools/blender/render_cars.py: the same cars (the GLBs
// tools/shots/export-cars.mjs writes to press/renders/glb), the same stage
// and the same camera, so a Unity render and a Cycles render of one car
// can be laid side by side. Writes press/unity/<id>.png and unity.json.
//
// THE STAGE, PORTED. Every position below is render_cars.py's, taken from
// Blender's Z-up frame (car nose toward -Y, camera flank +X) into Unity's
// Y-up one through B(): glTFast mirrors X on import and glTF's +Z (the
// nose) stays +Z, so Blender (x, y, z) is Unity (-x, z, -y). URP has no
// realtime area lights, so each area light is a soft spot of the same
// colour and relative power, and the long roof strip is a row of five.
// What an area light also gives in Cycles — its shape in the paint's
// reflection — comes from an unlit panel of the same size and place that
// only the reflection probe sees.
//
// THE FLOOR'S REFLECTION. URP has no screen-space or planar reflections
// out of the box, so the car is instanced a second time mirrored under a
// floor that lets 14% of it through: the brochure reflection, cheaply.
//
// WHAT IT CANNOT CARRY. glTFast's URP shaders have no clearcoat, so the
// paint is the base layer only; Cycles has the coat. Tonemapping is ACES,
// as in the game and the Blender set.
//
// Run by render-cars.sh as
//   Unity -batchmode -projectPath <this> -executeMethod NightRacer.RenderCars.Run
// without -quit (the loading is async and the editor must keep ticking;
// Run exits itself) and without -nographics (it renders on the GPU).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using GLTFast;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Experimental.Rendering;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using Debug = UnityEngine.Debug;

namespace NightRacer
{
    public static class RenderCars
    {
        const int LayerCar = 29, LayerMirror = 30, LayerPanel = 31;
        static readonly Color Sodium = new Color(0.92f, 0.40f, 0.03f);

        [Serializable] class CarRec { public string id; public string name; }
        [Serializable] class CarList { public CarRec[] cars; }

        class Args
        {
            public string root, glbDir, cars, outDir, only;
            public int width = 2560, height = 1440, supersample = 2;
            public bool force, flipNose, noMirror;
            public float lightScale = 1f, exposure = 0f;
        }

        static void Log(string s) => Debug.Log("[render] " + s);

        public static void Run()
        {
            // Unity would quit as soon as this returns with -quit; without
            // it the editor keeps ticking, the awaits below resume on its
            // update loop, and Main exits with the batch's status.
            _ = Main();
        }

        static async Task Main()
        {
            int code = 1;
            try { code = await RenderAll(ParseArgs()); }
            catch (Exception e) { Debug.LogException(e); }
            EditorApplication.Exit(code);
        }

        static Args ParseArgs()
        {
            var a = new Args();
            string project = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
            a.root = Path.GetFullPath(Path.Combine(project, "..", "..", ".."));
            var argv = Environment.GetCommandLineArgs();
            string Get(string name)
            {
                int i = Array.IndexOf(argv, "-" + name);
                return i >= 0 && i + 1 < argv.Length ? argv[i + 1] : null;
            }
            bool Has(string name) => Array.IndexOf(argv, "-" + name) >= 0;
            string Abs(string p) => Path.IsPathRooted(p) ? p : Path.Combine(a.root, p);
            a.glbDir = Abs(Get("glbDir") ?? "press/renders/glb");
            a.cars = Abs(Get("cars") ?? "press/renders/cars.json");
            a.outDir = Abs(Get("out") ?? "press/unity");
            a.only = Get("only");
            if (Get("width") is string w) a.width = int.Parse(w, CultureInfo.InvariantCulture);
            if (Get("height") is string h) a.height = int.Parse(h, CultureInfo.InvariantCulture);
            if (Get("supersample") is string s) a.supersample = Math.Max(1, int.Parse(s, CultureInfo.InvariantCulture));
            if (Get("lightScale") is string l) a.lightScale = float.Parse(l, CultureInfo.InvariantCulture);
            if (Get("exposure") is string x) a.exposure = float.Parse(x, CultureInfo.InvariantCulture);
            a.force = Has("force");
            a.flipNose = Has("flipNose");
            a.noMirror = Has("noMirror");
            return a;
        }

        static async Task<int> RenderAll(Args a)
        {
            SetUpPipeline();
            Directory.CreateDirectory(a.outDir);
            var cars = JsonUtility.FromJson<CarList>("{\"cars\":" + File.ReadAllText(a.cars) + "}").cars;
            var todo = cars.Where(c => a.only == null || a.only.Split(',').Contains(c.id)).ToList();
            if (todo.Count == 0) { Log($"no cars match '{a.only}'"); return 1; }

            var records = new List<string>();
            var failed = new List<string>();
            var total = Stopwatch.StartNew();
            for (int n = 0; n < todo.Count; n++)
            {
                var car = todo[n];
                string glb = Path.Combine(a.glbDir, car.id + ".glb");
                string png = Path.Combine(a.outDir, car.id + ".png");
                if (!File.Exists(glb)) { Log($"{car.id}: no GLB at {glb}; skipped"); failed.Add(car.id); continue; }
                if (!a.force && File.Exists(png) && File.GetLastWriteTimeUtc(png) > File.GetLastWriteTimeUtc(glb))
                {
                    Log($"{car.id}: up to date; skipped");
                    continue;
                }
                var sw = Stopwatch.StartNew();
                try
                {
                    string size = await RenderOne(a, glb, png);
                    double secs = sw.Elapsed.TotalSeconds;
                    records.Add($"{{\"id\":\"{car.id}\",\"file\":\"{car.id}.png\",\"seconds\":{secs.ToString("0.0", CultureInfo.InvariantCulture)},\"size\":\"{size}\"}}");
                    double eta = total.Elapsed.TotalSeconds / (n + 1) * (todo.Count - n - 1);
                    Log($"{n + 1}/{todo.Count} {car.name}: {size}, {secs:0.0} s; ETA {eta / 60:0.0} min");
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                    Log($"{car.id}: FAILED ({e.Message}); skipped");
                    failed.Add(car.id);
                }
            }

            var json = new StringBuilder();
            json.Append("{\n  \"renderer\": \"Unity ").Append(Application.unityVersion).Append(" URP\",\n");
            json.Append($"  \"width\": {a.width},\n  \"height\": {a.height},\n  \"supersample\": {a.supersample},\n");
            json.Append("  \"cars\": [\n    ").Append(string.Join(",\n    ", records)).Append("\n  ],\n");
            json.Append("  \"failed\": [").Append(string.Join(", ", failed.Select(f => $"\"{f}\""))).Append("]\n}\n");
            File.WriteAllText(Path.Combine(a.outDir, "unity.json"), json.ToString());
            Log($"{records.Count} rendered, {failed.Count} failed, in {total.Elapsed.TotalMinutes:0.0} min -> {a.outDir}");
            return failed.Count == 0 ? 0 : 1;
        }

        // ---- The pipeline: URP made in code, so the project needs no
        // hand-made assets. Forward+ so the nine studio lights all reach
        // every pixel (plain Forward stops at eight per object).
        static void SetUpPipeline()
        {
            const string dir = "Assets/Studio";
            if (!AssetDatabase.IsValidFolder(dir)) AssetDatabase.CreateFolder("Assets", "Studio");
            if (PlayerSettings.colorSpace != ColorSpace.Linear) PlayerSettings.colorSpace = ColorSpace.Linear;

            var asset = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(dir + "/Studio-URP.asset");
            if (asset == null)
            {
                var rd = ScriptableObject.CreateInstance<UniversalRendererData>();
                rd.renderingMode = RenderingMode.ForwardPlus;
                if (rd.postProcessData == null)
                    rd.postProcessData = AssetDatabase.LoadAssetAtPath<PostProcessData>(
                        "Packages/com.unity.render-pipelines.universal/Runtime/Data/PostProcessData.asset");
                AssetDatabase.CreateAsset(rd, dir + "/Studio-Renderer.asset");
                asset = UniversalRenderPipelineAsset.Create(rd);
                AssetDatabase.CreateAsset(asset, dir + "/Studio-URP.asset");
            }
            asset.supportsHDR = true;
            asset.msaaSampleCount = 8;
            asset.shadowDistance = 80f;
            asset.renderScale = 1f;
            // The shadow switches have no public setters in every URP
            // version; the serialized fields have kept their names.
            var so = new SerializedObject(asset);
            void Set(string field, Action<SerializedProperty> f) { var p = so.FindProperty(field); if (p != null) f(p); }
            Set("m_AdditionalLightsRenderingMode", p => p.intValue = 1);          // per pixel
            Set("m_AdditionalLightShadowsSupported", p => p.boolValue = true);
            Set("m_AdditionalLightsShadowmapResolution", p => p.intValue = 8192);
            Set("m_AdditionalLightsShadowResolutionTierHigh", p => p.intValue = 2048);
            Set("m_SoftShadowsSupported", p => p.boolValue = true);
            Set("m_SoftShadowQuality", p => p.intValue = 3);                       // high
            Set("m_ColorGradingMode", p => p.intValue = 1);                        // HDR grading
            so.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(asset);
            AssetDatabase.SaveAssets();

            GraphicsSettings.defaultRenderPipeline = asset;
            QualitySettings.renderPipeline = asset;
        }

        // Blender offset from the car's floor-centre -> Unity.
        static Vector3 B(float x, float y, float z) => new Vector3(-x, z, -y);

        static Color Lin(float r, float g, float b) => new Color(r, g, b).gamma; // linear value -> Color API (sRGB)

        static async Task<string> RenderOne(Args a, string glbPath, string pngPath)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var made = new List<UnityEngine.Object>();
            var gltf = new GltfImport(deferAgent: new UninterruptedDeferAgent());
            try
            {
                if (!await gltf.LoadFile(glbPath)) throw new Exception("glTFast could not load the file");

                // The car, centred on the origin with its wheels on y = 0.
                var carRoot = new GameObject("Car");
                var body = new GameObject("Body");
                body.transform.SetParent(carRoot.transform, false);
                if (!await gltf.InstantiateMainSceneAsync(body.transform)) throw new Exception("glTFast could not instantiate the scene");
                if (a.flipNose) carRoot.transform.rotation = Quaternion.Euler(0, 180, 0);
                var bounds = BoundsOf(carRoot);
                body.transform.position -= new Vector3(bounds.center.x, bounds.min.y, bounds.center.z);
                bounds = BoundsOf(carRoot);
                SetLayer(carRoot, LayerCar);
                foreach (var r in carRoot.GetComponentsInChildren<Renderer>()) r.shadowCastingMode = ShadowCastingMode.On;

                var dims = bounds.size;
                float L = Mathf.Max(dims.x, dims.z), H = dims.y;
                var centre = new Vector3(0, H / 2, 0);

                if (!a.noMirror)
                {
                    // Mirrored under the floor. Unity flips the winding for a
                    // negative scale, so the copy renders the right way out.
                    var mirror = new GameObject("Mirror");
                    mirror.transform.localScale = new Vector3(1, -1, 1);
                    var copy = UnityEngine.Object.Instantiate(body, mirror.transform, true);
                    copy.transform.localPosition = body.transform.localPosition;
                    copy.transform.localRotation = body.transform.localRotation;
                    if (a.flipNose) mirror.transform.rotation = carRoot.transform.rotation;
                    SetLayer(mirror, LayerMirror);
                    foreach (var r in mirror.GetComponentsInChildren<Renderer>()) r.shadowCastingMode = ShadowCastingMode.Off;
                }

                made.Add(Floor(Mathf.Max(120f, L * 30f), a.noMirror));

                // render_cars.py's five lights, same places, colours and
                // relative power. Blender watts -> URP intensity by P/pi^2
                // (a one-sided Lambertian emitter at 1/d^2); -lightScale
                // trims the whole rig if the first render reads hot or dim.
                float k = a.lightScale / (Mathf.PI * Mathf.PI);
                Spot("Key", B(1.3f * L, -0.8f * L, 2.4f * H + 1.0f), centre, 1100 * k, 110, Color.white, 3.6f, 2.4f, true, made);
                Spot("Fill", B(-1.6f * L, -0.6f * L, 1.0f * H + 0.6f), centre, 170 * k, 150, Lin(0.86f, 0.91f, 1.0f), 5.0f, 3.5f, false, made);
                Spot("Rim", B(-0.5f * L, 1.4f * L, 2.2f * H + 1.0f), centre, 1400 * k, 80, Lin(0.95f, 0.97f, 1.0f), 2.2f, 1.2f, true, made);
                Spot("Sodium", B(-1.3f * L, 0.6f * L, 0.45f * H), new Vector3(0, 0.5f * H, 0), 260 * k, 70, Lin(Sodium.r, Sodium.g, Sodium.b), 1.6f, 0.6f, false, made);
                // The strip: straight down over the roof, along the car, a
                // little toward the camera's side. Five spots share its
                // power; one panel carries its shape into the paint.
                var stripAt = B(0.15f * L, 0, 2.5f * H + 0.9f);
                for (int i = 0; i < 5; i++)
                {
                    var p = stripAt + new Vector3(0, 0, (i - 2) * 0.6f * L);
                    Spot("Strip" + i, p, p + Vector3.down, 1500 * k / 5, 120, Color.white, 0, 0, i == 2, made);
                }
                made.Add(Panel("StripPanel", stripAt, Quaternion.LookRotation(Vector3.up, Vector3.forward), 0.35f, 3.0f * L, 1500 * k, Color.white));

                // Dim grey to everything but the camera, as the Blender world.
                RenderSettings.ambientMode = AmbientMode.Flat;
                RenderSettings.ambientLight = Lin(0.045f, 0.045f, 0.055f);
                RenderSettings.skybox = null;

                var probeGo = new GameObject("Probe");
                probeGo.transform.position = centre;
                var probe = probeGo.AddComponent<ReflectionProbe>();
                probe.mode = ReflectionProbeMode.Realtime;
                probe.refreshMode = ReflectionProbeRefreshMode.ViaScripting;
                probe.timeSlicingMode = ReflectionProbeTimeSlicingMode.NoTimeSlicing;
                probe.size = Vector3.one * 400f;
                probe.resolution = 1024;
                probe.hdr = true;
                probe.clearFlags = ReflectionProbeClearFlags.SolidColor;
                probe.backgroundColor = Lin(0.045f, 0.045f, 0.055f);
                probe.cullingMask = (1 << LayerPanel) | 1;   // the panels and the floor; not the car it sits inside
                probe.nearClipPlane = 0.05f;
                probe.farClipPlane = 1000f;
                made.Add(probeGo);

                var volGo = new GameObject("Grade");
                var vol = volGo.AddComponent<Volume>();
                vol.isGlobal = true;
                var profile = ScriptableObject.CreateInstance<VolumeProfile>();
                profile.Add<Tonemapping>(true).mode.Override(TonemappingMode.ACES);
                var bloom = profile.Add<Bloom>(true);
                bloom.intensity.Override(0.15f);
                bloom.threshold.Override(1.2f);
                profile.Add<ColorAdjustments>(true).postExposure.Override(a.exposure);
                vol.sharedProfile = profile;
                made.Add(volGo);
                made.Add(profile);

                var cam = MakeCamera(a, bounds, H);

                int rid = probe.RenderProbe();
                for (int t = 0; t < 300 && !probe.IsFinishedRendering(rid); t++) await Task.Delay(10);

                int W = a.width * a.supersample, Hh = a.height * a.supersample;
                var big = new RenderTexture(new RenderTextureDescriptor(W, Hh, GraphicsFormat.R8G8B8A8_SRGB, 24) { msaaSamples = 1 });
                var small = new RenderTexture(new RenderTextureDescriptor(a.width, a.height, GraphicsFormat.R8G8B8A8_SRGB, 0));
                big.Create(); small.Create();
                try
                {
                    // Twice: the first frame warms the shadow atlas and the
                    // probe binding; the second is the picture.
                    for (int pass = 0; pass < 2; pass++) Draw(cam, big);
                    // A 2x downsample through a bilinear blit is a 2x2 box
                    // filter: supersampled edges on top of the MSAA.
                    Graphics.Blit(big, small);
                    var prev = RenderTexture.active;
                    RenderTexture.active = small;
                    var tex = new Texture2D(a.width, a.height, TextureFormat.RGB24, false, false);
                    tex.ReadPixels(new Rect(0, 0, a.width, a.height), 0, 0);
                    tex.Apply();
                    RenderTexture.active = prev;
                    File.WriteAllBytes(pngPath + ".part", tex.EncodeToPNG());
                    File.Delete(pngPath);
                    File.Move(pngPath + ".part", pngPath);
                    UnityEngine.Object.DestroyImmediate(tex);
                }
                finally
                {
                    big.Release(); small.Release();
                    UnityEngine.Object.DestroyImmediate(big);
                    UnityEngine.Object.DestroyImmediate(small);
                }
                return $"{dims.x:0.00} x {dims.z:0.00} x {dims.y:0.00} m";
            }
            finally
            {
                foreach (var o in made) if (o != null) UnityEngine.Object.DestroyImmediate(o);
                gltf.Dispose();
            }
        }

        static void Draw(Camera cam, RenderTexture rt)
        {
            var req = new RenderPipeline.StandardRequest { destination = rt };
            if (RenderPipeline.SupportsRenderRequest(cam, req)) RenderPipeline.SubmitRenderRequest(cam, req);
            else { cam.targetTexture = rt; cam.Render(); cam.targetTexture = null; }
        }

        // Three-quarter front, a little below the beltline, fitted to the
        // car's BOX exactly as render_cars.py does: the eight corners go
        // through the lens and the camera walks back along its own axis
        // until the worst one sits at 93% of the half-frame.
        static Camera MakeCamera(Args a, Bounds b, float H)
        {
            var go = new GameObject("Cam");
            var cam = go.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = Color.black;
            cam.allowHDR = true;
            cam.allowMSAA = true;
            cam.cullingMask = ~(1 << LayerPanel);
            cam.nearClipPlane = 0.05f;
            cam.farClipPlane = 2000f;
            var extra = cam.GetUniversalAdditionalCameraData();
            extra.renderPostProcessing = true;
            extra.antialiasing = AntialiasingMode.None;
            extra.renderShadows = true;

            float tanH = 18f / 55f;                       // 55 mm on a 36 mm sensor, horizontal fit
            float tanV = tanH * a.height / a.width;
            cam.fieldOfView = 2f * Mathf.Atan(tanV) * Mathf.Rad2Deg;
            cam.aspect = (float)a.width / a.height;

            float az = -(Mathf.PI / 2 - 36f * Mathf.Deg2Rad), el = 8.5f * Mathf.Deg2Rad;
            var view = B(Mathf.Cos(el) * Mathf.Cos(az), Mathf.Cos(el) * Mathf.Sin(az), Mathf.Sin(el));
            var aim = new Vector3(b.center.x, b.min.y + 0.40f * H, b.center.z);
            var corners = new List<Vector3>();
            foreach (float x in new[] { b.min.x, b.max.x })
                foreach (float y in new[] { b.min.y, b.max.y })
                    foreach (float z in new[] { b.min.z, b.max.z })
                        corners.Add(new Vector3(x, y, z));
            float dist = 1f;
            for (int i = 0; i < 40; i++)
            {
                var pos = aim + view * dist;
                var inv = Quaternion.Inverse(Quaternion.LookRotation(aim - pos, Vector3.up));
                float worst = 0f;
                foreach (var c in corners)
                {
                    var p = inv * (c - pos);                   // camera space: +z forward
                    if (p.z <= 0.05f) { worst = 9f; break; }
                    worst = Mathf.Max(worst, Mathf.Abs(p.x) / (p.z * tanH), Mathf.Abs(p.y) / (p.z * tanV));
                }
                if (Mathf.Abs(worst - 0.93f) < 0.005f) break;
                dist *= worst / 0.93f;
            }
            go.transform.position = aim + view * dist;
            go.transform.rotation = Quaternion.LookRotation(aim - go.transform.position, Vector3.up);
            return cam;
        }

        static GameObject Floor(float size, bool opaque)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Plane);   // 10 x 10 m
            go.name = "Floor";
            go.transform.localScale = new Vector3(size / 10f, 1, size / 10f);
            UnityEngine.Object.DestroyImmediate(go.GetComponent<Collider>());
            var m = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            var c = Lin(0.010f, 0.010f, 0.011f);
            // Roughness 0.30 in Cycles; a lower specular than the default.
            m.SetFloat("_Smoothness", 0.70f);
            m.SetFloat("_Metallic", 0f);
            m.SetFloat("_SpecularHighlights", 1f);
            m.SetFloat("_ReceiveShadows", 1f);
            if (!opaque)
            {
                // Lets 14% of the mirrored car through: the reflection.
                c.a = 0.86f;
                m.SetFloat("_Surface", 1f);
                m.SetFloat("_Blend", 0f);
                m.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
                m.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
                m.SetFloat("_ZWrite", 0f);
                m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
                m.renderQueue = (int)RenderQueue.Transparent;
            }
            m.SetColor("_BaseColor", c);
            go.GetComponent<Renderer>().sharedMaterial = m;
            go.layer = 0;
            return go;
        }

        static void Spot(string name, Vector3 at, Vector3 target, float intensity, float spreadDeg, Color color,
                         float w, float h, bool shadows, List<UnityEngine.Object> made)
        {
            var go = new GameObject(name);
            go.transform.position = at;
            go.transform.rotation = Quaternion.LookRotation(target - at, Vector3.up);
            var l = go.AddComponent<Light>();
            l.type = LightType.Spot;
            l.spotAngle = Mathf.Min(spreadDeg, 170f);
            l.innerSpotAngle = l.spotAngle * 0.35f;
            l.intensity = intensity;
            l.color = color;
            l.range = 500f;
            l.shadows = shadows ? LightShadows.Soft : LightShadows.None;
            l.shadowStrength = 0.9f;
            l.shadowBias = 0.02f;
            l.shadowNormalBias = 0.2f;
            made.Add(go);
            if (w > 0) made.Add(Panel(name + "Panel", at, Quaternion.LookRotation(at - target, Vector3.up), w, h, intensity, color));
        }

        // What an area light looks like in the paint: an unlit rectangle
        // of its size, as bright as its power over its area, seen only by
        // the reflection probe. A Quad's visible face looks down its -Z.
        static GameObject Panel(string name, Vector3 at, Quaternion rot, float w, float h, float intensity, Color color)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
            go.name = name;
            go.transform.SetPositionAndRotation(at, rot);
            go.transform.localScale = new Vector3(w, h, 1);
            UnityEngine.Object.DestroyImmediate(go.GetComponent<Collider>());
            var m = new Material(Shader.Find("Universal Render Pipeline/Unlit"));
            float radiance = intensity / (w * h);
            m.SetColor("_BaseColor", new Color(color.r, color.g, color.b) * radiance);
            var r = go.GetComponent<Renderer>();
            r.sharedMaterial = m;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            go.layer = LayerPanel;
            return go;
        }

        static Bounds BoundsOf(GameObject go)
        {
            var rs = go.GetComponentsInChildren<Renderer>();
            if (rs.Length == 0) throw new Exception("the car has no renderers");
            var b = rs[0].bounds;
            foreach (var r in rs) b.Encapsulate(r.bounds);
            return b;
        }

        static void SetLayer(GameObject go, int layer)
        {
            foreach (var t in go.GetComponentsInChildren<Transform>(true)) t.gameObject.layer = layer;
        }
    }
}
