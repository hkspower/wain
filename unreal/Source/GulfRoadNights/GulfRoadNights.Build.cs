using UnrealBuildTool;

public class GulfRoadNights : ModuleRules
{
	public GulfRoadNights(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		// This module keeps its headers beside its sources rather than in
		// Public/, and modern build settings turn off the legacy include
		// paths that used to hand a flat module's directory to the modules
		// depending on it. GulfRoadNightsEditor includes GRNPaint.h for the
		// paint's asset path and parameter names — the one place they are
		// spelled — so the directory is made public explicitly.
		PublicIncludePaths.Add(ModuleDirectory);

		// Runtime modules ONLY. This module is in the packaged game, so
		// nothing editor-side may appear here — UnrealEd, MaterialEditor,
		// EditorSubsystem and the rest live in GulfRoadNightsEditor, and
		// scripts/check-unreal-project.mjs fails if one is ever added.
		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core", "CoreUObject", "Engine", "InputCore",
			"ProceduralMeshComponent",
			// Live data API client (GRNApi)
			"HTTP", "Json", "JsonUtilities"
		});

		// GRNGraphics::MegaLightsActive asks the machine, not just the
		// project: GMaxRHIFeatureLevel (RHI) for SM6, IsRayTracingEnabled
		// (RenderCore) for hardware ray tracing. Private, because no header
		// of this module names either, so nothing depending on it needs them.
		PrivateDependencyModuleNames.AddRange(new string[] { "RHI", "RenderCore" });
	}
}
