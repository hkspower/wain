using UnrealBuildTool;

public class GulfRoadNights : ModuleRules
{
	public GulfRoadNights(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core", "CoreUObject", "Engine", "InputCore",
			"ProceduralMeshComponent"
		});
	}
}
