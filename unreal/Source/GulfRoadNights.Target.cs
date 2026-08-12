using UnrealBuildTool;

public class GulfRoadNightsTarget : TargetRules
{
	public GulfRoadNightsTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_4;
		ExtraModuleNames.Add("GulfRoadNights");
	}
}
