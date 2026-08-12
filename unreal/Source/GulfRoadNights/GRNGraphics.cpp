#include "GRNGraphics.h"
#include "GameFramework/GameUserSettings.h"
#include "Kismet/KismetSystemLibrary.h"
#include "Engine/Engine.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"

namespace
{
	FIntPoint ResolutionFor(GRNGraphics::EPreset Preset)
	{
		switch (Preset)
		{
		case GRNGraphics::EPreset::UHD4K:   return FIntPoint(3840, 2160);
		case GRNGraphics::EPreset::QHD2K:   return FIntPoint(2560, 1440);
		case GRNGraphics::EPreset::FHD1080: return FIntPoint(1920, 1080);
		default: break;
		}
		if (UGameUserSettings* S = UGameUserSettings::GetGameUserSettings())
		{
			const FIntPoint Native = S->GetDesktopResolution();
			if (Native.X > 0 && Native.Y > 0) return Native;
		}
		return FIntPoint(1920, 1080);
	}

	void Run(UObject* Ctx, const TCHAR* Cmd)
	{
		UKismetSystemLibrary::ExecuteConsoleCommand(Ctx, Cmd);
	}
}

void GRNGraphics::ApplyMax(UObject* WorldContext)
{
	// ---- Resolution: the display's native maximum, fullscreen, uncapped
	if (UGameUserSettings* S = UGameUserSettings::GetGameUserSettings())
	{
		const FIntPoint Native = S->GetDesktopResolution();
		if (Native.X > 0 && Native.Y > 0)
		{
			S->SetScreenResolution(Native);
		}
		S->SetFullscreenMode(EWindowMode::Fullscreen);
		S->SetVSyncEnabled(false);
		S->SetFrameRateLimit(0.f); // let TSR + the GPU decide
		// 4 = Cinematic across every scalability group
		S->SetOverallScalabilityLevel(4);
		S->ApplySettings(false);
	}

	// ---- Per-feature ceilings beyond the scalability groups. Each one is
	// a deliberate "all the way up" for the night corniche:
	const TCHAR* Cmds[] = {
		// Render at true native resolution — no hidden upscale
		TEXT("r.ScreenPercentage 100"),
		TEXT("r.SecondaryScreenPercentage.GameViewport 0"),

		// Lumen: the sodium lamps and paint reflections carry the look
		TEXT("r.Lumen.Reflections.MaxRoughnessToTrace 0.6"),
		TEXT("r.Lumen.TraceMeshSDFs 1"),
		TEXT("r.Lumen.ScreenProbeGather.RadianceCache.ProbeResolution 32"),
		TEXT("r.LumenScene.Radiosity.ProbeSpacing 2"),

		// Virtual shadow maps at full page resolution
		TEXT("r.Shadow.Virtual.ResolutionLodBiasLocal 0"),
		TEXT("r.Shadow.Virtual.ResolutionLodBiasDirectional 0"),

		// TSR at its highest-quality preset
		TEXT("r.TSR.History.ScreenPercentage 200"),
		TEXT("r.TSR.ShadingRejection.Flickering 1"),

		// Materials and translucency at full rate
		TEXT("r.SSR.Quality 4"),
		TEXT("r.TranslucencyLightingVolumeDim 96"),
		TEXT("r.RefractionQuality 3"),

		// Streaming generous enough that nothing pops on a 7 km lap
		TEXT("r.Streaming.PoolSize 4096"),
	};
	for (const TCHAR* Cmd : Cmds)
	{
		UKismetSystemLibrary::ExecuteConsoleCommand(WorldContext, Cmd);
	}

	UE_LOG(LogTemp, Log, TEXT("GRNGraphics: max render profile applied (native res, cinematic scalability)"));
}

