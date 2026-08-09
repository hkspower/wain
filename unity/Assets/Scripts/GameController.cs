using UnityEngine;

// The whole game loop — a faithful port of the web build's engine
// (src/game/engine.ts): TXR rules on the Gulf Road. Find the rival,
// flash headlights (F) to battle; the trailing car bleeds SP.
public class GameController : MonoBehaviour
{
    const float PlayerTopSpeed = 92f; // m/s
    const float FlashRange = 60f;
    static readonly float[] Gears = { 0, 55, 95, 145, 200, 260, 320 };

    TrackSpline track;
    Camera cam;
    ElevenLabsVoice voice;
    EngineAudio engineAudio;

    // Player state (same handling model as the web build)
    float pS = 40f, pLat, pSpeed, pSp = 100f;
    float heading, steerSmooth, slipVel, shake;
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

    void Start()
    {
        Application.targetFrameRate = 120;
        track = new TrackSpline();
        WorldBuilder.Build(track);

        cam = new GameObject("ChaseCam").AddComponent<Camera>();
        cam.backgroundColor = new Color(0.02f, 0.028f, 0.06f);
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.fieldOfView = 62f;
        cam.farClipPlane = 4000f;

        voice = gameObject.AddComponent<ElevenLabsVoice>();
        engineAudio = gameObject.AddComponent<EngineAudio>();

        playerCar = CarFactory.Create(new Color(0.95f, 0.96f, 0.97f), new Color(0f, 0.48f, 0.24f));
        pLat = TrackSpline.Lanes[1];

        var headlight = new GameObject("Headlight").AddComponent<Light>();
        headlight.type = LightType.Spot;
        headlight.color = new Color(1f, 0.95f, 0.8f);
        headlight.intensity = 4f;
        headlight.range = 90f;
        headlight.spotAngle = 55f;
        headlight.shadows = LightShadows.Hard;
        headlight.transform.SetParent(playerCar.Root.transform, false);
        headlight.transform.localPosition = new Vector3(0, 1.2f, 1.8f);

        traffic = new Traffic[16];
        var trafficColors = new[] { 0x8A96A3, 0x5D6770, 0xB0A890, 0x6E7F8D, 0x4A5560, 0x9C8F7A };
        for (int i = 0; i < traffic.Length; i++)
        {
            int c = trafficColors[i % trafficColors.Length];
            traffic[i] = new Traffic
            {
                Car = CarFactory.Create(new Color(((c >> 16) & 255) / 255f, ((c >> 8) & 255) / 255f, (c & 255) / 255f)),
                S = track.Wrap(120f + (float)i / traffic.Length * track.Length),
                Lat = TrackSpline.Lanes[i % 4],
                Speed = 21f + Random.value * 9f,
            };
        }

        SpawnRival();
        Say("يلا! دور على خصمك", "announcer-start", 0.5f);
        ShowMessage("Find " + rivalDef.Name + " — flash F to battle");
    }

    void SpawnRival()
    {
        if (rivalCar != null) Destroy(rivalCar.Root);
        rivalCar = null;
        if (rivalIndex >= RivalDef.All.Length) return;
        rivalDef = RivalDef.All[rivalIndex];
        rivalCar = CarFactory.Create(rivalDef.Body, rivalDef.Accent);
        rS = track.Wrap(pS + 260f);
        rLat = rTargetLat = TrackSpline.Lanes[2];
        rSpeed = 27f;
        rSp = 100f;
        rivalState = RivalState.Cruise;
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

        if (Input.GetKeyDown(KeyCode.F)) TryFlash();
        if (Input.GetKeyDown(KeyCode.M)) engineAudio.ToggleMute();
    }

    void UpdatePlayer(float dt)
    {
        bool up = Input.GetKey(KeyCode.W) || Input.GetKey(KeyCode.UpArrow);
        bool down = Input.GetKey(KeyCode.S) || Input.GetKey(KeyCode.DownArrow);
        float steer = (Input.GetKey(KeyCode.D) || Input.GetKey(KeyCode.RightArrow) ? 1 : 0)
                    - (Input.GetKey(KeyCode.A) || Input.GetKey(KeyCode.LeftArrow) ? 1 : 0);

        float accel = up ? Mathf.Max(0, 19f * (1f - pSpeed / 115f)) : 0;
        float braking = down ? 26f : 0;
        float drag = 0.0012f * pSpeed * pSpeed + 1.2f;
        pSpeed = Mathf.Max(0, pSpeed + (accel - braking - drag * (up ? 0.35f : 1f)) * dt);

        steerSmooth += (steer - steerSmooth) * Mathf.Min(1f, dt * 7f);
        float yawRateMax = Mathf.Min(1.6f, 12f / Mathf.Max(pSpeed, 2f));
        heading += steerSmooth * yawRateMax * dt;
        if (Mathf.Abs(steer) < 0.1f) heading -= heading * Mathf.Min(1f, dt * 2.4f);
        heading = Mathf.Clamp(heading, -0.45f, 0.45f);

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
        foreach (var w in playerCar.Wheels) w.Rotate(pSpeed / 0.36f * dt * Mathf.Rad2Deg, 0, 0, Space.Self);
        playerCar.TailMat.SetColor("_EmissionColor",
            new Color(1f, 0.13f, 0.13f) * (down ? 6f : 1.6f));

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
        foreach (var w in rivalCar.Wheels) w.Rotate(rSpeed / 0.36f * dt * Mathf.Rad2Deg, 0, 0, Space.Self);
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
        car.Root.transform.position = pos;
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

        GUI.Label(new Rect(Screen.width - 330, Screen.height - 50, 320, 40),
            "W/S drive · A/D steer · F flash · R rematch · M mute", GUI.skin.label);
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
