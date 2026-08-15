#include "GRNWorldBuilder.h"
#include "GRNTrack.h"
#include "GRNTypes.h"
#include "ProceduralMeshComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/SpotLightComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "UObject/ConstructorHelpers.h"

AGRNWorldBuilder::AGRNWorldBuilder()
{
	PrimaryActorTick.bCanEverTick = false;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	RoadMesh = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("Road"));
	RoadMesh->SetupAttachment(RootComponent);
}

UInstancedStaticMeshComponent* AGRNWorldBuilder::MakeISM(
	const TCHAR* Name, const TCHAR* MeshPath, FLinearColor Color)
{
	UInstancedStaticMeshComponent* ISM = NewObject<UInstancedStaticMeshComponent>(this, Name);
	ISM->RegisterComponent();
	ISM->AttachToComponent(RootComponent, FAttachmentTransformRules::KeepWorldTransform);
	if (UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, MeshPath))
	{
		ISM->SetStaticMesh(Mesh);
		if (UMaterialInterface* Base = Mesh->GetMaterial(0))
		{
			UMaterialInstanceDynamic* Mid = UMaterialInstanceDynamic::Create(Base, this);
			Mid->SetVectorParameterValue(TEXT("Color"), Color);
			ISM->SetMaterial(0, Mid);
		}
	}
	ISM->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	return ISM;
}

void AGRNWorldBuilder::Build(AGRNTrack* Track)
{
	BuildRoad(Track);
	BuildStreetLights(Track);
	BuildRails(Track);
	BuildCrowd(Track);
}

void AGRNWorldBuilder::BuildCrowd(AGRNTrack* Track)
{
	// Spectators along the seaward promenade, and the grid crew standing
	// by their machines. Each gets a neck joint and two-bone arms, so the
	// same IK that puts the driver's hands on the wheel turns these heads
	// and raises these hands.
	const float L = Track->LapLength();
	struct FSpot { float S; float LatPad; bool bRacer; };
	const FSpot Spots[] = {
		{ 0.28f * L, 3.2f, false }, { 0.28f * L + GRN_M(3.5f), 4.1f, false },
		{ 0.52f * L, 3.4f, false }, { 0.52f * L + GRN_M(4.0f), 3.9f, false },
		{ 0.74f * L, 3.6f, false }, { 0.74f * L + GRN_M(3.2f), 2.9f, false },
		{ Track->Wrap(GRN_M(-9.f)), 2.6f, true },
		{ Track->Wrap(GRN_M(-4.5f)), 3.4f, true },
		{ GRN_M(3.5f), 2.8f, true },
		{ GRN_M(8.5f), 3.6f, true },
	};

	int32 Index = 0;
	for (const FSpot& Spot : Spots)
	{
		const float SideSign = (Index % 2 == 0) ? 1.f : -1.f;
		const FVector Side = Track->SideAt(Spot.S) * SideSign;
		const FVector Base = Track->PointAt(Spot.S) + Side * (GRNRoadHalfWidth + GRN_M(Spot.LatPad));

		USceneComponent* Stand = NewObject<USceneComponent>(this);
		Stand->RegisterComponent();
		Stand->AttachToComponent(RootComponent, FAttachmentTransformRules::KeepWorldTransform);
		Stand->SetWorldLocation(Base);
		// Facing the road they came to watch
		Stand->SetWorldRotation((-Side).ToOrientationRotator());

		Watchers.Add(GRNDriverRig::BuildWatcher(this, Stand, Spot.bRacer, Index));
		Index++;
	}
}

void AGRNWorldBuilder::SetCrowdFocus(const FVector& Focus, float Dt)
{
	CrowdTime += Dt;
	for (FGRNWatcher& W : Watchers)
	{
		GRNDriverRig::SolveWatcher(W, Focus, CrowdTime, Dt);
	}
}

void AGRNWorldBuilder::BuildRoad(AGRNTrack* Track)
{
	// A ribbon of quads along the spline. UV.x runs across the road so a
	// single asphalt material tiles correctly; 6 m steps keep the curve
	// smooth at speed.
	TArray<FVector> Verts;
	TArray<int32> Tris;
	TArray<FVector> Normals;
	TArray<FVector2D> UVs;

	const float L = Track->LapLength();
	const float Step = GRN_M(6.f);
	const int32 Count = FMath::CeilToInt(L / Step);

	for (int32 i = 0; i <= Count; i++)
	{
		const float S = FMath::Min(i * Step, L);
		const FVector P = Track->PointAt(S);
		const FVector Side = Track->SideAt(S);
		Verts.Add(P - Side * GRNRoadHalfWidth);
		Verts.Add(P + Side * GRNRoadHalfWidth);
		Normals.Add(FVector::UpVector);
		Normals.Add(FVector::UpVector);
		UVs.Add(FVector2D(0.f, S / GRN_M(14.f)));
		UVs.Add(FVector2D(1.f, S / GRN_M(14.f)));
		if (i > 0)
		{
			const int32 A = (i - 1) * 2;
			Tris.Append({ A, A + 1, A + 2, A + 1, A + 3, A + 2 });
		}
	}
	RoadMesh->CreateMeshSection(0, Verts, Tris, Normals, UVs,
		TArray<FColor>(), TArray<FProcMeshTangent>(), true);
}

