using UnrealBuildTool;

// The editor half of the port. It exists for one job: building the
// Substrate car paint asset (GRNPaintBuilder.cpp), which a packaged game
// cannot do for itself because a UMaterial's shaders are compiled at cook
// time. "Type": "Editor" in the .uproject and listed only by the editor
// target, so none of these dependencies — UnrealEd above all — can reach
// the shipping executable. scripts/check-unreal-project.mjs checks both
// halves of that, and that every engine header these sources include is
// covered by a module named here.
public class GulfRoadNightsEditor : ModuleRules
{
	public GulfRoadNightsEditor(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"Core", "CoreUObject", "Engine",
			// UEditorSubsystem — builds the paint the first time the editor opens
			"EditorSubsystem",
			// UMaterialEditingLibrary — creates and wires the graph's nodes
			"MaterialEditor",
			// FAssetRegistryModule — announces the new asset, and the
			// files-loaded event the subsystem waits on
			"AssetRegistry",
			"UnrealEd",
			// GRNPaint.h / GRNPaintLaw.h: the asset path, the parameter
			// names and the web's numbers, each spelled once. Header-only
			// use — nothing from the runtime module is called, so nothing
			// in it needs exporting.
			"GulfRoadNights",
		});
	}
}
