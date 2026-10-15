using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using NightRacer.Cars;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using Debug = UnityEngine.Debug;
using Object = UnityEngine.Object;

namespace NightRacer.Studio
{
    /// <summary>
    /// The studio set: tools/blender/studio.py's stage built in URP round a
    /// game car, the Unity twin of tools/blender/render_cars.py. Same five
    /// lights, floor and camera, so press/unity/&lt;id&gt;.png and
    /// press/renders/&lt;id&gt;.png can be laid side by side.
    ///
    /// THE STAGE, PORTED. Every position is studio.py's, taken from
    /// Blender's frame into the car's through Stills.B. URP has no realtime
    /// area lights, so each one is a soft spot of the same colour and
    /// relative power, and the long roof strip is a row of five. What an
    /// area light also gives in Cycles, its shape in the paint, comes from
    /// an unlit panel of the same size and place that only the reflection
    /// probe sees.
    ///
    /// THE FLOOR'S REFLECTION. URP has no screen-space or planar
    /// reflections, so the car is spawned a second time mirrored under a
    /// floor that lets 14% of it through. The twin is lit by a mirrored
    /// twin of every light, on its own rendering layer, so it shows what a
    /// mirror would: the car lit from above, seen from below.
    ///
    /// WHAT IS NOT THE SAME. Cycles' paint, glass and lamps come from the
    /// glTF through Blender's importer; here they are CarMaterials, the
    /// game's own (Complex Lit clear coat, premultiplied glass, the real
    /// emissive strengths). Tonemapping is URP's ACES, the same RRT+ODT
    /// family as Blender's ACES 1.3 view, at the same +0.737 EV.
    /// </summary>
    internal static class StudioStage
    {
        // Layers the stage uses; the car draws on CarModel.CarLayer (9).
        const int LayerMirror = 30, LayerPanel = 31;

        // URP rendering layers (light layers): which lights reach what.
        // studio.py keeps the rim light off the floor ("floor": False):
        // on a glossy floor its mirror image spread a clipped pool across
        // the lower right of every hero shot. Blender does it with light
        // linking; URP with rendering layers, which the studio pipeline
        // turns on (Pipelines.Studio).
        const uint LitCar = 1u, LitFloor = 2u, LitMirror = 4u;

        static readonly Color Sodium = new Color(0.92f, 0.40f, 0.03f);        // studio.SODIUM, linear
        static readonly Color WorldGrey = new Color(0.045f, 0.045f, 0.055f);  // studio.WORLD_GREY, linear

        /// <summary>Render every car's studio still. False when the user
        /// cancelled from the progress bar.</summary>
        public static bool RenderAll(StudioOptions o, List<CarEntry> cars, Report report, StillProgress progress)
        {
            report.Settings("studio", new Dictionary<string, object>
            {
                ["width"] = o.Width,
                ["height"] = o.Height,
                ["supersample"] = o.Supersample,
                ["msaaRequested"] = o.Msaa,
                ["exposureEv"] = o.Exposure,
                ["lightScale"] = o.LightScale,
                ["mirror"] = !o.NoMirror,
                ["lensMm"] = Stills.LensMm,
                ["shot"] = "hero",
            });
            var total = Stopwatch.StartNew();
            int drawn = 0;
            for (int n = 0; n < cars.Count; n++)
            {
                var car = cars[n];
                if (progress != null && progress($"Studio: {car.Name}", (float)n / cars.Count))
                {
                    CarStudio.Log("cancelled");
                    return false;
                }
                string png = Path.Combine(o.Out, car.Id + ".png");
                var source = Stills.SourceTime(car.Id);
                if (source == null)
                {
                    CarStudio.Log($"{car.Id}: {CarStudio.NoSource}; skipped");
                    report.Set(car, "studio", 0, new List<object>(), new List<object> { CarStudio.NoSource }, null);
                    continue;
                }
                if (!o.Force && Stills.UpToDate(source.Value, png))
                {
                    CarStudio.Log($"{car.Id}: studio still is newer than the car; skipped (-force to redo)");
                    report.Skipped++;
                    continue;
                }
                var clock = Stopwatch.StartNew();
                var shots = new List<object>();
                var failures = new List<object>();
                string size = null;
                try { size = RenderOne(o, car, png, shots, failures); }
                catch (Exception e)
                {
                    Debug.LogException(e);
                    failures.Add(e.Message);
                }
                double secs = clock.Elapsed.TotalSeconds;
                report.Set(car, "studio", secs, shots, failures, size);
                drawn++;
                double eta = total.Elapsed.TotalSeconds / drawn * (cars.Count - n - 1);
                CarStudio.Log($"studio {n + 1}/{cars.Count} {car.Name}: {(shots.Count > 0 ? size : "no still")}, {secs:0.0} s" +
                              (failures.Count > 0 ? $"; FAILED: {string.Join("; ", failures)}" : "") + $"; ETA {eta / 60:0.0} min");
            }
            return true;
        }

