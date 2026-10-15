using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using NightRacer.Cars;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;
using Debug = UnityEngine.Debug;
using Object = UnityEngine.Object;

namespace NightRacer.Studio
{
    /// <summary>
    /// The street set: each car parked on the game's own night Gulf Road,
    /// the way the player meets it. WorldBuilder builds the world exactly
    /// as GameController does (road, rails, sodium lamps and their
    /// coronas, the moon, fog, the towers), NightReflections installs the
    /// game's night sky as the reflection source, and the car gets the
    /// game's probe settings (NightReflections.Follow), the headlight and
    /// rim light GameController gives the player, and the game's post
    /// profile. Three shots a car, studio.py's angles:
    /// press/unity/street/&lt;id&gt;-hero.png, -side.png, -rear.png.
    ///
    /// THE SPOT. The car stands in the player's lane (TrackSpline.Lanes[1],
    /// where GameController starts it) 3 m short of the lit street lamp
    /// nearest -streetS (160 m by default: the corniche just past the
    /// Kuwait Towers, which WorldBuilder puts at 1.6% of the 8.5 km lap,
    /// s = 136 m). The lamp is found among the scene's lights after the
    /// build, not from WorldBuilder's spacing, so it follows whatever the
    /// world does with its lamps. The camera stands on the lamp's side, so
    /// the flank it sees is the lit one; with the lamps on +lat that is the
    /// car's left (TrackSpline.SideAt is the driver's left), the flank the
    /// studio set shows too.
    ///
    /// ONE PROBE FOR EVERY CAR. The probe leaves cars and coronas out (the
    /// game's culling mask), so what it holds does not depend on the car:
    /// it is baked once at the spot, before any car is placed.
    /// </summary>
    internal static class StreetStage
    {
        /// <summary>GameController's ChaseCam clear colour: the sky the
        /// camera sees (the night environment is only ever reflected).</summary>
        static readonly Color NightClear = new Color(0.02f, 0.028f, 0.06f);

        sealed class Spot
        {
            public global::TrackSpline Track;
            public float S, Lat, LampS, LampLat, RoadY, Curvature;
            public bool HasLamp;
            public int Flank;          // +1: the camera stands on +lat
            public Vector3 Ground;     // where the car-group origin goes
            public Quaternion Frame;   // the road's heading at S
            public float LatOf(Vector3 p) => Vector3.Dot(p - Track.PointAt(S), Track.SideAt(S));
        }

        public static string Png(string dir, string id, string shot) => Path.Combine(dir, $"{id}-{shot}.png");

        /// <summary>Render every car's street shots. False when the user
        /// cancelled from the progress bar.</summary>
        public static bool RenderAll(StudioOptions o, List<CarEntry> cars, Report report, StillProgress progress)
        {
            string dir = Path.Combine(o.Out, "street");
            Directory.CreateDirectory(dir);
            var todo = new List<CarEntry>();
            foreach (var car in cars)
            {
                var source = Stills.SourceTime(car.Id);
                if (source == null)
                {
                    CarStudio.Log($"{car.Id}: {CarStudio.NoSource}; skipped");
                    report.Set(car, "street", 0, new List<object>(), new List<object> { CarStudio.NoSource }, null);
                }
                else if (!o.Force && Stills.Shots.All(s => Stills.UpToDate(source.Value, Png(dir, car.Id, s.Name))))
                {
                    CarStudio.Log($"{car.Id}: street shots are newer than the car; skipped (-force to redo)");
                    report.Skipped++;
                }
                else todo.Add(car);
            }
            if (todo.Count == 0) return true;

            if (progress != null && progress("Street: building the Gulf Road", 0f)) return false;
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var made = new List<Object>();
            try
            {
                var spot = Build(o, report, made, out string probeFailure);
                var total = Stopwatch.StartNew();
                for (int n = 0; n < todo.Count; n++)
                {
                    var car = todo[n];
                    if (progress != null && progress($"Street: {car.Name}", (float)n / todo.Count))
                    {
                        CarStudio.Log("cancelled");
                        return false;
                    }
                    var clock = Stopwatch.StartNew();
                    var shots = new List<object>();
                    var failures = new List<object>();
                    if (probeFailure != null) failures.Add(probeFailure);
                    string size = null;
                    try { size = RenderCar(o, car, spot, dir, shots, failures); }
                    catch (Exception e)
                    {
                        Debug.LogException(e);
                        failures.Add(e.Message);
                    }
                    double secs = clock.Elapsed.TotalSeconds;
                    report.Set(car, "street", secs, shots, failures, size);
                    double eta = total.Elapsed.TotalSeconds / (n + 1) * (todo.Count - n - 1);
                    CarStudio.Log($"street {n + 1}/{todo.Count} {car.Name}: {shots.Count} shot(s), {secs:0.0} s" +
                                  (failures.Count > 0 ? $"; FAILED: {string.Join("; ", failures)}" : "") + $"; ETA {eta / 60:0.0} min");
                }
            }
            finally { Stills.Destroy(made); }
            return true;
        }

