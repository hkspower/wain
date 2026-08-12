#pragma once

// A street legend cruising the corniche. Same three-state AI as the web
// build: cruise near the player so the chase never goes dull, race hard
// in a battle (capped so a clean driver can always hold a lead), pull
// over when beaten.

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "GRNTypes.h"
#include "GRNCarFactory.h"
#include "GRNRival.generated.h"

class AGRNTrack;
class AGRNVehiclePawn;

UENUM()
enum class EGRNRivalState : uint8 { Cruise, Battle, Defeated };

UCLASS()
class AGRNRival : public AActor
{
	GENERATED_BODY()

public:
	AGRNRival();
	virtual void Tick(float Dt) override;

	void Init(AGRNTrack* InTrack, AGRNVehiclePawn* InPlayer, int32 RivalIndex);

	UPROPERTY() AGRNTrack* Track = nullptr;
	UPROPERTY() AGRNVehiclePawn* Player = nullptr;
	/** Set by the game mode before Init; live tables when available. */
	UPROPERTY() class UGRNApiSubsystem* Api = nullptr;

	/** Name/crew for the HUD, from live data or the baked roster. */
	FString DisplayName() const;
	FString CrewName() const;
	float TopSpeedKmh() const;

	int32 DefIndex = 0;
	EGRNRivalState State = EGRNRivalState::Cruise;
	float S = 0.f;
	float Lat = 0.f;
	float TargetLat = 0.f;
	float SpeedMs = 0.f;
	float Sp = 100.f;
	FGRNCarRig Rig;
};