        static string RenderOne(StudioOptions o, CarEntry car, string png, List<object> shots, List<object> failures)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var made = new List<Object>();
            var model = CarLibrary.Instance.LoadNow(car.Id)
                        ?? throw new Exception("CarLibrary could not load it (see the [cars] lines above)");
            CarRig rig = null, twin = null;
            try
            {
                rig = model.Spawn();
                var box = Stills.LocalBox(rig);
                float L = Mathf.Max(box.size.x, box.size.z), H = box.size.y; // studio.dims: L is the long side
                // The stage is built round the car's box: its floor centre
                // on the origin, as studio.py centres on the box, not on
                // the car-group origin (zeta-300-gtr runs z -2.219..+2.311).
                var turn = o.FlipNose ? Quaternion.Euler(0f, 180f, 0f) : Quaternion.identity;
                var at = -(turn * new Vector3(box.center.x, 0f, box.center.z));
                at.y = -box.min.y;
                rig.transform.SetPositionAndRotation(at, turn);
                Stills.Dress(rig, contactShadow: false);
                foreach (var r in rig.GetComponentsInChildren<Renderer>(true)) r.renderingLayerMask = LitCar;

                var stage = new GameObject("Stage").transform;
                if (!o.NoMirror) twin = Mirror(model, at, turn);
                made.Add(Floor(stage, Mathf.Max(120f, L * 30f), seeThrough: !o.NoMirror));
                Lights(stage, L, H, o.LightScale, mirror: !o.NoMirror, made);

                // Dim grey to everything but the camera, as the Blender
                // world: what the paint reflects where there is no light.
                Stills.Ambient(WorldGrey);
                RenderSettings.skybox = null;
                RenderSettings.fog = false;

                var probe = new GameObject("Probe").AddComponent<ReflectionProbe>();
                probe.transform.SetParent(stage, false);
                probe.transform.position = new Vector3(0f, 0.5f * H, 0f);
                probe.size = Vector3.one * 400f;
                probe.resolution = 1024;
                probe.hdr = true;
                probe.clearFlags = ReflectionProbeClearFlags.SolidColor;
                probe.backgroundColor = WorldGrey.gamma;
                probe.cullingMask = (1 << LayerPanel) | 1; // the panels and the floor; not the car it sits in
                probe.nearClipPlane = 0.05f;
                probe.farClipPlane = 1000f;
                if (!Stills.Bake(probe, "studio", out var why)) failures.Add("probe: " + why);

                var grade = ScriptableObject.CreateInstance<VolumeProfile>();
                grade.name = "StudioGrade";
                made.Add(grade);
                grade.Add<Tonemapping>(true).mode.Override(TonemappingMode.ACES);
                var bloom = grade.Add<Bloom>(true);
                bloom.intensity.Override(0.15f);
                bloom.threshold.Override(1.2f);
                grade.Add<ColorAdjustments>(true).postExposure.Override(o.Exposure);
                Stills.MakeVolume(stage, "Grade", grade, 1f);

                var cam = Stills.MakeCamera(stage, "Cam");
                cam.backgroundColor = Color.black;
                cam.cullingMask = ~(1 << LayerPanel);
                cam.nearClipPlane = 0.05f;
                cam.farClipPlane = 2000f;
                var hero = Stills.Shots[0];
                float lens = Stills.Frame(cam, Stills.Corners(rig.transform, box), Stills.Aim(rig.transform, box),
                    Stills.ViewDir(hero, rightFlank: false), o.Width, o.Height, Stills.Fill);
                var levels = Stills.Shoot(cam, o, png);
                shots.Add(levels.Json(Path.GetFileName(png), lens));
                CarStudio.Log($"{car.Id}: {png} ({levels})");
                return Stills.Size(box);
            }
            finally
            {
                Stills.Release(twin);
                Stills.Release(rig);
                Stills.Free(model);
                Stills.Destroy(made);
            }
        }

