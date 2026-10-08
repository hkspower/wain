#include "GRNGraphics.h"
#include "GameFramework/GameUserSettings.h"
#include "Kismet/KismetSystemLibrary.h"
#include "Components/LocalLightComponent.h"
#include "Engine/Engine.h"
#include "HAL/IConsoleManager.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "UObject/UObjectIterator.h"
#include "RenderUtils.h"
#include "RHI.h"
#include "HAL/PlatformMemory.h"
#include "HAL/PlatformMisc.h"

namespace
{
	// Worn by every light whose shadows follow MegaLightsActive(). A
	// function-local static, not a file-scope FName, so nothing builds a
	// name before the name table exists.
	const FName& MegaShadowTag()
	{
		static const FName Tag(TEXT("GRN.MegaShadow"));
		return Tag;
	}

	// The answer changed (or may have: a scalability apply sets the
	// variable whether or not its value moves). Every tagged light still
	// standing takes the new answer; one already right is left alone, so
	// a repeat costs a walk over the light components and nothing else —
	// a few hundred objects, not a frame's worth.
	void RelightFollowers(IConsoleVariable* /*Changed*/)
	{
		const bool bShadowed = GRNGraphics::MegaLightsActive();
		int32 Relit = 0;
		for (TObjectIterator<ULocalLightComponent> It; It; ++It)
		{
			ULocalLightComponent* Light = *It;
			if (!IsValid(Light) || Light->IsTemplate() || !Light->IsRegistered()) continue;
			if (!Light->ComponentHasTag(MegaShadowTag())) continue;
			if ((Light->CastShadows != 0) == bShadowed) continue;
			Light->SetCastShadows(bShadowed);
			Relit++;
		}
		if (Relit > 0)
		{
			UE_LOG(LogTemp, Log, TEXT("GRNGraphics: MegaLights %s, %d lamps and headlights re-lit %s"),
				bShadowed ? TEXT("on") : TEXT("off"), Relit, bShadowed ? TEXT("shadowed") : TEXT("unshadowed"));
		}
	}

	// Once per process. The variables outlive every world, and so does a
	// static callback; the lights it touches are found fresh each time.
	void WatchMegaLights()
	{
		static bool bWatching = false;
		if (bWatching) return;
		bWatching = true;
		const TCHAR* Watched[] = { TEXT("r.MegaLights.Allow"), TEXT("r.MegaLights.EnableForProject") };
		for (const TCHAR* Name : Watched)
		{
			if (IConsoleVariable* Var = IConsoleManager::Get().FindConsoleVariable(Name))
			{
				Var->OnChangedDelegate().AddStatic(&RelightFollowers);
			}
		}
	}

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