void GRNGraphics::ApplyPreset(UObject* WorldContext, EPreset Preset)
{
	const FIntPoint Res = ResolutionFor(Preset);
	if (UGameUserSettings* S = UGameUserSettings::GetGameUserSettings())
	{
		S->SetScreenResolution(Res);
		S->SetFullscreenMode(EWindowMode::Fullscreen);
		S->ApplySettings(false);
	}

	// Shadow and streaming budgets that only make sense once the pixel
	// count is known. A 4K frame carries 2.25x the pixels of 1440p, so the
	// shadow atlas and streaming pool are scaled with it rather than left
	// at a single compromise value.
	const bool b4K = Res.X >= 3400;
	Run(WorldContext, b4K ? TEXT("r.Shadow.Virtual.MaxPhysicalPages 8192")
	                      : TEXT("r.Shadow.Virtual.MaxPhysicalPages 4096"));
	Run(WorldContext, b4K ? TEXT("r.Streaming.PoolSize 6144")
	                      : TEXT("r.Streaming.PoolSize 4096"));

	UE_LOG(LogTemp, Log, TEXT("GRNGraphics: output %dx%d"), Res.X, Res.Y);
}

void GRNGraphics::ApplyNvidia(UObject* WorldContext, bool bPreferQuality)
{
	// Ray tracing is engine-native: Lumen takes hardware tracing on any
	// DXR-capable GPU, and RTX cards are simply the fastest at it.
	const TCHAR* RtCmds[] = {
		TEXT("r.Lumen.HardwareRayTracing 1"),
		TEXT("r.Lumen.HardwareRayTracing.LightingMode 1"), // hit lighting
		TEXT("r.Lumen.Reflections.HardwareRayTracing 1"),
		TEXT("r.Lumen.TranslucencyReflections.FrontLayer.EnableForProject 1"),
		TEXT("r.RayTracing.Shadows 1"),
		TEXT("r.RayTracing.AmbientOcclusion 1"),
		// Reflective wet asphalt is the whole look of a night corniche,
		// so trace reflections well past the usual roughness cutoff.
		TEXT("r.Lumen.Reflections.MaxRoughnessToTrace 0.75"),
	};
	for (const TCHAR* C : RtCmds) Run(WorldContext, C);

	// DLSS and Reflex are plugin-provided. If the plugins are absent these
	// console variables do not exist and the calls are silently ignored,
	// so this stays safe on AMD, Intel and in editor builds.
	Run(WorldContext, TEXT("r.NGX.Enable 1"));
	Run(WorldContext, TEXT("r.NGX.DLSS.Enable 1"));
	// 1 = Performance, 2 = Balanced, 3 = Quality in the DLSS plugin's
	// quality enum. Quality at 4K renders 1440p internally, which beats
	// native 4K + TSR on both frame rate and stability.
	Run(WorldContext, bPreferQuality ? TEXT("r.NGX.DLSS.Quality 3")
	                                 : TEXT("r.NGX.DLSS.Quality 1"));
	Run(WorldContext, TEXT("r.NGX.DLSS.Sharpness 0.3"));
	// Reflex trims the render queue — worth real milliseconds of input lag
	// in a game decided by when you lift for a corner.
	Run(WorldContext, TEXT("t.Reflex.Enable 1"));
	Run(WorldContext, TEXT("t.Reflex.Mode 1"));

	UE_LOG(LogTemp, Log, TEXT("GRNGraphics: NVIDIA path applied (RT on, DLSS %s)"),
		bPreferQuality ? TEXT("Quality") : TEXT("Performance"));
}

void GRNGraphics::ApplyCommandLineOverrides(UObject* WorldContext)
{
	const TCHAR* Cmd = FCommandLine::Get();
	if (FParse::Param(Cmd, TEXT("grn4k")))        ApplyPreset(WorldContext, EPreset::UHD4K);
	else if (FParse::Param(Cmd, TEXT("grn2k")))   ApplyPreset(WorldContext, EPreset::QHD2K);
	else if (FParse::Param(Cmd, TEXT("grn1080"))) ApplyPreset(WorldContext, EPreset::FHD1080);

	FString Dlss;
	const bool bQuality = !(FParse::Value(Cmd, TEXT("-grndlss="), Dlss) && Dlss.Equals(TEXT("perf"), ESearchCase::IgnoreCase));
	if (!FParse::Param(Cmd, TEXT("grnnonvidia")))
	{
		ApplyNvidia(WorldContext, bQuality);
		if (FParse::Param(Cmd, TEXT("grnrtxultra")))
		{
			ApplyRtxUltra(WorldContext, FParse::Param(Cmd, TEXT("grnframegen")));
		}
	}
	if (FParse::Param(Cmd, TEXT("grnpathtrace"))) SetPathTracing(WorldContext, true);
}

