using NightRacer.Cars;
using UnityEngine;
using UnityEngine.Rendering;

// The whole game loop — a faithful port of the web build's engine
// (src/game/engine.ts): TXR rules on the Gulf Road. Find the rival,
// flash headlights (F) to battle; the trailing car bleeds SP.
public class GameController : MonoBehaviour
{
    const float PlayerTopSpeed = 92f; // m/s
    // Handling comes from the generated tables so the browser, UE5 and
    // Unity all race the same numbers — and so check:unity is verifying
    // values the game actually reads rather than a parallel copy.
    const float FlashRange = GRNData.Handling.FlashRangeM;
    static readonly float[] Gears = { 0, 55, 95, 145, 200, 260, 320 };

    TrackSpline track;
    Camera cam;
    ElevenLabsVoice voice;
    EngineAudio engineAudio;
    TouchControls touch;

    // Player state (same handling model as the web build)
    float pS = 40f, pLat, pSpeed, pSp = 100f;
    float heading, steerSmooth, slipVel, shake;

    // --- Braking state, carried between frames.
    //
    // The solver is stateful on purpose: lock builds and releases at a
    // rate, discs heat and cool, and the ABS pulse has a phase. A
    // stateless brake is the `brakeAmt * 26f` this replaced.
    GRNSim.BrakeState brakeState = GRNSim.NewBrakeState();
    GRNSim.BrakeTune brakeTune = new GRNSim.BrakeTune
    {
        // Filled from the car on the ramp in Start(); these are the
        // stock figures so a solver call before that is still sane.
        BrakeForce = 26.0,
        GripAccel = 12.0,
        BrakeThermalMult = 1.0,
        HasAbs = true,
    };
    /// <summary>Aero downforce, m/s2 at the reference speed. Stock car.</summary>
    float brakeDownforce = 0f;
    /// <summary>Steering authority left after the brakes, 0..1.</summary>
    float brakeSteerScale = 1f;
    /// <summary>Published for the HUD, the squeal and the smoke.</summary>
    float brakeLock, brakeTempC;
    bool brakeAbs;
    CarFactory.Car playerCar;

    // Rival
    int rivalIndex;
    RivalDef rivalDef;
    CarFactory.Car rivalCar;
    float rS, rLat, rTargetLat, rSpeed, rSp;
    enum RivalState { Cruise, Battle, Defeated }
    RivalState rivalState;
    bool inBattle;

    // Traffic
    class Traffic { public CarFactory.Car Car; public float S, Lat, Speed; }
    Traffic[] traffic;

    string message = "";
    float messageUntil;
    float bumpCooldown, scrapeCooldown;

    /// <summary>The street cars traffic is drawn from — the web uses plain
    /// saloon and SUV shells for traffic; these are the catalogue's own
    /// street machines, repainted in the traffic palette.</summary>
    static readonly string[] TrafficModels = { "deera-sedan", "hawally-2t", "sharq-hatch", "jahra-pickup", "wain-special" };

    /// <summary>True while the cars are still loading (OnGUI says so).</summary>
    bool loadingCars;

