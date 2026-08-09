using UnityEngine;

// Closed Catmull-Rom loop tracing Kuwait's Gulf Road — same control
// points as the web build (src/game/track.ts). Arc-length parameterised
// via a dense lookup table. One unit = one metre.
public class TrackSpline
{
    public const float RoadHalfWidth = 7f;
    public static readonly float[] Lanes = { -5.25f, -1.75f, 1.75f, 5.25f };

    static readonly Vector3[] Control =
    {
        new Vector3(800, 0, 0),    // Ras Ajouza — Kuwait Towers
        new Vector3(770, 0, -350), // Dasman curve
        new Vector3(820, 0, -700), // Bneid Al-Gar
        new Vector3(760, 0, -1100),
        new Vector3(830, 0, -1500), // Salmiya marina bay
        new Vector3(760, 0, -1950),
        new Vector3(800, 0, -2350), // Scientific Center
        new Vector3(850, 0, -2700),
        new Vector3(1050, 0, -2950), // Ras Al-Ard point
        new Vector3(1400, 0, -2900),
        new Vector3(1650, 0, -2500), // inland return leg
        new Vector3(1700, 0, -2000),
        new Vector3(1620, 0, -1400),
        new Vector3(1700, 0, -800),
        new Vector3(1650, 0, -300),
        new Vector3(1400, 0, 150), // city top curve
        new Vector3(1050, 0, 200),
    };

    const int Samples = 4096;
    readonly Vector3[] pts = new Vector3[Samples];
    readonly float[] cum = new float[Samples + 1];
    public float Length { get; private set; }

    public TrackSpline()
    {
        int n = Control.Length;
        for (int i = 0; i < Samples; i++)
        {
            float t = (float)i / Samples * n;
            int seg = Mathf.FloorToInt(t) % n;
            float u = t - Mathf.Floor(t);
            pts[i] = CatmullRom(
                Control[(seg - 1 + n) % n], Control[seg],
                Control[(seg + 1) % n], Control[(seg + 2) % n], u);
        }
        cum[0] = 0;
        for (int i = 1; i <= Samples; i++)
            cum[i] = cum[i - 1] + Vector3.Distance(pts[i - 1], pts[i % Samples]);
        Length = cum[Samples];
    }

    static Vector3 CatmullRom(Vector3 p0, Vector3 p1, Vector3 p2, Vector3 p3, float t)
    {
        float t2 = t * t, t3 = t2 * t;
        return 0.5f * ((2f * p1) + (-p0 + p2) * t
            + (2f * p0 - 5f * p1 + 4f * p2 - p3) * t2
            + (-p0 + 3f * p1 - 3f * p2 + p3) * t3);
    }

    public float Wrap(float s)
    {
        s %= Length;
        return s < 0 ? s + Length : s;
    }

    /// Signed shortest distance from `from` to `to` along the loop.
    public float DeltaAhead(float from, float to)
    {
        float d = Wrap(to) - Wrap(from);
        if (d > Length / 2) d -= Length;
        if (d < -Length / 2) d += Length;
        return d;
    }

    public Vector3 PointAt(float s)
    {
        s = Wrap(s);
        // cum[] is monotonic; binary search for the sample pair
        int lo = 0, hi = Samples;
        while (lo + 1 < hi)
        {
            int mid = (lo + hi) / 2;
            if (cum[mid] <= s) lo = mid; else hi = mid;
        }
        float span = cum[lo + 1] - cum[lo];
        float f = span > 0 ? (s - cum[lo]) / span : 0;
        return Vector3.Lerp(pts[lo], pts[(lo + 1) % Samples], f);
    }

    public Vector3 TangentAt(float s)
    {
        Vector3 a = PointAt(s - 1.5f), b = PointAt(s + 1.5f);
        Vector3 t = b - a;
        t.y = 0;
        return t.normalized;
    }

    /// Unit vector pointing to the driver's right.
    public Vector3 SideAt(float s) => Vector3.Cross(Vector3.up, TangentAt(s)).normalized * -1f;

    public Vector3 Pose(float s, float lateral) => PointAt(s) + SideAt(s) * lateral;

    /// Signed curvature over an 8 m window (positive pushes right).
    public float CurvatureAt(float s)
    {
        Vector3 t1 = TangentAt(s), t2 = TangentAt(s + 8f);
        float crossY = t1.z * t2.x - t1.x * t2.z;
        return -Mathf.Asin(Mathf.Clamp(crossY, -1f, 1f)) / 8f;
    }
}
