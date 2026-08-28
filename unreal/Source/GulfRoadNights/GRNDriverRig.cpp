#include "GRNDriverRig.h"
#include "GRNTypes.h"
#include "Components/SceneComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/Actor.h"

namespace
{
	constexpr float K = 100.f; // metres -> UE units

	UStaticMesh* Cube()
	{
		static UStaticMesh* M = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
		return M;
	}
	UStaticMesh* Cyl()
	{
		static UStaticMesh* M = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
		return M;
	}
	UStaticMesh* Sph()
	{
		static UStaticMesh* M = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere"));
		return M;
	}

	UMaterialInstanceDynamic* Mid(AActor* Owner, FLinearColor Color)
	{
		UMaterialInterface* Base = Cube() ? Cube()->GetMaterial(0) : nullptr;
		if (!Base) return nullptr;
		UMaterialInstanceDynamic* M = UMaterialInstanceDynamic::Create(Base, Owner);
		M->SetVectorParameterValue(TEXT("Color"), Color);
		return M;
	}

	USceneComponent* Joint(AActor* Owner, USceneComponent* Parent, FVector PosUU,
		FRotator Rot = FRotator::ZeroRotator)
	{
		USceneComponent* C = NewObject<USceneComponent>(Owner);
		C->RegisterComponent();
		C->AttachToComponent(Parent, FAttachmentTransformRules::KeepRelativeTransform);
		C->SetRelativeLocation(PosUU);
		C->SetRelativeRotation(Rot);
		return C;
	}

	UStaticMeshComponent* Shape(AActor* Owner, USceneComponent* Parent, UStaticMesh* Mesh,
		FVector PosUU, FVector ScaleM, UMaterialInterface* Mat,
		FRotator Rot = FRotator::ZeroRotator)
	{
		UStaticMeshComponent* C = NewObject<UStaticMeshComponent>(Owner);
		C->SetStaticMesh(Mesh);
		C->RegisterComponent();
		C->AttachToComponent(Parent, FAttachmentTransformRules::KeepRelativeTransform);
		C->SetRelativeLocation(PosUU);
		C->SetRelativeRotation(Rot);
		C->SetRelativeScale3D(ScaleM);
		if (Mat) C->SetMaterial(0, Mat);
		C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		return C;
	}

	/** Build one limb hanging along -Z from Root, with the meshes on it.
	 *  Upper/Lower are metres. */
	FGRNLimb BuildLimb(AActor* Owner, USceneComponent* Parent, FVector RootPosM,
		FRotator RootRot, float Upper, float Lower, float Side,
		float RadiusM, UMaterialInterface* Cloth, UMaterialInterface* Extremity,
		float ExtremityR)
	{
		FGRNLimb L;
		L.Upper = Upper;
		L.Lower = Lower;
		L.Side = Side;
		L.Root = Joint(Owner, Parent, RootPosM * K, RootRot);
		// The engine cylinder is 100 uu tall about its own Z, so a scale
		// of (r, r, length) in metres is the bone directly.
		Shape(Owner, L.Root, Cyl(), FVector(0, 0, -Upper * 0.5f * K),
			FVector(RadiusM * 2.f, RadiusM * 2.f, Upper), Cloth);
		L.Mid = Joint(Owner, L.Root, FVector(0, 0, -Upper * K));
		Shape(Owner, L.Mid, Cyl(), FVector(0, 0, -Lower * 0.5f * K),
			FVector(RadiusM * 1.8f, RadiusM * 1.8f, Lower), Cloth);
		L.End = Joint(Owner, L.Mid, FVector(0, 0, -Lower * K));
		Shape(Owner, L.End, Sph(), FVector::ZeroVector,
			FVector(ExtremityR * 2.f), Extremity);
		return L;
	}
}

// ---------------------------------------------------------------- solver

