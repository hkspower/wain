// com.unity.render-pipelines.universal 17.0 (runtime), the part the
// project touches. Signatures from the package source,
// github.com/Unity-Technologies/Graphics, branch 6000.0/staging (URP
// 17.0.4; the project pins 17.0.3), file and line on each. Public members
// only, with the real accessors: where URP has `internal set` (the shadow
// and reflection-probe switches) there is no setter here either, so code
// has to go through SerializedObject as it must in Unity. Editor-only
// members are under #if UNITY_EDITOR, as in the package, so the player
// flavour of this assembly lacks them like a player build does.
using System;
using System.Collections.Generic;

namespace UnityEngine.Rendering.Universal
{
    // ---- Data/UniversalRenderPipelineAsset.cs ------------------------------

    // :37-46
    public enum SoftShadowQuality { UsePipelineSettings, Low, Medium, High }

    // :162-172
    public enum HDRColorBufferPrecision { _32Bits, _64Bits }

    // :177-198
    public enum MsaaQuality { Disabled = 1, _2x = 2, _4x = 4, _8x = 8 }

    // :203-224
    public enum Downsampling { None, _2xBilinear, _4xBox, _4xBilinear }

    // :229-245
    public enum LightRenderingMode { Disabled = 0, PerVertex = 2, PerPixel = 1 }

    // :266-282
    public enum RendererType { Custom, UniversalRenderer, _2DRenderer }

    // :287-298
    public enum ColorGradingMode { LowDynamicRange, HighDynamicRange }

    // :303-311
    public enum StoreActionsOptimization { Auto, Discard, Store }

    // :340-371
    public enum UpscalingFilterSelection { Auto, Linear, Point, FSR, STP }

    // :443. Its real base is RenderPipelineAsset<UniversalRenderPipeline>,
    // which 2021.3's CoreModule doesn't have; the non-generic base it
    // derives from carries everything the project uses.
    public partial class UniversalRenderPipelineAsset : RenderPipelineAsset, ISerializationCallbackReceiver
    {
        protected override RenderPipeline CreatePipeline() => throw null;
        public void OnBeforeSerialize() => throw null;
        public void OnAfterDeserialize() => throw null;

#if UNITY_EDITOR
        // :676-692
        public static readonly string packagePath = "Packages/com.unity.render-pipelines.universal";
        public static UniversalRenderPipelineAsset Create(ScriptableRendererData rendererData = null) => throw null;
#endif

        // :854-1565: get-only, get/set and get/internal-set as in the source.
        public ScriptableRenderer scriptableRenderer => throw null;
        public ScriptableRenderer GetRenderer(int index) => throw null;
        public bool supportsCameraDepthTexture { get => throw null; set => throw null; }
        public bool supportsCameraOpaqueTexture { get => throw null; set => throw null; }
        public Downsampling opaqueDownsampling => throw null;
        public StoreActionsOptimization storeActionsOptimization { get => throw null; set => throw null; }
        public bool supportsHDR { get => throw null; set => throw null; }
        public HDRColorBufferPrecision hdrColorBufferPrecision { get => throw null; set => throw null; }
        public int msaaSampleCount { get => throw null; set => throw null; }
        public float renderScale { get => throw null; set => throw null; }
        public UpscalingFilterSelection upscalingFilter { get => throw null; set => throw null; }
        public LightRenderingMode mainLightRenderingMode => throw null;
        public bool supportsMainLightShadows => throw null;
        public int mainLightShadowmapResolution { get => throw null; set => throw null; }
        public LightRenderingMode additionalLightsRenderingMode => throw null;
        public int maxAdditionalLightsCount { get => throw null; set => throw null; }
        public bool supportsAdditionalLightShadows => throw null;
        public int additionalLightsShadowmapResolution { get => throw null; set => throw null; }
        public bool reflectionProbeBlending => throw null;
        public bool reflectionProbeBoxProjection => throw null;
        public float shadowDistance { get => throw null; set => throw null; }
        public int shadowCascadeCount { get => throw null; set => throw null; }
        public float cascade2Split { get => throw null; set => throw null; }
        public Vector2 cascade3Split { get => throw null; set => throw null; }
        public Vector3 cascade4Split { get => throw null; set => throw null; }
        public float cascadeBorder { get => throw null; set => throw null; }
        public float shadowDepthBias { get => throw null; set => throw null; }
        public float shadowNormalBias { get => throw null; set => throw null; }
        public bool supportsSoftShadows => throw null;
        public bool supportsDynamicBatching { get => throw null; set => throw null; }
        public VolumeProfile volumeProfile { get => throw null; set => throw null; }
        public bool useSRPBatcher { get => throw null; set => throw null; }
        public ColorGradingMode colorGradingMode { get => throw null; set => throw null; }
        public int colorGradingLutSize { get => throw null; set => throw null; }
    }

