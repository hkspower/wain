#include "GRNVehiclePawn.h"
#include "GRNTrack.h"
#include "GRNGameMode.h"
#include "Camera/CameraComponent.h"
#include "Kismet/GameplayStatics.h"

AGRNVehiclePawn::AGRNVehiclePawn()
{
	PrimaryActorTick.bCanEverTick = true;

	CarRoot = CreateDefaultSubobject<USceneComponent>(TEXT("CarRoot"));
	RootComponent = CarRoot;

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("ChaseCam"));
	Camera->SetupAttachment(CarRoot);
	// Chase framing matches the web build: back and up, looking ahead
	Camera->SetRelativeLocation(FVector(GRN_M(-9.5f), 0.f, GRN_M(3.4f)));
	Camera->SetRelativeRotation(FRotator(-8.f, 0.f, 0.f));
	Camera->FieldOfView = 62.f;

	AutoPossessPlayer = EAutoReceiveInput::Player0;
}

void AGRNVehiclePawn::SetupPlayerInputComponent(UInputComponent* Input)
{
	Super::SetupPlayerInputComponent(Input);
	// Axis + action names live in Config/DefaultInput.ini so keyboard,
	// gamepad sticks and triggers all land here without asset work.
	Input->BindAxis(TEXT("Throttle"), this, &AGRNVehiclePawn::AxisThrottle);
	Input->BindAxis(TEXT("Brake"), this, &AGRNVehiclePawn::AxisBrake);
	Input->BindAxis(TEXT("Steer"), this, &AGRNVehiclePawn::AxisSteer);
	Input->BindAction(TEXT("Drift"), IE_Pressed, this, &AGRNVehiclePawn::DriftPressed);
	Input->BindAction(TEXT("Drift"), IE_Released, this, &AGRNVehiclePawn::DriftReleased);
	Input->BindAction(TEXT("Nos"), IE_Pressed, this, &AGRNVehiclePawn::NosPressed);
	Input->BindAction(TEXT("Nos"), IE_Released, this, &AGRNVehiclePawn::NosReleased);
	Input->BindAction(TEXT("Flash"), IE_Pressed, this, &AGRNVehiclePawn::FlashPressed);
	Input->BindAction(TEXT("Pause"), IE_Pressed, this, &AGRNVehiclePawn::PausePressed);
	Input->BindAction(TEXT("CycleCar"), IE_Pressed, this, &AGRNVehiclePawn::CyclePressed);
}

void AGRNVehiclePawn::AxisSteer(float V)
{
	// Gamepad stick: deadzone + gentle curve so small corrections stay small
	const float Dz = 0.15f;
	if (FMath::Abs(V) < Dz) { InSteer = 0.f; return; }
	const float T = (FMath::Abs(V) - Dz) / (1.f - Dz);
	InSteer = FMath::Sign(V) * FMath::Pow(T, 1.3f);
}

void AGRNVehiclePawn::FlashPressed()
{
	if (AGRNGameMode* GM = Cast<AGRNGameMode>(UGameplayStatics::GetGameMode(this)))
	{
		GM->TryFlash();
	}
}

void AGRNVehiclePawn::PausePressed()
{
	if (AGRNGameMode* GM = Cast<AGRNGameMode>(UGameplayStatics::GetGameMode(this)))
	{
		GM->TogglePause();
	}
}

void AGRNVehiclePawn::CyclePressed()
{
	if (AGRNGameMode* GM = Cast<AGRNGameMode>(UGameplayStatics::GetGameMode(this)))
	{
		GM->CycleCar();
	}
}

void AGRNVehiclePawn::BuildRig(EGRNBodyStyle Style, FLinearColor Paint, bool bWing, bool bAttackKit)
{
	// Tear down the previous machine before the new one goes on
	for (UStaticMeshComponent* W : Rig.Wheels) if (W) W->DestroyComponent();
	TArray<USceneComponent*> Kids;
	CarRoot->GetChildrenComponents(false, Kids);
	for (USceneComponent* K : Kids)
	{
		if (K != Camera) K->DestroyComponent();
	}
	Rig = GRNCarFactory::Build(this, CarRoot, Style, Paint, bWing, bAttackKit);
}

void AGRNVehiclePawn::Tick(float Dt)
{
	Super::Tick(Dt);
	if (!Track) return;
	Dt = FMath::Min(Dt, 0.05f);
	UpdateHandling(Dt);
	UpdateCamera(Dt);
	// Lit-up rears visibly overspin the road speed — the launch tell
	GRNCarFactory::SpinWheels(Rig, SpeedMs + Wheelspin * 0.8f, Dt);
	GRNCarFactory::SetBraking(Rig, InBrake > 0.f || bInDrift);
}

