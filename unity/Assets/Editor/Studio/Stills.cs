using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using NightRacer.Cars;
using UnityEditor;
using UnityEngine;
using UnityEngine.Experimental.Rendering;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using Object = UnityEngine.Object;

namespace NightRacer.Studio
{
    /// <summary>One frame of a car: where the camera swings to, measured
    /// as tools/blender/studio.py SHOTS does it (azimuth from the nose
    /// toward the flank the camera sees, elevation, degrees).</summary>
    internal readonly struct Shot
    {
        public readonly string Name;
        public readonly float Az, El;
        public Shot(string name, float az, float el) { Name = name; Az = az; El = el; }
    }

    /// <summary>What a written still looks like, for unity.json and the log:
    /// the share of pixels with a channel at 255, and the median luma.
    /// The Blender set was tuned on these two numbers (commit 9a0052dd:
    /// "frame clip 6.0% -> 3.9%, median 33 -> 54").</summary>
    internal struct Levels
    {
        public float ClipPct;
        public int Median, Msaa;

        public static Levels Of(Texture2D t, int msaa)
        {
            var px = t.GetPixels32();
            var hist = new int[256];
            int clip = 0;
            foreach (var p in px)
            {
                if (p.r == 255 || p.g == 255 || p.b == 255) clip++;
                hist[(p.r * 54 + p.g * 183 + p.b * 19) >> 8]++; // Rec.709 luma, weights x256
            }
            int median = 0;
            for (int acc = 0; median < 255; median++)
            {
                acc += hist[median];
                if (acc >= px.Length / 2) break;
            }
            return new Levels { ClipPct = 100f * clip / Mathf.Max(1, px.Length), Median = median, Msaa = msaa };
        }

        public Dictionary<string, object> Json(string file, float lensMm) => new Dictionary<string, object>
        {
            ["file"] = file,
            ["lensMm"] = Math.Round(lensMm, 1),
            ["msaa"] = Msaa,
            ["clipPct"] = Math.Round(ClipPct, 2),
            ["median"] = Median,
        };

        public override string ToString() => $"clip {ClipPct:0.0}%, median {Median}";
    }

    /// <summary>
    /// What both sets share: the studio.py camera and its box fit, the
    /// supersampled MSAA render to PNG, the probe bake, and the cleanup a
    /// car built in edit mode needs.
    /// </summary>
    internal static class Stills
    {
        // tools/blender/studio.py: a 55 mm lens on a 36 mm sensor, fitted
        // horizontally, the worst box corner at 93% of the half-frame.
        public const float LensMm = 55f, SensorMm = 36f, Fill = 0.93f;

        public static readonly Shot[] Shots =
        {
            new Shot("hero", 36f, 8.5f),   // three-quarter front, a little below the beltline
            new Shot("side", 90f, 4f),     // the flank, square on
            new Shot("rear", 144f, 8.5f),  // three-quarter rear, same flank
        };

        // ------------------------------------------------------------ frame

        /// <summary>
        /// studio.py's frame (Blender: Z up, the car's nose toward -Y, the
        /// camera's flank +X) in a car's own Unity frame. CarAssetReader
        /// converts glTF the way glTFast does (X negated, nose kept on +Z),
        /// and Blender's importer turns glTF (x, y, z) into (x, -z, y), so
        /// Blender (x, y, z) is Unity (-x, z, -y). Blender's +X flank is
        /// therefore the car's left, Unity -X: the driver's side.
        /// </summary>
        public static Vector3 B(float x, float y, float z) => new Vector3(-x, z, -y);

        /// <summary>Unit vector from the aim point toward the camera, in the
        /// car's frame (studio.view_dir through B). <paramref name="rightFlank"/>
        /// swings it to the car's right (+X) instead.</summary>
        public static Vector3 ViewDir(Shot shot, bool rightFlank)
        {
            float a = -(Mathf.PI / 2f - shot.Az * Mathf.Deg2Rad), e = shot.El * Mathf.Deg2Rad;
            var v = B(Mathf.Cos(e) * Mathf.Cos(a), Mathf.Cos(e) * Mathf.Sin(a), Mathf.Sin(e));
            if (rightFlank) v.x = -v.x;
            return v;
        }