	// -grnmegalightssoft. A process-wide switch like the console variables
	// MegaLightsActive reads, and read at the same moment they are.
	bool GSoftwareMegaLights = false;
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
		// 4 = Cinematic across every scalability group. ApplySettings below
		// also saves it, so the level the NEXT launch starts from is 4 as
		// well: no per-rung switch in DefaultScalability.ini is ever what
		// the world is built under. MegaLightsActive says what that means
		// for the lamps' shadows.
		S->SetOverallScalabilityLevel(4);
		S->ApplySettings(false);
	}

	// ---- Per-feature ceilings beyond the scalability groups. Each one is
	// a deliberate "all the way up" for the night corniche:
	const TCHAR* Cmds[] = {
		// Render at true native resolution — no hidden upscale
		TEXT("r.ScreenPercentage 100"),
		TEXT("r.SecondaryScreenPercentage.GameViewport 0"),

		// Lumen: the sodium lamps and paint reflections carry the look.
		//
		// r.Lumen.TraceMeshSDFs 1 used to sit here. Software ray tracing's
		// per-mesh distance-field detail traces were deprecated in 5.6 and
		// default off from 5.7; on 5.8 the line asks for a path Epic has
		// deprecated, and the global distance field it falls back to is the
		// one MegaLights' own software fallback traces anyway — which is
		// why r.GenerateMeshDistanceFields stays on in DefaultEngine.ini.
		TEXT("r.Lumen.Reflections.MaxRoughnessToTrace 0.6"),
		TEXT("r.Lumen.ScreenProbeGather.RadianceCache.ProbeResolution 32"),
		TEXT("r.LumenScene.Radiosity.ProbeSpacing 2"),

		// MegaLights at its default sample count, written down so the
		// ceiling is a number in the source rather than an engine default
		// that can move under it. 4 per pixel; ApplyRtxUltra takes it to
		// 16. (Supported values are 2, 4 and 16.)
		TEXT("r.MegaLights.NumSamplesPerPixel 4"),

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
		// Ray-traced shadows for the lights MegaLights is NOT drawing — a
		// directional moon, or every light when MegaLights is off.
		TEXT("r.RayTracing.Shadows 1"),
		// r.RayTracing.AmbientOcclusion 1 used to sit here. The legacy ray
		// traced AO pass only ever ran with Lumen GI OFF, and the legacy
		// ray-traced passes were dropped in 5.4; under Lumen it set a
		// variable nothing read. Lumen's own short-range AO is the AO.
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

	// MegaLights' software path, before anything asks MegaLightsActive.
	if (FParse::Param(Cmd, TEXT("grnmegalightssoft"))) AllowSoftwareMegaLights(true);

	// A Mac with an Apple GPU takes its own profile and none of the
	// NVIDIA one: there is no DXR, no NGX and no Reflex to ask for, and
	// the ray-tracing lines would ask Lumen for hardware the chip has
	// not got. -grnapple forces it (for reading the profile's effect on
	// another machine); -grnnoapple leaves the Mac on the generic path.
	const bool bApple = FParse::Param(Cmd, TEXT("grnapple")) ||
		(IsAppleSilicon() && !FParse::Param(Cmd, TEXT("grnnoapple")));
	if (bApple)
	{
		float Fps = 0.f;
		FParse::Value(Cmd, TEXT("-grnapplefps="), Fps);
		ApplyAppleSilicon(WorldContext, Fps);
	}

	FString Dlss;
	const bool bQuality = !(FParse::Value(Cmd, TEXT("-grndlss="), Dlss) && Dlss.Equals(TEXT("perf"), ESearchCase::IgnoreCase));
	if (!bApple && !FParse::Param(Cmd, TEXT("grnnonvidia")))
	{
		ApplyNvidia(WorldContext, bQuality);
		if (FParse::Param(Cmd, TEXT("grnrtxultra")))
		{
			ApplyRtxUltra(WorldContext, FParse::Param(Cmd, TEXT("grnframegen")));
		}
	}
	if (FParse::Param(Cmd, TEXT("grnpathtrace"))) SetPathTracing(WorldContext, true);

	// MegaLights off, and so every lamp and headlight unshadowed. The
	// scalability rung cannot do this at boot (ApplyMax has just raised it
	// to Cinematic), and a variable set from the console outranks one set
	// by scalability, so a rung change later in the session cannot quietly
	// turn it back on either. Runs before the world is built, which waits
	// on the API fetch, so the lamps are built unshadowed rather than
	// re-lit a frame later.
	if (FParse::Param(Cmd, TEXT("grnnomegalights"))) Run(WorldContext, TEXT("r.MegaLights.Allow 0"));

	// Frame pacing: -grnvsync, -grngsync, or -grnfps=N
	float CapFps = 0.f;
	if (FParse::Param(Cmd, TEXT("grngsync"))) ApplyVrrPacing(WorldContext);
	else if (FParse::Param(Cmd, TEXT("grnvsync"))) SetFramePacing(WorldContext, true, 0.f);
	else if (FParse::Value(Cmd, TEXT("-grnfps="), CapFps)) SetFramePacing(WorldContext, false, CapFps);
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

		// The lamps' shadows. Under MegaLights they are its samples, so
		// they are raised there: 16 per pixel rather than 4. The lamp posts
		// cast the long shadows the look depends on, and a stochastic
		// light sampler shows undersampling as crawling noise in exactly
		// those penumbrae first.
		TEXT("r.MegaLights.NumSamplesPerPixel 16"),
		// And for any light MegaLights is not drawing (or all of them when
		// it is off): ray-traced shadows at full quality rather than the
		// denoised half-rate default. The AO sample count that sat beside
		// these is gone with the legacy AO pass — see ApplyNvidia.
		TEXT("r.RayTracing.Shadows.SamplesPerPixel 4"),
		TEXT("r.RayTracing.Shadows.EnableTwoSidedGeometry 1"),

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
		// 16 GB pool: a 5090 carries 32 GB and a 7 km lap of scanned
		// geometry has no reason to stream conservatively against it.
		TEXT("r.Streaming.PoolSize 16384"),
		TEXT("r.Streaming.LimitPoolSizeToVRAM 1"),
		TEXT("r.Streaming.MaxTempMemoryAllowed 512"),

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

bool GRNGraphics::IsAppleSilicon()
{
#if PLATFORM_MAC
	// The RHI's own answer: the device the renderer is on is Apple's. A
	// Mac with a discrete AMD card says no here, and rightly — it has
	// separate video memory and no unified pool to size against.
	return IsRHIDeviceApple();
#else
	return false;
#endif
}

void GRNGraphics::AllowSoftwareMegaLights(bool bAllow)
{
	GSoftwareMegaLights = bAllow;
}

void GRNGraphics::ApplyAppleSilicon(UObject* WorldContext, float TargetFps)
{
	// ---- The one memory. A quarter of it for the streaming pool, between
	// 2 and 12 GB: the GPU, the game and (in the editor) the editor all
	// draw on the same pool, and r.Streaming.PoolSize is the only one of
	// those this code gets to size. An 8 GB Air lands on the floor, a
	// 24 GB Pro on 6 GB, a 96 GB Max on the ceiling — which is where the
	// RTX path's 16 GB would have been a swap file on all but the last.
	const FPlatformMemoryStats Mem = FPlatformMemory::GetStats();
	const int32 PoolMb = (int32)FMath::Clamp<int64>((int64)(Mem.TotalPhysical / (1024 * 1024)) / 4, 2048, 12288);
	Run(WorldContext, *FString::Printf(TEXT("r.Streaming.PoolSize %d"), PoolMb));
	// Metal reports a working-set size, not a VRAM size; let the pool be
	// what it was asked to be.
	Run(WorldContext, TEXT("r.Streaming.LimitPoolSizeToVRAM 0"));

	// ---- No ray-tracing hardware. Said out loud, so Lumen's software
	// tracer is the path by decision and the hardware lines the project
	// carries (DefaultEngine.ini, for the cards that have it) are not an
	// unanswered request every frame. The global distance field those
	// traces read stays on (r.GenerateMeshDistanceFields).
	Run(WorldContext, TEXT("r.Lumen.HardwareRayTracing 0"));
	Run(WorldContext, TEXT("r.Lumen.Reflections.HardwareRayTracing 0"));
	Run(WorldContext, TEXT("r.RayTracing.Shadows 0"));

	// ---- Bandwidth. ApplyMax asked TSR for a 2x history; on unified
	// memory that is 4x the history traffic on a bus the CPU is also on.
	// Native history, and the sharpening the comfort grade already has.
	Run(WorldContext, TEXT("r.TSR.History.ScreenPercentage 100"));

	// ---- The panel's rate is the target, and the whole GPU goes on
	// holding it. Dynamic resolution between half and full native, with
	// the panel's frame time as the budget: the renderer finds the
	// highest internal resolution that makes the rate and sits there,
	// so a 120 Hz ProMotion panel gets 120 frames of whatever the chip
	// can draw in 8.3 ms and a 60 Hz Air gets 60 of twice as much. TSR
	// fills in to native. Mode 2 forces it on whatever the user settings
	// say, which is the point of a profile called full power.
	float Fps = TargetFps;
	if (Fps <= 0.f)
	{
		Fps = 60.f;
		if (GEngine && GEngine->GameViewport)
		{
			Fps = FMath::Max(Fps, (float)FPlatformMisc::GetMaxRefreshRate());
		}
	}
	Run(WorldContext, TEXT("r.DynamicRes.OperationMode 2"));
	Run(WorldContext, TEXT("r.DynamicRes.MinScreenPercentage 50"));
	Run(WorldContext, TEXT("r.DynamicRes.MaxScreenPercentage 100"));
	Run(WorldContext, *FString::Printf(TEXT("r.DynamicRes.FrameTimeBudget %.3f"), 1000.f / Fps));
	// v-sync off and a cap just under the panel: the VRR pacing the
	// RTX path offers, which a ProMotion panel is. (Reflex is asked for
	// in there too; on Metal the variable does not exist and the call
	// is a no-op, as every NGX line is.)
	ApplyVrrPacing(WorldContext, Fps);

	// ---- MegaLights. Without ray-tracing hardware MegaLightsActive says
	// no and the ~170 lamps are built unshadowed, as they always were.
	// -grnmegalightssoft has already said otherwise if it was given; the
	// log says which this boot is.
	UE_LOG(LogTemp, Log, TEXT("GRNGraphics: Apple silicon profile — %lld MB physical, pool %d MB, "
		"software Lumen, TSR history native, dynamic resolution 50-100%% to %.0f fps, MegaLights %s"),
		(long long)(Mem.TotalPhysical / (1024 * 1024)), PoolMb, Fps,
		MegaLightsActive() ? TEXT("on (software path)") : TEXT("off: lamps unshadowed; -grnmegalightssoft to try its software path"));
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

void GRNGraphics::SetFramePacing(UObject* WorldContext, bool bVSync, float CapFps)
{
	if (UGameUserSettings* S = UGameUserSettings::GetGameUserSettings())
	{
		S->SetVSyncEnabled(bVSync);
		S->SetFrameRateLimit(FMath::Max(0.f, CapFps));
		S->ApplySettings(false);
	}
	// The console variables are what actually take effect mid-session;
	// the settings object above is what persists to the ini.
	Run(WorldContext, bVSync ? TEXT("r.VSync 1") : TEXT("r.VSync 0"));
	Run(WorldContext, *FString::Printf(TEXT("t.MaxFPS %.0f"), FMath::Max(0.f, CapFps)));

	UE_LOG(LogTemp, Log, TEXT("GRNGraphics: v-sync %s, cap %.0f"),
		bVSync ? TEXT("on") : TEXT("off"), CapFps);
}

void GRNGraphics::ApplyVrrPacing(UObject* WorldContext, float RefreshHz)
{
	if (RefreshHz <= 0.f)
	{
		if (UGameUserSettings* S = UGameUserSettings::GetGameUserSettings())
		{
			// GetFrameRateLimit is the user's cap, not the panel — read the
			// mode instead so a 240 Hz display is not paced like a 60 Hz one.
			const FIntPoint Res = S->GetScreenResolution();
			(void)Res;
		}
		RefreshHz = 60.f;
		if (GEngine && GEngine->GameViewport)
		{
			// The platform reports the active mode's refresh where it can
			RefreshHz = FMath::Max(RefreshHz, (float)FPlatformMisc::GetMaxRefreshRate());
		}
	}
	// Three under the ceiling: enough margin that a frame-time spike does
	// not punch through into v-sync fallback, little enough that the
	// player never notices the frames are missing.
	const float Cap = FMath::Max(30.f, RefreshHz - 3.f);
	SetFramePacing(WorldContext, /*bVSync=*/false, Cap);
	// Reflex keeps the render queue short, which is what makes a VRR
	// display feel immediate rather than merely smooth.
	Run(WorldContext, TEXT("t.Reflex.Enable 1"));
	Run(WorldContext, TEXT("t.Reflex.Mode 1"));

	UE_LOG(LogTemp, Log, TEXT("GRNGraphics: VRR pacing at %.0f fps under a %.0f Hz panel"), Cap, RefreshHz);
}

bool GRNGraphics::MegaLightsActive()
{
	IConsoleManager& Console = IConsoleManager::Get();
	const IConsoleVariable* Project = Console.FindConsoleVariable(TEXT("r.MegaLights.EnableForProject"));
	const IConsoleVariable* Allow = Console.FindConsoleVariable(TEXT("r.MegaLights.Allow"));
	// No project switch means an engine without MegaLights: nothing to opt
	// into. A missing Allow, on an engine that has the project switch, is
	// read as allowed — it is only ever a way of saying no.
	//
	// Until these two lines were added this was the whole test, and in
	// this game it reduced to the project switch alone: ApplyMax puts
	// every scalability group at Cinematic before the world is built, so
	// r.MegaLights.Allow always read 1 and the Low/Medium "no" was never
	// heard. Nothing then looked at the GPU, so a card without MegaLights
	// got ~170 lamps and ~30 headlights shadowed the old way. The
	// variables say what the project asked for; these say whether this
	// machine can deliver it, and neither can be raised by ApplyMax.
	const bool bSM6 = GMaxRHIFeatureLevel >= ERHIFeatureLevel::SM6;
	// ...or MegaLights' own software path, when -grnmegalightssoft has
	// asked for it: the global distance field in place of the rays. An
	// M2 has SM6 on Metal and no ray-tracing hardware, and this is the
	// one way its lamps get a shadow.
	const bool bHardwareRT = IsRayTracingEnabled() || GSoftwareMegaLights;
	return Project && Project->GetInt() != 0 && (!Allow || Allow->GetInt() != 0)
		&& bSM6 && bHardwareRT;
}

bool GRNGraphics::FollowMegaLights(ULocalLightComponent* Light)
{
	const bool bShadowed = MegaLightsActive();
	if (!Light) return bShadowed;
	WatchMegaLights();
	Light->ComponentTags.AddUnique(MegaShadowTag());
	Light->SetCastShadows(bShadowed);
	return bShadowed;
}
