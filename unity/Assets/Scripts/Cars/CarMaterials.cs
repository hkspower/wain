using UnityEngine;
using UnityEngine.Rendering;

namespace NightRacer.Cars
{
    /// <summary>
    /// A game car material, rebuilt for URP from its glTF values.
    ///
    /// What makes a car read at night in the web build, and therefore here:
    /// a clear coat over the basecoat (URP's Complex Lit — plain Lit has no
    /// coat at all, which is why the port's old paint, Lit with a
    /// _CLEARCOAT keyword it does not have, never had one); lamps at their
    /// real emissive strengths (glTFast ignores KHR_materials_emissive_
    /// strength, so headlamps came out at a quarter and plates, decals and
    /// brake discs glowed at full white); glass that keeps its reflection
    /// at 45% opacity (premultiplied, URP's "preserve specular"); and the
    /// night floors that keep a livery and plates readable between lamps.
    /// </summary>
    public static class CarMaterials
    {
        public const string ComplexLitShader = "Universal Render Pipeline/Complex Lit";
        public const string LitShader = "Universal Render Pipeline/Lit";

        static Shader complexLit, lit, standard;
        static bool resolved, urp;

        /// <summary>True when URP's shaders are present. Without them the
        /// cars fall back to the built-in Standard shader (no clear coat).</summary>
        public static bool Urp { get { Resolve(); return urp; } }

        static void Resolve()
        {
            if (resolved) return;
            resolved = true;
            lit = Shader.Find(LitShader);
            complexLit = Shader.Find(ComplexLitShader);
            urp = lit != null;
            if (complexLit == null) complexLit = lit;
            standard = Shader.Find("Standard");
        }

        /// <summary>Tail-lamp emissive strengths: idle, and on the brake
        /// (src/game/cars.ts TAIL — lens 0.55 / 1.7, core 0.9 / 2.8).</summary>
        public const float TailLensIdle = 0.55f, TailLensBrake = 1.7f, TailCoreIdle = 0.9f, TailCoreBrake = 2.8f;

        /// <summary>Unity takes material colours through the sRGB API and
        /// converts them in a linear project; glTF values are linear.</summary>
        public static void SetLinear(Material m, string prop, Color linear)
        {
            m.SetColor(prop, QualitySettings.activeColorSpace == ColorSpace.Linear ? linear.gamma : linear);
        }

        public static Color Linear(float[] c, float alpha = 1f) =>
            new Color(c[0], c[1], c[2], c.Length > 3 ? c[3] : alpha);