    System.Collections.IEnumerator Start()
    {
        // Frame pacing. Unlike the web build — where the browser locks
        // rendering to v-sync with no way to switch it off — this is fully
        // controllable. vSyncCount 0 hands pacing to targetFrameRate; a cap
        // a few frames under the panel is what keeps a G-Sync/FreeSync
        // display inside its variable-refresh window, since crossing the
        // ceiling drops you back onto v-sync and its queued frame.
        QualitySettings.vSyncCount = 0;
        var hz = (float)Screen.currentResolution.refreshRateRatio.value;
        if (hz < 30f) hz = 60f; // some platforms report 0
        Application.targetFrameRate = Mathf.Max(30, Mathf.RoundToInt(hz) - 3);
        QualitySettings.shadows = ShadowQuality.All;
        QualitySettings.shadowResolution = ShadowResolution.VeryHigh;
        QualitySettings.shadowDistance = 220f;
        QualitySettings.anisotropicFiltering = AnisotropicFiltering.ForceEnable;
        track = new TrackSpline();
        var worldRoot = WorldBuilder.Build(track);
        // Something for the paint to reflect: the night environment as the
        // scene's reflection and the probes' sky (NightReflections).
        NightReflections.Install();
        // ...and the street itself reflects that environment only: the car
        // probe is sized for the paint, and a road or tower it happens to
        // overlap would swap reflections as the player drove past.
        NightReflections.ExcludeWorld(worldRoot);

        var camGo = new GameObject("ChaseCam");
        camGo.tag = "MainCamera"; // Camera.main, used by the corona billboards
        cam = camGo.AddComponent<Camera>();
        cam.backgroundColor = new Color(0.02f, 0.028f, 0.06f);
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.fieldOfView = 62f;
        cam.farClipPlane = 4000f;
        cam.allowHDR = true;
        cam.allowMSAA = true;
        // Cars stop drawing at 350 m (0 = the far plane, for the rest). The
        // city is 4 km deep; a car on the far side of it is under a pixel
        // and still a full draw of every part. Spherical, so swinging the
        // camera round does not pop the cars at the frustum's corners.
        var cull = new float[32];
        cull[CarModel.CarLayer] = 350f;
        cam.layerCullDistances = cull;
        cam.layerCullSpherical = true;
        camGo.AddComponent<AudioListener>();
        AttachPostProcessing(camGo);

        voice = gameObject.AddComponent<ElevenLabsVoice>();
        engineAudio = gameObject.AddComponent<EngineAudio>();
        touch = gameObject.AddComponent<TouchControls>();
        MobileTier.Apply(); // trims the render load on phones

        // The player's machine comes from the showroom table (live when the
        // API answered, generated otherwise) rather than a hardcoded body,
        // so the two ports and the browser all start you in the same car.
        if (GRNApi.Instance != null)
        {
            GRNApi.Instance.OnReady += OnDataReady;
            // Already answered before we got here? Take it now; the event
            // has fired and will not fire again.
            if (GRNApi.Instance.Ready && GRNApi.Instance.Live) pendingLiveRebuild = true;
        }

        // The game's own cars, before anything is spawned: the player's,
        // every rival's and the traffic models. Every rival, not the first:
        // SpawnRival builds the next one the moment a battle is won, and a
        // car still loading then is a procedural box for that whole race.
        // A missing file is not fatal — that car drives the procedural body
        // — and the wait is capped, after which stragglers keep loading in
        // the background. Phones skip the traffic models (see below).
        var startCar = PlayerCar();
        var preload = new System.Collections.Generic.List<string> { startCar.Id };
        foreach (var r in RivalDef.All)
            if (!string.IsNullOrEmpty(r.CarId) && !preload.Contains(r.CarId)) preload.Add(r.CarId);
        bool modelTraffic = !MobileTier.IsMobile;
        if (modelTraffic)
            foreach (var id in TrafficModels)
                if (!preload.Contains(id)) preload.Add(id);
        loadingCars = true;
        yield return CarLibrary.Instance.Preload(preload, 45f);
        loadingCars = false;

        playerCar = CarFactory.Create(startCar.Id, startCar.Paint, new Color(0f, 0.48f, 0.24f),
            startCar.Style, startCar.AttackKit, startCar.LengthM, repaint: false);
        pLat = TrackSpline.Lanes[1];

        // The paint's live reflection rides with the player, as the web's
        // probe does: the street around the car, without the cars.
        NightReflections.Follow(playerCar.Root.transform);

        // Warm rim light behind the roofline (engine.ts "rim": 3.0 at decay
        // 1.8), so the warm paints keep their hue against a blue night.
        // 1.22, not the 0.95 the physical-units conversion gives: that was
        // matched against the stand-in boxes, and the game's own models —
        // a real roofline, a rear window and a hood that curve away from
        // it — catch about three quarters of what a flat deck did.
        // StreetStage (the studio's street) uses the same figure.
        var rim = new GameObject("RimLight").AddComponent<Light>();
        rim.type = LightType.Point;
        rim.color = new Color(1f, 0.957f, 0.902f);
        rim.intensity = 1.22f;
        rim.range = 13f;
        rim.shadows = LightShadows.None;
        rim.transform.SetParent(playerCar.Root.transform, false);
        rim.transform.localPosition = new Vector3(0f, 2.6f, playerCar.Front - playerCar.Length - 2.2f);

        var headlight = new GameObject("Headlight").AddComponent<Light>();
        headlight.type = LightType.Spot;
        headlight.color = new Color(1f, 0.95f, 0.8f);
        headlight.intensity = 4f;
        headlight.range = 90f;
        headlight.spotAngle = 55f;
        headlight.innerSpotAngle = 28f;
        headlight.shadows = LightShadows.Soft;
        headlight.shadowStrength = 0.9f;
        headlight.shadowNearPlane = 1.5f;
        headlight.transform.SetParent(playerCar.Root.transform, false);
        // Off the car's real nose, not a fixed offset: the silhouettes run
        // 4.30 m to 4.70 m, so a constant lands inside the shorter bodies.
        headlight.transform.localPosition =
            new Vector3(0, playerCar.LampHeight + 0.45f, playerCar.Front - playerCar.Length * 0.12f);

        // Glow discs at the lamps themselves — the model's own lamp
        // centres, a hair ahead of the lens. Kept out of the car probe.
        var glowMat = Mats.Additive(new Color(1f, 0.95f, 0.8f, 1f), Mats.Glow());
        foreach (var lamp in playerCar.HeadLamps)
        {
            var glow = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(glow.GetComponent<Collider>());
            glow.name = "HeadlightGlow";
            glow.layer = NightReflections.GlowLayer;
            glow.transform.SetParent(playerCar.Root.transform, false);
            glow.transform.localPosition = lamp + new Vector3(0f, 0f, 0.06f);
            // A Quad's face looks down -Z; turned round, it faces the road
            // ahead (and anyone in front), where a headlamp's glow is seen.
            glow.transform.localRotation = Quaternion.Euler(0f, 180f, 0f);
            glow.transform.localScale = Vector3.one * (playerCar.Rig != null ? 1.1f : 1.6f);
            var gr = glow.GetComponent<MeshRenderer>();
            gr.sharedMaterial = glowMat;
            gr.shadowCastingMode = ShadowCastingMode.Off;
        }

        traffic = new Traffic[16];
        var trafficColors = new[] { 0x8A96A3, 0x5D6770, 0xB0A890, 0x6E7F8D, 0x4A5560, 0x9C8F7A };
        for (int i = 0; i < traffic.Length; i++)
        {
            int c = trafficColors[i % trafficColors.Length];
            var colour = new Color(((c >> 16) & 255) / 255f, ((c >> 8) & 255) / 255f, (c & 255) / 255f);
            // On phones traffic is the procedural saloon: sixteen of the
            // game's models is sixteen sets of hood, glass, rear window and
            // tyre parts, which is most of a mobile GPU's draw budget for
            // cars nobody looks at. The player and the rival keep theirs.
            var car = modelTraffic
                ? CarFactory.Create(TrafficModels[i % TrafficModels.Length], colour, null,
                    BodyStyle.Sedan, false, 0f, repaint: true)
                : CarFactory.Create(colour, null, BodyStyle.Sedan);
            Background(car, wheelShadows: false);
            traffic[i] = new Traffic
            {
                Car = car,
                S = track.Wrap(120f + (float)i / traffic.Length * track.Length),
                Lat = TrackSpline.Lanes[i % 4],
                Speed = 21f + Random.value * 9f,
            };
        }

        SpawnRival();
        Say("يلا! دور على خصمك", "announcer-start", 0.5f);
        ShowMessage("Find " + rivalDef.Name + " — flash F to battle");
    }