        // ------------------------------------------------------------ world

        static Spot Build(StudioOptions o, Report report, List<Object> made, out string probeFailure)
        {
            probeFailure = null;
            var clock = Stopwatch.StartNew();
            var track = new global::TrackSpline();
            // Edit-mode safe: WorldBuilder destroys its primitives' colliders
            // with CarModel.Kill (DestroyImmediate outside Play), where
            // Object.Destroy would only log an error and leave them.
            global::WorldBuilder.Build(track);
            NightReflections.Install();
            Stills.Ambient(RenderSettings.ambientLight.linear); // WorldBuilder's flat night ambient, made real now

            var spot = Choose(o, track);
            CarStudio.Log($"street: Gulf Road built in {clock.Elapsed.TotalSeconds:0.0} s; " +
                          (spot.HasLamp ? $"lamp at s {spot.LampS:0} m, lat {spot.LampLat:+0.0;-0.0} m; " : "no street-lamp light found; ") +
                          $"car at s {spot.S:0} m, lane {o.Lane} (lat {spot.Lat:+0.00;-0.00} m), road at y {spot.RoadY:0.000}, " +
                          $"curvature under {spot.Curvature * 1000f:0.0} mrad/m within 30 m");

            // The game's probe, with the game's size, clip planes, culling
            // mask and intensity, at 1024 px for a still (the game draws
            // 256). Baked here rather than followed: see Stills.Bake.
            var probe = NightReflections.Follow(null, 1024);
            float lift = probe.TryGetComponent<ProbeFollower>(out var follower) ? follower.Lift : 1.2f;
            probe.transform.SetPositionAndRotation(spot.Ground + Vector3.up * lift, Quaternion.identity);
            int skip = (1 << CarModel.CarLayer) | (1 << NightReflections.GlowLayer);
            foreach (var root in SceneManager.GetActiveScene().GetRootGameObjects())
                foreach (var t in root.GetComponentsInChildren<Transform>(true))
                    if ((skip & (1 << t.gameObject.layer)) == 0)
                        GameObjectUtility.SetStaticEditorFlags(t.gameObject,
                            GameObjectUtility.GetStaticEditorFlags(t.gameObject) | StaticEditorFlags.ReflectionProbeStatic);
            if (!Stills.Bake(probe, "street", out var why)) probeFailure = "probe: " + why;

            string post = Grade(o, made);
            report.Settings("street", new Dictionary<string, object>
            {
                ["width"] = o.Width,
                ["height"] = o.Height,
                ["supersample"] = o.Supersample,
                ["msaaRequested"] = o.Msaa,
                ["s"] = Math.Round(spot.S, 1),
                ["lane"] = o.Lane,
                ["lat"] = Math.Round(spot.Lat, 2),
                ["lamp"] = spot.HasLamp
                    ? new Dictionary<string, object> { ["s"] = Math.Round(spot.LampS, 1), ["lat"] = Math.Round(spot.LampLat, 2) }
                    : null,
                ["curvatureMradPerM"] = Math.Round(spot.Curvature * 1000f, 2),
                ["probe"] = probeFailure ?? $"baked, {probe.resolution} px",
                ["post"] = post,
                ["exposureEv"] = o.StreetExposure,
                ["shots"] = Stills.Shots.Select(s => (object)s.Name).ToList(),
            });
            return spot;
        }

