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
	// Right-hand drive, seated behind the wheel. Rebuilt with the car:
	// the teardown above takes the old driver with the old bodywork.
	Driver = GRNDriverRig::Build(this, CarRoot, FVector(GRN_M(0.08f), GRN_M(0.38f), GRN_M(0.42f)));
}

void AGRNVehiclePawn::Tick(float Dt)
{
	Super::Tick(Dt);
	if (!Track) return;

	// The simulation runs at a FIXED rate and the renderer does not.
	//
	// This used to be one call to UpdateHandling with the frame time,
	// clamped to 50 ms — which makes the physics frame-rate dependent: a
	// 30 fps machine and a 144 fps machine take different paths through
	// the same corner. Survivable in a lot of games and not in this one,
	// because the drift solver has a runaway term past the critical angle
	// and a threshold that turns a slide into a spin, and near either of
	// those a difference in step size is the difference between going
	// round and not.
	//
	// The spiral guard matters as much as the rate. If a frame takes
	// longer than the steps it owes, the accumulator asks for more steps
	// next frame, which takes longer still: a hitch becomes a stall.
	// Dropping the backlog past the cap means the sim runs slow for a
	// moment, which is the right failure — a game that stutters is
	// playable and one that locks up is not.
	Dt = FMath::Min(Dt, GRNSimMaxFrame);
	SimAccum += Dt;
	int32 Steps = 0;
	while (SimAccum >= GRNSimStep && Steps < GRNSimMaxSteps)
	{
		PrevS = CurS; PrevLat = CurLat;
		PrevHeading = CurHeading; PrevDriftYaw = CurDriftYaw;
		StepSim(GRNSimStep);
		CurS = S; CurLat = Lat;
		CurHeading = Heading; CurDriftYaw = DriftYaw;
		if (!bSimStarted)
		{
			bSimStarted = true;
			PrevS = CurS; PrevLat = CurLat;
			PrevHeading = CurHeading; PrevDriftYaw = CurDriftYaw;
		}
		SimAccum -= GRNSimStep;
		Steps++;
	}
	if (Steps >= GRNSimMaxSteps) SimAccum = 0.f; // the spiral guard

	SimAlpha = FMath::Clamp(SimAccum / GRNSimStep, 0.f, 1.f);
	ApplyRenderPose();

	UpdateCamera(Dt);
	// Lit-up rears visibly overspin the road speed — the launch tell.
	// On the FRAME, not the step: a wheel's angle is a picture, not a
	// state anything reads back.
	GRNCarFactory::SpinWheels(Rig, SpeedMs + Wheelspin * 0.8f, Dt);
	GRNCarFactory::SetBraking(Rig, InBrake > 0.f || bInDrift || LastBrake.Lock > 0.2);
	UpdateDriver(Dt);
}

void AGRNVehiclePawn::ApplyRenderPose()
{
	// Between the last two fixed steps. Without this the car visibly
	// stutters whenever the frame rate is not a multiple of the sim rate,
	// which is nearly always: at 60 fps against a 120 Hz sim some frames
	// advance two steps and some one, and the eye reads that as judder
	// however smooth the underlying motion is.
	//
	// The interpolants are the four things that place the car. S wraps,
	// so it is interpolated along the SHORT way round — lerping 8,490 to
	// 3 the long way sends the car backwards down the whole lap for one
	// frame at the line.
	const float A = SimAlpha;
	const float DS = Track->DeltaAhead(PrevS, CurS);
	const float ShowS = Track->Wrap(PrevS + DS * A);
	const float ShowLat = FMath::Lerp(PrevLat, CurLat, A);
	const float ShowHeading = FMath::Lerp(PrevHeading, CurHeading, A);
	const float ShowDrift = FMath::Lerp(PrevDriftYaw, CurDriftYaw, A);

	FVector Pos; FRotator Rot;
	Track->Pose(ShowS, ShowLat, Pos, Rot);
	Rot.Yaw += FMath::RadiansToDegrees(ShowHeading * 0.85f + ShowDrift);
	SetActorLocation(Pos);
	CarRoot->SetWorldRotation(Rot);
}

void AGRNVehiclePawn::StepSim(float Dt)
{
	UpdateHandling(Dt);
}

