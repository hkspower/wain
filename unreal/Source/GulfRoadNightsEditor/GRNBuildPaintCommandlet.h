#pragma once

// Builds the car paint headlessly — for CI, or before a cook on a machine
// where nobody will open the editor:
//
//   UnrealEditor-Cmd GulfRoadNights.uproject -run=GRNBuildPaint
//   UnrealEditor-Cmd GulfRoadNights.uproject -run=GRNBuildPaint -force
//
// -force rebuilds an asset that is already there, in place. Exits 0 when
// the asset is built or already present and 1 when it is not — with
// Substrate off as much as on an error, because a pipeline that asked for
// the paint and did not get it should stop rather than cook a build that
// quietly draws the fallback.

#include "CoreMinimal.h"
#include "Commandlets/Commandlet.h"
#include "GRNBuildPaintCommandlet.generated.h"

UCLASS()
class UGRNBuildPaintCommandlet : public UCommandlet
{
	GENERATED_BODY()

public:
	UGRNBuildPaintCommandlet();

	virtual int32 Main(const FString& Params) override;
};