void GRNIk::SolveTwoBone(USceneComponent* Root, USceneComponent* Mid,
	float Upper, float Lower, const FVector& Target, const FVector& Pole)
{
	if (!Root || !Mid) return;

	const FTransform RootXf = Root->GetComponentTransform();
	const FVector RootPos = RootXf.GetLocation();

	// Bone lengths are authored in the rig's own units while the target
	// is in world space, and this rig hangs under a car carrying a
	// presence scale. Without lifting the lengths the triangle is solved
	// for the wrong arm and the hand lands short, silently.
	const FVector Scale3 = RootXf.GetScale3D();
	const float WorldScale = (Scale3.X + Scale3.Y + Scale3.Z) / 3.f;
	const float A = Upper * K * WorldScale;
	const float B = Lower * K * WorldScale;

	FVector ToTarget = Target - RootPos;
	const float Eps = 0.01f; // UE units
	if (ToTarget.SizeSquared() < Eps * Eps) return;
	// Clamp into the annulus the limb can actually reach: fully extended
	// outside, folded inside. Without this the acos below goes imaginary.
	const float Dist = FMath::Clamp(ToTarget.Size(), FMath::Abs(A - B) + Eps, A + B - Eps);
	ToTarget.Normalize();

	// Elbow: the interior angle from the three sides.
	const float CosElbow = FMath::Clamp((A * A + B * B - Dist * Dist) / (2.f * A * B), -1.f, 1.f);
	const float ElbowBend = PI - FMath::Acos(CosElbow);

	// Shoulder: aim at the target, then swing back by the triangle's
	// shoulder angle so the elbow sits off the straight line.
	const float CosShoulder =
		FMath::Clamp((A * A + Dist * Dist - B * B) / (2.f * A * Dist), -1.f, 1.f);
	const float ShoulderOffset = FMath::Acos(CosShoulder);

	// The pole decides which way the joint breaks: the bend happens in
	// the plane containing the target and the pole hint, and Axis is that
	// plane's normal.
	//
	// Pole CROSS aim, not aim cross pole — the same way round as ik.ts,
	// and for the same reason. The swing below is applied as
	// -ShoulderOffset, and rotating the aim about (aim x pole) by a
	// negative angle carries it AWAY from the hint: the joint broke on
	// the far side of every limb in the game. Both engines had it, because
	// the port is faithful; measured in the web build, a driver asking
	// for elbows "outward and down" got them 236 mm above his shoulders,
	// crossed over the centreline above his head. RotateAngleAxis here
	// turns the same way three's applyAxisAngle does, so the fix is the
	// same fix.
	FVector Axis = FVector::CrossProduct(Pole - RootPos, ToTarget);
	if (Axis.SizeSquared() < KINDA_SMALL_NUMBER)
	{
		Axis = FVector::CrossProduct(ToTarget, FVector::UpVector);
		if (Axis.SizeSquared() < KINDA_SMALL_NUMBER) Axis = FVector::ForwardVector;
	}
	Axis.Normalize();

	// The upper bone's direction: the aim, swung back within that plane.
	const FVector Dir = ToTarget.RotateAngleAxisRad(-ShoulderOffset, Axis).GetSafeNormal();

	// Build the root's rotation as a full basis, not a bare aim. It is
	// not enough to point the bone the right way: the mid joint bends
	// about its own local X, so that axis has to land on the bend plane's
	// normal. Aiming alone leaves it hinging in an arbitrary plane, and
	// the hand misses by half a metre while every step looks correct.
	// Bones hang along -Z here, so local +Z is the bone's back.
	FVector ZAxis = -Dir;
	FVector XAxis = Axis;
	FVector YAxis = FVector::CrossProduct(ZAxis, XAxis).GetSafeNormal();
	XAxis = FVector::CrossProduct(YAxis, ZAxis).GetSafeNormal();
	const FQuat WorldQ = FMatrix(XAxis, YAxis, ZAxis, FVector::ZeroVector).ToQuat();

	// Into the joint's parent space
	FQuat LocalQ = WorldQ;
	if (USceneComponent* Parent = Root->GetAttachParent())
	{
		LocalQ = Parent->GetComponentQuat().Inverse() * WorldQ;
	}
	Root->SetRelativeRotation(LocalQ);

	// With local X on the plane normal the hinge is in the right plane,
	// and the angle from the law of cosines is all that is left.
	Mid->SetRelativeRotation(FQuat(FVector::ForwardVector, ElbowBend));
}

