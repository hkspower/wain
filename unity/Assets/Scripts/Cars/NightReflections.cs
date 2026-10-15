using UnityEngine;
using UnityEngine.Rendering;

namespace NightRacer.Cars
{
    /// <summary>
    /// Something for the paint to reflect at night.
    ///
    /// A clear coat over nothing reads as a hole: the web measured 25-75% of
    /// a car's bodywork dead before its reflection probe held the sky. The
    /// Unity port had no reflection source at all — no skybox, no probe, a
    /// flat ambient — so every car mirrored whatever default the scene had.
    ///
    /// Two layers, as on the web:
    ///  - a baked night environment (src/game/env.ts's recipe: a dark dome
    ///    with a bright horizon band, eight street-lamp heads, the moon, a
    ///    ring of towers with lit windows) as the scene's reflection and the
    ///    probe's sky — the only source on phones, where realtime probes are
    ///    off (MobileTier);
    ///  - a realtime probe riding with the player's car that captures the
    ///    actual street (lamp heads, towers, the road) and leaves the cars
    ///    and the lamp coronas out, as the web's probe does.
    /// </summary>
    public static class NightReflections
    {
        /// <summary>Additive glows and coronas: seen by cameras, left out of
        /// the car probe (sized for the main view, they smear in a face).</summary>
        public const int GlowLayer = 10;

        static Cubemap environment;

        /// <summary>env.ts's dome, top (0) to bottom (1): sRGB stops.</summary>
        static readonly (float t, int hex)[] Dome =
        {
            (0f, 0x0b0d14), (0.42f, 0x161a24), (0.5f, 0xbfbbad), (0.56f, 0x2e2d2a), (0.72f, 0x0b0c10), (1f, 0x050506),
        };

        public static Cubemap Environment(int size = 128)
        {
            if (environment != null) return environment;
            var cube = new Cubemap(size, TextureFormat.RGBAHalf, true) { name = "NightEnvironment" };
            var rnd = new System.Random(20260);
            var lamps = new Vector4[8];
            for (int k = 0; k < 8; k++)
            {
                float az = (k + 0.5f) / 8f * Mathf.PI * 2f;
                float h = 11f + 3f * (k % 3);
                var p = new Vector3(Mathf.Cos(az) * 34f, h, Mathf.Sin(az) * 34f);
                lamps[k] = new Vector4(p.x, p.y, p.z, Mathf.Asin(1.6f / p.magnitude));
            }
            var moon = new Vector3(-34f, 38f, -14f);
            float moonR = Mathf.Asin(3.4f / moon.magnitude);
            moon.Normalize();
            // Towers: azimuth centre, half-width (rad), top elevation (rad), window seed.
            var towers = new Vector4[14];
            for (int k = 0; k < towers.Length; k++)
            {
                float ring = 95f + (float)rnd.NextDouble() * 26f;
                float width = 9f + (float)rnd.NextDouble() * 9f;
                float height = 26f + (float)rnd.NextDouble() * 44f;
                towers[k] = new Vector4((k + (float)rnd.NextDouble() * 0.6f) / towers.Length * Mathf.PI * 2f,
                    Mathf.Atan(width * 0.5f / ring), Mathf.Atan(height / ring), k * 7919);
            }
            var lampColor = new Color(11.5f, 12.0f, 13.2f);
            var moonColor = new Color(9.5f, 10f, 12f);
            var towerColor = Lin(0x07080c);
            var winWarm = Lin(0x6b5a34);
            var winCool = Lin(0x3d4759);

            var px = new Color[size * size];
            for (int f = 0; f < 6; f++)
            {
                var face = (CubemapFace)f;
                for (int y = 0; y < size; y++)
                    for (int x = 0; x < size; x++)
                    {
                        float u = (x + 0.5f) / size * 2f - 1f, v = (y + 0.5f) / size * 2f - 1f;
                        var d = Direction(face, u, v).normalized;
                        float elev = Mathf.Asin(Mathf.Clamp(d.y, -1f, 1f));
                        float az = Mathf.Atan2(d.z, d.x);
                        if (az < 0) az += Mathf.PI * 2f;
                        var c = DomeColor(0.5f - elev / Mathf.PI);
                        // Towers stand on the horizon, in front of the dome.
                        foreach (var t in towers)
                        {
                            float da = Mathf.Abs(Mathf.DeltaAngle(az * Mathf.Rad2Deg, t.x * Mathf.Rad2Deg)) * Mathf.Deg2Rad;
                            if (da > t.y || elev < -0.012f || elev > t.z) continue;
                            int col = (int)((da / t.y + 1f) * 8f), row = (int)(elev / t.z * 32f);
                            int hash = (int)((uint)(col * 73856093 ^ row * 19349663 ^ (int)t.w) % 100u);
                            bool lit = hash < 34 && (col % 2 == 0) && (row % 2 == 0);
                            c = lit ? (hash % 3 == 0 ? winCool : winWarm) : towerColor;
                        }
                        foreach (var l in lamps)
                            if (Vector3.Angle(d, new Vector3(l.x, l.y, l.z)) * Mathf.Deg2Rad < l.w) c = lampColor;
                        if (Vector3.Angle(d, moon) * Mathf.Deg2Rad < moonR) c = moonColor;
                        px[y * size + x] = c;
                    }
                cube.SetPixels(px, face);
            }
            cube.Apply(true, false);
            environment = cube;
            return cube;
        }