    /// Hook the camera into URP post-processing and drop the global volume
    /// (ACES tonemap, bloom, vignette, grain, motion blur) into the scene.
    /// Everything is looked up by name so the project still runs if the
    /// render pipeline package hasn't been installed yet.
    void AttachPostProcessing(GameObject camGo)
    {
        var camDataType = System.Type.GetType(
            "UnityEngine.Rendering.Universal.UniversalAdditionalCameraData, Unity.RenderPipelines.Universal.Runtime");
        if (camDataType != null)
        {
            var data = camGo.AddComponent(camDataType);
            var prop = camDataType.GetProperty("renderPostProcessing");
            prop?.SetValue(data, true);
            camDataType.GetProperty("antialiasing")?.SetValue(data, 2); // SMAA
            camDataType.GetProperty("antialiasingQuality")?.SetValue(data, 2); // high
        }
        else
        {
            Debug.LogWarning(
                "[Night Racer] URP not found — running on the built-in pipeline. " +
                "Install Universal RP and run 'Night Racer ▸ Setup Rendering' for the full look.");
            return;
        }

        var profile = Resources.Load<VolumeProfile>("GulfRoadPostProfile")
            ?? FindProfileInSettings();
        if (profile == null)
        {
            Debug.LogWarning(
                "[Night Racer] No post profile — run 'Night Racer ▸ Setup Rendering (URP + Post)'.");
            return;
        }
        var volGo = new GameObject("GlobalPostVolume");
        var vol = volGo.AddComponent<Volume>();
        vol.isGlobal = true;
        vol.priority = 1f;
        vol.sharedProfile = profile;
    }