void GRNGraphics::ApplyRtxUltra(UObject* WorldContext, bool bFrameGeneration)
{
	const TCHAR* Cmds[] = {
		// Lumen: more probes and more rays per probe. The corniche is lit
		// almost entirely by many small sodium sources, which is the case
		// that punishes a sparse probe grid hardest.
		TEXT("r.Lumen.ScreenProbeGather.RadianceCache.ProbeResolution 64"),
		TEXT("r.Lumen.ScreenProbeGather.TracingOctahedronResolution 16"),
		TEXT("r.Lumen.ScreenProbeGather.DownsampleFactor 8"),
		TEXT("r.LumenScene.Radiosity.ProbeSpacing 1"),
		TEXT("r.LumenScene.Radiosity.HemisphereProbeResolution 8"),
		TEXT("r.Lumen.Reflections.MaxRoughnessToTrace 1.0"),
		TEXT("r.Lumen.Reflections.SmoothBias 0"),

		// Ray-traced shadows at full quality rather than the denoised
		// half-rate default; the lamp posts cast the long shadows the look
		// depends on and they are what shows sampling first.
		TEXT("r.RayTracing.Shadows.SamplesPerPixel 4"),
		TEXT("r.RayTracing.Shadows.EnableTwoSidedGeometry 1"),
		TEXT("r.RayTracing.AmbientOcclusion.SamplesPerPixel 4"),

		// Nanite and virtual shadow maps unclamped
		TEXT("r.Nanite.MaxPixelsPerEdge 0.5"),
		TEXT("r.Shadow.Virtual.MaxPhysicalPages 16384"),
		TEXT("r.Shadow.Virtual.SMRT.RayCountLocal 16"),
		TEXT("r.Shadow.Virtual.SMRT.RayCountDirectional 16"),

		// Volumetrics and translucency: the sodium haze over the bay
		TEXT("r.VolumetricFog.GridPixelSize 4"),
		TEXT("r.VolumetricFog.GridSizeZ 128"),
		TEXT("r.TranslucencyLightingVolumeDim 128"),

		// A 5090 carries 32 GB; there is no reason to stream conservatively
		TEXT("r.Streaming.PoolSize 12288"),

		// DLSS Ray Reconstruction replaces the hand-tuned denoisers with
		// the trained one — the single biggest win for ray-traced detail.
		TEXT("r.NGX.DLSS.RayReconstruction 1"),
		TEXT("r.NGX.DLSS.Quality 3"),
	};
	for (const TCHAR* C : Cmds) Run(WorldContext, C);

	// Frame Generation is opt-in: it roughly doubles displayed frame rate
	// but adds a frame of latency, which a racing game feels.
	Run(WorldContext, bFrameGeneration ? TEXT("r.NGX.DLSSG.Enable 1")
	                                   : TEXT("r.NGX.DLSSG.Enable 0"));

	UE_LOG(LogTemp, Log, TEXT("GRNGraphics: RTX ultra profile applied (frame gen %s)"),
		bFrameGeneration ? TEXT("on") : TEXT("off"));
}

void GRNGraphics::SetPathTracing(UObject* WorldContext, bool bEnabled)
{
	Run(WorldContext, bEnabled ? TEXT("r.PathTracing 1") : TEXT("r.PathTracing 0"));
	if (bEnabled)
	{
		Run(WorldContext, TEXT("r.PathTracing.SamplesPerPixel 2048"));
		Run(WorldContext, TEXT("r.PathTracing.MaxBounces 8"));
		Run(WorldContext, TEXT("r.PathTracing.Denoiser 1"));
	}
}
