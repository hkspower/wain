using UnityEngine;

// Material + texture factory. Every material in the game goes through
// here so the project works on URP (the shipping path) and still runs if
// someone opens it before installing the render pipeline.
//
// Textures are generated procedurally — same algorithms as the web build
// — so the repo stays asset-free.
public static class Mats
{
    static Shader lit;
    static Shader unlit;
    static bool urp;

    static void EnsureShaders()
    {
        if (lit != null) return;
        lit = Shader.Find("Universal Render Pipeline/Lit");
        urp = lit != null;
        if (!urp) lit = Shader.Find("Standard");
        unlit = Shader.Find(urp ? "Universal Render Pipeline/Unlit" : "Unlit/Color");
    }

    /// Opaque PBR material. `smooth` is 0..1 (glossiness/smoothness).
    public static Material Lit(Color c, float metallic = 0f, float smooth = 0.4f)
    {
        EnsureShaders();
        var m = new Material(lit);
        if (urp)
        {
            m.SetColor("_BaseColor", c);
            m.SetFloat("_Metallic", metallic);
            m.SetFloat("_Smoothness", smooth);
        }
        else
        {
            m.color = c;
            m.SetFloat("_Metallic", metallic);
            m.SetFloat("_Glossiness", smooth);
        }
        return m;
    }

    /// HDR-emissive material — intensity above 1 pushes it into bloom.
    public static Material Emissive(Color c, float intensity, float smooth = 0.5f)
    {
        var m = Lit(c * 0.25f, 0f, smooth);
        m.EnableKeyword("_EMISSION");
        m.globalIlluminationFlags = MaterialGlobalIlluminationFlags.RealtimeEmissive;
        m.SetColor("_EmissionColor", c * intensity);
        return m;
    }