    static VolumeProfile FindProfileInSettings()
    {
#if UNITY_EDITOR
        var guids = UnityEditor.AssetDatabase.FindAssets("GulfRoadPostProfile t:VolumeProfile");
        if (guids.Length > 0)
        {
            var path = UnityEditor.AssetDatabase.GUIDToAssetPath(guids[0]);
            return UnityEditor.AssetDatabase.LoadAssetAtPath<VolumeProfile>(path);
        }
#endif
        return null;
    }

    /// <summary>
    /// The starter machine. CARS is ordered richest-first in mods.ts, so
    /// the last entry is the cheapest one a new player owns.
    /// </summary>
    static GRNData.Car PlayerCar()
    {
        var cars = GRNApi.Instance != null ? GRNApi.Instance.Cars : GRNData.Cars;
        return cars[cars.Count - 1];
    }

    /// <summary>
    /// The API answers after the world is already up, so without this the
    /// live tables would only take effect on the NEXT run. Rebuilding the
    /// spline and respawning the rival on arrival means a live roster
    /// reaches the race it was fetched for. Guarded on Live so the
    /// offline path never rebuilds anything.
    /// </summary>
    bool pendingLiveRebuild;

    void OnDestroy()
    {
        if (GRNApi.Instance != null) GRNApi.Instance.OnReady -= OnDataReady;
    }

    void OnDataReady(bool live)
    {
        if (live) pendingLiveRebuild = true;
    }

    void SpawnRival()
    {
        if (rivalCar != null) Destroy(rivalCar.Root);
        rivalCar = null;
        if (rivalIndex >= RivalDef.All.Length) return;
        rivalDef = RivalDef.All[rivalIndex];
        // The rival drives their own car from the catalogue (the web's
        // carId), in their colours.
        rivalCar = CarFactory.Create(rivalDef.CarId, rivalDef.Body, rivalDef.Accent, rivalDef.Style,
            false, 0f, repaint: true);
        Background(rivalCar, wheelShadows: true);
        rS = track.Wrap(pS + 260f);
        rLat = rTargetLat = TrackSpline.Lanes[2];
        rSpeed = 27f;
        rSp = 100f;
        rivalState = RivalState.Cruise;
    }

    /// <summary>
    /// The render trims every car but the player's gets. A single-level
    /// LODGroup over all its renderers culls the car once it is under 1.5 %
    /// of the screen's height. The group measures the car by its longest
    /// side, so for a 4.7 m saloon at this field of view that is about
    /// 250 m, inside the camera's 350 m car-layer distance, which catches
    /// anything the group misses. Unity only culls whole
    /// groups, so the hood, rear window and tyres go together rather than
    /// the small parts blinking out first. <paramref name="wheelShadows"/>
    /// off drops the wheel and tyre renderers from the shadow pass: on
    /// traffic they are four draws per cascade for a shadow the body's
    /// already covers.
    /// </summary>
    static void Background(CarFactory.Car car, bool wheelShadows)
    {
        if (car == null || car.Root == null) return;
        if (!wheelShadows && car.Wheels != null)
            foreach (var w in car.Wheels)
                if (w != null)
                    foreach (var r in w.GetComponentsInChildren<Renderer>(true))
                        r.shadowCastingMode = ShadowCastingMode.Off;
        var renderers = car.Root.GetComponentsInChildren<Renderer>(true);
        if (renderers.Length == 0) return;
        // Not ??: a missing component can come back as Unity's fake null,
        // which the C# operator does not see.
        var lod = car.Root.GetComponent<LODGroup>();
        if (lod == null) lod = car.Root.AddComponent<LODGroup>();
        lod.SetLODs(new[] { new LOD(0.015f, renderers) });
        lod.RecalculateBounds();
    }

