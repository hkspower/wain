#include "GRNRival.h"
#include "GRNTrack.h"
#include "GRNVehiclePawn.h"

AGRNRival::AGRNRival()
{
	PrimaryActorTick.bCanEverTick = true;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
}

void AGRNRival::Init(AGRNTrack* InTrack, AGRNVehiclePawn* InPlayer, int32 RivalIndex)
{
	Track = InTrack;
	Player = InPlayer;
	DefIndex = FMath::Clamp(RivalIndex, 0, GRNRivalCount - 1);
	State = EGRNRivalState::Cruise;
	Sp = 100.f;
	S = Track->Wrap(Player->S + GRN_M(260.f));
	Lat = GRNLanes[2];
	TargetLat = GRNLanes[2];
}

void AGRNRival::Tick(float Dt)
{
	Super::Tick(Dt);
	if (!Track || !Player) return;
	Dt = FMath::Min(Dt, 0.05f);

	const FGRNRivalDef& Def = GRNRivals[DefIndex];
	const float Top = Def.TopSpeedKmh / 3.6f;
	const float GapM = Track->DeltaAhead(Player->S, S) / 100.f;

	float TargetSpeed;
	if (State == EGRNRivalState::Cruise)
	{
		// Hang around the player so the chase never gets dull
		TargetSpeed = GapM > 350.f ? 18.f : GapM > 120.f ? 26.f : 33.f;
	}
	else if (State == EGRNRivalState::Battle)
	{
		if (GapM > 0.f)
		{
			// Leading: let the player claw back unless they're slow
			TargetSpeed = Top * (GapM > 120.f ? 0.86f : 0.97f);
		}
		else
		{
			// Chasing — capped below the player's ceiling so a clean
			// driver can hold a lead against every rival, boss included
			TargetSpeed = FMath::Min(Top * 1.05f, 90.f);
		}
	}
	else
	{
		TargetSpeed = FMath::Max(0.f, SpeedMs - 8.f * Dt);
		TargetLat = GRNRoadHalfWidth - GRN_M(1.4f);
	}

	SpeedMs += FMath::Clamp(TargetSpeed - SpeedMs, -22.f * Dt, 13.f * Dt);
	Lat += (TargetLat - Lat) * FMath::Min(1.f, Dt * 2.f);
	S = Track->Wrap(S + GRN_M(SpeedMs) * Dt);

	FVector Pos; FRotator Rot;
	Track->Pose(S, Lat, Pos, Rot);
	SetActorLocationAndRotation(Pos, Rot);
}