        /// <summary>The car's box in its own frame (origin on the ground
        /// under the car-group origin, nose +Z): body, hood, glass, wing,
        /// wheels. Measured with the rig parked at the world origin,
        /// unrotated, so world bounds are local ones. The contact-shadow
        /// quad is not the car.</summary>
        public static Bounds LocalBox(CarRig rig)
        {
            rig.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
            Bounds? box = null;
            foreach (var r in rig.GetComponentsInChildren<Renderer>())
            {
                if (r.gameObject.name == "ContactShadow") continue;
                if (box is Bounds b) { b.Encapsulate(r.bounds); box = b; }
                else box = r.bounds;
            }
            return box ?? throw new Exception("the car has no renderers");
        }

        /// <summary>
        /// What CarLibrary.LoadNow will build a car from, and when that last
        /// changed: its baked prefab (Resources/Cars/&lt;id&gt;/, which LoadNow
        /// prefers; any file in the folder counts, since a bake rewrites
        /// meshes and materials beside the prefab) and its GLB, the newer of
        /// the two. Null when it has neither.
        /// </summary>
        public static DateTime? SourceTime(string id)
        {
            DateTime? t = null;
            var glb = CarLibrary.PathFor(id);
            if (glb != null && File.Exists(glb)) t = File.GetLastWriteTimeUtc(glb);
            var baked = CarLibrary.BakedPrefab(id);
            if (baked != null)
            {
                var dir = Path.GetDirectoryName(Path.Combine(Path.GetDirectoryName(Application.dataPath), AssetDatabase.GetAssetPath(baked)));
                if (Directory.Exists(dir))
                    foreach (var f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
                    {
                        var ft = File.GetLastWriteTimeUtc(f);
                        if (t == null || ft > t) t = ft;
                    }
            }
            return t;
        }

        public static Vector3[] Corners(Transform car, Bounds box)
        {
            var c = new Vector3[8];
            int i = 0;
            foreach (float x in new[] { box.min.x, box.max.x })
                foreach (float y in new[] { box.min.y, box.max.y })
                    foreach (float z in new[] { box.min.z, box.max.z })
                        c[i++] = car.TransformPoint(new Vector3(x, y, z));
            return c;
        }

        /// <summary>studio.fit_camera's aim: the box centre at 40% of the
        /// height.</summary>
        public static Vector3 Aim(Transform car, Bounds box) =>
            car.TransformPoint(new Vector3(box.center.x, box.min.y + 0.40f * box.size.y, box.center.z));

        public static string Size(Bounds box) => $"{box.size.x:0.00} x {box.size.z:0.00} x {box.size.y:0.00} m";

        /// <summary>
        /// studio.fit_camera: walk the camera back along its view until the
        /// worst of the box corners sits at <paramref name="fill"/> of the
        /// half-frame. When <paramref name="fits"/> rejects where that puts
        /// the camera (the street's guard rail), the lens widens 8% at a
        /// time so the camera can stand closer. Returns the focal length
        /// used, in mm on the 36 mm sensor.
        /// </summary>
        public static float Frame(Camera cam, Vector3[] corners, Vector3 aim, Vector3 view, int width, int height,
                                  float fill, Func<Vector3, bool> fits = null)
        {
            float aspect = (float)width / height;
            float tanH = SensorMm / 2f / LensMm;
            Pose pose = default;
            for (int k = 0; k < 16; k++)
            {
                pose = Fit(corners, aim, view, tanH, tanH / aspect, fill);
                if (fits == null || fits(pose.position)) break;
                tanH *= 1.08f;
            }
            cam.transform.SetPositionAndRotation(pose.position, pose.rotation);
            cam.fieldOfView = 2f * Mathf.Atan(tanH / aspect) * Mathf.Rad2Deg; // Unity's FOV is vertical
            cam.aspect = aspect;
            return SensorMm / 2f / tanH;
        }

        static Pose Fit(Vector3[] corners, Vector3 aim, Vector3 view, float tanH, float tanV, float fill)
        {
            float dist = 1f;
            for (int i = 0; i < 40; i++)
            {
                var pos = aim + view * dist;
                var inv = Quaternion.Inverse(Quaternion.LookRotation(aim - pos, Vector3.up));
                float worst = 0f;
                foreach (var c in corners)
                {
                    var p = inv * (c - pos); // camera space: +z forward
                    if (p.z <= 0.05f) { worst = 9f; break; }
                    worst = Mathf.Max(worst, Mathf.Abs(p.x) / (p.z * tanH), Mathf.Abs(p.y) / (p.z * tanV));
                }
                if (Mathf.Abs(worst - fill) < 0.005f) break;
                dist *= worst / fill;
            }
            var at = aim + view * dist;
            return new Pose(at, Quaternion.LookRotation(aim - at, Vector3.up));
        }

        // ----------------------------------------------------------- render

        public static Camera MakeCamera(Transform parent, string name)
        {
            var go = new GameObject(name);
            if (parent != null) go.transform.SetParent(parent, false);
            var cam = go.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.allowHDR = true;
            cam.allowMSAA = true;
            var extra = cam.GetUniversalAdditionalCameraData();
            extra.renderPostProcessing = true;
            extra.antialiasing = AntialiasingMode.None; // MSAA on the target plus the supersample
            extra.renderShadows = true;
            extra.dithering = true;  // an 8-bit PNG of a night gradient bands without it
            extra.stopNaN = true;    // one NaN through bloom is a black square
            return cam;
        }

        public static Volume MakeVolume(Transform parent, string name, VolumeProfile profile, float priority)
        {
            var go = new GameObject(name);
            if (parent != null) go.transform.SetParent(parent, false);
            var v = go.AddComponent<Volume>();
            v.isGlobal = true;
            v.priority = priority;
            v.sharedProfile = profile;
            return v;
        }

        /// <summary>
        /// Draw <paramref name="cam"/> at the options' size times the
        /// supersample, filter it down and write <paramref name="png"/>
        /// (through a .part file, so an interrupted run never leaves half a
        /// PNG that looks newer than its GLB).
        /// </summary>
        public static Levels Shoot(Camera cam, StudioOptions o, string png)
        {
            int W = o.Width * o.Supersample, H = o.Height * o.Supersample;
            // URP takes MSAA from the target texture, not the pipeline asset
            // (UniversalRenderPipeline.cs:1323-1324: msaaSamples =
            // camera.targetTexture.antiAliasing, once the asset has MSAA on
            // at all), so the count is set here. The old studio left this at
            // 1 and got no MSAA. Ask the GPU what it has: a count it does
            // not support fails the texture.
            var desc = new RenderTextureDescriptor(W, H, GraphicsFormat.R8G8B8A8_SRGB, 24) { msaaSamples = o.Msaa };
            desc.msaaSamples = Mathf.Max(1, SystemInfo.GetRenderTextureSupportedMSAASampleCount(desc));
            var big = new RenderTexture(desc) { name = "Still", filterMode = FilterMode.Bilinear };
            big.Create();
            var tex = new Texture2D(o.Width, o.Height, TextureFormat.RGB24, false, false);
            var prev = RenderTexture.active;
            RenderTexture src = big;
            try
            {
                // Twice: the first frame warms the shadow atlas and the
                // probe binding; the second is the picture.
                Submit(cam, big);
                Submit(cam, big);
                // Halve until the output size (the supersample is a power of
                // two): one bilinear tap at exactly half size is a 2x2 box,
                // and an sRGB texture is read and written in linear light.
                // The MSAA target resolves when it is first read.
                for (int w = W, h = H; w > o.Width;)
                {
                    w /= 2;
                    h /= 2;
                    var half = RenderTexture.GetTemporary(new RenderTextureDescriptor(w, h, GraphicsFormat.R8G8B8A8_SRGB, 0));
                    half.filterMode = FilterMode.Bilinear;
                    Graphics.Blit(src, half);
                    if (src != big) RenderTexture.ReleaseTemporary(src);
                    src = half;
                }
                RenderTexture.active = src;
                tex.ReadPixels(new Rect(0, 0, o.Width, o.Height), 0, 0, false);
                tex.Apply(false);
                Directory.CreateDirectory(Path.GetDirectoryName(png));
                File.WriteAllBytes(png + ".part", tex.EncodeToPNG());
                if (File.Exists(png)) File.Delete(png);
                File.Move(png + ".part", png);
                return Levels.Of(tex, desc.msaaSamples);
            }
            finally
            {
                RenderTexture.active = prev;
                if (src != big) RenderTexture.ReleaseTemporary(src);
                big.Release();
                Object.DestroyImmediate(big);
                Object.DestroyImmediate(tex);
            }
        }

        /// <summary>
        /// One frame of <paramref name="cam"/> into <paramref name="rt"/>.
        /// StandardRequest, not UniversalRenderPipeline.SingleCameraRequest:
        /// URP 17 serves both (UniversalRenderPipeline.cs:509-525), but the
        /// single-camera path goes straight to RenderSingleCameraInternal
        /// (:674-697) and never calls UpdateVolumeFramework, which only the
        /// full Render path does (:486, :1030). With no other camera drawing
        /// in a batch run, the volume stack would never take the grade's
        /// ACES, bloom and exposure. Both requests are synchronous: the
        /// frame is in <paramref name="rt"/> when this returns.
        /// </summary>
        static void Submit(Camera cam, RenderTexture rt)
        {
            var req = new RenderPipeline.StandardRequest { destination = rt };
            if (RenderPipeline.SupportsRenderRequest(cam, req))
            {
                RenderPipeline.SubmitRenderRequest(cam, req);
                return;
            }
            cam.targetTexture = rt;
            cam.Render();
            cam.targetTexture = null;
        }

        public static bool UpToDate(DateTime source, string png) =>
            File.Exists(png) && File.GetLastWriteTimeUtc(png) > source;

        // ------------------------------------------------------------ probe

        /// <summary>Where baked probes are written while a run lasts. It has
        /// to be under Assets/ (the bake imports what it writes); the run
        /// deletes it at the end.</summary>
        public const string ProbeCache = "Assets/StudioCache";

        /// <summary>
        /// Bake <paramref name="probe"/> now, as a Custom probe, and bind the
        /// result to it. Why a bake and not a realtime probe:
        /// Lightmapping.BakeReflectionProbe is synchronous and says whether
        /// it worked; a realtime probe's RenderProbe() only queues the
        /// capture for the player loop's next render, which a synchronous
        /// -executeMethod never yields to, and a batch editor draws no
        /// views. (The old studio polled one for three seconds and drew the
        /// car whether or not it had finished.) A baked probe also ignores
        /// QualitySettings.realtimeReflectionProbes, which MobileTier turns
        /// off.
        /// </summary>
        public static bool Bake(ReflectionProbe probe, string name, out string why)
        {
            why = null;
            probe.mode = ReflectionProbeMode.Custom;
            // Custom probes only: draw objects that are not marked
            // ReflectionProbeStatic too. The stages mark theirs anyway.
            probe.renderDynamicObjects = true;
            if (!AssetDatabase.IsValidFolder(ProbeCache)) AssetDatabase.CreateFolder("Assets", Path.GetFileName(ProbeCache));
            string path = $"{ProbeCache}/{name}.{(probe.hdr ? "exr" : "png")}";
            var clock = Stopwatch.StartNew();
            if (!Lightmapping.BakeReflectionProbe(probe, path))
            {
                why = "Lightmapping.BakeReflectionProbe failed";
                return false;
            }
            // The bake imports its file as a specular-convolved cubemap, as
            // the Inspector's Bake button does. Should that ever change,
            // say so and import it that way here.
            if (AssetImporter.GetAtPath(path) is TextureImporter importer && importer.textureShape != TextureImporterShape.TextureCube)
            {
                CarStudio.Log($"{path} came in as {importer.textureShape}; re-importing it as a cubemap");
                var s = new TextureImporterSettings();
                importer.ReadTextureSettings(s);
                s.textureShape = TextureImporterShape.TextureCube;
                s.generateCubemap = TextureImporterGenerateCubemap.AutoCubemap;
                s.cubemapConvolution = TextureImporterCubemapConvolution.Specular;
                s.seamlessCubemap = true;
                s.sRGBTexture = false;
                s.mipmapEnabled = true;
                importer.SetTextureSettings(s);
                importer.SaveAndReimport();
            }
            var cube = AssetDatabase.LoadAssetAtPath<Texture>(path);
            if (cube == null || cube.dimension != TextureDimension.Cube)
            {
                why = $"{path} did not import as a cubemap";
                return false;
            }
            probe.customBakedTexture = cube;
            CarStudio.Log($"probe {name}: {probe.resolution} px HDR cube baked in {clock.Elapsed.TotalSeconds:0.0} s");
            return true;
        }

        public static void DropProbeCache()
        {
            if (AssetDatabase.IsValidFolder(ProbeCache)) AssetDatabase.DeleteAsset(ProbeCache);
        }

        /// <summary>Mark a hierarchy as something baked probes capture.</summary>
        public static void ProbeStatic(GameObject go)
        {
            foreach (var t in go.GetComponentsInChildren<Transform>(true))
                GameObjectUtility.SetStaticEditorFlags(t.gameObject,
                    GameObjectUtility.GetStaticEditorFlags(t.gameObject) | StaticEditorFlags.ReflectionProbeStatic);
        }

        // ----------------------------------------------------------- lights

        /// <summary>
        /// A soft spot light standing in for a studio area light. Light.color
        /// is sRGB by Unity's convention and URP lights with its .linear
        /// (lightsUseLinearIntensity), so a linear colour goes in as .gamma.
        /// <paramref name="layers"/> are URP rendering layers: the light
        /// reaches only renderers whose renderingLayerMask shares a bit, and
        /// with shadow layers left to follow it, casts shadows only from them.
        /// </summary>
        public static Light SpotLight(Transform parent, string name, Vector3 at, Vector3 dir, float intensity,
                                      float spreadDeg, Color linear, bool shadows, uint layers)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.SetPositionAndRotation(at, Aim(dir));
            var l = go.AddComponent<Light>();
            l.type = LightType.Spot;
            l.spotAngle = Mathf.Min(spreadDeg, 170f);
            l.innerSpotAngle = l.spotAngle * 0.35f;
            l.intensity = intensity;
            l.color = linear.gamma;
            l.range = 500f;
            l.shadows = shadows ? LightShadows.Soft : LightShadows.None;
            l.shadowStrength = 0.9f;
            RenderingLayers(l, layers);
            return l;
        }