    void Say(string arabicText, string clipId, float stability)
        => voice.Speak(arabicText, clipId, stability);

    void ShowMessage(string text)
    {
        message = text;
        messageUntil = Time.time + 3.5f;
    }

    void Update()
    {
        if (playerCar == null) return; // still loading the cars (Start)
        // Applied here rather than inside the callback: OnReady can fire
        // from the fetch coroutine mid-frame, and rebuilding the spline
        // while UpdatePlayer is walking it is asking for trouble.
        if (pendingLiveRebuild)
        {
            pendingLiveRebuild = false;
            track = new TrackSpline();
            SpawnRival();
        }

        float dt = Mathf.Min(Time.deltaTime, 0.05f);
        UpdatePlayer(dt);
        UpdateTraffic(dt);
        UpdateRival(dt);
        if (inBattle) UpdateBattle(dt);
        UpdateCamera(dt);

        float kmh = pSpeed * 3.6f;
        int gear = 0;
        while (gear < Gears.Length - 2 && kmh >= Gears[gear + 1]) gear++;
        float rpm = Mathf.Clamp((kmh - Gears[gear]) / (Gears[gear + 1] - Gears[gear]), 0.12f, 1f);
        engineAudio.Set(rpm, Input.GetKey(KeyCode.W) || Input.GetKey(KeyCode.UpArrow) ? 1f : 0f, kmh);

        if (Input.GetKeyDown(KeyCode.F) || (touch != null && touch.FlashPressed)) TryFlash();
        if (Input.GetKeyDown(KeyCode.M)) engineAudio.ToggleMute();
    }

