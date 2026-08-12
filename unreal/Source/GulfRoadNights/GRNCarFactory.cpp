#include "GRNCarFactory.h"
#include "Components/StaticMeshComponent.h"
#include "Components/SpotLightComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/Actor.h"

namespace
{
	UStaticMesh* Cube()
	{
		static UStaticMesh* M = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
		return M;
	}
	UStaticMesh* Cyl()
	{
		static UStaticMesh* M = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
		return M;
	}

	// Engine basic shapes are 100 uu across, so Scale is metres directly.
	UStaticMeshComponent* Box(AActor* Owner, USceneComponent* Parent,
		FVector PosM, FVector SizeM, UMaterialInterface* Mat, FRotator Rot = FRotator::ZeroRotator)
	{
		UStaticMeshComponent* C = NewObject<UStaticMeshComponent>(Owner);
		C->SetStaticMesh(Cube());
		C->RegisterComponent();
		C->AttachToComponent(Parent, FAttachmentTransformRules::KeepRelativeTransform);
		C->SetRelativeLocation(PosM * 100.f);
		C->SetRelativeRotation(Rot);
		C->SetRelativeScale3D(SizeM);
		if (Mat) C->SetMaterial(0, Mat);
		C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		return C;
	}

	UMaterialInstanceDynamic* Mid(AActor* Owner, FLinearColor Color)
	{
		UMaterialInterface* Base = Cube() ? Cube()->GetMaterial(0) : nullptr;
		if (!Base) return nullptr;
		UMaterialInstanceDynamic* M = UMaterialInstanceDynamic::Create(Base, Owner);
		M->SetVectorParameterValue(TEXT("Color"), Color);
		return M;
	}
}

