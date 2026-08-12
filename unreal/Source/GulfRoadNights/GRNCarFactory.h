#pragma once

// Builds a drivable-looking machine out of engine primitives — the same
// three silhouettes as the web build (sedan / Z-wedge / R34-style
// coupe), with per-car paint MIDs, spinning wheels, tail lamps that
// flare on the brakes and a real headlight. Zero binary assets: when
// Nanite car scans arrive, swap the component tree and keep the API.

#include "CoreMinimal.h"
#include "GRNTypes.h"

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
	FGRNCarRig Build(AActor* Parent, USceneComponent* AttachTo,
		EGRNBodyStyle Style, FLinearColor Paint, bool bWing,
		bool bAttackKit = false);

	/** Advance wheel spin from road speed (m/s). */
	void SpinWheels(const FGRNCarRig& Rig, float SpeedMs, float Dt);

	/** Brake-light state: idle glow vs full flare. */
	void SetBraking(const FGRNCarRig& Rig, bool bBraking);
}