    void UpdatePlayer(float dt)
    {
        bool up = Input.GetKey(KeyCode.W) || Input.GetKey(KeyCode.UpArrow);
        bool down = Input.GetKey(KeyCode.S) || Input.GetKey(KeyCode.DownArrow);
        float steer = (Input.GetKey(KeyCode.D) || Input.GetKey(KeyCode.RightArrow) ? 1 : 0)
                    - (Input.GetKey(KeyCode.A) || Input.GetKey(KeyCode.LeftArrow) ? 1 : 0);

        // On-screen pads sit alongside the keyboard, never replace it
        float throttleAmt = up ? 1f : 0f;
        float brakeAmt = down ? 1f : 0f;
        if (touch != null && touch.Enabled)
        {
            throttleAmt = Mathf.Max(throttleAmt, touch.Throttle);
            brakeAmt = Mathf.Max(brakeAmt, touch.Brake);
            steer = Mathf.Clamp(steer + touch.Steer, -1f, 1f);
        }
        up = throttleAmt > 0.01f;
        down = brakeAmt > 0.01f;

        float accel = throttleAmt * Mathf.Max(0,
            GRNData.Handling.ThrustK * (1f - pSpeed / GRNData.Handling.Ceiling));

        // Braking, through the real solver.
        //
        // This was `brakeAmt * 26f` — a constant, with no lock-up, no
        // anti-lock, no disc heat and no fade. It meant this build could
        // not be made to lock a wheel and threshold braking did nothing
        // here at all, while the web build and the UE5 port both ran a
        // full model. Same solver in all three now; see GRNSim.cs.
        // The tune comes from the car actually being driven, not from a
        // constant: brake and grip are per-car figures in the showroom,
        // and a solver fed the same numbers for a Wain Special and a Zeta
        // 300 GTR is a solver that has thrown away the showroom.
        var pc = PlayerCar();
        brakeTune.BrakeForce = pc.Brake;
        brakeTune.GripAccel = pc.Grip;

        double latDemand = Mathf.Clamp01(Mathf.Abs(steerSmooth));
        // The car's own grip (the web: gripAtSpeed(car.gripAccel, ...)).
        // This read GRNData.Handling.GripAccel, a constant that does not
        // exist — the port had never been compiled to say so.
        double gripNow = GRNSim.GripAtSpeed(
            brakeTune.GripAccel, brakeDownforce, pSpeed);
        GRNSim.BrakeResult brakeOut = GRNSim.SolveBrakes(
            ref brakeState, brakeTune, dt,
            brakeAmt, pSpeed, latDemand, steerSmooth, throttleAmt, gripNow);
        float braking = (float)brakeOut.Decel;
        // Locked fronts do not steer, and the rear the brakes have
        // unloaded offers rotation — both of which the old constant had
        // no way to express.
        brakeSteerScale = (float)brakeOut.SteerScale;
        brakeLock = (float)brakeOut.Lock;
        brakeTempC = (float)brakeOut.Temp;
        brakeAbs = brakeOut.Abs;

        float drag = GRNData.Handling.DragA * pSpeed * pSpeed + GRNData.Handling.DragB;
        pSpeed = Mathf.Max(0, pSpeed + (accel - braking - drag * (up ? 0.35f : 1f)) * dt);

        steerSmooth += (steer - steerSmooth) * Mathf.Min(1f, dt * GRNData.Handling.SteerSmoothRate);
        float yawRateMax = Mathf.Min(1.6f, 12f / Mathf.Max(pSpeed, 2f));
        // brakeSteerScale is 1 with the tyres rotating and falls toward
        // BrakeLockSteer as they lock: a car sliding on all four does not
        // go where it is pointed.
        heading += steerSmooth * yawRateMax * brakeSteerScale * dt;
        if (Mathf.Abs(steer) < 0.1f) heading -= heading * Mathf.Min(1f, dt * GRNData.Handling.CasterRate);
        heading = Mathf.Clamp(heading, -GRNData.Handling.HeadingClamp, GRNData.Handling.HeadingClamp);

        float curvature = track.CurvatureAt(pS);
        float push = Mathf.Clamp(curvature * pSpeed * pSpeed * 0.22f, -8f, 8f);
        slipVel += (push - slipVel * 2.5f) * dt;
        pLat += (Mathf.Sin(heading) * pSpeed + slipVel) * dt;

        float maxLat = TrackSpline.RoadHalfWidth - 1.1f;
        if (Mathf.Abs(pLat) > maxLat)
        {
            pLat = Mathf.Clamp(pLat, -maxLat, maxLat);
            heading *= 0.15f; slipVel *= 0.2f;
            pSpeed *= 1f - 0.9f * dt;
            if (scrapeCooldown <= 0)
            {
                scrapeCooldown = 0.5f;
                shake = 0.55f;
                engineAudio.Scrape();
                if (inBattle) pSp = Mathf.Max(0, pSp - 4);
            }
        }
        scrapeCooldown -= dt;
        bumpCooldown -= dt;

        pS = track.Wrap(pS + pSpeed * dt);
        PoseCar(playerCar, pS, pLat, -heading * 0.85f);
        playerCar.Roll(pSpeed * dt);
        playerCar.SetBrake(down);

        if (bumpCooldown <= 0)
            foreach (var t in traffic)
            {
                float ds = track.DeltaAhead(pS, t.S);
                if (Mathf.Abs(ds) < 4.2f && Mathf.Abs(t.Lat - pLat) < 2f)
                {
                    bumpCooldown = 1f;
                    pSpeed = Mathf.Min(pSpeed * 0.55f, t.Speed * 0.9f);
                    if (ds >= 0) pS = track.Wrap(t.S - 4.5f);
                    shake = 1f;
                    engineAudio.Bump();
                    if (inBattle) pSp = Mathf.Max(0, pSp - 8);
                    break;
                }
            }
    }

    void UpdateTraffic(float dt)
    {
        foreach (var t in traffic)
        {
            t.S = track.Wrap(t.S + t.Speed * dt);
            PoseCar(t.Car, t.S, t.Lat, 0);
            t.Car.Roll(t.Speed * dt);
        }
    }