void AGRNWorldBuilder::BuildStreetLights(AGRNTrack* Track)
{
	Poles = MakeISM(TEXT("Poles"), TEXT("/Engine/BasicShapes/Cylinder.Cylinder"), FLinearColor(0.05f, 0.055f, 0.06f));
	Arms = MakeISM(TEXT("Arms"), TEXT("/Engine/BasicShapes/Cylinder.Cylinder"), FLinearColor(0.05f, 0.055f, 0.06f));
	LampHeads = MakeISM(TEXT("Heads"), TEXT("/Engine/BasicShapes/Cube.Cube"), FLinearColor(0.05f, 0.055f, 0.06f));

	const float L = Track->LapLength();
	const float Spacing = GRN_M(42.f);
	const int32 Count = FMath::FloorToInt(L / Spacing);

	for (int32 i = 0; i < Count; i++)
	{
		const float S = i * Spacing;
		const float SideSign = (i % 2 == 0) ? 1.f : -1.f;
		const FVector Side = Track->SideAt(S) * SideSign;
		const FVector Base = Track->PointAt(S) + Side * (GRNRoadHalfWidth + GRN_M(1.6f));

		// Pole (engine cylinder is 100 uu tall, so scale.Z = metres)
		Poles->AddInstance(FTransform(FQuat::Identity,
			Base + FVector(0, 0, GRN_M(4.2f)), FVector(0.25f, 0.25f, 8.4f)), true);

		// Head hangs over the road; the arm bridges pole top → head
		const FVector Head = Track->PointAt(S) + Side * (GRNRoadHalfWidth - GRN_M(1.2f)) + FVector(0, 0, GRN_M(8.45f));
		const FVector ArmMid = (Base + FVector(0, 0, GRN_M(8.42f)) + Head) * 0.5f;
		const FQuat ArmRot = FQuat::FindBetweenNormals(FVector::UpVector, (-Side).GetSafeNormal());
		Arms->AddInstance(FTransform(ArmRot, ArmMid, FVector(0.09f, 0.09f, 3.0f)), true);
		LampHeads->AddInstance(FTransform(Side.ToOrientationQuat(), Head, FVector(0.55f, 0.3f, 0.12f)), true);

		// Real light: one narrow spot per lamp. Lumen makes these cheap
		// enough to run every head; drop to every other on low scalability.
		USpotLightComponent* Lamp = NewObject<USpotLightComponent>(this);
		Lamp->RegisterComponent();
		Lamp->SetWorldLocation(Head - FVector(0, 0, GRN_M(0.2f)));
		Lamp->SetWorldRotation(FRotator(-90.f, 0.f, 0.f));
		Lamp->SetIntensity(8000.f);
		Lamp->SetLightColor(FColor(0xFF, 0xB1, 0x5C)); // sodium
		Lamp->SetOuterConeAngle(55.f);
		Lamp->SetAttenuationRadius(GRN_M(26.f));
		Lamp->SetCastShadows(false);
		Lamp->AttachToComponent(RootComponent, FAttachmentTransformRules::KeepWorldTransform);
	}
}

void AGRNWorldBuilder::BuildRails(AGRNTrack* Track)
{
	Rails = MakeISM(TEXT("Rails"), TEXT("/Engine/BasicShapes/Cube.Cube"), FLinearColor(0.35f, 0.36f, 0.38f));
	const float L = Track->LapLength();
	const float Step = GRN_M(8.f);
	const int32 Count = FMath::FloorToInt(L / Step);
	for (int32 i = 0; i < Count; i++)
	{
		const float S = i * Step;
		const FVector T = Track->TangentAt(S);
		for (float SideSign : { -1.f, 1.f })
		{
			const FVector P = Track->PointAt(S)
				+ Track->SideAt(S) * SideSign * (GRNRoadHalfWidth + GRN_M(0.6f))
				+ FVector(0, 0, GRN_M(0.6f));
			Rails->AddInstance(FTransform(T.ToOrientationQuat(), P, FVector(0.082f, 0.06f, 0.3f)), true);
		}
	}
}