    /// Additive, unlit, depth-write-off — coronas, light pools, glows.
    public static Material Additive(Color c, Texture tex = null)
    {
        EnsureShaders();
        var m = new Material(unlit);
        if (tex != null) m.mainTexture = tex;
        if (urp) m.SetColor("_BaseColor", c);
        else m.color = c;
        m.SetFloat("_Surface", 1);           // transparent
        m.SetFloat("_Blend", 1);             // additive
        m.SetFloat("_ZWrite", 0);
        m.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
        m.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.One);
        m.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
        m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
        m.EnableKeyword("_ALPHAPREMULTIPLY_ON");
        return m;
    }

    /// Alpha-blended unlit — contact shadows, decals.
    public static Material AlphaBlend(Color c, Texture tex = null)
    {
        EnsureShaders();
        var m = new Material(unlit);
        if (tex != null) m.mainTexture = tex;
        if (urp) m.SetColor("_BaseColor", c);
        else m.color = c;
        m.SetFloat("_Surface", 1);
        m.SetFloat("_ZWrite", 0);
        m.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
        m.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
        m.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
        m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
        return m;
    }

    /// Clearcoat car paint: metallic base under a glossy lacquer.
    public static Material CarPaint(Color c)
    {
        var m = Lit(c, 0.75f, 0.86f);
        if (urp)
        {
            m.EnableKeyword("_CLEARCOAT");
            m.SetFloat("_ClearCoatMask", 1f);
            m.SetFloat("_ClearCoatSmoothness", 0.92f);
        }
        return m;
    }

    // ------------------------------------------------------------ textures

    static Texture2D asphaltAlbedo, asphaltNormal, glowSprite, poolSprite;

    /// Tileable asphalt: graded aggregate, wear bands, cracks, tar seams,
    /// oil drips — plus a normal map from the same height field.
    public static void AsphaltTextures(out Texture2D albedo, out Texture2D normal)
    {
        if (asphaltAlbedo != null)
        {
            albedo = asphaltAlbedo;
            normal = asphaltNormal;
            return;
        }

        const int S = 1024;
        var height = new float[S * S];

        // four octaves of tileable value noise
        float Hash(int x, int y)
        {
            int h = x * 374761393 + y * 668265263;
            h = (h ^ (h >> 13)) * 1274126177;
            return ((h ^ (h >> 16)) & 0x7fffffff) / 2147483647f;
        }
        float Smooth(float t) => t * t * (3f - 2f * t);
        float Noise(int x, int y, int period)
        {
            float fx = (float)x / period, fy = (float)y / period;
            int x0 = Mathf.FloorToInt(fx), y0 = Mathf.FloorToInt(fy);
            float tx = Smooth(fx - x0), ty = Smooth(fy - y0);
            int w = Mathf.Max(1, S / period);
            int X0 = ((x0 % w) + w) % w, Y0 = ((y0 % w) + w) % w;
            int X1 = ((x0 + 1) % w + w) % w, Y1 = ((y0 + 1) % w + w) % w;
            float a = Hash(X0, Y0), b = Hash(X1, Y0), c = Hash(X0, Y1), d = Hash(X1, Y1);
            return Mathf.Lerp(Mathf.Lerp(a, b, tx), Mathf.Lerp(c, d, tx), ty);
        }

        var octaves = new (int period, float amp)[] { (128, 0.34f), (32, 0.26f), (8, 0.24f), (3, 0.16f) };
        foreach (var (period, amp) in octaves)
            for (int y = 0; y < S; y++)
                for (int x = 0; x < S; x++)
                    height[y * S + x] += Noise(x, y, period) * amp;

        // albedo: dark binder with lighter stones proud of it
        var px = new Color32[S * S];
        for (int i = 0; i < S * S; i++)
        {
            float h = height[i];
            float stone = Mathf.Max(0f, h - 0.52f) * 2.1f;
            byte v = (byte)Mathf.Clamp(22 + h * 26 + stone * 74, 0, 255);
            px[i] = new Color32(v, (byte)Mathf.Min(255, v + 1), (byte)Mathf.Min(255, v + 5), 255);
        }

        // tyre-polished wear bands in each lane
        foreach (float u in new[] { 0.125f, 0.375f, 0.625f, 0.875f })
            foreach (float off in new[] { -0.045f, 0.045f })
            {
                int cx = Mathf.RoundToInt((u + off) * S);
                for (int dx = -24; dx <= 24; dx++)
                {
                    int x = ((cx + dx) % S + S) % S;
                    float fall = 1f - Mathf.Abs(dx) / 24f;
                    for (int y = 0; y < S; y++)
                    {
                        int i = y * S + x;
                        px[i] = Color32.Lerp(px[i], new Color32(10, 11, 14, 255), fall * 0.45f);
                    }
                }
            }

        // oil drips down the lane centres
        var rng = new System.Random(7);
        for (int k = 0; k < 20; k++)
        {
            int cx = Mathf.RoundToInt(new[] { 0.25f, 0.5f, 0.75f }[k % 3] * S + (float)(rng.NextDouble() - 0.5) * 60f);
            int cy = (int)(rng.NextDouble() * S);
            int r = 6 + (int)(rng.NextDouble() * 22);
            for (int dy = -r; dy <= r; dy++)
                for (int dx = -r; dx <= r; dx++)
                {
                    float d = Mathf.Sqrt(dx * dx + dy * dy);
                    if (d > r) continue;
                    int x = ((cx + dx) % S + S) % S, y = ((cy + dy) % S + S) % S;
                    int i = y * S + x;
                    px[i] = Color32.Lerp(px[i], new Color32(4, 4, 6, 255), (1f - d / r) * 0.5f);
                }
        }

        asphaltAlbedo = new Texture2D(S, S, TextureFormat.RGBA32, true, false);
        asphaltAlbedo.SetPixels32(px);
        asphaltAlbedo.wrapMode = TextureWrapMode.Repeat;
        asphaltAlbedo.anisoLevel = 16;
        asphaltAlbedo.Apply(true);

        // normal map from the same height field
        var npx = new Color32[S * S];
        const float strength = 2.6f;
        for (int y = 0; y < S; y++)
        {
            int yp = ((y + 1) % S) * S, ym = ((y - 1 + S) % S) * S, yc = y * S;
            for (int x = 0; x < S; x++)
            {
                int xp = (x + 1) % S, xm = (x - 1 + S) % S;
                float dx = (height[yc + xp] - height[yc + xm]) * strength;
                float dy = (height[yp + x] - height[ym + x]) * strength;
                float len = Mathf.Sqrt(dx * dx + dy * dy + 1f);
                // Unity normal maps sample .rgb when uncompressed
                npx[yc + x] = new Color32(
                    (byte)((-dx / len * 0.5f + 0.5f) * 255f),
                    (byte)((-dy / len * 0.5f + 0.5f) * 255f),
                    (byte)((1f / len * 0.5f + 0.5f) * 255f),
                    255);
            }
        }
        asphaltNormal = new Texture2D(S, S, TextureFormat.RGBA32, true, true);
        asphaltNormal.SetPixels32(npx);
        asphaltNormal.wrapMode = TextureWrapMode.Repeat;
        asphaltNormal.anisoLevel = 16;
        asphaltNormal.Apply(true);

        albedo = asphaltAlbedo;
        normal = asphaltNormal;
    }

    /// Soft radial sprite for lamp coronas and headlight glows.
    public static Texture2D Glow()
    {
        if (glowSprite != null) return glowSprite;
        const int S = 128;
        glowSprite = new Texture2D(S, S, TextureFormat.RGBA32, false);
        var px = new Color32[S * S];
        for (int y = 0; y < S; y++)
            for (int x = 0; x < S; x++)
            {
                float d = Vector2.Distance(new Vector2(x, y), new Vector2(S / 2f, S / 2f)) / (S / 2f);
                float a = Mathf.Clamp01(1f - d);
                a = a * a * a; // tight core, long falloff
                px[y * S + x] = new Color32(255, 255, 255, (byte)(a * 255));
            }
        glowSprite.SetPixels32(px);
        glowSprite.wrapMode = TextureWrapMode.Clamp;
        glowSprite.Apply(true);
        return glowSprite;
    }

    /// Elliptical soft blob — contact shadows under cars.
    public static Texture2D Blob()
    {
        if (poolSprite != null) return poolSprite;
        const int S = 128;
        poolSprite = new Texture2D(S, S, TextureFormat.RGBA32, false);
        var px = new Color32[S * S];
        for (int y = 0; y < S; y++)
            for (int x = 0; x < S; x++)
            {
                float d = Vector2.Distance(new Vector2(x, y), new Vector2(S / 2f, S / 2f)) / (S / 2f);
                float a = Mathf.Clamp01(1f - d);
                px[y * S + x] = new Color32(0, 0, 0, (byte)(a * a * 190));
            }
        poolSprite.SetPixels32(px);
        poolSprite.wrapMode = TextureWrapMode.Clamp;
        poolSprite.Apply(true);
        return poolSprite;
    }
}