    // ---- UniversalRenderPipeline.cs ----------------------------------------

    // :20
    public sealed partial class UniversalRenderPipeline : RenderPipeline
    {
        protected override void Render(ScriptableRenderContext context, Camera[] cameras) => throw null;

        // :2377-2398
        public class SingleCameraRequest
        {
            public RenderTexture destination = null;
            public int mipLevel = 0;
            public CubemapFace face = CubemapFace.Unknown;
            public int slice = 0;
        }
    }

    // ---- ScriptableRenderer.cs / ScriptableRendererData.cs ----------------

    public abstract partial class ScriptableRenderer : IDisposable
    {
        public void Dispose() => throw null;
    }

    // ScriptableRendererData.cs:14-82
    public abstract partial class ScriptableRendererData : ScriptableObject
    {
        protected abstract ScriptableRenderer Create();
        public new void SetDirty() => throw null;
        protected virtual void OnValidate() => throw null;
        protected virtual void OnEnable() => throw null;
        public bool useNativeRenderPass { get => throw null; set => throw null; }
    }

    // ---- UniversalRenderer.cs / UniversalRendererData.cs -------------------

    // UniversalRenderer.cs:11-20
    public enum RenderingMode { Forward = 0, ForwardPlus = 2, Deferred = 1 }

    // UniversalRendererData.cs:107-230
    public partial class UniversalRendererData : ScriptableRendererData, ISerializationCallbackReceiver
    {
        public PostProcessData postProcessData = null;
        protected override ScriptableRenderer Create() => throw null;
        void ISerializationCallbackReceiver.OnBeforeSerialize() => throw null;
        void ISerializationCallbackReceiver.OnAfterDeserialize() => throw null;
        public LayerMask opaqueLayerMask { get => throw null; set => throw null; }
        public LayerMask transparentLayerMask { get => throw null; set => throw null; }
        public bool shadowTransparentReceive { get => throw null; set => throw null; }
        public RenderingMode renderingMode { get => throw null; set => throw null; }
    }

    // Data/PostProcessData.cs:19. GetDefaultPostProcessData() is internal
    // (:39), so it is not here: load
    // Packages/com.unity.render-pipelines.universal/Runtime/Data/PostProcessData.asset.
    [Serializable]
    public class PostProcessData : ScriptableObject
    {
    }

    // ---- UniversalAdditionalCameraData.cs -----------------------------------

    // :10-16
    public enum CameraOverrideOption { Off, On, UsePipelineSettings }

    // :28-38
    public enum AntialiasingMode { None, FastApproximateAntialiasing, SubpixelMorphologicalAntiAliasing, TemporalAntiAliasing }

    // :43-47
    public enum CameraRenderType { Base, Overlay }

    // :50-55
    public enum AntialiasingQuality { Low, Medium, High }

    // :59-61
    public static class CameraExtensions
    {
        public static UniversalAdditionalCameraData GetUniversalAdditionalCameraData(this Camera camera) => throw null;
    }

    // :183-552
    [DisallowMultipleComponent]
    [RequireComponent(typeof(Camera))]
    [ExecuteAlways]
    public class UniversalAdditionalCameraData : MonoBehaviour, ISerializationCallbackReceiver
    {
        public bool renderShadows { get => throw null; set => throw null; }
        public CameraOverrideOption requiresDepthOption { get => throw null; set => throw null; }
        public CameraOverrideOption requiresColorOption { get => throw null; set => throw null; }
        public CameraRenderType renderType { get => throw null; set => throw null; }
        public List<Camera> cameraStack => throw null;
        public bool clearDepth => throw null;
        public bool requiresDepthTexture { get => throw null; set => throw null; }
        public bool requiresColorTexture { get => throw null; set => throw null; }
        public ScriptableRenderer scriptableRenderer => throw null;
        public void SetRenderer(int index) => throw null;
        public LayerMask volumeLayerMask { get => throw null; set => throw null; }
        public Transform volumeTrigger { get => throw null; set => throw null; }
        public bool requiresVolumeFrameworkUpdate => throw null;
        public bool renderPostProcessing { get => throw null; set => throw null; }
        public AntialiasingMode antialiasing { get => throw null; set => throw null; }
        public AntialiasingQuality antialiasingQuality { get => throw null; set => throw null; }
        public bool resetHistory { get => throw null; set => throw null; }
        public bool stopNaN { get => throw null; set => throw null; }
        public bool dithering { get => throw null; set => throw null; }
        public bool allowXRRendering { get => throw null; set => throw null; }
        public bool allowHDROutput { get => throw null; set => throw null; }
        public void OnBeforeSerialize() => throw null;
        public void OnAfterDeserialize() => throw null;
    }

