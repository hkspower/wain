#include "GRNPaintBuilder.h"
#include "GRNPaint.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "HAL/FileManager.h"
#include "HAL/IConsoleManager.h"
#include "MaterialEditingLibrary.h"
#include "Materials/Material.h"
#include "Materials/MaterialExpression.h"
#include "Materials/MaterialExpressionScalarParameter.h"
#include "Materials/MaterialExpressionSubstrate.h"
#include "Materials/MaterialExpressionVectorParameter.h"
#include "Misc/PackageName.h"
#include "Misc/Paths.h"
#include "SceneTypes.h"
#include "UObject/Package.h"
#include "UObject/SavePackage.h"
#include "UObject/UObjectGlobals.h"

DEFINE_LOG_CATEGORY_STATIC(LogGRNPaintBuilder, Log, All);

namespace
{
	// Graph layout, so the asset is readable when somebody opens it: the
	// parameters in a column on the left, the conversion in the middle,
	// the clear coat beside the material's own output.
	constexpr int32 ColParams = -1100;
	constexpr int32 ColConvert = -700;
	constexpr int32 ColCoat = -350;
	constexpr int32 RowStep = 140;

	template <typename T>
	T* AddNode(UMaterial* Material, int32 X, int32 Y)
	{
		return Cast<T>(UMaterialEditingLibrary::CreateMaterialExpression(Material, T::StaticClass(), X, Y));
	}

	UMaterialExpressionScalarParameter* Scalar(UMaterial* Material, const TCHAR* Name, float Default, int32 Row)
	{
		UMaterialExpressionScalarParameter* P =
			AddNode<UMaterialExpressionScalarParameter>(Material, ColParams, Row * RowStep);
		if (P)
		{
			P->ParameterName = FName(Name);
			P->DefaultValue = Default;
		}
		return P;
	}

	/** The index of the output called Name, or INDEX_NONE. */
	int32 OutputIndex(UMaterialExpression* Node, const TCHAR* Name)
	{
		const TArray<FExpressionOutput>& Outputs = Node->GetOutputs();
		for (int32 I = 0; I < Outputs.Num(); ++I)
		{
			if (Outputs[I].OutputName == FName(Name)) return I;
		}
		return INDEX_NONE;
	}

	/** "DiffuseAlbedo, F0" — for the message when a name is not found. */
	FString OutputNames(UMaterialExpression* Node)
	{
		TArray<FString> Names;
		for (const FExpressionOutput& O : Node->GetOutputs())
		{
			Names.Add(O.OutputName.IsNone() ? FString(TEXT("(unnamed)")) : O.OutputName.ToString());
		}
		return FString::Join(Names, TEXT(", "));
	}