void AGRNVehiclePawn::UpdateDriver(float Dt)
{
	if (!Driver.IsValid() || !Track) return;
	// Eyes up: look where the car is going, not where it is pointing.
	FVector Pos; FRotator Rot;
	Track->Pose(Track->Wrap(S + GRN_M(GRNRig::DriverLookAheadM)),
		Lat * GRNRig::DriverLookLatK, Pos, Rot);
	Pos.Z += GRN_M(GRNRig::DriverLookHeight);
	// What the car is pulling, in m/s²: sideways from the yaw rate at
	// speed, along from the load solver's own lagged figure. The driver
	// is a mass in a seat and this is what moves them.
	const float GLat = Heading * SpeedMs * SpeedMs / 40.f;
	const float GLong = (float)LastLoad.PitchG * 9.81f;
	GRNDriverRig::Solve(Driver, SteerSmooth, InThrottle, InBrake, Pos, Dt, GLat, GLong);
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

	// The game's logic is GRNSim.h now, not a copy of it.
	//
	// What used to be here was a simplified transcription of the web
	// model, written before drift.ts, brakes.ts and grip.ts existed: no
	// brake lock, no ABS, no fade, no momentum spin, no counter-steer, no
	// chain, no feint, no lift-off, no load transfer, no downforce. Every
	// constant matched and none of the behaviour did, which is exactly
	// what src/game/handling.ts warned about in a comment nobody could
	// act on. tests/parity.mjs now drives both builds through the same
	// eight thousand steps and compares fourteen state variables.

	// Grip as it is at this speed: the tyres, plus whatever the bodywork
	// is pressing them into the road with. A wing is a v² term.
	const float Grip = (float)GRNSim::GripAtSpeed(GripAccel, Downforce, SpeedMs);

	// Where the weight is. Solved from LAST step's longitudinal
	// acceleration, which is the physically correct order — load lags the
	// pedal by however long the springs take to compress.
	const float DriveGrip = 1.f - FMath::Min(0.55f, FMath::Abs(DriftYaw) * DriftDriveLoss);
	const float Power = PowerMult * (1.f + Boost * BoostMult);
	const float LimitMs = TopSpeedKmh / 3.6f;
	const float DragAtLimit = (DragA * LimitMs * LimitMs + DragB) * 0.35f;
	const float Headroom = 1.f - DragAtLimit / (ThrustK * Power);
	const float Ceil = FMath::Max(Ceiling, Headroom > 0.08f ? LimitMs / Headroom : LimitMs * 12.f);
	const float EngineAccel =
		InThrottle * FMath::Max(0.f, ThrustK * Power * (1.f - SpeedMs / Ceil));
	const float TractionCap =
		Grip * (TractionBase + (1.f - TractionBase) * FMath::Min(1.f, SpeedMs / TractionRampSpeed)) *
		(float)LastLoad.DriveScale;
	Wheelspin = FMath::Max(0.f, EngineAccel - TractionCap) * DriveGrip;
	const float Accel = FMath::Min(EngineAccel, TractionCap) * DriveGrip + (bNosActive ? 14.f : 0.f);

	// Brakes: lock, ABS, fade, and the rotation a light rear gives up.
	SteerSmooth += (InSteer - SteerSmooth) * FMath::Min(1.f, Dt * SteerSmoothRate);
	const float LatDemand = FMath::Min(1.f, FMath::Abs(SteerSmooth) * SpeedMs / LatDemandSpeed);
	GRNSim::FBrakeTune BTune;
	BTune.GripAccel = GripAccel;
	BTune.BrakeForce = BrakeForce;
	BTune.BrakeThermalMult = BrakeThermalMult;
	BTune.bHasAbs = bHasAbs;
	LastBrake = GRNSim::SolveBrakes(BrakeState, BTune, Dt, InBrake, SpeedMs,
		LatDemand, SteerSmooth, InThrottle, Grip);
	const float Braking = (float)LastBrake.Decel;

	const float Drag = (DragA * SpeedMs * SpeedMs + DragB) * (InThrottle > 0.f ? 0.35f : 1.f);
	const float ALong = Accel - Braking - Drag;
	SpeedMs = FMath::Max(0.f, SpeedMs + ALong * Dt);
	if (SpeedMs > LimitMs) SpeedMs = LimitMs; // the governor cuts fuel

	// Yaw authority: grip-limited, shrinking with speed, and scaled by
	// how much weight is on the FRONT axle — dive under braking loads the
	// nose and the car turns in, squat under power unloads it and it
	// pushes wide. Locked fronts do not steer at all.
	const float LongDemand =
		FMath::Min(1.f, (Braking + Wheelspin) / FMath::Max((float)GRNSim::BrakeCeiling(BTune, LatDemand, Grip), 1.f));
	const float YawRateMax =
		FMath::Min(1.6f, Grip / FMath::Max(SpeedMs, 2.f)) *
		(1.f - UndersteerK * LongDemand) *
		(float)LastLoad.SteerScale *
		(float)LastBrake.SteerScale;
	Heading += SteerSmooth * YawRateMax * Dt;
	// Cornering scrub, on the same friction circle the brakes spend from
	// rather than added on top of it.
	const float LatAvail = FMath::Sqrt(FMath::Max(0.f, 1.f - TrailBrakeK * LongDemand * LongDemand));
	SpeedMs *= 1.f - FMath::Abs(Heading) * FMath::Min(1.f, SpeedMs / CornerScrubSpeed) *
		CornerScrubK * LatAvail * Dt;
	if (FMath::Abs(InSteer) < 0.1f)
	{
		Heading -= Heading * FMath::Min(1.f, Dt * CasterRate);
	}
	Heading = FMath::Clamp(Heading, -HeadingClamp, HeadingClamp);

	// The slide. A balance held on opposite lock, and a spin that is
	// momentum against friction rather than a clock.
	GRNSim::FDriftInput DIn;
	DIn.Dt = Dt;
	DIn.Speed = SpeedMs;
	DIn.Steer = SteerSmooth;
	DIn.Throttle = InThrottle;
	DIn.bHandbrake = bInDrift;
	DIn.Wheelspin = Wheelspin;
	DIn.BrakeRotate = LastBrake.Rotate;
	DIn.RearLight = LastLoad.RearLight;
	DIn.DriftAngleMult = 1.f;
	LastDrift = GRNSim::SolveDrift(DriftState, DIn);
	DriftYaw = (float)LastDrift.Angle;
	SpeedMs *= 1.f - (float)LastDrift.ScrubRate * LatAvail * Dt;
	DriftRun = (float)DriftState.Run;
	// A trail-braked entry rotates the car's LINE as well as its body.
	Heading += (float)LastBrake.Rotate * BrakeRotateK * Dt;

	// And the springs, fed what the car actually did — read back at the
	// top of the next step, which is where load transfer belongs.
	LastLoad = GRNSim::SolveLoad(LoadState, Dt, ALong);

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
		// The wall takes the slide AND the style points, and it has to
		// take them from the solver's own state — writing DriftYaw here
		// and leaving DriftState.Angle alone would have the next step
		// hand the whole angle straight back.
		DriftState.Angle *= 0.25;
		DriftState.SpinT = 0.0;
		DriftState.SpinRate = 0.0;
		GRNSim::BreakChain(DriftState);
		DriftYaw = (float)DriftState.Angle;
		DriftRun = 0.f;
		if (ScrapeCooldown <= 0.f)
		{
			ScrapeCooldown = 0.5f;
			SpeedMs *= 1.f - CrashSpeedLossK * Severity;   // the impact itself, once
			ReboundVel = -Side * (1.2f + CrashReboundK * Severity);
		}
	}

	S = Track->Wrap(S + GRN_M(SpeedMs) * Dt);
	// No pose written here. Where the car IS is a simulation result and
	// where it is DRAWN is a frame's business — see ApplyRenderPose,
	// which places it between the last two fixed steps.
}

