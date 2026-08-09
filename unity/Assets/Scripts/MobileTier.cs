using UnityEngine;
using UnityEngine.Rendering;

// Phones get the same look, dialled down: the expensive parts of the
// render stack are the ones you cannot see on a 6-inch screen anyway.
//
// Runs once at startup. Desktop and console are left untouched.
public static class MobileTier
{
    public static bool IsMobile =>
        Application.isMobilePlatform ||
        SystemInfo.deviceType == DeviceType.Handheld;

    public static void Apply()
    {
        if (!IsMobile) return;

        // 60 fps is the right target — 120 cooks the battery and thermal
        // throttles within minutes on most handsets.
        Application.targetFrameRate = 60;
        QualitySettings.vSyncCount = 0;

        // Shadows: keep them (they sell the night) but cheaper and nearer
        QualitySettings.shadows = ShadowQuality.HardOnly;
        QualitySettings.shadowResolution = ShadowResolution.Medium;
        QualitySettings.shadowDistance = 90f;
        QualitySettings.shadowCascades = 2;

        QualitySettings.anisotropicFiltering = AnisotropicFiltering.Enable;
        QualitySettings.antiAliasing = 2;
        QualitySettings.skinWeights = SkinWeights.TwoBones;
        QualitySettings.softParticles = false;
        QualitySettings.realtimeReflectionProbes = false;

        // Fog closes in a little so less of the city has to be drawn
        RenderSettings.fogDensity = 0.0022f;

        TrimPipeline();
        TrimPost();
        Debug.Log("[Gulf Road Nights] Mobile render tier applied.");
    }

    /// Lower the URP asset's render scale and light budget, reflectively so
    /// this file compiles with or without the render pipeline package.
    static void TrimPipeline()
    {
        var asset = GraphicsSettings.defaultRenderPipeline;
        if (asset == null) return;
        var t = asset.GetType();

        void SetProp(string name, object value)
        {
            var p = t.GetProperty(name);
            if (p != null && p.CanWrite)
            {
                try { p.SetValue(asset, value); } catch { /* property is read-only in this version */ }
            }
        }

        // 0.85 render scale is nearly invisible on a phone DPI and buys
        // roughly a third of the fragment cost back
        SetProp("renderScale", 0.85f);
        SetProp("msaaSampleCount", 2);
        SetProp("shadowDistance", 90f);
        SetProp("shadowCascadeCount", 2);
        SetProp("supportsSoftShadows", false);
    }

    /// Drop the post effects that cost the most per pixel on tiled mobile
    /// GPUs. Bloom and tonemapping stay — they are the look.
    static void TrimPost()
    {
        var profile = Resources.Load<VolumeProfile>("GulfRoadPostProfile");
        if (profile == null) return;

        foreach (var comp in profile.components)
        {
            string n = comp.GetType().Name;
            // Motion blur and chromatic aberration are full-screen passes
            // with little payoff at phone size; grain fights compression.
            if (n == "MotionBlur" || n == "ChromaticAberration" || n == "FilmGrain")
                comp.active = false;
        }
    }
}