    // ---- UniversalAdditionalLightData.cs ------------------------------------

    // :6-18
    [Flags]
    public enum LightLayerEnum
    {
        Nothing = 0,
        LightLayerDefault = 1 << 0,
        LightLayer1 = 1 << 1,
        LightLayer2 = 1 << 2,
        LightLayer3 = 1 << 3,
        LightLayer4 = 1 << 4,
        LightLayer5 = 1 << 5,
        LightLayer6 = 1 << 6,
        LightLayer7 = 1 << 7,
        Everything = 0xFF,
    }

    // :20-31
    public static class LightExtensions
    {
        public static UniversalAdditionalLightData GetUniversalAdditionalLightData(this Light light) => throw null;
    }

    // :36-195
    [DisallowMultipleComponent]
    [RequireComponent(typeof(Light))]
    public class UniversalAdditionalLightData : MonoBehaviour, ISerializationCallbackReceiver
    {
        public bool usePipelineSettings { get => throw null; set => throw null; }
        public int additionalLightsShadowResolutionTier => throw null;
        [Obsolete("This is obsolete, please use renderingLayerMask instead.", true)]
        public LightLayerEnum lightLayerMask { get => throw null; set => throw null; }
        public uint renderingLayers { get => throw null; set => throw null; }
        public bool customShadowLayers { get => throw null; set => throw null; }
        [Obsolete("This is obsolete, please use shadowRenderingLayerMask instead.", true)]
        public LightLayerEnum shadowLayerMask { get => throw null; set => throw null; }
        public uint shadowRenderingLayers { get => throw null; set => throw null; }
        public Vector2 lightCookieSize { get => throw null; set => throw null; }
        public Vector2 lightCookieOffset { get => throw null; set => throw null; }
        public SoftShadowQuality softShadowQuality { get => throw null; set => throw null; }
        public void OnBeforeSerialize() => throw null;
        public void OnAfterDeserialize() => throw null;
    }

    // ---- Overrides/ (volume components) ------------------------------------

    // Bloom.cs:5-11
    public enum BloomDownscaleMode { Half, Quarter }

    // Bloom.cs:15-47
    [Serializable]
    public sealed partial class Bloom : VolumeComponent
    {
        public MinFloatParameter threshold = new MinFloatParameter(0.9f, 0f);
        public MinFloatParameter intensity = new MinFloatParameter(0f, 0f);
        public ClampedFloatParameter scatter = new ClampedFloatParameter(0.7f, 0f, 1f);
        public MinFloatParameter clamp = new MinFloatParameter(65472f, 0f);
        public ColorParameter tint = new ColorParameter(Color.white, false, false, true);
        public BoolParameter highQualityFiltering = new BoolParameter(false);
        public DownscaleParameter downscale = new DownscaleParameter(BloomDownscaleMode.Half);
        public ClampedIntParameter maxIterations = new ClampedIntParameter(6, 2, 8);
        public TextureParameter dirtTexture = new TextureParameter(null);
        public MinFloatParameter dirtIntensity = new MinFloatParameter(0f, 0f);
        public bool IsActive() => throw null;
    }

    // Bloom.cs:56-58
    [Serializable]
    public sealed class DownscaleParameter : VolumeParameter<BloomDownscaleMode>
    {
        public DownscaleParameter(BloomDownscaleMode value, bool overrideState = false) : base(value, overrideState) { }
    }

    // Tonemapping.cs:5-12
    public enum TonemappingMode { None, Neutral, ACES }

