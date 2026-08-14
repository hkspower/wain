using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;

// Live data connection to the web build.
//
// At boot this asks the game's own API for the authoritative track,
// roster, showroom and handling constants. On success the runtime tables
// replace the ones generated into GRNData.cs; on any failure — offline,
// LAN, a plane, a server mid-deploy — the generated tables stand in and
// the game plays identically. Callers never branch on where the numbers
// came from; they just read Rivals / Cars / TrackPoints.
//
// This mirrors the Unreal client's UGRNApiSubsystem deliberately, down to
// the refusal rules, so the two ports cannot drift in behaviour either.

public class GRNApi : MonoBehaviour
{
    public static GRNApi Instance { get; private set; }

    /// <summary>Where the web build lives. Override with -grnapi=&lt;url&gt;.</summary>
    public string BaseUrl = "http://localhost:3000";
    /// <summary>Hub server REST root. Override with -grnhub=&lt;url&gt;.</summary>
    public string HubUrl = "http://localhost:8787";

    /// <summary>True once the tables are usable, from network or fallback.</summary>
    public bool Ready { get; private set; }
    /// <summary>True when the tables came from the API rather than the bake.</summary>
    public bool Live { get; private set; }
    public event Action<bool> OnReady;

    const float TimeoutSeconds = 6f;

    List<GRNData.Rival> rivals;
    List<GRNData.Car> cars;
    List<GRNData.TrackPoint> trackPoints;

    // ------------------------------------------------------------ tables
    // Each prefers live data and falls back to the generated bake.

    public IReadOnlyList<GRNData.Rival> Rivals =>
        (IReadOnlyList<GRNData.Rival>)rivals ?? GRNData.Rivals;

    public IReadOnlyList<GRNData.Car> Cars =>
        (IReadOnlyList<GRNData.Car>)cars ?? GRNData.Cars;

    /// <summary>Live control points, or null to use the baked spline.</summary>
    public IReadOnlyList<GRNData.TrackPoint> TrackPoints => trackPoints;

    void Awake()
    {
        if (Instance != null && Instance != this) { Destroy(gameObject); return; }
        Instance = this;
        DontDestroyOnLoad(gameObject);
        ReadCommandLine();
        StartCoroutine(FetchGameData());
    }

    void ReadCommandLine()
    {
        foreach (var arg in Environment.GetCommandLineArgs())
        {
            if (arg.StartsWith("-grnapi=")) BaseUrl = arg.Substring(8).TrimEnd('/');
            else if (arg.StartsWith("-grnhub=")) HubUrl = arg.Substring(8).TrimEnd('/');
        }
    }

    IEnumerator FetchGameData()
    {
        using (var req = UnityWebRequest.Get(BaseUrl + "/api/grn/v1/gamedata"))
        {
            req.timeout = Mathf.CeilToInt(TimeoutSeconds);
            yield return req.SendWebRequest();

            if (req.result == UnityWebRequest.Result.Success)
            {
                if (TryParse(req.downloadHandler.text)) { Finish(true); yield break; }
                Debug.LogWarning("GRNApi: payload rejected; using baked tables.");
            }
            else
            {
                Debug.Log("GRNApi: " + req.error + " — using baked tables.");
            }
        }
        Finish(false);
    }

    void Finish(bool fromNetwork)
    {
        Live = fromNetwork;
        Ready = true;
        Debug.Log(string.Format("GRNApi ready ({0}): {1} rivals, {2} cars, {3} track points",
            fromNetwork ? "live" : "baked", Rivals.Count, Cars.Count,
            trackPoints != null ? trackPoints.Count : GRNData.ControlPoints.Length));
        OnReady?.Invoke(fromNetwork);
    }

    // ------------------------------------------------------------- parse
    // Unity's JsonUtility cannot handle the payload's nested objects and
    // arrays-of-objects at the top level, so the DTOs below mirror only
    // the fields the game reads. Anything the payload adds later is
    // ignored rather than fatal.

    [Serializable] class Payload
    {
        public int apiVersion;
        public TrackDto track;
        public RivalDto[] rivals;
        public CarDto[] cars;
    }
    [Serializable] class TrackDto { public PointDto[] controlPoints; }
    [Serializable] class PointDto { public float x, y, z; }
    [Serializable] class RivalDto
    {
        public string id, name, arabicName, crew, area, bodyStyle, bodyColor, accentColor;
        public float topSpeedKmh;
        public int prizeKd;
        public LinesDto lines;
    }
    [Serializable] class LinesDto { public string intro, win, lose; }
    [Serializable] class CarDto
    {
        public string id, name, color, bodyStyle, kit;
        public int price;
        public float power, topSpeedKmh, grip, brake;
    }

