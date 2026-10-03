using UnrealBuildTool;

public class GulfRoadNightsTarget : TargetRules
{
	public GulfRoadNightsTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		// Pinned, not Latest, and the same pair in both targets. An
		// installed 5.8 editor is built with V7 and UnrealBuildTool will
		// not build a project target that disagrees with it; `Latest`
		// would follow the engine silently on the next bump, and V7 is
		// the version that turns the ReturnType, Dangling and
		// UnreachableCode warnings into errors — a change worth seeing in
		// a diff rather than discovering in a build log.
		// scripts/check-unreal-project.mjs fails if the two targets or the
		// .uproject's EngineAssociation ever disagree.
		DefaultBuildSettings = BuildSettingsVersion.V7;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_8;
		// The game ONLY. GulfRoadNightsEditor is an Editor module in the
		// .uproject and never goes into a packaged build; naming it here
		// would try to link UnrealEd into the shipping executable.
		ExtraModuleNames.Add("GulfRoadNights");
	}
}