        /// <summary>URP reads a light's rendering layers off its additional
        /// data (ForwardLights.cs:537-541); the built-in mask is what the
        /// engine culls shadow casters with, so both are set.</summary>
        public static void RenderingLayers(Light l, uint layers)
        {
            l.GetUniversalAdditionalLightData().renderingLayers = layers;
            l.renderingLayerMask = (int)layers;
        }

        /// <summary>LookRotation along <paramref name="dir"/>, with a usable
        /// up when the light hangs straight down (the roof strip).</summary>
        static Quaternion Aim(Vector3 dir)
        {
            var d = dir.normalized;
            return Quaternion.LookRotation(d, Mathf.Abs(d.y) > 0.99f ? Vector3.forward : Vector3.up);
        }

        /// <summary>A flat ambient that is really there. URP shades ambient
        /// from RenderSettings.ambientProbe, which the Editor otherwise
        /// refreshes only when it bakes the environment; a script that sets
        /// ambientLight and renders at once would light with whatever SH the
        /// last scene left.</summary>
        public static void Ambient(Color linear)
        {
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = linear.gamma;
            var sh = new SphericalHarmonicsL2();
            sh.AddAmbientLight(linear);
            RenderSettings.ambientProbe = sh;
        }

        // ------------------------------------------------------------- cars

