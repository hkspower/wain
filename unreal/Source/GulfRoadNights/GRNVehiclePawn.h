#pragma once

// The player's machine. Not Chaos Vehicles: Gulf Road Nights has its own
// arcade handling model (ported verbatim from the web engine) — cars
// live in track space, the nose can point past the direction of travel
// (that is the drift), and the trailing car in a battle bleeds SP.

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "GRNTypes.h"
#include "GRNSim.h"
#include "GRNCarFactory.h"
#include "GRNDriverRig.h"
#include "GRNVehiclePawn.generated.h"

class AGRNTrack;
class UCameraComponent;
class USceneComponent;

UCLASS()
class AGRNVehiclePawn : public APawn
{
	GENERATED_BODY()

public:
	AGRNVehiclePawn();

	virtual void Tick(float Dt) override;
	virtual void SetupPlayerInputComponent(UInputComponent* Input) override;

	// ---------------------------------------------------------- track space
	UPROPERTY() AGRNTrack* Track = nullptr;
	float S = 0.f;          // distance along the lap (UE units)
	float Lat = 0.f;        // metres * 100 off centreline
	float SpeedMs = 0.f;    // the model runs in m/s, like the web build

	// ------------------------------------------------------------- tuning
	float PowerMult = 1.f;
	/** Governed top speed in km/h — absolute, not a bonus. */
	float TopSpeedKmh = 180.f;
	float BrakeForce = 26.f;
	float GripAccel = 12.f;
	/** Aero grip in m/s² at GRNHandling::DownforceRefSpeed, scaling with
	 *  v² either side of it. A wing is not a constant. */
	float Downforce = 0.f;
	float BrakeThermalMult = 1.f;
	/** 0..1 of an impact's DAMAGE a cage absorbs — speed shed and SP lost.
	 *  Not its rotation: an impulse turns the car whatever the shell is
	 *  made of, and scaling the yaw by this made a caged car unspinnable
	 *  by any impact at all. mods.ts sets 0.55 for the cage, 0 otherwise. */
	float CrashResist = 0.f;
	bool bHasAbs = true;
	bool bHasNos = false;
	float BoostMult = 0.f;

	// ------------------------------------------------------------ handling
	float Heading = 0.f;      // radians vs the road tangent
	float SteerSmooth = 0.f;
	float DriftYaw = 0.f;     // body yaw past the velocity heading
	float DriftRun = 0.f;     // unbanked style points
	float Boost = 0.f;
	float NosCharge = 1.f;
	/** m/s² of engine torque the driven tires could not transmit this
	 *  frame — drives the visual overspin and power-over drift entry. */
	float Wheelspin = 0.f;
	/** Shove off the barrier after a wall hit, decaying (m/s lateral). */
	float ReboundVel = 0.f;
	/** One impact per contact: cooldown mirrors the web engine's. */
	float ScrapeCooldown = 0.f;

	float Sp = 100.f;         // spirit points in a battle

	// ------------------------------------------------- the solvers' state
	//
	// Carried between fixed steps, not between frames. Everything the
	// game's logic remembers lives here and in GRNSim.h — the drift
	// angle and its chain, the discs' temperature and how locked the
	// wheels are, where the weight has moved to.
	GRNSim::FDriftState DriftState;
	GRNSim::FBrakeState BrakeState;
	GRNSim::FLoadState LoadState;
	/** What the last solve said, for the HUD and for the next step. */
	GRNSim::FBrakeResult LastBrake;
	GRNSim::FLoadResult LastLoad;
	GRNSim::FDriftResult LastDrift;

	// ------------------------------------------------------------- camera
	UPROPERTY(VisibleAnywhere) USceneComponent* CarRoot;
	UPROPERTY(VisibleAnywhere) UCameraComponent* Camera;

	/** Current input state, fed by axis bindings (keyboard or gamepad). */
	float InThrottle = 0.f, InBrake = 0.f, InSteer = 0.f;
	bool bInDrift = false, bInNos = false;

	/** Rebuild the visible car (garage swap / respray / wing). */
	/** LengthM is the length on the car's own card. Zero falls back to
	 *  the silhouette's reference machine — see GRNCarFactory::Build. */
	void BuildRig(EGRNBodyStyle Style, FLinearColor Paint, bool bWing,
		bool bAttackKit = false, float LengthM = 0.f);
	FGRNCarRig Rig;
	/** Somebody is driving this: hands solved onto the wheel, feet onto
	 *  the pedals, eyes into the corner. See GRNDriverRig.h. */
	FGRNDriverRig Driver;

private:
	/**
	 * ONE simulation step, at a fixed size. Never called with the frame
	 * time — see Tick.
	 */
	void StepSim(float Dt);
	/** Place the car between the last two fixed steps. */
	void ApplyRenderPose();
	void UpdateHandling(float Dt);
	void UpdateCamera(float Dt);
	void UpdateDriver(float Dt);

	void AxisThrottle(float V) { InThrottle = FMath::Clamp(V, 0.f, 1.f); }
	void AxisBrake(float V) { InBrake = FMath::Clamp(V, 0.f, 1.f); }
	void AxisSteer(float V);
	void DriftPressed() { bInDrift = true; }
	void DriftReleased() { bInDrift = false; }
	void NosPressed() { bInNos = true; }
	void NosReleased() { bInNos = false; }
	void FlashPressed();
	void PausePressed();
	void CyclePressed();

	float FovCurrent = 62.f;

	// ------------------------------------------------------- the fixed tick
	//
	// The simulation runs at GRNSimHz whatever the renderer is doing, and
	// the render pose is interpolated between the last two steps.
	//
	// It used to integrate on the frame, clamped to 50 ms, which makes
	// the physics frame-rate dependent: a 30 fps machine and a 144 fps
	// machine take different paths through the same corner. That is
	// survivable in a lot of games and it is not survivable in this one —
	// the drift solver has a runaway term past the critical angle and a
	// threshold that turns a slide into a spin, and near either of those
	// a difference in step size is the difference between going round and
	// not. The web build gets away with a variable step because it is one
	// machine at a time; a port that ships to a spread of hardware does
	// not.
	float SimAccum = 0.f;
	/** Where the car was at the previous fixed step, and at the latest —
	 *  the render pose is between them. */
	float PrevS = 0.f, PrevLat = 0.f, PrevHeading = 0.f, PrevDriftYaw = 0.f;
	float CurS = 0.f, CurLat = 0.f, CurHeading = 0.f, CurDriftYaw = 0.f;
	bool bSimStarted = false;
	/** 0..1 through the step the renderer is showing. */
	float SimAlpha = 0.f;
};