    void UpdateRival(float dt)
    {
        if (rivalCar == null) return;
        float top = rivalDef.TopSpeedKmh / 3.6f;
        float gap = track.DeltaAhead(pS, rS);
        float target;
        if (rivalState == RivalState.Cruise)
            target = gap > 350 ? 18 : gap > 120 ? 26 : 33;
        else if (rivalState == RivalState.Battle)
            target = gap > 0 ? top * (gap > 120 ? 0.86f : 0.97f) : Mathf.Min(top * 1.05f, 90f);
        else
            target = Mathf.Max(0, rSpeed - 8 * dt);
        rSpeed += Mathf.Clamp(target - rSpeed, -22f * dt, 13f * dt);

        // Crude traffic dodge
        foreach (var t in traffic)
        {
            float ds = track.DeltaAhead(rS, t.S);
            if (ds > 0 && ds < 42 && Mathf.Abs(t.Lat - rTargetLat) < 2.4f)
            {
                rTargetLat = TrackSpline.Lanes[(System.Array.IndexOf(TrackSpline.Lanes, rTargetLat) + 2) % 4];
                break;
            }
        }
        rLat += Mathf.Clamp(rTargetLat - rLat, -6f * dt, 6f * dt);
        rS = track.Wrap(rS + rSpeed * dt);
        PoseCar(rivalCar, rS, rLat, 0);
        rivalCar.Roll(rSpeed * dt);
    }

    void TryFlash()
    {
        if (rivalCar == null || inBattle || rivalState != RivalState.Cruise) return;
        float gap = track.DeltaAhead(pS, rS);
        if (gap < 2 || gap > FlashRange) return;
        inBattle = true;
        rivalState = RivalState.Battle;
        pSp = rSp = 100;
        Say(rivalDef.IntroAr, rivalDef.Id + "-intro", rivalDef.VoiceStability);
        engineAudio.BattleSting();
        ShowMessage("BATTLE — " + rivalDef.Name + " " + rivalDef.ArabicName);
    }

    void UpdateBattle(float dt)
    {
        float gap = track.DeltaAhead(pS, rS);
        if (gap > 4)
        {
            float drain = 1.7f + Mathf.Min(gap, 160) * 0.04f + (gap > 230 ? 16 : 0);
            pSp = Mathf.Max(0, pSp - drain * dt);
        }
        else if (gap < -4)
        {
            float lead = -gap;
            float drain = 1.7f + Mathf.Min(lead, 160) * 0.04f + (lead > 230 ? 16 : 0);
            rSp = Mathf.Max(0, rSp - drain * dt);
        }

        if (rSp <= 0)
        {
            inBattle = false;
            rivalState = RivalState.Defeated;
            rivalIndex++;
            Say(rivalDef.LoseAr, rivalDef.Id + "-lose", rivalDef.VoiceStability);
            if (rivalIndex >= RivalDef.All.Length)
            {
                ShowMessage("KING OF GULF ROAD — ملك شارع الخليج 👑");
                Invoke(nameof(ChampionLine), 3f);
            }
            else
            {
                ShowMessage("VICTORY — " + rivalDef.Name + " defeated");
                Invoke(nameof(SpawnRival), 2.6f);
            }
        }
        else if (pSp <= 0)
        {
            inBattle = false;
            rivalState = RivalState.Cruise;
            Say(rivalDef.WinAr, rivalDef.Id + "-win", rivalDef.VoiceStability);
            ShowMessage("DEFEATED — press R to rematch");
        }

        if (Input.GetKeyDown(KeyCode.R) && !inBattle && pSp <= 0)
        {
            pSp = 100;
            SpawnRival();
        }
    }

    void ChampionLine() => Say("مبروك! إنت ملك شارع الخليج", "announcer-champion", 0.5f);

    void PoseCar(CarFactory.Car car, float s, float lat, float bodyYaw)
    {
        Vector3 pos = track.Pose(s, lat);
        // On the asphalt, which WorldBuilder lays 2 cm above the ground
        // plane: at y 0 the tyres sat 2 cm into the road.
        car.Root.transform.position = pos + Vector3.up * 0.02f;
        car.Root.transform.rotation =
            Quaternion.LookRotation(track.TangentAt(s)) * Quaternion.Euler(0, bodyYaw * Mathf.Rad2Deg, 0);
    }

