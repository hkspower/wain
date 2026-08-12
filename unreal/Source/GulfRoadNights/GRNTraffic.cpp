#include "GRNTraffic.h"
#include "GRNTrack.h"
#include "GRNTypes.h"
#include "GRNVehiclePawn.h"

static const FLinearColor GTrafficColors[] = {
	FLinearColor(0.55f, 0.56f, 0.6f), FLinearColor(0.08f, 0.09f, 0.1f),
	FLinearColor(0.7f, 0.68f, 0.62f), FLinearColor(0.25f, 0.3f, 0.42f),
};

AGRNTraffic::AGRNTraffic()
{
	PrimaryActorTick.bCanEverTick = true;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
}

void AGRNTraffic::Init(AGRNTrack* InTrack, AGRNVehiclePawn* InPlayer, int32 Seed)
{
	Track = InTrack;
	Player = InPlayer;
	FRandomStream Rand(Seed * 7919 + 13);
	S = Track->Wrap(Rand.FRandRange(0.f, Track->LapLength()));
	Lat = GRNLanes[Rand.RandRange(0, 3)];
	SpeedMs = Rand.FRandRange(18.f, 27.f);
	Rig = GRNCarFactory::Build(this, RootComponent, EGRNBodyStyle::Sedan,
		GTrafficColors[Seed % UE_ARRAY_COUNT(GTrafficColors)], false);
	// Civilian cars don't need their own beams lighting the scene
	if (Rig.Headlight) Rig.Headlight->SetIntensity(4000.f);
}

void AGRNTraffic::Tick(float Dt)
{
	Super::Tick(Dt);
	if (!Track || !Player) return;

	S = Track->Wrap(S + GRN_M(SpeedMs) * Dt);

	// Fell far behind the action? Respawn well ahead, fresh lane.
	const float GapM = Track->DeltaAhead(Player->S, S) / 100.f;
	if (GapM < -400.f)
	{
		S = Track->Wrap(Player->S + GRN_M(FMath::FRandRange(300.f, 600.f)));
		Lat = GRNLanes[FMath::RandRange(0, 3)];
	}

	FVector Pos; FRotator Rot;
	Track->Pose(S, Lat, Pos, Rot);
	SetActorLocationAndRotation(Pos, Rot);
	GRNCarFactory::SpinWheels(Rig, SpeedMs, Dt);
}
