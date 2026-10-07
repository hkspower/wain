#pragma once

// The showcase's handle on the running game: park the player's car at a
// place on the lap, dress it in imported art, and clear the road — so a
// Movie Render Queue job can shoot the Black Demon on the night Gulf
// Road the game builds for itself (unreal/Showcase/README.md).
//
// A function library rather than a game-mode change, because none of
// this is the game. The game spawns thirty traffic cars and a rival and
// puts the player at the start line; a still of one parked car wants
// none of that, and wants it without the Python that drives the render
// reaching into private members. Everything here goes through what the
// game mode and the pawn already expose: ApplyCar, BuildRig's HeroAssets
// slot (the port's own extension point for imported art, GRNHeroArt.h),
// the track's Pose.
//
// Runtime module, no editor dependency, so the packaged game carries it
// too — a console `GRN.Showcase.*` would be the natural next step. Not
// in the Shipping build's interest, but it costs nothing there: nothing
// calls it.

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "GRNShowcase.generated.h"

class UStaticMesh;

UCLASS()
class UGRNShowcase : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/** Make the player's car the one with this catalogue id (e.g.
	 *  "black-demon"), rebuilt at once. False if no such car. */
	UFUNCTION(BlueprintCallable, Category = "GRN|Showcase", meta = (WorldContext = "WorldContextObject"))
	static bool SelectCar(UObject* WorldContextObject, const FString& CarId);

	/** Dress the player's car in an imported body (X forward, wheels
	 *  included) and rebuild it. PaintSlot is the body's material slot the
	 *  port's paint rides on; PaintParam the vector parameter a respray
	 *  drives there ("Color" on the port's own paint). */
	UFUNCTION(BlueprintCallable, Category = "GRN|Showcase", meta = (WorldContext = "WorldContextObject"))
	static bool WearArt(UObject* WorldContextObject, UStaticMesh* Body, int32 PaintSlot, FName PaintParam);

	/** Put the player's car StationM metres along the lap, LateralM off
	 *  the centreline (positive = the web build's +lat), still, yawed
	 *  YawOffsetDeg off the road. bFreeze stops its tick so it stays. */
	UFUNCTION(BlueprintCallable, Category = "GRN|Showcase", meta = (WorldContext = "WorldContextObject"))
	static bool ParkPlayer(UObject* WorldContextObject, float StationM, float LateralM, float YawOffsetDeg, bool bFreeze);

	/** Hide every traffic car and the rival, and stop them. Returns how
	 *  many actors it touched. */
	UFUNCTION(BlueprintCallable, Category = "GRN|Showcase", meta = (WorldContext = "WorldContextObject"))
	static int32 ClearOthers(UObject* WorldContextObject);

	/** Where the player's car is now, for aiming a camera. */
	UFUNCTION(BlueprintCallable, Category = "GRN|Showcase", meta = (WorldContext = "WorldContextObject"))
	static FTransform PlayerTransform(UObject* WorldContextObject);
};
