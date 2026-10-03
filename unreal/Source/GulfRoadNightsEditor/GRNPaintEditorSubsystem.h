#pragma once

// Builds the car paint the first time the editor opens a project that
// does not have it — so a fresh clone, opened and played, gets the
// Substrate clear coat with nobody having to know a commandlet exists.
//
// Waits for the asset registry's initial scan, because "is the asset
// there" asked before the scan is a question about an empty index, and
// the answer would be to build over an asset that was there all along.
//
// Does nothing in a commandlet. -run=GRNBuildPaint builds explicitly, and
// any OTHER commandlet — above all a cook — must not write assets into
// Content/ behind its own back; that is how a cook and a build of the
// same package race each other.

#include "CoreMinimal.h"
#include "EditorSubsystem.h"
#include "GRNPaintEditorSubsystem.generated.h"

UCLASS()
class UGRNPaintEditorSubsystem : public UEditorSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

private:
	void BuildIfMissing();

	FDelegateHandle FilesLoadedHandle;
};