float GRNIk::AimConstrained(USceneComponent* Obj, const FVector& Target,
	float MaxYawRad, float MaxPitchRad, float Ease)
{
	if (!Obj) return 0.f;
	FVector Local = Target - Obj->GetComponentLocation();
	if (USceneComponent* Parent = Obj->GetAttachParent())
	{
		Local = Parent->GetComponentQuat().Inverse().RotateVector(Local);
	}
	if (Local.SizeSquared() < KINDA_SMALL_NUMBER) return 0.f;

	// Forward is +X, up is +Z: yaw about up, pitch off the horizontal.
	const float WantYaw = FMath::Atan2(Local.Y, Local.X);
	const float Flat = FMath::Sqrt(Local.X * Local.X + Local.Y * Local.Y);
	const float WantPitch = FMath::Atan2(Local.Z, Flat);

	const float Yaw = FMath::Clamp(WantYaw, -MaxYawRad, MaxYawRad);
	const float Pitch = FMath::Clamp(WantPitch, -MaxPitchRad, MaxPitchRad);

	const FQuat Wanted = FRotator(FMath::RadiansToDegrees(Pitch),
		FMath::RadiansToDegrees(Yaw), 0.f).Quaternion();
	Obj->SetRelativeRotation(
		FQuat::Slerp(Obj->GetRelativeRotation().Quaternion(), Wanted, FMath::Clamp(Ease, 0.f, 1.f)));

	const float Wanted1 = FMath::Abs(WantYaw);
	return Wanted1 < 1e-4f ? 1.f : FMath::Min(1.f, FMath::Abs(Yaw) / Wanted1);
}

// ------------------------------------------------------------------ build

