#include "GRNRival.h"
#include "GRNTrack.h"
#include "GRNVehiclePawn.h"
#include "GRNCarFactory.h"
#include "GRNApi.h"

AGRNRival::AGRNRival()
{
	PrimaryActorTick.bCanEverTick = true;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
}

void AGRNRival::Init(AGRNTrack* InTrack, AGRNVehiclePawn* InPlayer, int32 RivalIndex)
{
	Track = InTrack;
	Player = InPlayer;
	DefIndex = FMath::Clamp(RivalIndex, 0, (Api ? Api->NumRivals() : GRNRivalCount) - 1);
	State = EGRNRivalState::Cruise;
	Sp = 100.f;
	S = Track->Wrap(Player->S + GRN_M(260.f));
	Lat = GRNLanes[2];
	TargetLat = GRNLanes[2];

	if (Api)
	{
		const FGRNRuntimeRival R = Api->GetRival(DefIndex);
		Rig = GRNCarFactory::Build(this, RootComponent, R.Style,
			FLinearColor(R.BodyColor), /*bWing=*/R.Style == EGRNBodyStyle::GTR);
	}
	else
	{
		const FGRNRivalDef& Def = GRNRivals[DefIndex];
		Rig = GRNCarFactory::Build(this, RootComponent, Def.Style,
			FLinearColor(Def.BodyColor), /*bWing=*/Def.Style == EGRNBodyStyle::GTR);
	}

	// A legend at the wheel, not an empty car pulling alongside you.
	Driver = GRNDriverRig::Build(this, RootComponent,
		FVector(GRN_M(0.08f), GRN_M(0.38f), GRN_M(0.42f)));
}

FString AGRNRival::DisplayName() const
{
	return Api ? Api->GetRival(DefIndex).Name : FString(GRNRivals[DefIndex].Name);
}

FString AGRNRival::CrewName() const
{
	return Api ? Api->GetRival(DefIndex).Crew : FString(GRNRivals[DefIndex].Crew);
}

float AGRNRival::TopSpeedKmh() const
{
	return Api ? Api->GetRival(DefIndex).TopSpeedKmh : GRNRivals[DefIndex].TopSpeedKmh;
}

void AGRNRival::Tick(float Dt)
{
	Super::Tick(Dt);
	if (!Track || !Player) return;
	Dt = FMath::Min(Dt, 0.05f);

	const float Top = TopSpeedKmh() / 3.6f;
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

	const float PrevSpeed = SpeedMs;
	SpeedMs += FMath::Clamp(TargetSpeed - SpeedMs, -22.f * Dt, 13.f * Dt);
	Lat += (TargetLat - Lat) * FMath::Min(1.f, Dt * 2.f);
	S = Track->Wrap(S + GRN_M(SpeedMs) * Dt);

	FVector Pos; FRotator Rot;
	Track->Pose(S, Lat, Pos, Rot);
	SetActorLocationAndRotation(Pos, Rot);
	GRNCarFactory::SpinWheels(Rig, SpeedMs, Dt);
	UpdateDriver(Dt > 0.f ? (SpeedMs - PrevSpeed) / Dt : 0.f, Dt);
}

void AGRNRival::UpdateDriver(float AccelMs2, float Dt)
{
	if (!Driver.IsValid() || !Track) return;

	// Steer follows the lane change still to be taken; the feet follow
	// the speed change. Both smoothed, or the driver twitches.
	const float SteerWant =
		FMath::Clamp(((TargetLat - Lat) / 100.f) * GRNRig::RivalSteerPerLat, -1.f, 1.f);
	SteerVis += (SteerWant - SteerVis) * FMath::Min(1.f, Dt * GRNRig::RivalSteerRate);
	const float WantThrottle = AccelMs2 > GRNRig::RivalThrottleAccel
		? FMath::Min(1.f, AccelMs2 / GRNRig::RivalThrottleScale)
		: (SpeedMs > 1.f ? GRNRig::RivalCruiseThrottle : 0.f);
	const float WantBrake = AccelMs2 < GRNRig::RivalBrakeAccel
		? FMath::Min(1.f, -AccelMs2 / GRNRig::RivalBrakeScale) : 0.f;
	ThrottleVis += (WantThrottle - ThrottleVis) * FMath::Min(1.f, Dt * GRNRig::RivalPedalRate);
	BrakeVis += (WantBrake - BrakeVis) * FMath::Min(1.f, Dt * GRNRig::RivalPedalRate);

	// Alongside and offset: look over at them. Otherwise, eyes up the road.
	FVector Look;
	const bool bAlongside = Player &&
		FMath::Abs(Track->DeltaAhead(S, Player->S)) < GRN_M(GRNRig::RivalGlanceGapM) &&
		FMath::Abs(Player->Lat - Lat) > GRN_M(GRNRig::RivalGlanceLatM);
	if (bAlongside)
	{
		Look = Player->GetActorLocation() + FVector(0, 0, GRN_M(0.6f));
	}
	else
	{
		FRotator Rot;
		Track->Pose(Track->Wrap(S + GRN_M(GRNRig::DriverLookAheadM)),
			Lat * GRNRig::DriverLookLatK, Look, Rot);
		Look.Z += GRN_M(GRNRig::DriverLookHeight);
	}
	// The rival leans too. Derived from the AI's own kinematics rather
	// than from inputs it does not have: the lateral pull is the visible
	// steering at this speed, and the longitudinal is the pedal it is
	// showing. A car alongside you whose driver sits bolt upright through
	// a corner is the tell that gives away every AI.
	const float GLat = SteerVis * SpeedMs * SpeedMs / 60.f;
	const float GLong = (ThrottleVis * 6.f) - (BrakeVis * 12.f);
	GRNDriverRig::Solve(Driver, SteerVis, ThrottleVis, BrakeVis, Look, Dt, GLat, GLong);
}
