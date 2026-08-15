#pragma once

// Builds the night corniche procedurally: the road ribbon along the
// spline, lane paint, guard rails, and cobra-head street lights on real
// arms over the carriageway — the same furniture as the web build, made
// of instanced engine primitives so the project ships with zero binary
// assets. Swap the meshes for Nanite scans when art arrives; the layout
// code stays.

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "GRNDriverRig.h"
#include "GRNWorldBuilder.generated.h"

class AGRNTrack;
class UProceduralMeshComponent;
class UInstancedStaticMeshComponent;

UCLASS()
class AGRNWorldBuilder : public AActor
{
	GENERATED_BODY()

public:
	AGRNWorldBuilder();

	void Build(AGRNTrack* Track);

	/**
	 * Turn the roadside crowd to watch the car at Focus, and raise a hand
	 * when it comes close. Called every frame by the game mode with the
	 * player's position — a corniche whose people ignore a car going past
	 * at 200 km/h is a corniche full of mannequins.
	 */
	void SetCrowdFocus(const FVector& Focus, float Dt);

private:
	UPROPERTY() UProceduralMeshComponent* RoadMesh;
	UPROPERTY() UInstancedStaticMeshComponent* Poles;
	UPROPERTY() UInstancedStaticMeshComponent* Arms;
	UPROPERTY() UInstancedStaticMeshComponent* LampHeads;
	UPROPERTY() UInstancedStaticMeshComponent* Rails;

	void BuildRoad(AGRNTrack* Track);
	void BuildCrowd(AGRNTrack* Track);
	/** Everyone at the roadside who turns to watch, and their wave clock. */
	TArray<FGRNWatcher> Watchers;
	float CrowdTime = 0.f;
	void BuildStreetLights(AGRNTrack* Track);
	void BuildRails(AGRNTrack* Track);
	UInstancedStaticMeshComponent* MakeISM(const TCHAR* Name, const TCHAR* MeshPath, FLinearColor Color);
};