        /// <summary>Build the URP material for one glTF material.
        /// <paramref name="textures"/> is indexed by glTF texture index.
        /// <paramref name="night"/> is the lamp level, 0 by day to 1 at night,
        /// scaling the night floors as world.lampLevel() does on the web.</summary>
        public static Material Build(CarMat m, Texture2D[] textures, float night, Texture2D[] metalGloss = null)
        {
            Resolve();
            bool coat = m.HasClearcoat && m.Clearcoat > 0f;
            Shader shader = urp ? (coat ? complexLit : lit) : standard;
            var mat = new Material(shader) { name = string.IsNullOrEmpty(m.Name) ? "driver" : m.Name };

            var baseColor = Linear(m.BaseColor);
            float smooth = Mathf.Clamp01(1f - m.Roughness);
            if (urp)
            {
                SetLinear(mat, "_BaseColor", baseColor);
                mat.SetFloat("_WorkflowMode", 1f); // metallic
                mat.SetFloat("_Metallic", m.Metallic);
                mat.SetFloat("_Smoothness", smooth);
            }
            else
            {
                SetLinear(mat, "_Color", baseColor);
                mat.SetFloat("_Metallic", m.Metallic);
                mat.SetFloat("_Glossiness", smooth);
            }

            // --- textures --------------------------------------------------
            var baseTex = Tex(textures, m.BaseTex);
            if (baseTex != null)
            {
                mat.SetTexture(urp ? "_BaseMap" : "_MainTex", baseTex);
                var st = new Vector4(m.BaseTex.ScaleU, m.BaseTex.ScaleV, m.BaseTex.OffsetU, m.BaseTex.OffsetV);
                // URP Lit has one _ST for every map; the GLBs give a
                // material's maps the same transform (the tyre's [18, 1]).
                mat.SetTextureScale(urp ? "_BaseMap" : "_MainTex", new Vector2(st.x, st.y));
                mat.SetTextureOffset(urp ? "_BaseMap" : "_MainTex", new Vector2(st.z, st.w));
            }
            var normal = Tex(textures, m.NormalTex);
            if (normal != null)
            {
                mat.SetTexture("_BumpMap", normal);
                mat.SetFloat("_BumpScale", m.NormalTex.Strength);
                mat.EnableKeyword("_NORMALMAP");
                if (baseTex == null && urp)
                {
                    mat.SetTextureScale("_BaseMap", new Vector2(m.NormalTex.ScaleU, m.NormalTex.ScaleV));
                    mat.SetTextureOffset("_BaseMap", new Vector2(m.NormalTex.OffsetU, m.NormalTex.OffsetV));
                }
            }
            var metalRough = Tex(textures, m.MetalRoughTex);
            if (metalRough != null)
            {
                // glTF packs roughness in G and metal in B; URP wants metal
                // in R and smoothness in A. Repacked once per texture, with
                // the factors baked in, so _Metallic/_Smoothness stay at 1.
                // The baker hands in its own repacked texture assets.
                var packed = Tex(metalGloss, m.MetalRoughTex) ?? RepackMetalRough(metalRough, m.Metallic, m.Roughness);
                if (packed != null)
                {
                    mat.SetTexture("_MetallicGlossMap", packed);
                    mat.EnableKeyword("_METALLICSPECGLOSSMAP");
                    mat.SetFloat(urp ? "_Smoothness" : "_GlossMapScale", 1f);
                    if (urp) mat.SetFloat("_SmoothnessTextureChannel", 0f); // metallic map alpha
                }
            }

            // --- clear coat ------------------------------------------------
            if (coat && urp && shader == complexLit && complexLit != lit)
            {
                mat.SetFloat("_ClearCoat", 1f);
                mat.SetFloat("_ClearCoatMask", Mathf.Clamp01(m.Clearcoat));
                mat.SetFloat("_ClearCoatSmoothness", Mathf.Clamp01(1f - m.ClearcoatRoughness));
                mat.EnableKeyword("_CLEARCOAT");
            }

            // --- emission ---------------------------------------------------
            float strength = EmissiveStrength(m, night);
            var emissive = Linear(m.Emissive) * strength;
            var emissiveTex = Tex(textures, m.EmissiveTex);
            if (strength > 0f && (emissive.maxColorComponent > 0f))
            {
                SetLinear(mat, "_EmissionColor", emissive);
                if (emissiveTex != null) mat.SetTexture("_EmissionMap", emissiveTex);
                mat.EnableKeyword("_EMISSION");
                mat.globalIlluminationFlags = MaterialGlobalIlluminationFlags.RealtimeEmissive;
            }
            else
            {
                SetLinear(mat, "_EmissionColor", Color.black);
                mat.DisableKeyword("_EMISSION");
                mat.globalIlluminationFlags = MaterialGlobalIlluminationFlags.EmissiveIsBlack;
            }

            // --- faces ------------------------------------------------------
            // The exhaust bore is an inside-out cylinder (three BackSide):
            // with the winding converted, that is "cull the front faces".
            float cull = m.Role == MatRole.ExhaustBore ? 1f : m.DoubleSided ? 0f : 2f;
            if (urp) mat.SetFloat("_Cull", cull);

            // --- reflection --------------------------------------------------
            NightReflections.EnvFactor(mat, EnvFactor(m));

            // --- transparency -----------------------------------------------
            if (m.Role == MatRole.Glass) Transparent(mat, preserveSpecular: true, queueOffset: GlassQueue);
            else if (m.Role == MatRole.GlassTint) Transparent(mat, preserveSpecular: true, queueOffset: TintQueue);
            else if (m.Blend) Transparent(mat, preserveSpecular: false, queueOffset: LiveryQueue);
            return mat;
        }

        /// <summary>Transparent queue offsets (URP's _QueueOffset, -50..50).
        /// The road's contact shadow first, under everything; then blended
        /// livery that lies on the paint; then the glass, which composites
        /// over both from inside the cabin as from out; and the sun band
        /// last, because it is printed on the windscreen it shares a depth
        /// with. Within one queue URP sorts back to front by renderer.</summary>
        public const int ShadowQueue = -40, LiveryQueue = -20, GlassQueue = 0, TintQueue = 1;

        /// <summary>How much of the environment a material reflects, as a
        /// share of the probe's 2.1 gain (NightReflections): gloss paint all
        /// of it, satin 0.62 (≈1.3), matte 0.3 (≈0.63); metals all of it;
        /// every other dielectric — glass, plastics, tyre, lamps — 0.476,
        /// which puts them back at a gain of 1.</summary>
        public static float EnvFactor(CarMat m)
        {
            if (m.Role == MatRole.Paint)
                return !m.HasClearcoat ? 0.3f : m.Clearcoat >= 0.9f ? 1f : 0.62f;
            if (m.Role == MatRole.Metal || m.Role == MatRole.Disc || m.Metallic >= 0.5f) return 1f;
            return 0.476f;
        }

        /// <summary>Emissive strength to use: the as-built idle level the GLB
        /// carries, or for the night-floor materials (plates, decals,
        /// reflectors, the hot stripe — exported at 0) their night level.</summary>
        public static float EmissiveStrength(CarMat m, float night)
        {
            switch (m.Role)
            {
                case MatRole.Paint:
                case MatRole.Disc: // brake-heat glow, off at rest
                    return 0f;
                case MatRole.Plate:
                case MatRole.Decal:
                case MatRole.NightFloor:
                    return m.NightFloor > 0f ? m.NightFloor * night : m.EmissiveStrength;
            }
            return m.EmissiveStrength;
        }

