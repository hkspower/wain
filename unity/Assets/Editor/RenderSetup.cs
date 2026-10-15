#if UNITY_EDITOR
using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

// One-click render setup: builds the URP asset, renderer, quality
// settings and the post-processing volume profile the game expects, then
// wires them into Graphics/Quality/Player settings.
//
//   Menu: Night Racer ▸ Setup Rendering (URP + Post)
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

    // URP's own post-processing resources (bloom, tonemapping LUTs, grain
    // textures). PostProcessData.GetDefaultPostProcessData() loads exactly
    // this path but is internal in URP 17 (PostProcessData.cs:39-43), so it
    // is loaded the same way here.
    const string PostProcessDataPath =
        "Packages/com.unity.render-pipelines.universal/Runtime/Data/PostProcessData.asset";

    // Every shader the game builds materials from at runtime with
    // Shader.Find (Mats.cs, Cars/CarMaterials.cs, Cars/NightReflections.cs).
    // No material asset in a build references them, so without this a
    // player gets a null Shader.Find and pink cars, and the shader_feature
    // variants the code switches on (_CLEARCOAT, _EMISSION, _NORMALMAP,
    // _METALLICSPECGLOSSMAP, _SURFACE_TYPE_TRANSPARENT, _ALPHAPREMULTIPLY_ON)
    // are stripped as unused. Play mode in the editor hides both.
    static readonly string[] RuntimeShaders =
    {
        "Universal Render Pipeline/Complex Lit", // car paint: clear coat
        "Universal Render Pipeline/Lit",
        "Universal Render Pipeline/Unlit",       // lamp coronas, glows
        "Skybox/Cubemap",                        // the night reflection sky
    };

    [MenuItem("Night Racer/Setup Rendering (URP + Post)")]
    public static void Setup()
    {
        // Checked before anything is written: a renderer without it renders
        // no post-processing at all, which is the whole night look.
        var postData = AssetDatabase.LoadAssetAtPath<PostProcessData>(PostProcessDataPath);
        if (postData == null)
        {
            Debug.LogError(
                "[Night Racer] URP's PostProcessData was not found at " + PostProcessDataPath +
                ". Is com.unity.render-pipelines.universal installed (Packages/manifest.json)? Nothing was changed.");
            return;
        }

        Directory.CreateDirectory(Dir);
        Directory.CreateDirectory(ResDir);

        // ---- colour space ---------------------------------------------
        // The car materials, the HDR emissive strengths and the paint law
        // are all authored in linear light, as the web build is. The
        // project folder ships no ProjectSettings to say so, and under
        // Gamma Unity neither linearises sRGB colours and textures nor adds
        // light linearly, so every value tuned against the web lands wrong.
        PlayerSettings.colorSpace = ColorSpace.Linear;

        // ---- renderer -------------------------------------------------
        var rendererData = ScriptableObject.CreateInstance<UniversalRendererData>();
        rendererData.name = "GulfRoadRenderer";
        rendererData.postProcessData = postData;
        // Depth+opaque textures let distortion/soft-particle style effects work
        AssetDatabase.CreateAsset(rendererData, RendererPath);

        // ---- pipeline asset -------------------------------------------
        var urp = UniversalRenderPipelineAsset.Create(rendererData);
        urp.name = "GulfRoadURP";
        // 64-bit (RGBA16F) colour buffers instead of the default 32-bit
        // R11G11B10: the night sky and the sodium-lit tarmac are long, dark
        // gradients that band at 32 bits, and R11G11B10's blue channel is
        // the coarsest (URP's own note, UniversalRenderPipelineAsset.cs:164).
        urp.hdrColorBufferPrecision = HDRColorBufferPrecision._64Bits;

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
        // Off, URP's forward path gives each renderer only its most
        // important probe, so paint snaps between a car's probe and the sky
        // at the probe's edge; on, it blends them, which is what the car
        // bodies ask for (CarModel: ReflectionProbeUsage.BlendProbesAndSkybox).
        // The setter is internal in URP 17
        // (UniversalRenderPipelineAsset.cs:1342-1346), hence the field.
        Set("m_ReflectionProbeBlending", true);
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
        // The car paint's reflection is a realtime probe that rides with
        // the player (NightReflections.Follow), and Unity's lower default
        // quality levels ship with realtime probes off. MobileTier turns
        // them off again on phones, on purpose: there the paint reflects
        // the fixed night environment (NightReflections.Install) instead.
        QualitySettings.realtimeReflectionProbes = true;

        AlwaysInclude(RuntimeShaders);

        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();

        Debug.Log(
            "[Night Racer] URP + post-processing configured.\n" +
            $"  pipeline: {PipelinePath}\n  profile:  {ProfilePath}\n" +
            "Press Play — the game finds the profile automatically."
        );
        Selection.activeObject = urp;
    }

    // Adds shaders to Graphics settings ▸ Always Included Shaders, once
    // each. Unity compiles every variant of an always-included shader into
    // the player rather than only the ones its materials use (URP still
    // strips the variants of pipeline features the URP asset turns off), so
    // builds get slower and bigger; in exchange any keyword set the game
    // turns on at runtime is there. GraphicsSettings has no typed API for
    // the list, so it is edited through the settings object itself, as the
    // Graphics settings inspector does. GetGraphicsSettings() is public in
    // 6000.0 (GraphicsSettings.bindings.cs:108) and returns the live object
    // behind ProjectSettings/GraphicsSettings.asset.
    static void AlwaysInclude(string[] shaderNames)
    {
        var settings = GraphicsSettings.GetGraphicsSettings();
        var gso = settings != null ? new SerializedObject(settings) : null;
        var list = gso?.FindProperty("m_AlwaysIncludedShaders");
        if (list == null || !list.isArray)
        {
            Debug.LogError(
                "[Night Racer] Could not read Always Included Shaders from the Graphics settings. " +
                "Add these in Project Settings ▸ Graphics by hand, or player builds render them pink: " +
                string.Join(", ", shaderNames));
            return;
        }

        foreach (var name in shaderNames)
        {
            var shader = Shader.Find(name);
            if (shader == null)
            {
                Debug.LogError($"[Night Racer] Shader '{name}' not found, so it is not in Always Included Shaders.");
                continue;
            }
            bool present = false;
            for (int i = 0; i < list.arraySize && !present; i++)
                present = list.GetArrayElementAtIndex(i).objectReferenceValue == shader;
            if (present) continue;
            list.arraySize++;
            list.GetArrayElementAtIndex(list.arraySize - 1).objectReferenceValue = shader;
        }
        gso.ApplyModifiedProperties();
    }
}
#endif
