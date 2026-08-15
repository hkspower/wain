#pragma once

// The people, posed by inverse kinematics rather than animation assets.
//
// This is the UE5 half of src/game/ik.ts and src/game/characters.ts. The
// solver is analytic — the law of cosines, no iteration, no drift — and
// every number it solves against comes from namespace GRNRig in
// GRNTypes.h, which is generated from src/game/rig.ts. So the driver's
// hands land on the same point of the same rim in both engines, and
// scripts/check-unreal-sync.mjs fails if that ever stops being true.
//
// Zero binary assets, like GRNCarFactory: joints are USceneComponents
// and the visible limbs are engine basic shapes. Swap in a skeletal mesh
// later and the solver does not change — it drives transforms.
//
// Axes. The web build is Y-up with bones hanging along -Y; UE is Z-up
// with X forward, so bones hang along -Z here and the mapping is
//   web x (width) -> UE Y,  web y (up) -> UE Z,  web z (nose) -> UE X.
// Lengths in GRNRig are metres; multiply by 100 for UE centimetres.

#include "CoreMinimal.h"

class USceneComponent;
class UStaticMeshComponent;
class AActor;

/** One two-bone chain: root -> mid -> end, with the bones between them.
 *  An arm and a leg are the same shape, because the solver neither knows
 *  nor cares which limb it is straightening. */
struct FGRNLimb
{
	USceneComponent* Root = nullptr; // shoulder / hip
	USceneComponent* Mid = nullptr;  // elbow / knee
	USceneComponent* End = nullptr;  // hand / foot
	float Upper = 0.f;               // metres
	float Lower = 0.f;
	float Side = 1.f;                // -1 left, +1 right
};

/** A seated driver: hands to the wheel, feet to the pedals, eyes up. */
struct FGRNDriverRig
{
	USceneComponent* Root = nullptr;
	TArray<FGRNLimb> Arms;
	TArray<FGRNLimb> Legs;
	USceneComponent* Head = nullptr;
	USceneComponent* Wheel = nullptr;
	USceneComponent* PedalThrottle = nullptr;
	USceneComponent* PedalBrake = nullptr;
	/** Rest position of a pedal face, UE units — a press sinks it from
	 *  here and the foot is solved onto the moving face. */
	FVector PedalRest = FVector::ZeroVector;
	/** Shown steering angle, radians, chasing the input. */
	float WheelAngle = 0.f;
	bool IsValid() const { return Root != nullptr && Arms.Num() == 2 && Legs.Num() == 2; }
};

/** A watcher at the roadside: turns to follow a car, and waves at it. */
struct FGRNWatcher
{
	USceneComponent* Body = nullptr;
	USceneComponent* Head = nullptr;
	TArray<FGRNLimb> Arms;
	/** Rest pose of each arm's two joints, restored when the car has gone. */
	TArray<FQuat> ArmRest;
	/** Which hand goes up; 0 for a watcher who never waves. */
	float WaveSide = 0.f;
	float Phase = 0.f;
	float Lift = 0.f;
	float BaseYaw = 0.f;
};

namespace GRNIk
{
	/**
	 * Solve a two-bone chain so its end lands on Target.
	 *
	 * Closed form: the distance to the target and the two bone lengths
	 * determine the triangle, so the elbow angle and the shoulder's extra
	 * swing fall straight out. Exact whenever the target is reachable;
	 * when it is not, the chain straightens toward it, which is what an
	 * arm does. Pole is a world-space hint for which way the joint breaks.
	 *
	 * Bone lengths are in the chain's own units and lifted into world
	 * units by the root's world scale — a rig parented under a scaled car
	 * otherwise solves the triangle for the wrong arm entirely and the
	 * hand lands short with no sign anything is wrong.
	 */
	void SolveTwoBone(USceneComponent* Root, USceneComponent* Mid,
		float Upper, float Lower, const FVector& Target, const FVector& Pole);

	/**
	 * Point a joint at a world target within joint limits, easing rather
	 * than snapping, and stopping at the limit instead of flipping past
	 * it. Returns how much of the requested turn the limits allowed,
	 * 0..1, so the caller can pass the remainder down the chain — a body
	 * turning when the neck runs out is exactly how people watch a car.
	 */
	float AimConstrained(USceneComponent* Obj, const FVector& Target,
		float MaxYawRad, float MaxPitchRad, float Ease);
}

namespace GRNDriverRig
{
	/** Build a driver seated at SeatOffset (UE units) under AttachTo. */
	FGRNDriverRig Build(AActor* Owner, USceneComponent* AttachTo, FVector SeatOffset);

	/**
	 * Pose one driver for this frame: wheel to the steering, both hands
	 * IK'd onto the rim where they grip it, both feet onto pedals that
	 * sink with the actual inputs, eyes on LookTarget.
	 * Steer is -1..1; Throttle and Brake are 0..1.
	 */
	void Solve(FGRNDriverRig& Rig, float Steer, float Throttle, float Brake,
		const FVector& LookTarget, float Dt);

	/** Build a standing figure (spectator or racer) with chain arms and a
	 *  neck joint. bRacer picks the racer's proportions over the robed
	 *  spectator's. Index seeds the wave phase, and every third watcher
	 *  is built as one who never waves. */
	FGRNWatcher BuildWatcher(AActor* Owner, USceneComponent* AttachTo, bool bRacer, int32 Index);

	/**
	 * Turn a watcher to follow the car at Focus, and raise a hand when it
	 * is close. The neck goes first and reports how much of the turn it
	 * could take; the body supplies the rest. Time is a running clock so
	 * the wave keeps its rhythm across frames.
	 */
	void SolveWatcher(FGRNWatcher& W, const FVector& Focus, float Time, float Dt);
}