FGRNDriverRig GRNDriverRig::Build(AActor* Owner, USceneComponent* AttachTo, FVector SeatOffset)
{
	FGRNDriverRig Rig;
	if (!Owner || !AttachTo) return Rig;

	UMaterialInstanceDynamic* Suit = Mid(Owner, FLinearColor(0.06f, 0.07f, 0.09f));
	UMaterialInstanceDynamic* Skin = Mid(Owner, FLinearColor(0.45f, 0.30f, 0.18f));
	UMaterialInstanceDynamic* Dark = Mid(Owner, FLinearColor(0.02f, 0.02f, 0.03f));

	Rig.Root = Joint(Owner, AttachTo, SeatOffset);

	// The lean joint: everything that is PART OF THE PERSON hangs off
	// this, and everything bolted to the CAR does not.
	//
	// That split is the whole reason the IK is worth having. The wheel
	// and the pedals stay on Root because they belong to the car; the
	// torso, head, arms and legs hang off Lean because they belong to a
	// body that is being thrown about by cornering force. Rotate Lean and
	// the hands are still pinned to grips that have not moved, so the
	// arms have to re-solve to stay where they are gripping — which is
	// what an inverse kinematic solver is for, and what this port was
	// missing entirely.
	Rig.Lean = Joint(Owner, Rig.Root, FVector::ZeroVector);

	// Torso, leaned back into the seat the way a driver sits
	Shape(Owner, Rig.Lean, Cyl(), FVector(-0.02f, 0, 0.23f) * K,
		FVector(0.34f, 0.34f, 0.46f), Suit, FRotator(9.f, 0.f, 0.f));

	// Head joint — the aim target for looking into a corner
	Rig.Head = Joint(Owner, Rig.Lean,
		FVector(GRNRig::DriverHeadZ, 0.f, GRNRig::DriverHeadY) * K);
	Shape(Owner, Rig.Head, Sph(), FVector::ZeroVector, FVector(0.224f), Skin);
	Shape(Owner, Rig.Head, Sph(), FVector::ZeroVector, FVector(0.27f), Suit); // helmet

	// Steering wheel, raked toward the driver like a real column. The
	// rake is about the width axis, which is Pitch in UE.
	Rig.Wheel = Joint(Owner, Rig.Root,
		FVector(GRNRig::DriverWheelZ, 0.f, GRNRig::DriverWheelY) * K,
		FRotator(FMath::RadiansToDegrees(GRNRig::DriverWheelRake), 0.f, 0.f));
	Shape(Owner, Rig.Wheel, Cyl(), FVector::ZeroVector,
		FVector(GRNRig::DriverWheelRadius * 2.f, GRNRig::DriverWheelRadius * 2.f, 0.04f),
		Dark, FRotator(90.f, 0.f, 0.f));

	// Arms: shoulder -> elbow -> hand, hanging along -Z.
	for (int32 i = 0; i < 2; i++)
	{
		const float Side = i == 0 ? -1.f : 1.f;
		Rig.Arms.Add(BuildLimb(Owner, Rig.Lean,
			FVector(GRNRig::DriverShoulderZ, Side * GRNRig::DriverShoulderX, GRNRig::DriverShoulderY),
			FRotator::ZeroRotator, GRNRig::DriverUpperArm, GRNRig::DriverForeArm, Side,
			0.048f, Suit, Dark, 0.05f));
	}

	// Pedal box, right-hand drive: throttle outboard, brake inboard.
	auto MakePedal = [&](float XM) -> USceneComponent*
	{
		USceneComponent* P = Joint(Owner, Rig.Root,
			FVector(GRNRig::DriverPedalZ, XM, GRNRig::DriverPedalY) * K,
			FRotator(FMath::RadiansToDegrees(GRNRig::DriverPedalPitch), 0.f, 0.f));
		Shape(Owner, P, Cube(), FVector::ZeroVector, FVector(0.02f, 0.07f, 0.11f), Dark);
		return P;
	};
	Rig.PedalThrottle = MakePedal(GRNRig::DriverPedalThrottleX);
	Rig.PedalBrake = MakePedal(GRNRig::DriverPedalBrakeX);
	Rig.PedalRest = FVector(GRNRig::DriverPedalZ, 0.f, GRNRig::DriverPedalY) * K;

	// The handbrake, between the seats: pivot at the base, lever raked
	// back toward the driver. The one control a hand leaves the wheel
	// for, so the inboard arm has somewhere to go during a slide.
	Rig.Handbrake = Joint(Owner, Rig.Root,
		FVector(GRNRig::DriverHandbrakeZ, GRNRig::DriverHandbrakeX, GRNRig::DriverHandbrakeY) * K);
	Rig.HandbrakeRest = GRNRig::DriverHandbrakeTilt;
	if (Rig.Handbrake)
	{
		Rig.Handbrake->SetRelativeRotation(
			FRotator(FMath::RadiansToDegrees(Rig.HandbrakeRest), 0.f, 0.f));
	}

	// Legs: hip -> knee -> foot, the same chains as the arms. The rest
	// pose reads as seated even before a solver runs, for rigs that are
	// built and never updated.
	for (int32 i = 0; i < 2; i++)
	{
		const float Side = i == 0 ? -1.f : 1.f;
		FGRNLimb Leg = BuildLimb(Owner, Rig.Lean,
			FVector(GRNRig::DriverHipZ, Side * GRNRig::DriverHipX, GRNRig::DriverHipY),
			FRotator(FMath::RadiansToDegrees(-GRNRig::DriverHipPitch), 0.f, 0.f),
			GRNRig::DriverThigh, GRNRig::DriverShin, Side, 0.062f, Suit, Dark, 0.055f);
		if (Leg.Mid)
		{
			Leg.Mid->SetRelativeRotation(
				FRotator(FMath::RadiansToDegrees(-GRNRig::DriverKneePitch), 0.f, 0.f));
		}
		Rig.Legs.Add(Leg);
	}

	return Rig;
}

// ------------------------------------------------------------------ solve

