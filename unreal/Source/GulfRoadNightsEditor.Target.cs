using UnrealBuildTool;

public class GulfRoadNightsEditorTarget : TargetRules
{
	public GulfRoadNightsEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_4;
		ExtraModuleNames.Add("GulfRoadNights");
	}
}