    bool TryParse(string json)
    {
        Payload p;
        try { p = JsonUtility.FromJson<Payload>(json); }
        catch (Exception e) { Debug.LogWarning("GRNApi: parse failed — " + e.Message); return false; }

        if (p == null) return false;

        // A payload whose shape this build does not know is worse than no
        // payload: the fields we read might mean something else now.
        if (p.apiVersion != GRNData.ApiVersion)
        {
            Debug.LogWarning(string.Format(
                "GRNApi: apiVersion {0} but this build understands {1}.", p.apiVersion, GRNData.ApiVersion));
            return false;
        }

        // Refuse a partial payload outright. Half a roster is worse than
        // none — the player would race a truncated career and not know.
        if (p.rivals == null || p.rivals.Length == 0 || p.cars == null || p.cars.Length == 0)
        {
            return false;
        }

        var r = new List<GRNData.Rival>(p.rivals.Length);
        for (int i = 0; i < p.rivals.Length; i++)
        {
            var d = p.rivals[i];
            if (string.IsNullOrEmpty(d.id) || d.topSpeedKmh <= 0f) return false;
            r.Add(new GRNData.Rival
            {
                Id = d.id, Name = d.name, ArabicName = d.arabicName,
                Crew = d.crew, Area = d.area,
                Body = ParseHex(d.bodyColor), Accent = ParseHex(d.accentColor),
                TopSpeedKmh = d.topSpeedKmh,
                Style = StyleFrom(d.bodyStyle),
                PrizeKd = d.prizeKd,
                IntroAr = d.lines != null ? d.lines.intro : "",
                WinAr = d.lines != null ? d.lines.win : "",
                LoseAr = d.lines != null ? d.lines.lose : "",
            });
        }

        var c = new List<GRNData.Car>(p.cars.Length);
        for (int i = 0; i < p.cars.Length; i++)
        {
            var d = p.cars[i];
            if (string.IsNullOrEmpty(d.id)) return false;
            c.Add(new GRNData.Car
            {
                Id = d.id, Name = d.name, Price = d.price,
                Power = d.power, TopSpeedKmh = d.topSpeedKmh, Grip = d.grip, Brake = d.brake,
                Paint = ParseHex(d.color),
                Style = StyleFrom(d.bodyStyle),
                AttackKit = d.kit == "attack",
            });
        }

        // Only publish once both lists are fully built, so a failure
        // halfway through can never leave a half-live roster behind.
        rivals = r;
        cars = c;
        if (p.track != null && p.track.controlPoints != null && p.track.controlPoints.Length >= 10)
        {
            var t = new List<GRNData.TrackPoint>(p.track.controlPoints.Length);
            foreach (var q in p.track.controlPoints)
                t.Add(new GRNData.TrackPoint { X = q.x, Z = q.z });
            trackPoints = t;
        }
        return true;
    }

    static BodyStyle StyleFrom(string s)
    {
        switch (s)
        {
            case "zx": return BodyStyle.ZX;
            case "gtr": return BodyStyle.GTR;
            case "rx7": return BodyStyle.RX7;
            default: return BodyStyle.Sedan;
        }
    }

    /// <summary>"#rrggbb" to a Color; anything unparseable comes back white
    /// rather than throwing, so one bad swatch cannot sink the roster.</summary>
    static Color ParseHex(string hex)
    {
        if (string.IsNullOrEmpty(hex)) return Color.white;
        if (hex[0] == '#') hex = hex.Substring(1);
        int rgb;
        if (!int.TryParse(hex, System.Globalization.NumberStyles.HexNumber,
                System.Globalization.CultureInfo.InvariantCulture, out rgb))
            return Color.white;
        return new Color(((rgb >> 16) & 255) / 255f, ((rgb >> 8) & 255) / 255f, (rgb & 255) / 255f);
    }

    // --------------------------------------------------------- hub writes

    /// <summary>Submit a lap to the hub leaderboard. Fire and forget.</summary>
    public void SubmitLap(string playerName, int lapMs)
    {
        StartCoroutine(Post("/api/v1/lap",
            "{\"name\":\"" + Escape(playerName) + "\",\"ms\":" + lapMs + "}"));
    }

    /// <summary>Mirror career progress to the hub (4 KB cap server-side).</summary>
    public void PushCareer(string playerName, int rivalIndex, int kd, int xp)
    {
        StartCoroutine(Put("/api/v1/career/" + UnityWebRequest.EscapeURL(playerName),
            "{\"rivalIndex\":" + rivalIndex + ",\"kd\":" + kd + ",\"xp\":" + xp + "}"));
    }

    IEnumerator Post(string path, string body) { yield return Send("POST", path, body); }
    IEnumerator Put(string path, string body) { yield return Send("PUT", path, body); }

    IEnumerator Send(string verb, string path, string body)
    {
        using (var req = new UnityWebRequest(HubUrl + path, verb))
        {
            req.uploadHandler = new UploadHandlerRaw(System.Text.Encoding.UTF8.GetBytes(body));
            req.downloadHandler = new DownloadHandlerBuffer();
            req.SetRequestHeader("Content-Type", "application/json");
            req.timeout = Mathf.CeilToInt(TimeoutSeconds);
            yield return req.SendWebRequest();
            // The hub is optional; a failure here must never interrupt a race.
            if (req.result != UnityWebRequest.Result.Success)
                Debug.Log("GRNApi hub " + verb + " " + path + ": " + req.error);
        }
    }

    static string Escape(string s) =>
        (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");
}