void GRNDriverRig::Solve(FGRNDriverRig& Rig, float Steer, float Throttle, float Brake,
	const FVector& LookTarget, float Dt, float GLat, float GLong, float Handbrake)
{
	if (!Rig.IsValid()) return;

	// The body first, because everything else is solved onto targets and
	// will follow it. Lean away from the cornering force and fold forward
	// under braking — the two things a driver's body does that a parented
	// pose can never show, and the reason the limbs below are worth
	// solving at all: the grips are bolted to the CAR, so a torso that
	// moves forces the arms and legs to re-solve to stay on them.
	{
		const float WantRoll =
			FMath::Clamp(-GLat / 14.f, -1.f, 1.f) * GRNRig::DriverLeanPerG;
		const float WantPitch =
			FMath::Clamp(-GLong / 10.f, -1.f, 1.f) * GRNRig::DriverFoldPerG;
		const float K1 = FMath::Min(1.f, Dt * GRNRig::DriverLeanRate);
		Rig.LeanRoll += (WantRoll - Rig.LeanRoll) * K1;
		Rig.LeanPitch += (WantPitch - Rig.LeanPitch) * K1;
		// Web y-up roll about z maps to UE Roll about x; web fold about x
		// maps to UE Pitch about y. See the axis note at the top.
		Rig.Lean->SetRelativeRotation(FRotator(
			FMath::RadiansToDegrees(Rig.LeanPitch), 0.f,
			FMath::RadiansToDegrees(Rig.LeanRoll)));
	}

	// Lock-to-lock is about a turn and a half each way in a road car.
	const float Lock = Steer * GRNRig::DriverSteerLock;
	Rig.WheelAngle += (-Lock - Rig.WheelAngle) * FMath::Min(1.f, Dt * GRNRig::DriverWheelRate);

	// The lever first, because the hand is solved onto wherever it is.
	Rig.HbBlend += (FMath::Clamp(Handbrake, 0.f, 1.f) - Rig.HbBlend)
		* FMath::Min(1.f, Dt * GRNRig::DriverHandbrakeRate);
	if (Rig.Handbrake)
	{
		// Web rotation.x maps to UE pitch about Y; HandbrakeRest is the
		// build-time rake, captured the way PedalRest is.
		Rig.Handbrake->SetRelativeRotation(FRotator(
			FMath::RadiansToDegrees(Rig.HandbrakeRest - Rig.HbBlend * GRNRig::DriverHandbrakeThrow),
			0.f, 0.f));
	}
	if (Rig.Wheel)
	{
		// The wheel spins about the column, which after the rake is the
		// joint's own forward axis: Roll in UE.
		Rig.Wheel->SetRelativeRotation(FRotator(
			FMath::RadiansToDegrees(GRNRig::DriverWheelRake), 0.f,
			FMath::RadiansToDegrees(Rig.WheelAngle)));
	}

	// Eyes first — the look target may live in a scratch the rest of this
	// routine is about to reuse.
	if (Rig.Head)
	{
		GRNIk::AimConstrained(Rig.Head, LookTarget, GRNRig::DriverNeckYaw,
			GRNRig::DriverNeckPitch, FMath::Min(1.f, Dt * GRNRig::DriverNeckRate));
		// The neck fights the lean. A driver's head stays closer to level
		// than their shoulders do, which is why a helmet cam is watchable
		// — so take a fraction of the body's roll back off the head.
		// After the aim, because the aim sets yaw and pitch and this is
		// roll.
		FRotator HeadRot = Rig.Head->GetRelativeRotation();
		HeadRot.Roll = FMath::RadiansToDegrees(-Rig.LeanRoll * GRNRig::DriverHeadCounter);
		Rig.Head->SetRelativeRotation(HeadRot);
	}

	// Ten-to-two, carried round with the rim. The grips are points fixed
	// in the WHEEL'S OWN frame, so its transform carries them round as it
	// turns; adding the wheel angle to the local angle as well counts the
	// rotation twice and orbits the hands at double the spoke rate.
	for (const FGRNLimb& Arm : Rig.Arms)
	{
		if (!Rig.Wheel) break;
		const float Grip = Arm.Side < 0.f ? GRNRig::DriverGripLeft : GRNRig::DriverGripRight;
		const float R = GRNRig::DriverWheelRadius * K;
		// ...but only to the comfortable arc. Past GripCarryMax the rim
		// slides through the grip: the excess rotation is subtracted back
		// inside the wheel's own frame, so the hand holds station in the
		// cab while the wheel turns under it. Mirrors src/game/driver.ts.
		const float Carried = FMath::Clamp(Rig.WheelAngle,
			-GRNRig::DriverGripCarryMax, GRNRig::DriverGripCarryMax);
		const float Slide = Carried - Rig.WheelAngle;
		// The rim lies in the wheel joint's Y/Z plane (its X is the column).
		const FVector LocalGrip(0.f, FMath::Cos(Grip + Slide) * R, FMath::Sin(Grip + Slide) * R);
		FVector Target = Rig.Wheel->GetComponentTransform().TransformPosition(LocalGrip);

		// The inboard hand answers the handbrake, eased off the rim onto
		// the lever grip. Inboard is read from the lever's own bolted
		// side, so a left-hand-drive rebuild gets the correct hand free.
		const float Inboard = GRNRig::DriverHandbrakeX < 0.f ? -1.f : 1.f;
		if (Rig.Handbrake && Arm.Side == Inboard && Rig.HbBlend > 0.001f)
		{
			const FVector LeverGrip = Rig.Handbrake->GetComponentTransform()
				.TransformPosition(FVector(0.f, 0.f, GRNRig::DriverHandbrakeLen * K));
			Target = FMath::Lerp(Target, LeverGrip, Rig.HbBlend);
		}

		// Elbows break outward and down — the pole is what stops a solved
		// arm bending like a flamingo's knee. Offset in the rig's own
		// frame so the pose holds whichever way the car is heading.
		const FVector Pole = Rig.Root->GetComponentTransform().TransformPosition(
			FVector(GRNRig::DriverArmPoleZ, Arm.Side * GRNRig::DriverArmPoleX,
				GRNRig::DriverArmPoleY) * K);

		GRNIk::SolveTwoBone(Arm.Root, Arm.Mid, Arm.Upper, Arm.Lower, Target, Pole);
	}

	// Feet on the pedals. The pedal sinks with the press and the foot is
	// solved onto the moving face, so a stab of brake reads all the way
	// down the driver's leg.
	for (const FGRNLimb& Leg : Rig.Legs)
	{
		USceneComponent* Pedal = Leg.Side > 0.f ? Rig.PedalThrottle : Rig.PedalBrake;
		if (!Pedal) continue;
		const float Press = FMath::Clamp(Leg.Side > 0.f ? Throttle : Brake, 0.f, 1.f);
		FVector P = Pedal->GetRelativeLocation();
		P.X = Rig.PedalRest.X + Press * GRNRig::DriverPedalTravelZ * K;
		P.Z = Rig.PedalRest.Z - Press * GRNRig::DriverPedalTravelY * K;
		Pedal->SetRelativeLocation(P);

		const FVector Target = Pedal->GetComponentLocation();
		// Knees break up and forward, not sideways into the tunnel
		const FVector Pole = Rig.Root->GetComponentTransform().TransformPosition(
			FVector(GRNRig::DriverLegPoleZ, Leg.Side * GRNRig::DriverLegPoleX,
				GRNRig::DriverLegPoleY) * K);
		GRNIk::SolveTwoBone(Leg.Root, Leg.Mid, Leg.Upper, Leg.Lower, Target, Pole);
	}
}

