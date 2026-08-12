#pragma once

#include "CoreMinimal.h"
#include "GameFramework/SaveGame.h"
#include "GRNSaveGame.generated.h"

/** Career progress — the UE twin of the web build's localStorage keys. */
UCLASS()
class UGRNSaveGame : public USaveGame
{
	GENERATED_BODY()

public:
	UPROPERTY() int32 RivalIndex = 0;
	UPROPERTY() int32 Kd = 2500;
	UPROPERTY() int32 Xp = 0;
	UPROPERTY() TArray<FString> OwnedParts;
	UPROPERTY() FString CurrentCar = TEXT("wain-special");
};
