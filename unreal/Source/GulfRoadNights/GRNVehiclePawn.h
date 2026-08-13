#pragma once

// The player's machine. Not Chaos Vehicles: Gulf Road Nights has its own
// arcade handling model (ported verbatim from the web engine) — cars
// live in track space, the nose can point past the direction of travel
// (that is the drift), and the trailing car in a battle bleeds SP.

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "GRNTypes.h"
#include "GRNCarFactory.h"
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
	float TopSpeedBonus = 0.f;
	float BrakeForce = 26.f;
	float GripAccel = 12.f;
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

	// ------------------------------------------------------------- camera
	UPROPERTY(VisibleAnywhere) USceneComponent* CarRoot;
	UPROPERTY(VisibleAnywhere) UCameraComponent* Camera;

	/** Current input state, fed by axis bindings (keyboard or gamepad). */
	float InThrottle = 0.f, InBrake = 0.f, InSteer = 0.f;
	bool bInDrift = false, bInNos = false;

	/** Rebuild the visible car (garage swap / respray / wing). */
	void BuildRig(EGRNBodyStyle Style, FLinearColor Paint, bool bWing, bool bAttackKit = false);
	FGRNCarRig Rig;

private:
	void UpdateHandling(float Dt);
	void UpdateCamera(float Dt);

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
};
