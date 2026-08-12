#include "GRNGraphics.h"
#include "GameFramework/GameUserSettings.h"
#include "Kismet/KismetSystemLibrary.h"
#include "Engine/Engine.h"

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