    void UpdateCamera(float dt)
    {
        shake = Mathf.Max(0, shake - shake * 3.5f * dt);
        Vector3 p = track.Pose(pS, pLat);
        Vector3 tan = track.TangentAt(pS);
        float dist = 9.5f + pSpeed * 0.02f;
        Vector3 target = p - tan * dist + Vector3.up * (3.4f + pSpeed * 0.007f);
        cam.transform.position = Vector3.Lerp(cam.transform.position, target, Mathf.Min(1f, dt * 5.5f));
        float t = Time.time;
        float amp = Mathf.Pow(pSpeed / PlayerTopSpeed, 3f) * 0.055f + shake * 0.32f;
        cam.transform.position += new Vector3(
            (Mathf.Sin(t * 31.7f) + Mathf.Sin(t * 17.3f)) * 0.5f * amp,
            (Mathf.Sin(t * 27.1f) + Mathf.Sin(t * 13.9f)) * 0.5f * amp, 0);
        Vector3 look = p + tan * 14f + Vector3.up * 1.4f
            + track.SideAt(pS) * Mathf.Clamp(track.CurvatureAt(pS) * pSpeed * pSpeed * 0.045f, -4f, 4f);
        cam.transform.LookAt(look);
        cam.fieldOfView = Mathf.Lerp(cam.fieldOfView, 62f + pSpeed / PlayerTopSpeed * 18f, dt * 3f);
    }

    void OnGUI()
    {
        GUI.color = Color.white;
        if (playerCar == null)
        {
            if (loadingCars)
                GUI.Label(new Rect(30, 20, 600, 40), "Loading the cars…",
                    new GUIStyle(GUI.skin.label) { fontSize = 22, fontStyle = FontStyle.Bold });
            return;
        }
        var big = new GUIStyle(GUI.skin.label) { fontSize = 42, fontStyle = FontStyle.Bold };
        var mid = new GUIStyle(GUI.skin.label) { fontSize = 18, fontStyle = FontStyle.Bold };
        GUI.Label(new Rect(30, Screen.height - 80, 300, 60), Mathf.RoundToInt(pSpeed * 3.6f) + " km/h", big);
        GUI.Label(new Rect(30, 20, 600, 30),
            "Rivals beaten: " + rivalIndex + " / " + RivalDef.All.Length, mid);

        if (rivalCar != null && rivalState != RivalState.Defeated && !inBattle)
        {
            float gap = track.DeltaAhead(pS, rS);
            GUI.Label(new Rect(Screen.width / 2f - 150, 60, 300, 30),
                gap >= 0 ? "Rival " + Mathf.RoundToInt(gap) + " m ahead" : "Rival behind", mid);
            if (gap >= 2 && gap <= FlashRange)
                GUI.Label(new Rect(Screen.width / 2f - 150, 90, 300, 30), "PRESS F TO FLASH ⚡", mid);
        }

        if (inBattle)
        {
            DrawBar(new Rect(Screen.width / 2f - 280, 20, 560, 16), pSp / 100f, new Color(0.2f, 0.85f, 0.5f));
            DrawBar(new Rect(Screen.width / 2f - 280, 42, 560, 16), rSp / 100f, new Color(0.9f, 0.25f, 0.25f));
        }

        if (Time.time < messageUntil)
            GUI.Label(new Rect(Screen.width / 2f - 300, Screen.height / 3f, 600, 40), message,
                new GUIStyle(GUI.skin.label) { fontSize = 26, fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleCenter });

        if (touch == null || !touch.Enabled)
        {
            GUI.Label(new Rect(Screen.width - 330, Screen.height - 50, 320, 40),
                "W/S drive · A/D steer · F flash · R rematch · M mute", GUI.skin.label);
        }
    }

    static void DrawBar(Rect r, float frac, Color c)
    {
        var prev = GUI.color;
        GUI.color = new Color(0, 0, 0, 0.5f);
        GUI.DrawTexture(r, Texture2D.whiteTexture);
        GUI.color = c;
        GUI.DrawTexture(new Rect(r.x, r.y, r.width * Mathf.Clamp01(frac), r.height), Texture2D.whiteTexture);
        GUI.color = prev;
    }
}