FGRNCarRig GRNCarFactory::Build(AActor* Parent, USceneComponent* AttachTo,
	EGRNBodyStyle Style, FLinearColor Paint, bool bWing)
{
	FGRNCarRig Rig;
	Rig.PaintMid = Mid(Parent, Paint);
	UMaterialInstanceDynamic* Dark = Mid(Parent, FLinearColor(0.02f, 0.02f, 0.025f));
	UMaterialInstanceDynamic* Glass = Mid(Parent, FLinearColor(0.03f, 0.04f, 0.06f));
	Rig.TailMid = Mid(Parent, FLinearColor(0.6f, 0.05f, 0.05f));

	// Web-build proportions × the 1.12 presence factor. Forward = +X.
	const float K = 1.12f;
	const bool bZX = Style == EGRNBodyStyle::ZX;
	const bool bGTR = Style == EGRNBodyStyle::GTR;

	// Lower body: one long slab, nose/tail wedges per silhouette
	const float BodyLen = (bZX ? 4.8f : 4.55f) * K;
	const float BodyH = (bZX ? 0.62f : bGTR ? 0.76f : 0.72f) * K;
	Box(Parent, AttachTo, FVector(0, 0, 0.30f * K + BodyH * 0.5f),
		FVector(BodyLen, 1.9f * K, BodyH), Rig.PaintMid);

	// Glasshouse: cab-back fastback on the ZX, upright box otherwise
	const float CabLen = (bZX ? 2.2f : 1.9f) * K;
	const float CabX = (bZX ? -0.7f : -0.15f) * K;
	const float CabH = (bZX ? 0.42f : 0.5f) * K;
	Box(Parent, AttachTo, FVector(CabX, 0, 0.30f * K + BodyH + CabH * 0.5f),
		FVector(CabLen, 1.55f * K, CabH), Glass,
		FRotator(bZX ? -6.f : 0.f, 0.f, 0.f));

	// Nose wedge
	Box(Parent, AttachTo, FVector(BodyLen * 0.5f - 0.25f * K, 0, 0.30f * K + BodyH * 0.72f),
		FVector(0.7f * K, 1.85f * K, BodyH * 0.5f), Rig.PaintMid,
		FRotator(bZX ? 9.f : 5.f, 0.f, 0.f));

	// Tail lamps: quad rings on the coupe, a full-width band otherwise
	const float TailX = -BodyLen * 0.5f;
	if (bGTR)
	{
		for (float Y : { -0.72f, -0.44f, 0.44f, 0.72f })
		{
			UStaticMeshComponent* Ring = Box(Parent, AttachTo,
				FVector(TailX - 0.02f * K, Y * K, 0.84f * K), FVector(0.04f, 0.21f, 0.21f), Rig.TailMid);
			Ring->SetStaticMesh(Cyl());
			Ring->SetRelativeRotation(FRotator(0.f, 0.f, 90.f));
		}
	}
	else
	{
		Box(Parent, AttachTo, FVector(TailX - 0.02f * K, 0, (bZX ? 0.66f : 0.78f) * K),
			FVector(0.06f, 1.78f * K, 0.13f), Rig.TailMid);
	}

	// Optional GT wing — the player's choice, never forced
	if (bWing)
	{
		Box(Parent, AttachTo, FVector(TailX + 0.15f * K, 0, (bGTR ? 1.31f : 1.25f) * K),
			FVector(0.42f, 1.8f * K, 0.05f), Rig.PaintMid, FRotator(-7.f, 0.f, 0.f));
		for (float Y : { -0.62f, 0.62f })
		{
			Box(Parent, AttachTo, FVector(TailX + 0.18f * K, Y * K, 1.1f * K),
				FVector(0.16f, 0.06f, 0.26f), Dark);
		}
	}

	// Wheels: cylinders on their sides, fronts forward per style stance
	const float WzF = (bZX ? 1.52f : bGTR ? 1.45f : 1.42f) * K;
	const float WzR = -(bZX ? 1.48f : bGTR ? 1.45f : 1.42f) * K;
	for (const FVector2D& W : { FVector2D(WzF, -0.94f * K), FVector2D(WzF, 0.94f * K),
	                            FVector2D(WzR, -0.94f * K), FVector2D(WzR, 0.94f * K) })
	{
		UStaticMeshComponent* Wheel = NewObject<UStaticMeshComponent>(Parent);
		Wheel->SetStaticMesh(Cyl());
		Wheel->RegisterComponent();
		Wheel->AttachToComponent(AttachTo, FAttachmentTransformRules::KeepRelativeTransform);
		Wheel->SetRelativeLocation(FVector(W.X, W.Y, 0.40f * K) * 100.f);
		Wheel->SetRelativeRotation(FRotator(0.f, 0.f, 90.f));
		Wheel->SetRelativeScale3D(FVector(0.8f * K, 0.29f * K, 0.8f * K));
		Wheel->SetMaterial(0, Dark);
		Wheel->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Rig.Wheels.Add(Wheel);
	}

	// Headlight beam, warm like the web build
	Rig.Headlight = NewObject<USpotLightComponent>(Parent);
	Rig.Headlight->RegisterComponent();
	Rig.Headlight->AttachToComponent(AttachTo, FAttachmentTransformRules::KeepRelativeTransform);
	Rig.Headlight->SetRelativeLocation(FVector(BodyLen * 0.5f, 0, 1.1f * K) * 100.f);
	Rig.Headlight->SetRelativeRotation(FRotator(-6.f, 0.f, 0.f));
	Rig.Headlight->SetIntensity(20000.f);
	Rig.Headlight->SetLightColor(FColor(0xFF, 0xF2, 0xCC));
	Rig.Headlight->SetOuterConeAngle(28.f);
	Rig.Headlight->SetAttenuationRadius(9000.f);
	Rig.Headlight->SetCastShadows(false);

	return Rig;
}

void GRNCarFactory::SpinWheels(const FGRNCarRig& Rig, float SpeedMs, float Dt)
{
	// Tire radius ≈ 0.40 m → degrees per second at road speed
	const float DegPerSec = FMath::RadiansToDegrees(SpeedMs / 0.40f);
	for (UStaticMeshComponent* W : Rig.Wheels)
	{
		if (W) W->AddLocalRotation(FRotator(0.f, DegPerSec * Dt, 0.f));
	}
}

void GRNCarFactory::SetBraking(const FGRNCarRig& Rig, bool bBraking)
{
	if (Rig.TailMid)
	{
		Rig.TailMid->SetVectorParameterValue(TEXT("Color"),
			bBraking ? FLinearColor(3.5f, 0.12f, 0.12f) : FLinearColor(0.6f, 0.05f, 0.05f));
	}
}