	/**
	 * Wire the v1 graph into an EMPTY material. False, with Why filled,
	 * if a node could not be made or an output is not where the
	 * Substrate headers of this engine put it.
	 */
	bool BuildGraph(UMaterial* Material, FString& Why)
	{
		UMaterialExpressionVectorParameter* Color =
			AddNode<UMaterialExpressionVectorParameter>(Material, ColParams, 0);
		// Defaults are only what the material shows in its own preview;
		// GRNPaint::CreatePaintMid sets every one of these on every car.
		UMaterialExpressionScalarParameter* Metalness = Scalar(Material, GRNPaint::ParamMetalness, 0.f, 1);
		UMaterialExpressionScalarParameter* Specular =
			Scalar(Material, GRNPaint::ParamSpecular, GRNPaintLaw::Specular, 2);
		UMaterialExpressionScalarParameter* BaseRoughness =
			Scalar(Material, GRNPaint::ParamBaseRoughness, GRNPaintLaw::BaseRoughness, 3);
		const GRNPaintLaw::FFinishSpec& Gloss = GRNPaintLaw::Finish(EGRNFinish::Gloss);
		UMaterialExpressionScalarParameter* ClearCoat =
			Scalar(Material, GRNPaint::ParamClearCoat, Gloss.ClearCoat, 4);
		UMaterialExpressionScalarParameter* ClearCoatRoughness =
			Scalar(Material, GRNPaint::ParamClearCoatRoughness, Gloss.ClearCoatRoughness, 5);
		if (!Color || !Metalness || !Specular || !BaseRoughness || !ClearCoat || !ClearCoatRoughness)
		{
			Why = TEXT("could not create the parameter nodes");
			return false;
		}
		Color->ParameterName = FName(GRNPaint::ParamColor);
		Color->DefaultValue = FLinearColor(0.18f, 0.18f, 0.18f, 1.f);

		// Base colour, metalness and specular in; the albedo and F0 a
		// Substrate BSDF wants out. The same split the legacy shading model
		// does internally, made explicit — and it keeps the parameters in
		// the metalness workflow the web's numbers were measured in.
		UMaterialExpressionSubstrateMetalnessToDiffuseAlbedoF0* ToF0 =
			AddNode<UMaterialExpressionSubstrateMetalnessToDiffuseAlbedoF0>(Material, ColConvert, RowStep);
		if (!ToF0)
		{
			Why = TEXT("could not create a Substrate Metalness-To-DiffuseAlbedo-F0 node");
			return false;
		}
		ToF0->BaseColor.Connect(0, Color);
		ToF0->Metallic.Connect(0, Metalness);
		ToF0->Specular.Connect(0, Specular);

		const int32 AlbedoOut = OutputIndex(ToF0, TEXT("DiffuseAlbedo"));
		const int32 F0Out = OutputIndex(ToF0, TEXT("F0"));
		if (AlbedoOut == INDEX_NONE || F0Out == INDEX_NONE)
		{
			Why = FString::Printf(
				TEXT("Metalness-To-DiffuseAlbedo-F0 has no DiffuseAlbedo/F0 outputs in this engine (it has: %s) — ")
				TEXT("update GRNPaintBuilder.cpp to the new names"),
				*OutputNames(ToF0));
			return false;
		}

		// The coat. Its own F0 is fixed at 0.04 by the node — lacquer is
		// lacquer — and ClearCoat (0..1) is how much of it there is: 1 for
		// gloss, 0.45 for satin, 0 for matte, which leaves the basecoat
		// alone and is exactly the web's matte.
		UMaterialExpressionSubstrateSimpleClearCoatBSDF* Coat =
			AddNode<UMaterialExpressionSubstrateSimpleClearCoatBSDF>(Material, ColCoat, RowStep);
		if (!Coat)
		{
			Why = TEXT("could not create a Substrate Simple Clear Coat node");
			return false;
		}
		Coat->DiffuseAlbedo.Connect(AlbedoOut, ToF0);
		Coat->F0.Connect(F0Out, ToF0);
		Coat->Roughness.Connect(0, BaseRoughness);
		Coat->ClearCoatCoverage.Connect(0, ClearCoat);
		Coat->ClearCoatRoughness.Connect(0, ClearCoatRoughness);

		if (!UMaterialEditingLibrary::ConnectMaterialProperty(Coat, FString(), MP_FrontMaterial))
		{
			Why = TEXT("could not connect the clear coat to Front Material — is Substrate really on?");
			return false;
		}
		return true;
	}

	bool SubstrateOn()
	{
		const IConsoleVariable* Cv = IConsoleManager::Get().FindConsoleVariable(GRNPaint::SubstrateCVar);
		return Cv && Cv->GetInt() != 0;
	}
}

const TCHAR* GRNPaintBuilder::ResultName(EResult Result)
{
	switch (Result)
	{
	case EResult::Built: return TEXT("built");
	case EResult::AlreadyThere: return TEXT("already there");
	case EResult::SubstrateOff: return TEXT("Substrate off");
	case EResult::Failed: return TEXT("failed");
	}
	return TEXT("?");
}

