#pragma once

// Builds a drivable-looking machine out of engine primitives — the same
// three silhouettes as the web build (sedan / Z-wedge / R34-style
// coupe), with per-car paint MIDs, spinning wheels, tail lamps that
// flare on the brakes and a real headlight. Zero binary assets: when
// Nanite car scans arrive, swap the component tree and keep the API.

#include "CoreMinimal.h"
#include "GRNTypes.h"
#include "GRNCarFactory.generated.h"

class UStaticMesh;
class UStaticMeshComponent;
class UMaterialInstanceDynamic;
class USpotLightComponent;
class USceneComponent;
class AActor;

struct FGRNCarRig
{
	/** All four wheel components, FL FR RL RR — spin these with speed. */
	TArray<UStaticMeshComponent*> Wheels;
	/** Paint MID (body panels share it) for garage resprays. */
	UMaterialInstanceDynamic* PaintMid = nullptr;
	/** Tail lamp MID: push Emissive up when the brakes bite. */
	UMaterialInstanceDynamic* TailMid = nullptr;
	/** The headlight beam. */
	USpotLightComponent* Headlight = nullptr;
	/** True when the wheels are hero art (axle along the mesh's Y) rather
	 *  than the rolled primitive cylinder (axis along its own Z); the spin
	 *  goes on a different local axis for each. */
	bool bHeroWheels = false;
};

/**
 * High-end art in place of the primitives, when it is there.
 *
 * Car scans and hero meshes from Fab (Epic's asset store — the Fab
 * plugin ships with the editor from 5.4, sign in with the Epic account,
 * "Add to project"), Quixel Megascans, or anything else imported as a
 * UStaticMesh drop in here: set the soft references on the pawn, the
 * rival or the traffic actor in the editor and Build uses them instead
 * of the primitive shell and cylinders. The rig API — wheels, paint
 * MID, tail MID, headlight — is the same either way, so nothing that
 * drives the car changes. The body is scaled so its X extent is the
 * car's fitted length, the way the web build fits every shell to the
 * length on its card; a wheel mesh is scaled to the primitive wheel's
 * diameter. Leave Body unset and the factory builds what it always
 * built. Nothing is loaded until Build runs: these are soft references
 * so a project without the art still cooks.
 */
USTRUCT(BlueprintType)
struct FGRNHeroAssets
{
	GENERATED_BODY()

	/** The whole shell — panels, glass, lamps — as one mesh, X forward. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Art")
	TSoftObjectPtr<UStaticMesh> Body;

	/** One wheel, axle along Y, standing on Z; used four times. Unset
	 *  keeps the primitive cylinders under a hero body. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Art")
	TSoftObjectPtr<UStaticMesh> Wheel;

	/** Material slot on Body that takes the paint MID, so garage resprays
	 *  still work on scanned art. −1 leaves every slot as imported. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Art")
	int32 PaintSlot = 0;

	/** Material slot on Body that takes the tail-lamp MID (flares under
	 *  braking). −1 if the art has no separate lens slot. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Art")
	int32 TailSlot = -1;

	/** Material slot on Wheel that takes the wheel finish; −1 as imported. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Art")
	int32 WheelSlot = -1;

	bool HasBody() const { return !Body.IsNull(); }
};

namespace GRNCarFactory
{
	/**
	 * Attach a full car to Parent under AttachTo.
	 * Dimensions are metres * 100, matching the web build's car scaled by
	 * its 1.12 screen-presence factor. bAttackKit layers the factory
	 * time-attack aero (swan wing, splitter, canards, bronze wheels) on
	 * top of whatever bWing says — the kit's wing replaces the garage one.
	 */
	/** LengthM is the length on this car's own card, in metres. Zero
	 *  falls back to the silhouette's reference machine — which is what
	 *  every car used to get, at one width for the whole roster. */
	/** Hero, when given and its Body is set, replaces the primitive
	 *  bodywork and (if its Wheel is set) the cylinders — see
	 *  FGRNHeroAssets. The aero, lamps and stance are the art's own. */
	FGRNCarRig Build(AActor* Parent, USceneComponent* AttachTo,
		EGRNBodyStyle Style, FLinearColor Paint, bool bWing,
		bool bAttackKit = false, float LengthM = 0.f,
		const FGRNHeroAssets* Hero = nullptr);

	/** Advance wheel spin from road speed (m/s). */
	void SpinWheels(const FGRNCarRig& Rig, float SpeedMs, float Dt);

	/** Brake-light state: idle glow vs full flare. */
	void SetBraking(const FGRNCarRig& Rig, bool bBraking);
}