void AGRNVehiclePawn::UpdateCamera(float Dt)
{
	// The camera stays road-aligned (not drift-aligned) so a slide reads
	// as the car rotating under you — the TXR feel.
	//
	// Framed on the pose the car is DRAWN at, not the one it was last
	// simulated at: aiming at the newer of the two makes the camera lead
	// the car it is following by up to a whole step, which reads as the
	// car sliding around inside a shot that is not quite on it.
	const float ShowS = Track->Wrap(PrevS + Track->DeltaAhead(PrevS, CurS) * SimAlpha);
	const float ShowLat = FMath::Lerp(PrevLat, CurLat, SimAlpha);
	FVector Pos; FRotator RoadRot;
	Track->Pose(ShowS, ShowLat, Pos, RoadRot);
	const FRotator CamRot = RoadRot;
	Camera->SetWorldRotation(FMath::RInterpTo(Camera->GetComponentRotation(),
		CamRot + FRotator(-8.f, 0.f, FMath::RadiansToDegrees(DriftYaw) * 0.1f), Dt, 5.5f));

	// FOV stretches with speed, exactly like the web build
	const float TargetFov = 62.f + (SpeedMs / 92.f) * 18.f;
	FovCurrent += (TargetFov - FovCurrent) * FMath::Min(1.f, Dt * 3.f);
	Camera->SetFieldOfView(FovCurrent);
}