        /// <summary>A car as it sits: tail lamps at idle (CarRig's brake
        /// starts at -1, so this sets them), and its contact shadow on or
        /// off. The studio has real shadows and the Blender set no blob; the
        /// street keeps the game's.</summary>
        public static void Dress(CarRig rig, bool contactShadow)
        {
            rig.SetBrake(0f);
            var blob = rig.transform.Find("ContactShadow");
            if (blob != null) blob.gameObject.SetActive(contactShadow);
        }

        public static void SetLayer(GameObject go, int layer)
        {
            foreach (var t in go.GetComponentsInChildren<Transform>(true)) t.gameObject.layer = layer;
        }

        /// <summary>Destroy a spawned car and the materials it owns. CarRig
        /// frees them in OnDestroy, which edit mode does not send to a plain
        /// MonoBehaviour; CarModel.Kill ignores what is already gone, so the
        /// order is safe either way.</summary>
        public static void Release(CarRig rig)
        {
            if (rig == null) return;
            Kill(rig.Paint);
            Kill(rig.TailCore);
            Object.DestroyImmediate(rig.gameObject);
        }

        /// <summary>
        /// Free what CarModel.Build made for one car from its GLB: the meshes
        /// it lists, its materials, textures and the template. None of them
        /// is a scene object, so a new scene does not take them with it, and
        /// seventeen cars of 257k-381k triangles each would otherwise stay in
        /// memory for the whole run. A model from a baked prefab is all
        /// assets (EditorUtility.IsPersistent), which are left alone:
        /// DestroyImmediate refuses assets, and they are the project's.
        /// Call after every rig spawned from the model is gone.
        /// </summary>
        public static void Free(CarModel m)
        {
            if (m == null) return;
            foreach (var mesh in m.Meshes.Values) Kill(mesh);
            if (m.Materials != null) foreach (var x in m.Materials) Kill(x);
            if (m.Textures != null) foreach (var x in m.Textures) Kill(x);
            Kill(m.Template);
        }

        static void Kill(Object o)
        {
            if (o != null && !EditorUtility.IsPersistent(o)) Object.DestroyImmediate(o);
        }

        public static void Destroy(List<Object> made)
        {
            foreach (var o in made)
                if (o != null) Object.DestroyImmediate(o);
            made.Clear();
        }
    }
}
