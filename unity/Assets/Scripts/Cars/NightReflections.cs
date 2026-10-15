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
            var cube = new Cubemap(size, TextureFormat.RGBAHalf, true)
            {
                name = "NightEnvironment",
                filterMode = FilterMode.Trilinear,
                wrapMode = TextureWrapMode.Clamp,
            };
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

            var faces = new Color[6][];
            for (int f = 0; f < 6; f++)
            {
                var px = faces[f] = new Color[size * size];
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
            }
            Prefilter(cube, faces, size);
            cube.Apply(false, false);
            environment = cube;
            return cube;
        }

        // ------------------------------------------------------ prefilter

        /// <summary>GGX-prefiltered mips, as URP expects to find them: it
        /// reads a reflection at mip = r(1.7 - 0.7r) x 6 for perceptual
        /// roughness r (PerceptualRoughnessToMipmapLevel), so each mip here
        /// holds the environment convolved with the GGX lobe of the r that
        /// maps to it, and mip 6 on (2x2, 1x1) hold r = 1. Box mips are no
        /// lobe at all: a satin or matte coat reflected a blocky smear of
        /// the lamps, not a highlight. Filtered importance sampling (Křivánek and
        /// Colbert): each sample reads the box-reduced source at the level
        /// whose texel matches its solid angle, so a modest count stays
        /// smooth. N = V = R, so the samples are the same for every texel of
        /// a mip and are drawn once per mip.</summary>
        static void Prefilter(Cubemap cube, Color[][] faces, int size)
        {
            int mips = cube.mipmapCount;
            // Box-reduced source chain: src[level][face].
            var src = new Color[mips][][];
            src[0] = faces;
            for (int l = 1; l < mips; l++)
            {
                int s = Mathf.Max(1, size >> l), ps = Mathf.Max(1, size >> (l - 1));
                src[l] = new Color[6][];
                for (int f = 0; f < 6; f++)
                {
                    var o = src[l][f] = new Color[s * s];
                    var p = src[l - 1][f];
                    for (int y = 0; y < s; y++)
                        for (int x = 0; x < s; x++)
                        {
                            int x0 = Mathf.Min(x * 2, ps - 1), x1 = Mathf.Min(x * 2 + 1, ps - 1);
                            int y0 = Mathf.Min(y * 2, ps - 1), y1 = Mathf.Min(y * 2 + 1, ps - 1);
                            o[y * s + x] = (p[y0 * ps + x0] + p[y0 * ps + x1] + p[y1 * ps + x0] + p[y1 * ps + x1]) * 0.25f;
                        }
                }
            }
            for (int f = 0; f < 6; f++) cube.SetPixels(faces[f], (CubemapFace)f, 0);

            const int Samples = 48;
            float texelAngle = 4f * Mathf.PI / (6f * size * size);
            var dirs = new Vector3[Samples];
            var weights = new float[Samples];
            var lods = new int[Samples];
            for (int m = 1; m < mips; m++)
            {
                float r = MipRoughness(m), a = r * r, a2 = a * a;
                int n = 0;
                for (int i = 0; i < Samples; i++)
                {
                    // Hammersley point, GGX half-vector about +Z, reflected.
                    float u1 = (i + 0.5f) / Samples, u2 = RadicalInverse((uint)i);
                    float phi = 2f * Mathf.PI * u1;
                    float cosT = Mathf.Sqrt((1f - u2) / (1f + (a2 - 1f) * u2)), sinT = Mathf.Sqrt(1f - cosT * cosT);
                    var h = new Vector3(sinT * Mathf.Cos(phi), sinT * Mathf.Sin(phi), cosT);
                    var l = 2f * cosT * h - Vector3.forward;
                    if (l.z <= 0f) continue;
                    float dd = cosT * cosT * (a2 - 1f) + 1f;
                    float pdf = a2 / (Mathf.PI * dd * dd) * 0.25f; // D(h) cos / (4 v.h), v = n
                    float lod = 0.5f * Mathf.Log(1f / (Samples * pdf + 1e-6f) / texelAngle, 2f) + 1f;
                    dirs[n] = l;
                    weights[n] = l.z;
                    lods[n] = Mathf.Clamp(Mathf.RoundToInt(lod), 0, mips - 1);
                    n++;
                }
                int s = Mathf.Max(1, size >> m);
                var px = new Color[s * s];
                for (int f = 0; f < 6; f++)
                {
                    for (int y = 0; y < s; y++)
                        for (int x = 0; x < s; x++)
                        {
                            var nrm = Direction((CubemapFace)f, (x + 0.5f) / s * 2f - 1f, (y + 0.5f) / s * 2f - 1f).normalized;
                            var up = Mathf.Abs(nrm.y) < 0.999f ? Vector3.up : Vector3.right;
                            var tx = Vector3.Cross(up, nrm).normalized;
                            var ty = Vector3.Cross(nrm, tx);
                            Color sum = Color.clear;
                            float w = 0f;
                            for (int i = 0; i < n; i++)
                            {
                                var d = dirs[i];
                                sum += Fetch(src[lods[i]], Mathf.Max(1, size >> lods[i]), tx * d.x + ty * d.y + nrm * d.z) * weights[i];
                                w += weights[i];
                            }
                            var c = w > 0f ? sum / w : Fetch(src[m], s, nrm);
                            c.a = 1f;
                            px[y * s + x] = c;
                        }
                    cube.SetPixels(px, (CubemapFace)f, m);
                }
            }
        }

        /// <summary>The perceptual roughness URP reads mip <paramref name="m"/>
        /// at: the inverse of m = r(1.7 - 0.7r) x 6, 1 from mip 6 on.</summary>
        static float MipRoughness(int m)
        {
            float k = m / 6f;
            if (k >= 1f) return 1f;
            return (1.7f - Mathf.Sqrt(2.89f - 2.8f * k)) / 1.4f;
        }

        static float RadicalInverse(uint b)
        {
            b = (b << 16) | (b >> 16);
            b = ((b & 0x55555555u) << 1) | ((b & 0xAAAAAAAAu) >> 1);
            b = ((b & 0x33333333u) << 2) | ((b & 0xCCCCCCCCu) >> 2);
            b = ((b & 0x0F0F0F0Fu) << 4) | ((b & 0xF0F0F0F0u) >> 4);
            b = ((b & 0x00FF00FFu) << 8) | ((b & 0xFF00FF00u) >> 8);
            return b * 2.3283064365386963e-10f;
        }

        /// <summary>The texel a direction lands on: Direction() inverted.</summary>
        static Color Fetch(Color[][] level, int s, Vector3 d)
        {
            float ax = Mathf.Abs(d.x), ay = Mathf.Abs(d.y), az = Mathf.Abs(d.z);
            int f; float u, v;
            if (ax >= ay && ax >= az)
            {
                if (d.x > 0f) { f = 0; u = -d.z / ax; v = -d.y / ax; }
                else { f = 1; u = d.z / ax; v = -d.y / ax; }
            }
            else if (ay >= az)
            {
                if (d.y > 0f) { f = 2; u = d.x / ay; v = d.z / ay; }
                else { f = 3; u = d.x / ay; v = -d.z / ay; }
            }
            else
            {
                if (d.z > 0f) { f = 4; u = d.x / az; v = -d.y / az; }
                else { f = 5; u = -d.x / az; v = -d.y / az; }
            }
            int x = Mathf.Clamp((int)((u + 1f) * 0.5f * s), 0, s - 1);
            int y = Mathf.Clamp((int)((v + 1f) * 0.5f * s), 0, s - 1);
            return level[f][y * s + x];
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
            RenderSettings.reflectionIntensity = 1.5f;
            var sky = Shader.Find("Skybox/Cubemap");
            if (sky != null)
            {
                if (skybox == null) skybox = new Material(sky) { name = "NightSky" };
                skybox.SetTexture("_Tex", env);
                RenderSettings.skybox = skybox;
            }
        }

        static Texture2D black;

        /// <summary>A 1x1 black linear texture: the occlusion map EnvFactor
        /// sets (the baker saves it as an asset so baked materials keep it).</summary>
        public static Texture2D EnvBlack
        {
            get
            {
                if (black != null) return black;
                black = new Texture2D(1, 1, TextureFormat.RGBA32, false, true)
                {
                    name = "EnvFactorBlack",
                    wrapMode = TextureWrapMode.Clamp,
                    filterMode = FilterMode.Point,
                };
                black.SetPixel(0, 0, Color.black);
                black.Apply(false, false);
                return black;
            }
        }

        /// <summary>Scale how much of the environment (probe and sky) a
        /// material reflects, 0..1, without touching its direct light — the
        /// web's per-material envMapIntensity. URP Lit and Complex Lit have
        /// no such knob; their occlusion has one: indirect light is
        /// multiplied by lerp(1, map.g, _OcclusionStrength), so a black map
        /// at strength 1 - factor leaves exactly factor of it. (It scales
        /// the ambient diffuse as well, which at night is the smaller term.)
        /// The built-in Standard shader reads the same two properties.</summary>
        public static void EnvFactor(Material mat, float factor)
        {
            factor = Mathf.Clamp01(factor);
            if (factor >= 0.999f)
            {
                mat.SetTexture("_OcclusionMap", null);
                mat.SetFloat("_OcclusionStrength", 1f);
                mat.DisableKeyword("_OCCLUSIONMAP");
                return;
            }
            mat.SetTexture("_OcclusionMap", EnvBlack);
            mat.SetFloat("_OcclusionStrength", 1f - factor);
            mat.EnableKeyword("_OCCLUSIONMAP");
        }

        /// <summary>Keep the world out of the car probe's reach: every
        /// renderer under <paramref name="root"/> reflects the baked night
        /// environment only. The probe rides with the player's car and is
        /// sized and placed for its paint; the road and the buildings it
        /// happens to overlap would otherwise swap reflections as it passes.</summary>
        public static void ExcludeWorld(Transform root)
        {
            if (root == null) return;
            foreach (var r in root.GetComponentsInChildren<Renderer>(true))
                r.reflectionProbeUsage = ReflectionProbeUsage.Off;
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
            probe.intensity = 2.1f;
            var f = go.AddComponent<ProbeFollower>();
            f.Target = target;
            f.Lift = 1.2f;
            return probe;
        }
    }
}