void AGRNVehiclePawn::UpdateHandling(float Dt)
{
	using namespace GRNHandling;

	// Turbo spool + NOS, straight from the web model
	if (BoostMult > 0.f)
	{
		const float Target = (InThrottle > 0.5f && SpeedMs > 4.f) ? 1.f : 0.f;
		Boost += (Target - Boost) * FMath::Min(1.f, Dt * 1.5f);
	}
	const bool bNosActive = bHasNos && bInNos && NosCharge > 0.02f && InThrottle > 0.f;
	NosCharge = bNosActive
		? FMath::Max(0.f, NosCharge - Dt / 3.f)
		: FMath::Min(1.f, NosCharge + Dt * 0.06f);

	// Tire model, ported verbatim from the web engine: one grip budget
	// shared by drive, brakes and steering. The engine proposes, the
	// tires dispose — torque beyond the traction cap becomes wheelspin.
	const float DriveGrip = 1.f - FMath::Min(0.55f, FMath::Abs(DriftYaw) * DriftDriveLoss);
	const float Power = PowerMult * (1.f + Boost * BoostMult);
	const float Ceil = Ceiling + TopSpeedBonus;
	const float EngineAccel =
		InThrottle * FMath::Max(0.f, ThrustK * Power * (1.f - SpeedMs / Ceil));
	const float TractionCap =
		GripAccel * (TractionBase + (1.f - TractionBase) * FMath::Min(1.f, SpeedMs / TractionRampSpeed));
	Wheelspin = FMath::Max(0.f, EngineAccel - TractionCap) * DriveGrip;
	const float Accel =
		FMath::Min(EngineAccel, TractionCap) * DriveGrip + (bNosActive ? 14.f : 0.f);

	// Brakes are grip-limited, not pad-limited; friction circle half one:
	// steering hard leaves less for braking (trail-braking works, both
	// pedals mid-corner doesn't).
	const float BrakeCap = GripAccel * BrakeGripK + BrakeForce * BrakePadK;
	const float LatDemand = FMath::Min(1.f, FMath::Abs(SteerSmooth) * SpeedMs / LatDemandSpeed);
	const float Braking =
		FMath::Min(InBrake * BrakeForce, BrakeCap) *
		FMath::Sqrt(1.f - TrailBrakeK * LatDemand * LatDemand);
	const float Drag = (DragA * SpeedMs * SpeedMs + DragB) * (InThrottle > 0.f ? 0.35f : 1.f);
	SpeedMs = FMath::Max(0.f, SpeedMs + (Accel - Braking - Drag) * Dt);

	// Grip steering: yaw authority shrinks with speed — and friction
	// circle half two: heavy braking or a lit-up rear axle blunts turn-in
	SteerSmooth += (InSteer - SteerSmooth) * FMath::Min(1.f, Dt * SteerSmoothRate);
	const float LongDemand = FMath::Min(1.f, (Braking + Wheelspin) / FMath::Max(BrakeCap, 1.f));
	const float YawRateMax =
		FMath::Min(1.6f, GripAccel / FMath::Max(SpeedMs, 2.f)) * (1.f - UndersteerK * LongDemand);
	Heading += SteerSmooth * YawRateMax * Dt;
	// Cornering near the limit scrubs speed
	SpeedMs *= 1.f - FMath::Abs(Heading) * FMath::Min(1.f, SpeedMs / CornerScrubSpeed) * CornerScrubK * Dt;
	if (FMath::Abs(InSteer) < 0.1f)
	{
		Heading -= Heading * FMath::Min(1.f, Dt * CasterRate);
	}
	Heading = FMath::Clamp(Heading, -HeadingClamp, HeadingClamp);

	// Drift: the handbrake breaks the rear loose — and power-over hangs
	// the tail out with throttle alone when the rears are lit
	const bool bPowerOver =
		Wheelspin > PowerOverSpin &&
		FMath::Abs(SteerSmooth) > PowerOverSteer &&
		SpeedMs > PowerOverMinSpeed &&
		InThrottle > PowerOverThrottle;
	if ((bInDrift || bPowerOver) && SpeedMs > DriftMinSpeed)
	{
		const float SteerDir = FMath::Abs(SteerSmooth) > 0.12f
			? FMath::Sign(SteerSmooth)
			: FMath::Sign(DriftYaw);
		if (SteerDir != 0.f)
		{
			// Power-over reaches shallower angles than a handbrake entry
			const float Cap = (DriftAngleBase + DriftAngleSpeedK * FMath::Min(1.f, SpeedMs / 55.f)) *
				(bInDrift ? 1.f : PowerOverAngleK);
			const float Target = SteerDir * Cap * FMath::Min(1.f, FMath::Abs(SteerSmooth) + 0.45f);
			DriftYaw += (Target - DriftYaw) * FMath::Min(1.f, Dt * DriftEngageRate);
		}
		SpeedMs *= 1.f - (0.05f + FMath::Abs(DriftYaw) * 0.24f) * (1.f - InThrottle * 0.55f) * Dt;
	}
	else if (DriftYaw != 0.f)
	{
		const float Counter = (FMath::Sign(SteerSmooth) == -FMath::Sign(DriftYaw))
			? FMath::Abs(SteerSmooth) : 0.f;
		DriftYaw -= DriftYaw * FMath::Min(1.f, Dt * (DriftRecoverRate + Counter * 3.2f));
		if (FMath::Abs(DriftYaw) < 0.005f) DriftYaw = 0.f;
	}
	DriftYaw = FMath::Clamp(DriftYaw, -DriftYawClamp, DriftYawClamp);

	// Style points: angle × speed, banked by the game mode
	const float Deg = FMath::RadiansToDegrees(FMath::Abs(DriftYaw));
	if (Deg > 8.f && SpeedMs > 12.f)
	{
		DriftRun += Deg * (SpeedMs * 3.6f / 100.f) * 3.2f * Dt;
	}

	// Lateral: sideways tires scrub translation while the body hangs out,
	// plus any rebound still carrying the car off a barrier
	const float Scrub = 1.f - DriftLatScrub * FMath::Min(1.f, FMath::Abs(DriftYaw) / 0.5f);
	const float LatVelMs = FMath::Sin(Heading) * SpeedMs * Scrub + ReboundVel;
	Lat += GRN_M(LatVelMs) * Dt;
	ReboundVel -= ReboundVel * FMath::Min(1.f, Dt * 2.5f);
	ScrapeCooldown = FMath::Max(0.f, ScrapeCooldown - Dt);

	const float MaxLat = GRNRoadHalfWidth - GRN_M(1.1f);
	if (FMath::Abs(Lat) > MaxLat)
	{
		// Severity is the speed component INTO the barrier: a shallow rub
		// grinds the door, a steep arrival is a crash that deflects the
		// nose, sheds real speed once, and bounces the car back off.
		const float Side = Lat >= 0.f ? 1.f : -1.f;
		const float IntoWall = FMath::Max(0.f, LatVelMs * Side);
		const float Severity = FMath::Min(1.f, IntoWall / CrashLatFull);
		Lat = FMath::Clamp(Lat, -MaxLat, MaxLat);
		SpeedMs *= 1.f - (0.35f + 1.3f * Severity) * Dt; // sustained rubbing
		if (FMath::Sign(Heading) == Side)
		{
			Heading *= -(0.1f + 0.3f * Severity); // the barrier turns the nose away
		}
		DriftYaw *= 0.25f;
		DriftRun = 0.f; // the wall takes the style points
		if (ScrapeCooldown <= 0.f)
		{
			ScrapeCooldown = 0.5f;
			SpeedMs *= 1.f - CrashSpeedLossK * Severity;   // the impact itself, once
			ReboundVel = -Side * (1.2f + CrashReboundK * Severity);
		}
	}

	S = Track->Wrap(S + GRN_M(SpeedMs) * Dt);

	// Pose: the mesh yaws with heading + drift, body language included
	FVector Pos; FRotator Rot;
	Track->Pose(S, Lat, Pos, Rot);
	Rot.Yaw += FMath::RadiansToDegrees(Heading * 0.85f + DriftYaw);
	SetActorLocation(Pos);
	CarRoot->SetWorldRotation(Rot);
}

void AGRNVehiclePawn::UpdateCamera(float Dt)
{
	// The camera stays road-aligned (not drift-aligned) so a slide reads
	// as the car rotating under you — the TXR feel.
	FVector Pos; FRotator RoadRot;
	Track->Pose(S, Lat, Pos, RoadRot);
	const FRotator CamRot = RoadRot;
	Camera->SetWorldRotation(FMath::RInterpTo(Camera->GetComponentRotation(),
		CamRot + FRotator(-8.f, 0.f, FMath::RadiansToDegrees(DriftYaw) * 0.1f), Dt, 5.5f));

	// FOV stretches with speed, exactly like the web build
	const float TargetFov = 62.f + (SpeedMs / 92.f) * 18.f;
	FovCurrent += (TargetFov - FovCurrent) * FMath::Min(1.f, Dt * 3.f);
	Camera->SetFieldOfView(FovCurrent);
}
