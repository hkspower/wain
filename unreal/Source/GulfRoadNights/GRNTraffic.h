#pragma once

// Civilian traffic drifting along the corniche at night — obstacles in a
// battle, atmosphere the rest of the time. Same behaviour as the web
// build: steady lane cruising, respawned ahead when the player laps them
// far behind.

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "GRNCarFactory.h"
#include "GRNTraffic.generated.h"

class AGRNTrack;
class AGRNVehiclePawn;

UCLASS()
class AGRNTraffic : public AActor
{
	GENERATED_BODY()

public:
	AGRNTraffic();
	virtual void Tick(float Dt) override;

	void Init(AGRNTrack* InTrack, AGRNVehiclePawn* InPlayer, int32 Seed);

	UPROPERTY() AGRNTrack* Track = nullptr;
	UPROPERTY() AGRNVehiclePawn* Player = nullptr;

	float S = 0.f;
	float Lat = 0.f;
	float SpeedMs = 22.f;
	FGRNCarRig Rig;
};