    // Tonemapping.cs:30-33
    [Serializable]
    public sealed class Tonemapping : VolumeComponent
    {
        public TonemappingModeParameter mode = new TonemappingModeParameter(TonemappingMode.None);
        public bool IsActive() => throw null;
    }

    // Tonemapping.cs:69-71
    [Serializable]
    public sealed class TonemappingModeParameter : VolumeParameter<TonemappingMode>
    {
        public TonemappingModeParameter(TonemappingMode value, bool overrideState = false) : base(value, overrideState) { }
    }

    // ColorAdjustments.cs:8-23
    [Serializable]
    public sealed class ColorAdjustments : VolumeComponent
    {
        public FloatParameter postExposure = new FloatParameter(0f);
        public ClampedFloatParameter contrast = new ClampedFloatParameter(0f, -100f, 100f);
        public ColorParameter colorFilter = new ColorParameter(Color.white, true, false, true);
        public ClampedFloatParameter hueShift = new ClampedFloatParameter(0f, -180f, 180f);
        public ClampedFloatParameter saturation = new ClampedFloatParameter(0f, -100f, 100f);
        public bool IsActive() => throw null;
    }

    // Vignette.cs:8-23
    [Serializable]
    public sealed class Vignette : VolumeComponent
    {
        public ColorParameter color = new ColorParameter(Color.black, false, false, true);
        public Vector2Parameter center = new Vector2Parameter(new Vector2(0.5f, 0.5f));
        public ClampedFloatParameter intensity = new ClampedFloatParameter(0f, 0f, 1f);
        public ClampedFloatParameter smoothness = new ClampedFloatParameter(0.2f, 0.01f, 1f);
        public BoolParameter rounded = new BoolParameter(false);
        public bool IsActive() => throw null;
    }

    // FilmGrain.cs:5-28
    public enum FilmGrainLookup { Thin1, Thin2, Medium1, Medium2, Medium3, Medium4, Medium5, Medium6, Large01, Large02, Custom }

    // FilmGrain.cs:33-45
    [Serializable]
    public sealed class FilmGrain : VolumeComponent
    {
        public FilmGrainLookupParameter type = new FilmGrainLookupParameter(FilmGrainLookup.Thin1);
        public ClampedFloatParameter intensity = new ClampedFloatParameter(0f, 0f, 1f);
        public ClampedFloatParameter response = new ClampedFloatParameter(0.8f, 0f, 1f);
        public NoInterpTextureParameter texture = new NoInterpTextureParameter(null);
        public bool IsActive() => throw null;
    }

    // FilmGrain.cs:54-56
    [Serializable]
    public sealed class FilmGrainLookupParameter : VolumeParameter<FilmGrainLookup>
    {
        public FilmGrainLookupParameter(FilmGrainLookup value, bool overrideState = false) : base(value, overrideState) { }
    }

    // ChromaticAberration.cs:8-11
    [Serializable]
    public sealed class ChromaticAberration : VolumeComponent
    {
        public ClampedFloatParameter intensity = new ClampedFloatParameter(0f, 0f, 1f);
        public bool IsActive() => throw null;
    }

    // MotionBlur.cs:5-18
    public enum MotionBlurMode { CameraOnly, CameraAndObjects }
    public enum MotionBlurQuality { Low, Medium, High }

    // MotionBlur.cs:24-36
    [Serializable]
    public sealed class MotionBlur : VolumeComponent
    {
        public MotionBlurModeParameter mode = new MotionBlurModeParameter(MotionBlurMode.CameraOnly);
        public MotionBlurQualityParameter quality = new MotionBlurQualityParameter(MotionBlurQuality.Low);
        public ClampedFloatParameter intensity = new ClampedFloatParameter(0f, 0f, 1f);
        public ClampedFloatParameter clamp = new ClampedFloatParameter(0.05f, 0f, 0.2f);
        public bool IsActive() => throw null;
    }

    // MotionBlur.cs:45-53
    [Serializable]
    public sealed class MotionBlurModeParameter : VolumeParameter<MotionBlurMode>
    {
        public MotionBlurModeParameter(MotionBlurMode value, bool overrideState = false) : base(value, overrideState) { }
    }

    [Serializable]
    public sealed class MotionBlurQualityParameter : VolumeParameter<MotionBlurQuality>
    {
        public MotionBlurQualityParameter(MotionBlurQuality value, bool overrideState = false) : base(value, overrideState) { }
    }
}
