#if UNITY_EDITOR
using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

// One-click render setup: builds the URP asset, renderer, quality
// settings and the post-processing volume profile the game expects, then
// wires them into Graphics/Quality settings.
//
//   Menu: Gulf Road Nights ▸ Setup Rendering (URP + Post)
//
// Doing this from a script rather than shipping hand-written .asset YAML
// keeps the GUIDs valid across Unity versions.
public static class RenderSetup
{
    const string Dir = "Assets/Settings";
    // The profile lives under Resources so a built player can load it by
    // name — AssetDatabase only exists in the editor.
    const string ResDir = "Assets/Resources";
    const string RendererPath = Dir + "/GulfRoadRenderer.asset";
    const string PipelinePath = Dir + "/GulfRoadURP.asset";
    const string ProfilePath = ResDir + "/GulfRoadPostProfile.asset";

    [MenuItem("Gulf Road Nights/Setup Rendering (URP + Post)")]
    public static void Setup()
    {
        Directory.CreateDirectory(Dir);
        Directory.CreateDirectory(ResDir);

        // ---- renderer -------------------------------------------------
        var rendererData = ScriptableObject.CreateInstance<UniversalRendererData>();
        rendererData.name = "GulfRoadRenderer";
        rendererData.postProcessData = PostProcessData.GetDefaultPostProcessData();
        // Depth+opaque textures let distortion/soft-particle style effects work
        AssetDatabase.CreateAsset(rendererData, RendererPath);

        // ---- pipeline asset -------------------------------------------
        var urp = UniversalRenderPipelineAsset.Create(rendererData);
        urp.name = "GulfRoadURP";

        var so = new SerializedObject(urp);
        void Set(string prop, object value)
        {
            var p = so.FindProperty(prop);
            if (p == null) return;
            switch (value)
            {
                case bool b: p.boolValue = b; break;
                case int i: p.intValue = i; break;
                case float f: p.floatValue = f; break;
            }
        }

        Set("m_SupportsHDR", true);              // required for bloom to bloom
        Set("m_MSAA", 4);                        // 4x MSAA
        Set("m_RenderScale", 1f);                // native res; drop to 0.8 on mobile
        Set("m_MainLightRenderingMode", 1);      // per-pixel
        Set("m_MainLightShadowsSupported", true);
        Set("m_MainLightShadowmapResolution", 4096);
        Set("m_AdditionalLightsRenderingMode", 1); // per-pixel (headlights, lamps)
        Set("m_AdditionalLightsPerObjectLimit", 8);
        Set("m_AdditionalLightShadowsSupported", true);
        Set("m_AdditionalLightsShadowmapResolution", 1024);
        Set("m_ShadowDistance", 220f);
        Set("m_ShadowCascadeCount", 4);
        Set("m_SoftShadowsSupported", true);
        Set("m_UseSRPBatcher", true);
        so.ApplyModifiedProperties();

        AssetDatabase.CreateAsset(urp, PipelinePath);

        // ---- post-processing volume profile ---------------------------
        var profile = ScriptableObject.CreateInstance<VolumeProfile>();

        var tone = profile.Add<Tonemapping>(true);
        tone.mode.overrideState = true;
        tone.mode.value = TonemappingMode.ACES;      // filmic, matches the web build

        var color = profile.Add<ColorAdjustments>(true);
        color.postExposure.overrideState = true;
        color.postExposure.value = 0.25f;
        color.contrast.overrideState = true;
        color.contrast.value = 12f;
        color.saturation.overrideState = true;
        color.saturation.value = 6f;

        var bloom = profile.Add<Bloom>(true);
        bloom.threshold.overrideState = true;
        bloom.threshold.value = 0.85f;
        bloom.intensity.overrideState = true;
        bloom.intensity.value = 0.9f;
        bloom.scatter.overrideState = true;
        bloom.scatter.value = 0.72f;
        bloom.tint.overrideState = true;
        bloom.tint.value = new Color(1f, 0.94f, 0.85f); // sodium-warm halos

        var vignette = profile.Add<Vignette>(true);
        vignette.intensity.overrideState = true;
        vignette.intensity.value = 0.34f;
        vignette.smoothness.overrideState = true;
        vignette.smoothness.value = 0.42f;

        var grain = profile.Add<FilmGrain>(true);
        grain.type.overrideState = true;
        grain.type.value = FilmGrainLookup.Medium1;
        grain.intensity.overrideState = true;
        grain.intensity.value = 0.28f;

        var ca = profile.Add<ChromaticAberration>(true);
        ca.intensity.overrideState = true;
        ca.intensity.value = 0.12f;

        var mb = profile.Add<MotionBlur>(true);
        mb.mode.overrideState = true;
        mb.mode.value = MotionBlurMode.CameraOnly;
        mb.intensity.overrideState = true;
        mb.intensity.value = 0.22f;               // speed smear, not soup

        AssetDatabase.CreateAsset(profile, ProfilePath);

        // ---- wire it up -----------------------------------------------
        GraphicsSettings.defaultRenderPipeline = urp;
        QualitySettings.renderPipeline = urp;
        QualitySettings.shadows = ShadowQuality.All;
        QualitySettings.shadowResolution = ShadowResolution.VeryHigh;
        QualitySettings.antiAliasing = 4;
        QualitySettings.vSyncCount = 0;

        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();

        Debug.Log(
            "[Gulf Road Nights] URP + post-processing configured.\n" +
            $"  pipeline: {PipelinePath}\n  profile:  {ProfilePath}\n" +
            "Press Play — the game finds the profile automatically."
        );
        Selection.activeObject = urp;
    }
}
#endif