        /// <summary>URP Lit/Complex Lit transparent setup, as URP's own
        /// BaseShaderGUI.SetupMaterialBlendModeInternal does it (17.0).
        /// preserveSpecular: alpha scales the diffuse only, so 45%-opaque
        /// glass keeps its full reflection — the web's premultiplied glass.
        /// queueOffset goes into _QueueOffset as well as renderQueue, so the
        /// order survives URP's material editor recomputing the queue.</summary>
        public static void Transparent(Material mat, bool preserveSpecular, int queueOffset)
        {
            if (!Urp)
            {
                mat.SetFloat("_Mode", 3f); // Standard: Transparent
                mat.SetInt("_SrcBlend", (int)BlendMode.One);
                mat.SetInt("_DstBlend", (int)BlendMode.OneMinusSrcAlpha);
                mat.SetInt("_ZWrite", 0);
                mat.EnableKeyword("_ALPHAPREMULTIPLY_ON");
                mat.renderQueue = (int)RenderQueue.Transparent + queueOffset;
                return;
            }
            queueOffset = Mathf.Clamp(queueOffset, -50, 50);
            mat.SetFloat("_QueueOffset", queueOffset);
            mat.SetFloat("_Surface", 1f);
            mat.SetFloat("_Blend", 0f); // Alpha
            mat.SetFloat("_BlendModePreserveSpecular", preserveSpecular ? 1f : 0f);
            mat.SetFloat("_SrcBlend", (float)(preserveSpecular ? BlendMode.One : BlendMode.SrcAlpha));
            mat.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
            mat.SetFloat("_SrcBlendAlpha", (float)BlendMode.One);
            mat.SetFloat("_DstBlendAlpha", (float)BlendMode.OneMinusSrcAlpha);
            mat.SetFloat("_ZWrite", 0f);
            mat.SetFloat("_CastShadows", 0f);
            mat.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            if (preserveSpecular) mat.EnableKeyword("_ALPHAPREMULTIPLY_ON");
            else mat.DisableKeyword("_ALPHAPREMULTIPLY_ON");
            mat.SetOverrideTag("RenderType", "Transparent");
            mat.SetShaderPassEnabled("DepthOnly", false);
            mat.SetShaderPassEnabled("ShadowCaster", false);
            mat.renderQueue = (int)RenderQueue.Transparent + queueOffset;
        }

        /// <summary>A repainted car: new basecoat colour (sRGB, as the game
        /// data gives it) and the metalness the web's law gives that colour
        /// under this car's finish.</summary>
        public static void Repaint(Material paint, Color srgb, string finish)
        {
            int hex = (Mathf.RoundToInt(Mathf.Clamp01(srgb.r) * 255f) << 16)
                      | (Mathf.RoundToInt(Mathf.Clamp01(srgb.g) * 255f) << 8)
                      | Mathf.RoundToInt(Mathf.Clamp01(srgb.b) * 255f);
            var c = new Color(srgb.r, srgb.g, srgb.b, 1f);
            if (Urp) paint.SetColor("_BaseColor", c);
            else paint.SetColor("_Color", c);
            paint.SetFloat("_Metallic", PaintLaw.Metalness(hex) * PaintLaw.FinishMetalScale(finish));
        }

        static Texture2D Tex(Texture2D[] textures, TexRef r) =>
            r != null && textures != null && r.Texture >= 0 && r.Texture < textures.Length ? textures[r.Texture] : null;

        static readonly System.Collections.Generic.Dictionary<(Texture2D, float, float), Texture2D> repacked =
            new System.Collections.Generic.Dictionary<(Texture2D, float, float), Texture2D>();

        /// <summary>glTF metal-roughness pixels (G rough, B metal) to URP
        /// metallic-gloss (R metal, A smoothness), factors applied, in place.</summary>
        public static void RepackPixels(Color32[] px, float metallic, float roughness)
        {
            for (int i = 0; i < px.Length; i++)
            {
                byte rough = px[i].g, metal = px[i].b;
                px[i] = new Color32(
                    (byte)Mathf.RoundToInt(metal * metallic),
                    0, 0,
                    (byte)Mathf.RoundToInt(255f - rough * roughness));
            }
        }

        static Texture2D RepackMetalRough(Texture2D src, float metallic, float roughness)
        {
            if (repacked.TryGetValue((src, metallic, roughness), out var done) && done != null) return done;
            if (!src.isReadable) return null;
            var px = src.GetPixels32();
            RepackPixels(px, metallic, roughness);
            var t = new Texture2D(src.width, src.height, TextureFormat.RGBA32, true, true)
            {
                name = src.name + "-metalgloss",
                wrapModeU = src.wrapModeU,
                wrapModeV = src.wrapModeV,
                filterMode = src.filterMode,
                anisoLevel = src.anisoLevel,
            };
            t.SetPixels32(px);
            t.Apply(true, true);
            repacked[(src, metallic, roughness)] = t;
            return t;
        }
    }
}