// --------------------------------------------------------------- watchers

FGRNWatcher GRNDriverRig::BuildWatcher(AActor* Owner, USceneComponent* AttachTo,
	bool bRacer, int32 Index)
{
	FGRNWatcher W;
	if (!Owner || !AttachTo) return W;

	UMaterialInstanceDynamic* Cloth =
		Mid(Owner, bRacer ? FLinearColor(0.5f, 0.09f, 0.08f) : FLinearColor(0.85f, 0.83f, 0.76f));
	UMaterialInstanceDynamic* Skin = Mid(Owner, FLinearColor(0.45f, 0.30f, 0.18f));

	W.Body = AttachTo;
	W.BaseYaw = AttachTo->GetRelativeRotation().Yaw;

	const float ShoulderX = bRacer ? GRNRig::RacerShoulderX : GRNRig::SpectatorShoulderX;
	const float ShoulderY = bRacer ? GRNRig::RacerShoulderY : GRNRig::SpectatorShoulderY;
	const float Upper = bRacer ? GRNRig::RacerUpperArm : GRNRig::SpectatorUpperArm;
	const float Lower = bRacer ? GRNRig::RacerForeArm : GRNRig::SpectatorForeArm;
	const float HeadY = bRacer ? GRNRig::RacerHeadY : GRNRig::SpectatorHeadY;
	// Robe, or a race suit's legs and torso — silhouette only; these are
	// read at twenty metres through a windscreen at night.
	Shape(Owner, AttachTo, Cyl(), FVector(0, 0, 0.65f) * K,
		FVector(bRacer ? 0.36f : 0.5f, bRacer ? 0.36f : 0.5f, 1.3f), Cloth);

	// The head is a joint, not a ball glued on: the crowd turns to watch.
	W.Head = Joint(Owner, AttachTo, FVector(0, 0, HeadY) * K);
	Shape(Owner, W.Head, Sph(), FVector::ZeroVector, FVector(0.23f), Skin);

	for (int32 i = 0; i < 2; i++)
	{
		const float Side = i == 0 ? -1.f : 1.f;
		// Arms hang slightly abducted; a wave returns to exactly this,
		// which is also what keeps the hand clear of the robe.
		const FRotator Rest(0.f, 0.f,
			FMath::RadiansToDegrees(Side * GRNRig::SpectatorArmAbduction));
		FGRNLimb Arm = BuildLimb(Owner, AttachTo,
			FVector(0.f, Side * ShoulderX, ShoulderY), Rest, Upper, Lower, Side,
			0.048f, Cloth, Skin, 0.04f);
		W.Arms.Add(Arm);
		W.ArmRest.Add(Arm.Root ? Arm.Root->GetRelativeRotation().Quaternion() : FQuat::Identity);
		W.ArmRest.Add(Arm.Mid ? Arm.Mid->GetRelativeRotation().Quaternion() : FQuat::Identity);
	}

	// One in every StillEvery never waves — a crowd in lockstep reads as
	// a stadium routine rather than a roadside.
	const int32 Still = FMath::Max(1, (int32)GRNRig::CrowdStillEvery);
	W.WaveSide = (Index % Still == Still - 1) ? 0.f : (Index % 2 == 0 ? 1.f : -1.f);
	W.Phase = Index * 1.9f;
	return W;
}

