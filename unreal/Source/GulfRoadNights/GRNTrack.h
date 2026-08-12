#pragma once

// The Gulf Road circuit as a closed spline, with the same track-space
// API the web engine uses: every car lives at (S, Lat) — distance along
// the lap and metres from the centreline — and only becomes a world
// transform at render time. That is what makes rubber-band AI, lap
// wrapping and "who is ahead" trivial.

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "GRNTrack.generated.h"

class USplineComponent;

UCLASS()
class AGRNTrack : public AActor
{
	GENERATED_BODY()

public:
	AGRNTrack();

	UPROPERTY(VisibleAnywhere)
	USplineComponent* Spline;

	/**
	 * Replace the baked circuit with control points from the data API.
	 * Points are already in UE space. Fewer than 4 is ignored — a broken
	 * payload must never leave the game without a road.
	 */
	void RebuildFrom(const TArray<FVector>& Points);

	/** Total lap length in UE units (≈ 7.3 km * 100). */
	float LapLength() const;

	/** Wrap an S coordinate onto [0, LapLength). */
	float Wrap(float S) const;

	/** Signed distance B is ahead of A along the lap (shorter way). */
	float DeltaAhead(float FromS, float ToS) const;

	/** World transform for (S, Lat): position + forward along the road. */
	void Pose(float S, float Lat, FVector& OutPos, FRotator& OutRot) const;

	FVector PointAt(float S) const;
	FVector TangentAt(float S) const;
	FVector SideAt(float S) const;
};