        static Spot Choose(StudioOptions o, global::TrackSpline track)
        {
            var lanes = global::TrackSpline.Lanes; // -lane is checked against these in StudioOptions.Parse
            float target = track.Wrap(o.StreetS);
            var spot = new Spot { Track = track, LampS = target };
            float best = float.MaxValue;
            foreach (var l in Object.FindObjectsByType<Light>(FindObjectsSortMode.None))
            {
                if (!l.enabled || (l.type != LightType.Point && l.type != LightType.Spot)) continue;
                float s = NearestS(track, l.transform.position);
                float lat = Vector3.Dot(l.transform.position - track.PointAt(s), track.SideAt(s));
                if (Mathf.Abs(lat) > global::TrackSpline.RoadHalfWidth + 6f) continue; // a street lamp, not a landmark
                float d = Mathf.Abs(track.DeltaAhead(target, s));
                if (d < best)
                {
                    best = d;
                    spot.LampS = s;
                    spot.LampLat = lat;
                    spot.HasLamp = true;
                }
            }
            // Just short of the lamp: its pool falls on the bonnet and the
            // flank the camera sees.
            spot.S = track.Wrap(spot.HasLamp ? spot.LampS - 3f : target);
            spot.Lat = lanes[o.Lane];
            spot.Flank = !spot.HasLamp || spot.LampLat >= 0f ? 1 : -1;
            spot.RoadY = RoadHeight();
            spot.Ground = track.Pose(spot.S, spot.Lat) + Vector3.up * spot.RoadY;
            spot.Frame = Quaternion.LookRotation(track.TangentAt(spot.S)); // GameController.PoseCar, body yaw 0
            for (float d = -30f; d <= 30f; d += 2f)
                spot.Curvature = Mathf.Max(spot.Curvature, Mathf.Abs(track.CurvatureAt(spot.S + d)));
            return spot;
        }

        /// <summary>The arc length of the track point nearest
        /// <paramref name="p"/>: a 2 m scan of the lap, then 5 cm steps
        /// round the best.</summary>
        static float NearestS(global::TrackSpline t, Vector3 p)
        {
            float best = 0f, bestD = float.MaxValue;
            void Try(float s)
            {
                var d = t.PointAt(s) - p;
                d.y = 0f;
                if (d.sqrMagnitude < bestD) { bestD = d.sqrMagnitude; best = s; }
            }
            for (float s = 0f; s < t.Length; s += 2f) Try(s);
            float c = best;
            for (float s = c - 2f; s <= c + 2f; s += 0.05f) Try(s);
            return t.Wrap(best);
        }

        /// <summary>WorldBuilder lays the asphalt 2 cm up (Ribbon(..., 0.02f,
        /// ...)); the game poses cars at y = 0, tyres 2 cm into it, which a
        /// close still shows as flat-bottomed tyres. The stills stand them on
        /// the road, read off the ribbon itself.</summary>
        static float RoadHeight()
        {
            var road = GameObject.Find("Road");
            return road != null && road.TryGetComponent<MeshFilter>(out var f) && f.sharedMesh != null
                ? f.sharedMesh.bounds.center.y
                : 0f;
        }

        /// <summary>
        /// The game's grade: GulfRoadPostProfile on a global volume, as
        /// GameController.AttachPostProcessing loads it. Over it, one thing
        /// for stills: motion blur off. A still has no motion, and URP's
        /// camera-only blur compares against the camera matrix it kept from
        /// the previous render, which here is the last shot, metres away.
        /// -streetExposure adds to the profile's own post exposure.
        /// </summary>
        static string Grade(StudioOptions o, List<Object> made)
        {
            var game = Resources.Load<VolumeProfile>("GulfRoadPostProfile");
            if (game == null)
            {
                var guids = AssetDatabase.FindAssets("GulfRoadPostProfile t:VolumeProfile");
                if (guids.Length > 0) game = AssetDatabase.LoadAssetAtPath<VolumeProfile>(AssetDatabase.GUIDToAssetPath(guids[0]));
            }
            string post;
            if (game != null)
            {
                Stills.MakeVolume(null, "GlobalPostVolume", game, 1f);
                post = "GulfRoadPostProfile";
            }
            else
            {
                CarStudio.Log("street: no GulfRoadPostProfile (Night Racer > Setup Rendering makes it); graded with ACES only");
                var fallback = ScriptableObject.CreateInstance<VolumeProfile>();
                made.Add(fallback);
                fallback.Add<Tonemapping>(false).mode.Override(TonemappingMode.ACES);
                Stills.MakeVolume(null, "GlobalPostVolume", fallback, 1f);
                post = "ACES only (no GulfRoadPostProfile)";
            }
            var still = ScriptableObject.CreateInstance<VolumeProfile>();
            still.name = "StillsOverride";
            made.Add(still);
            still.Add<MotionBlur>(false).intensity.Override(0f);
            if (o.StreetExposure != 0f)
            {
                float baseEv = game != null && game.TryGet<ColorAdjustments>(out var ca) && ca.postExposure.overrideState
                    ? ca.postExposure.value
                    : 0f;
                still.Add<ColorAdjustments>(false).postExposure.Override(baseEv + o.StreetExposure);
            }
            Stills.MakeVolume(null, "StillsOverride", still, 100f);
            return post;
        }

        // ------------------------------------------------------------- cars