void GRNDriverRig::SolveWatcher(FGRNWatcher& W, const FVector& Focus, float Time, float Dt)
{
	if (!W.Body || !W.Head) return;

	auto SettleArms = [&]()
	{
		W.Lift = FMath::Max(0.f, W.Lift - Dt * GRNRig::CrowdLiftDownRate);
		const float T = FMath::Min(1.f, Dt * GRNRig::CrowdRestRate);
		for (int32 i = 0; i < W.Arms.Num(); i++)
		{
			if (W.Arms[i].Root)
			{
				W.Arms[i].Root->SetRelativeRotation(FQuat::Slerp(
					W.Arms[i].Root->GetRelativeRotation().Quaternion(), W.ArmRest[i * 2], T));
			}
			if (W.Arms[i].Mid)
			{
				W.Arms[i].Mid->SetRelativeRotation(FQuat::Slerp(
					W.Arms[i].Mid->GetRelativeRotation().Quaternion(), W.ArmRest[i * 2 + 1], T));
			}
		}
	};

	const FVector Pos = W.Body->GetComponentLocation();
	const float D2 = FVector::DistSquaredXY(Pos, Focus);
	const float WatchR = GRNRig::CrowdWatchRangeM * K;

	// Nobody cranes at a car three streets away.
	if (D2 >= WatchR * WatchR)
	{
		W.Head->SetRelativeRotation(FQuat::Slerp(W.Head->GetRelativeRotation().Quaternion(),
			FQuat::Identity, FMath::Min(1.f, Dt * GRNRig::CrowdRestRate)));
		SettleArms();
		return;
	}

	// The neck goes first and reports how much of the turn it could take;
	// the body supplies whatever it could not. That is the difference
	// between a crowd watching and a row of heads on swivels.
	const float Got = GRNIk::AimConstrained(W.Head, Focus, GRNRig::CrowdNeckYaw,
		GRNRig::CrowdNeckPitch, FMath::Min(1.f, Dt * GRNRig::CrowdNeckRate));
	if (Got < 0.999f)
	{
		const float Want = FMath::RadiansToDegrees(
			FMath::Atan2(Focus.Y - Pos.Y, Focus.X - Pos.X));
		FRotator R = W.Body->GetRelativeRotation();
		R.Yaw += FMath::UnwindDegrees(Want - R.Yaw) *
			FMath::Min(1.f, Dt * GRNRig::CrowdBodyRate) * (1.f - Got);
		W.Body->SetRelativeRotation(R);
	}

	// A free hand goes up for a car that comes close: a wave solved onto
	// a moving target rather than a canned clip, so it tracks wherever
	// the car actually is and settles home when it has gone.
	const FGRNLimb* Arm = nullptr;
	if (W.WaveSide != 0.f)
	{
		for (const FGRNLimb& L : W.Arms) if (L.Side == W.WaveSide) { Arm = &L; break; }
	}
	if (!Arm) { SettleArms(); return; }

	const float WaveR = GRNRig::CrowdWaveRangeM * K;
	W.Lift = FMath::Clamp(W.Lift + (D2 < WaveR * WaveR
		? Dt * GRNRig::CrowdLiftUpRate : -Dt * GRNRig::CrowdLiftDownRate), 0.f, 1.f);
	if (W.Lift <= 0.01f) { SettleArms(); return; }

	const FVector Shoulder = Arm->Root->GetComponentLocation();
	FVector Out(Focus.X - Shoulder.X, Focus.Y - Shoulder.Y, 0.f);
	if (!Out.Normalize()) Out = FVector::ForwardVector;

	const FVector S3 = Arm->Root->GetComponentTransform().GetScale3D();
	const float Span = (Arm->Upper + Arm->Lower) * K * ((S3.X + S3.Y + S3.Z) / 3.f);

	// Swing the arm along an ARC by blending the DIRECTION it points and
	// holding a fixed reach out along it. Blending the hand's position
	// instead draws a straight line from hanging to raised that passes
	// within a hand's width of the shoulder, and the solver answers that
	// by folding the arm into the armpit at both ends of every wave.
	const float Abduct = W.WaveSide * GRNRig::SpectatorArmAbduction;
	const FVector RestDir = W.Body->GetComponentQuat().RotateVector(
		FVector(0.f, FMath::Sin(Abduct), -FMath::Cos(Abduct)));
	const float Wag = FMath::Sin(Time * GRNRig::CrowdWagHz + W.Phase) * GRNRig::CrowdWagAmp * W.Lift;
	const float OutK = GRNRig::CrowdRaiseOut;
	const FVector UpDir = FVector(Out.X * OutK - Out.Y * Wag,
		Out.Y * OutK + Out.X * Wag, GRNRig::CrowdRaiseUp).GetSafeNormal();
	const FVector Dir = FMath::Lerp(RestDir, UpDir, W.Lift).GetSafeNormal();
	const FVector Target = Shoulder + Dir * (Span * GRNRig::CrowdReach);

	const FVector Pole = Shoulder + W.Body->GetComponentQuat().RotateVector(
		FVector(GRNRig::CrowdPoleZ, W.WaveSide * GRNRig::CrowdPoleX, GRNRig::CrowdPoleY) * K);
	GRNIk::SolveTwoBone(Arm->Root, Arm->Mid, Arm->Upper, Arm->Lower, Target, Pole);
}