        /// <summary>Cubemap texel direction, D3D/Unity face convention
        /// (y = 0 is the top row of a face).</summary>
        static Vector3 Direction(CubemapFace f, float u, float v)
        {
            switch (f)
            {
                case CubemapFace.PositiveX: return new Vector3(1f, -v, -u);
                case CubemapFace.NegativeX: return new Vector3(-1f, -v, u);
                case CubemapFace.PositiveY: return new Vector3(u, 1f, v);
                case CubemapFace.NegativeY: return new Vector3(u, -1f, -v);
                case CubemapFace.PositiveZ: return new Vector3(u, -v, 1f);
                default: return new Vector3(-u, -v, -1f);
            }
        }

        static Color DomeColor(float t)
        {
            for (int i = 1; i < Dome.Length; i++)
                if (t <= Dome[i].t)
                {
                    float k = Mathf.InverseLerp(Dome[i - 1].t, Dome[i].t, t);
                    return Color.Lerp(Srgb(Dome[i - 1].hex), Srgb(Dome[i].hex), k).linear;
                }
            return Lin(Dome[Dome.Length - 1].hex);
        }

        static Color Srgb(int hex) => new Color(((hex >> 16) & 255) / 255f, ((hex >> 8) & 255) / 255f, (hex & 255) / 255f);
        static Color Lin(int hex) => Srgb(hex).linear;

        static Material skybox;

        /// <summary>Make the night environment the scene's reflection source
        /// and the sky reflection probes see. The cameras still clear to the
        /// game's solid night colour; this sky is only ever reflected.</summary>
        public static void Install()
        {
            var env = Environment();
            RenderSettings.defaultReflectionMode = DefaultReflectionMode.Custom;
#if UNITY_2022_1_OR_NEWER
            RenderSettings.customReflectionTexture = env;
#else
            RenderSettings.customReflection = env;
#endif
            RenderSettings.reflectionIntensity = 1f;
            var sky = Shader.Find("Skybox/Cubemap");
            if (sky != null)
            {
                if (skybox == null) skybox = new Material(sky) { name = "NightSky" };
                skybox.SetTexture("_Tex", env);
                RenderSettings.skybox = skybox;
            }
        }

        /// <summary>A realtime probe that rides with <paramref name="target"/>
        /// (position only) and leaves cars and glows out of what it sees.</summary>
        public static ReflectionProbe Follow(Transform target, int resolution = 256)
        {
            var go = new GameObject("CarProbe");
            var probe = go.AddComponent<ReflectionProbe>();
            probe.mode = ReflectionProbeMode.Realtime;
            probe.refreshMode = ReflectionProbeRefreshMode.EveryFrame;
            probe.timeSlicingMode = ReflectionProbeTimeSlicingMode.IndividualFaces;
            probe.resolution = resolution;
            probe.hdr = true;
            probe.boxProjection = false;
            probe.size = new Vector3(40f, 24f, 40f);
            probe.nearClipPlane = 0.3f;
            probe.farClipPlane = 420f;
            probe.clearFlags = ReflectionProbeClearFlags.Skybox;
            probe.cullingMask = ~((1 << CarModel.CarLayer) | (1 << GlowLayer));
            probe.importance = 10;
            probe.intensity = 1.25f;
            var f = go.AddComponent<ProbeFollower>();
            f.Target = target;
            f.Lift = 1.2f;
            return probe;
        }
    }
}
