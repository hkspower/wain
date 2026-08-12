#pragma once

// Builds the night corniche procedurally: the road ribbon along the
// spline, lane paint, guard rails, and cobra-head street lights on real
// arms over the carriageway — the same furniture as the web build, made
// of instanced engine primitives so the project ships with zero binary
// assets. Swap the meshes for Nanite scans when art arrives; the layout
// code stays.

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
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

private:
	UPROPERTY() UProceduralMeshComponent* RoadMesh;
	UPROPERTY() UInstancedStaticMeshComponent* Poles;
	UPROPERTY() UInstancedStaticMeshComponent* Arms;
	UPROPERTY() UInstancedStaticMeshComponent* LampHeads;
	UPROPERTY() UInstancedStaticMeshComponent* Rails;

	void BuildRoad(AGRNTrack* Track);
	void BuildStreetLights(AGRNTrack* Track);
	void BuildRails(AGRNTrack* Track);
	UInstancedStaticMeshComponent* MakeISM(const TCHAR* Name, const TCHAR* MeshPath, FLinearColor Color);
};
