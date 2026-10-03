#include "GRNPaintEditorSubsystem.h"
#include "GRNPaintBuilder.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "AssetRegistry/IAssetRegistry.h"
#include "CoreGlobals.h"
#include "Modules/ModuleManager.h"

DEFINE_LOG_CATEGORY_STATIC(LogGRNPaintEditor, Log, All);

void UGRNPaintEditorSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	if (IsRunningCommandlet())
	{
		return;
	}

	IAssetRegistry& Registry =
		FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry")).Get();
	if (Registry.IsLoadingAssets())
	{
		FilesLoadedHandle = Registry.OnFilesLoaded().AddUObject(this, &UGRNPaintEditorSubsystem::BuildIfMissing);
	}
	else
	{
		BuildIfMissing();
	}
}

void UGRNPaintEditorSubsystem::Deinitialize()
{
	if (FilesLoadedHandle.IsValid() && FModuleManager::Get().IsModuleLoaded(TEXT("AssetRegistry")))
	{
		FModuleManager::GetModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry")).Get()
			.OnFilesLoaded().Remove(FilesLoadedHandle);
	}
	FilesLoadedHandle.Reset();
	Super::Deinitialize();
}

void UGRNPaintEditorSubsystem::BuildIfMissing()
{
	FString Message;
	const GRNPaintBuilder::EResult Result = GRNPaintBuilder::Build(/*bForce=*/false, Message);
	switch (Result)
	{
	case GRNPaintBuilder::EResult::Built:
		UE_LOG(LogGRNPaintEditor, Display, TEXT("car paint: %s"), *Message);
		break;
	case GRNPaintBuilder::EResult::AlreadyThere:
		// The normal case on every launch after the first; not worth a line
		// above Verbose.
		UE_LOG(LogGRNPaintEditor, Verbose, TEXT("car paint: %s"), *Message);
		break;
	case GRNPaintBuilder::EResult::SubstrateOff:
		// Not a failure: the game falls back to the basic-shape paint and
		// says so itself (GRN.Paint.Status). Said once here, at Display, so
		// the reason is in the editor log too.
		UE_LOG(LogGRNPaintEditor, Display, TEXT("car paint: %s"), *Message);
		break;
	case GRNPaintBuilder::EResult::Failed:
		UE_LOG(LogGRNPaintEditor, Warning,
			TEXT("car paint: %s — the game will draw the basic-shape paint until this is fixed"), *Message);
		break;
	}
}
