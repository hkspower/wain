#pragma once

// Canvas-drawn HUD: digital speed, the twin SP bars, drift readout and
// the message toast — everything the web HUD shows, without a single
// UMG asset so the project compiles from source alone. Rebuild it in
// UMG when the art pass starts; the game state it reads stays the same.

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "GRNHud.generated.h"

UCLASS()
class AGRNHud : public AHUD
{
	GENERATED_BODY()

public:
	virtual void DrawHUD() override;

private:
	void DrawBar(float X, float Y, float W, float H, float Frac, FLinearColor Fill);
};