        /// <summary>The car again, under a y = -1 parent. Unity flips the
        /// winding under a negative scale, so it renders right side out.</summary>
        static CarRig Mirror(CarModel model, Vector3 at, Quaternion turn)
        {
            var mirror = new GameObject("Mirror");
            mirror.transform.localScale = new Vector3(1f, -1f, 1f);
            var twin = model.Spawn(mirror.transform);
            twin.transform.localPosition = at;
            twin.transform.localRotation = turn;
            Stills.Dress(twin, contactShadow: false);
            Stills.SetLayer(mirror, LayerMirror);
            foreach (var r in mirror.GetComponentsInChildren<Renderer>(true))
            {
                r.renderingLayerMask = LitMirror;
                r.shadowCastingMode = ShadowCastingMode.On; // self-shadowed by the mirrored lights, as the car is by the real ones
            }
            return twin;
        }

        /// <summary>studio.floor(): black, roughness 0.40, specular 0.4.
        /// Returns its material.</summary>
        static Material Floor(Transform stage, float size, bool seeThrough)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Plane); // 10 x 10 m, facing up
            go.name = "Floor";
            go.transform.SetParent(stage, false);
            go.transform.localScale = new Vector3(size / 10f, 1f, size / 10f);
            Object.DestroyImmediate(go.GetComponent<Collider>());
            var m = new Material(Shader.Find(CarMaterials.LitShader)) { name = "StudioFloor" };
            var c = new Color(0.010f, 0.010f, 0.011f).gamma;
            c.a = seeThrough ? 0.86f : 1f; // lets 14% of the mirrored car through: the reflection
            m.SetColor("_BaseColor", c);
            m.SetFloat("_Smoothness", 1f - 0.40f);
            // Blender's Specular IOR Level 0.4 is 0.8x the default
            // dielectric F0 (0.04 -> 0.032). URP's metallic workflow fixes
            // F0 at 0.04; its specular workflow takes it as _SpecColor.
            m.SetFloat("_WorkflowMode", 0f);
            m.EnableKeyword("_SPECULAR_SETUP");
            m.SetColor("_SpecColor", new Color(0.032f, 0.032f, 0.032f).gamma);
            m.SetFloat("_ReceiveShadows", 1f);
            // Preserve specular: the alpha thins the floor's black, not the
            // lights it mirrors (BaseShaderGUI's Alpha mode with the box ticked).
            if (seeThrough) CarMaterials.Transparent(m, preserveSpecular: true, queueOffset: 0);
            var r = go.GetComponent<MeshRenderer>();
            r.sharedMaterial = m;
            r.shadowCastingMode = ShadowCastingMode.Off; // a cast shadow would darken the twin beneath it
            r.receiveShadows = true;
            r.renderingLayerMask = LitFloor;
            go.layer = 0;
            Stills.ProbeStatic(go);
            return m;
        }

        /// <summary>
        /// studio.rig()'s five lights, same places, colours and relative
        /// power. Blender watts become URP intensity as P / pi^2: a one-sided
        /// Lambertian emitter of power P has an on-axis intensity of P / pi,
        /// and URP's diffuse (albedo x E, no 1/pi) is pi times the physical
        /// one, so a pixel lands where Cycles puts it. -lightScale trims the
        /// whole rig.
        /// </summary>
        static void Lights(Transform stage, float L, float H, float lightScale, bool mirror, List<Object> made)
        {
            float k = lightScale / (Mathf.PI * Mathf.PI);
            var centre = new Vector3(0f, 0.5f * H, 0f); // studio.py's target: the box centre
            const uint all = LitCar | LitFloor;
            Area(stage, "Key", Stills.B(1.3f * L, -0.8f * L, 2.4f * H + 1.0f), centre, 1100f * k, 110f, Color.white,
                 3.6f, 2.4f, true, all, mirror, made);
            Area(stage, "Fill", Stills.B(-1.6f * L, -0.6f * L, 1.0f * H + 0.6f), centre, 170f * k, 160f,
                 new Color(0.86f, 0.91f, 1.0f), 5.0f, 3.5f, false, all, mirror, made);
            Area(stage, "Rim", Stills.B(-0.5f * L, 1.4f * L, 2.2f * H + 1.0f), centre, 1400f * k, 80f,
                 new Color(0.95f, 0.97f, 1.0f), 2.2f, 1.2f, true, LitCar, mirror, made);
            Area(stage, "Sodium", Stills.B(-1.3f * L, 0.6f * L, 0.45f * H), centre, 260f * k, 70f, Sodium,
                 1.6f, 0.6f, false, all, mirror, made);
            // The strip: straight down over the roof, along the car, a
            // little toward the camera's side. Five spots share its power;
            // one panel carries its shape into the paint.
            var strip = Stills.B(0.15f * L, 0f, 2.5f * H + 0.9f);
            for (int i = 0; i < 5; i++)
                Spot(stage, "Strip" + i, strip + new Vector3(0f, 0f, (i - 2) * 0.6f * L), Vector3.down,
                     1500f * k / 5f, 120f, Color.white, i == 2, all, mirror);
            made.Add(Panel(stage, "StripPanel", strip, Quaternion.LookRotation(Vector3.up, Vector3.forward),
                           0.35f, 3.0f * L, 1500f * k, Color.white));
        }

        static void Area(Transform stage, string name, Vector3 at, Vector3 target, float intensity, float spreadDeg,
                         Color linear, float w, float h, bool shadows, uint layers, bool mirror, List<Object> made)
        {
            Spot(stage, name, at, target - at, intensity, spreadDeg, linear, shadows, layers, mirror);
            made.Add(Panel(stage, name + "Panel", at, Quaternion.LookRotation(at - target, Vector3.up), w, h, intensity, linear));
        }

        /// <summary>A light, and with the mirror its twin reflected in the
        /// floor plane, lighting the mirrored car only.</summary>
        static void Spot(Transform stage, string name, Vector3 at, Vector3 dir, float intensity, float spreadDeg,
                         Color linear, bool shadows, uint layers, bool mirror)
        {
            Stills.SpotLight(stage, name, at, dir, intensity, spreadDeg, linear, shadows, layers);
            if (mirror)
                Stills.SpotLight(stage, name + "Mirrored", new Vector3(at.x, -at.y, at.z), new Vector3(dir.x, -dir.y, dir.z),
                                 intensity, spreadDeg, linear, shadows, LitMirror);
        }

        /// <summary>
        /// What an area light looks like in the paint: an unlit rectangle of
        /// its size and place, seen only by the probe (a Quad shows its -Z
        /// face, here turned to the car). Its radiance is the emitter's,
        /// P / (pi A) for a Lambertian panel of power P, which with the
        /// spot's intensity I = P / pi^2 is pi I / A. CarMaterials.SetLinear
        /// round-trips the HDR value through Unity's sRGB colour API; the old
        /// studio scaled an already sRGB-encoded colour and let SetColor
        /// decode the product, so the key's radiance of 13 reached the
        /// shader as several hundred. Returns its material.
        /// </summary>
        static Material Panel(Transform stage, string name, Vector3 at, Quaternion rot, float w, float h,
                              float intensity, Color linear)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
            go.name = name;
            go.transform.SetParent(stage, false);
            go.transform.SetPositionAndRotation(at, rot);
            go.transform.localScale = new Vector3(w, h, 1f);
            Object.DestroyImmediate(go.GetComponent<Collider>());
            var m = new Material(Shader.Find("Universal Render Pipeline/Unlit")) { name = name };
            float radiance = Mathf.PI * intensity / (w * h);
            CarMaterials.SetLinear(m, "_BaseColor", new Color(linear.r * radiance, linear.g * radiance, linear.b * radiance, 1f));
            var r = go.GetComponent<MeshRenderer>();
            r.sharedMaterial = m;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            go.layer = LayerPanel;
            Stills.ProbeStatic(go);
            return m;
        }
    }
}