        static string RenderCar(StudioOptions o, CarEntry car, Spot spot, string dir, List<object> shots, List<object> failures)
        {
            var model = CarLibrary.Instance.LoadNow(car.Id)
                        ?? throw new Exception("CarLibrary could not load it (see the [cars] lines above)");
            CarRig rig = null;
            Camera cam = null;
            try
            {
                rig = model.Spawn();
                var box = Stills.LocalBox(rig);
                var turn = o.FlipNose ? Quaternion.Euler(0f, 180f, 0f) : Quaternion.identity;
                rig.transform.SetPositionAndRotation(spot.Ground, spot.Frame * turn);
                Stills.Dress(rig, contactShadow: true);
                PlayerLights(rig);

                var corners = Stills.Corners(rig.transform, box);
                var aim = Stills.Aim(rig.transform, box);
                cam = Stills.MakeCamera(null, "StillCam");
                cam.backgroundColor = NightClear;
                cam.nearClipPlane = 0.1f;
                cam.farClipPlane = 4000f; // the ChaseCam's
                // Inside the rails (RoadHalfWidth + 0.6): a long car's side
                // shot from lane 1 would otherwise put the camera behind one.
                float limit = global::TrackSpline.RoadHalfWidth + 0.3f;
                var coronas = Object.FindObjectsByType<global::FaceCamera>(FindObjectsSortMode.None);
                foreach (var shot in Stills.Shots)
                {
                    var view = spot.Frame * Stills.ViewDir(shot, rightFlank: spot.Flank < 0);
                    float lens = Stills.Frame(cam, corners, aim, view, o.Width, o.Height, Stills.Fill,
                        p => Mathf.Abs(spot.LatOf(p)) <= limit);
                    // FaceCamera turns the coronas in LateUpdate, which edit
                    // mode never calls: do it for this camera.
                    foreach (var c in coronas) c.transform.rotation = cam.transform.rotation;
                    string png = Png(dir, car.Id, shot.Name);
                    try
                    {
                        var levels = Stills.Shoot(cam, o, png);
                        shots.Add(levels.Json("street/" + Path.GetFileName(png), lens));
                        CarStudio.Log($"{car.Id}: {png} ({lens:0} mm, {levels})");
                    }
                    catch (Exception e)
                    {
                        Debug.LogException(e);
                        failures.Add($"{shot.Name}: {e.Message}");
                    }
                }
                return Stills.Size(box);
            }
            finally
            {
                if (cam != null) Object.DestroyImmediate(cam.gameObject);
                Stills.Release(rig);
                Stills.Free(model);
                // A fresh library for the next car: this one's dictionary
                // still holds the CarAsset (every vertex, as arrays) behind
                // the model just freed. The next LoadNow makes a new one.
                Object.DestroyImmediate(CarLibrary.Instance.gameObject);
            }
        }

        /// <summary>
        /// The two lights GameController.Start hangs on the player's car, at
        /// its values: the warm rim point behind the roofline that keeps a
        /// warm paint's hue against the blue night, and the headlight, so the
        /// road ahead in the hero shot is lit as the player sees it. The lamp
        /// height is CarFactory.Create's: the mean of CarRig.HeadLamps, 0.6 m
        /// without them. Keep in step with GameController if those change.
        /// </summary>
        static void PlayerLights(CarRig rig)
        {
            float lampY = 0f;
            foreach (var h in rig.HeadLamps) lampY += h.y;
            lampY = rig.HeadLamps.Length > 0 ? lampY / rig.HeadLamps.Length : 0.6f;

            var rim = new GameObject("RimLight").AddComponent<Light>();
            rim.type = LightType.Point;
            rim.color = new Color(1f, 0.957f, 0.902f);
            rim.intensity = 0.95f;
            rim.range = 13f;
            rim.shadows = LightShadows.None;
            rim.transform.SetParent(rig.transform, false);
            rim.transform.localPosition = new Vector3(0f, 2.6f, rig.Front - rig.Length - 2.2f);

            var head = new GameObject("Headlight").AddComponent<Light>();
            head.type = LightType.Spot;
            head.color = new Color(1f, 0.95f, 0.8f);
            head.intensity = 4f;
            head.range = 90f;
            head.spotAngle = 55f;
            head.innerSpotAngle = 28f;
            head.shadows = LightShadows.Soft;
            head.shadowStrength = 0.9f;
            head.shadowNearPlane = 1.5f;
            head.transform.SetParent(rig.transform, false);
            head.transform.localPosition = new Vector3(0f, lampY + 0.45f, rig.Front - rig.Length * 0.12f);
        }
    }
}