GRNPaintBuilder::EResult GRNPaintBuilder::Build(bool bForce, FString& OutMessage)
{
	const FString PackageName = GRNPaint::MaterialPackageName();
	const FString AssetName = GRNPaint::MaterialAssetName();

	if (!SubstrateOn())
	{
		OutMessage = FString::Printf(
			TEXT("%s is off, so %s was not built — its graph hangs off Front Material, which a project without ")
			TEXT("Substrate ignores. The game draws the basic-shape paint, as it did before. Turn Substrate on ")
			TEXT("(DefaultEngine.ini in the repository has it), restart, and build again."),
			GRNPaint::SubstrateCVar, *PackageName);
		return EResult::SubstrateOff;
	}

	const bool bOnDisk = FPackageName::DoesPackageExist(PackageName);
	if (bOnDisk && !bForce)
	{
		OutMessage = FString::Printf(TEXT("%s is already built; -force rebuilds it"), *PackageName);
		return EResult::AlreadyThere;
	}

	// CreatePackage finds the package if it is already in memory and makes
	// an empty one otherwise; FullyLoad then brings an on-disk asset in, so
	// a forced rebuild edits the existing object rather than constructing a
	// second one over its name.
	UPackage* Package = CreatePackage(*PackageName);
	if (!Package)
	{
		OutMessage = FString::Printf(TEXT("could not create package %s"), *PackageName);
		return EResult::Failed;
	}
	Package->FullyLoad();

	UObject* Existing = StaticFindObject(UObject::StaticClass(), Package, *AssetName);
	if (Existing && !Existing->IsA<UMaterial>())
	{
		OutMessage = FString::Printf(TEXT("%s holds a %s, not a material — delete it and build again"),
			*PackageName, *Existing->GetClass()->GetName());
		return EResult::Failed;
	}

	UMaterial* Material = Cast<UMaterial>(Existing);
	const bool bNew = Material == nullptr;
	if (bNew)
	{
		Material = NewObject<UMaterial>(Package, FName(*AssetName), RF_Public | RF_Standalone | RF_Transactional);
		if (!Material)
		{
			OutMessage = FString::Printf(TEXT("could not create %s"), *AssetName);
			return EResult::Failed;
		}
	}
	else
	{
		UMaterialEditingLibrary::DeleteAllMaterialExpressions(Material);
	}

	FString Why;
	if (!BuildGraph(Material, Why))
	{
		OutMessage = FString::Printf(TEXT("%s: %s"), *PackageName, *Why);
		return EResult::Failed;
	}

	// Compiles the shaders for this machine's platform (asynchronously) and
	// marks the package dirty. The cook compiles its own.
	UMaterialEditingLibrary::RecompileMaterial(Material);
	if (bNew)
	{
		FAssetRegistryModule::AssetCreated(Material);
	}
	Package->MarkPackageDirty();

	const FString FileName =
		FPackageName::LongPackageNameToFilename(PackageName, FPackageName::GetAssetPackageExtension());
	// Content/GRN/Generated does not exist on a fresh clone — Content/ is
	// not in the repository at all.
	IFileManager::Get().MakeDirectory(*FPaths::GetPath(FileName), /*Tree=*/true);

	FSavePackageArgs Args;
	Args.TopLevelFlags = RF_Public | RF_Standalone;
	Args.SaveFlags = SAVE_NoError;
	if (!UPackage::SavePackage(Package, Material, *FileName, Args))
	{
		OutMessage = FString::Printf(TEXT("built %s but could not save it to %s"), *PackageName, *FileName);
		return EResult::Failed;
	}

	OutMessage = FString::Printf(TEXT("%s %s (%s)"), bNew ? TEXT("built") : TEXT("rebuilt"), *PackageName, *FileName);
	UE_LOG(LogGRNPaintBuilder, Log, TEXT("%s"), *OutMessage);
	return EResult::Built;
}
