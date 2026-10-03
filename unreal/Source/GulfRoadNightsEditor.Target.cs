using UnrealBuildTool;

public class GulfRoadNightsEditorTarget : TargetRules
{
	public GulfRoadNightsEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		// Must match GulfRoadNights.Target.cs exactly — see the note there.
		DefaultBuildSettings = BuildSettingsVersion.V7;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_8;
		ExtraModuleNames.Add("GulfRoadNights");
		// Builds the Substrate car paint asset (GRNPaintBuilder). Editor
		// target only: a packaged game cannot create a UMaterial — its
		// shaders are compiled at cook time — so the asset has to exist
		// before the cook, and this is what makes it.
		ExtraModuleNames.Add("GulfRoadNightsEditor");
	}
}
