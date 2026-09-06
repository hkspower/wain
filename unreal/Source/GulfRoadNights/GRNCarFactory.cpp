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

/**
 * The machine each silhouette evokes, and how much of a length change a
 * width follows.
 *
 * The same numbers the web build carries and publishes at
 * gamedata.bodyShape. A zero exponent would make every saloon exactly as
 * wide as every other; one is the uniform scale that left a 3.95 m hatch
 * 12% narrower than the class it belongs to; a third is what real fleets
 * do.
 */
static constexpr float GRN_WIDTH_FOLLOWS_LENGTH = 1.f / 3.f;

/**
 * The tyre's rolling radius, metres, before the presence scale.
 *
 * Published by the web at gamedata.bodyShape.tyreRadiusM, and it is
 * published because all three builds had invented their own: this file
 * carried 0.40 in two places, the Unity port carried 0.33, and the web
 * derives 0.375. One car, three sizes of wheel, spun at three different
 * rates — and the comment beside the old literal said "Tire radius
 * approximately 0.40 m", which was true of nothing.
 */
static constexpr float GRN_TYRE_RADIUS_M = 0.375f;

static float StyleRefLength(EGRNBodyStyle Style)
{
	switch (Style)
	{
	case EGRNBodyStyle::ZX: return 4.31f;
	case EGRNBodyStyle::GTR: return 4.60f;
	case EGRNBodyStyle::RX7: return 4.30f;
	case EGRNBodyStyle::Hatch: return 4.28f;
	case EGRNBodyStyle::Pony: return 4.90f;
	default: return 4.70f;
	}
}

static float StyleRefWidth(EGRNBodyStyle Style)
{
	switch (Style)
	{
	case EGRNBodyStyle::ZX: return 1.80f;
	case EGRNBodyStyle::GTR: return 1.79f;
	case EGRNBodyStyle::RX7: return 1.76f;
	case EGRNBodyStyle::Hatch: return 1.79f;
	case EGRNBodyStyle::Pony: return 1.88f;
	default: return 1.80f;
	}
}

FGRNCarRig GRNCarFactory::Build(AActor* Parent, USceneComponent* AttachTo,
	EGRNBodyStyle Style, FLinearColor Paint, bool bWing, bool bAttackKit, float LengthM,
	const FGRNHeroAssets* Hero)
{
	FGRNCarRig Rig;
	Rig.PaintMid = Mid(Parent, Paint);
	UMaterialInstanceDynamic* Dark = Mid(Parent, FLinearColor(0.02f, 0.02f, 0.025f));
	UMaterialInstanceDynamic* Glass = Mid(Parent, FLinearColor(0.03f, 0.04f, 0.06f));
	Rig.TailMid = Mid(Parent, FLinearColor(0.6f, 0.05f, 0.05f));

	// Hero art, when the project has it. Loaded here and not before, so a
	// project that never imported any still builds and cooks; a reference
	// that fails to load falls through to the primitives with a warning
	// rather than an invisible car.
	UStaticMesh* HeroBody = (Hero && Hero->HasBody()) ? Hero->Body.LoadSynchronous() : nullptr;
	UStaticMesh* HeroWheel = (Hero && !Hero->Wheel.IsNull()) ? Hero->Wheel.LoadSynchronous() : nullptr;
	if (Hero && Hero->HasBody() && !HeroBody)
	{
		UE_LOG(LogTemp, Warning, TEXT("GRNCarFactory: hero body %s did not load; building primitives"),
			*Hero->Body.ToString());
	}

	// Web-build proportions × the 1.12 presence factor. Forward = +X.
	const float K = 1.12f;
	// The RX7 shares the Z's cab-back massing at primitive fidelity
	const bool bZX = Style == EGRNBodyStyle::ZX || Style == EGRNBodyStyle::RX7;
	const bool bGTR = Style == EGRNBodyStyle::GTR;

	// The size of the car, from the card of the car.
	//
	// This was one length for the fastbacks and one for everything else,
	// and — the part that mattered — ONE WIDTH, 1.9 m, for every machine
	// in the game. A supermini and a pickup came out of here the same
	// width. The web fits each car to the length on its own card and then
	// fits the width to it, because width is neither a constant per class
	// nor a slave to length: a longer car in a class is a little wider,
	// and the exponent is the whole of that claim.
	//
	// The reference machines and the exponent are published at
	// gamedata.bodyShape, so a car added to the roster is sized correctly
	// here without anybody editing this file.
	const float RefLen = StyleRefLength(Style);
	const float RefWidth = StyleRefWidth(Style);
	const float CarLen = LengthM > 1.f ? LengthM : RefLen;
	const float CarWidth = RefWidth * FMath::Pow(CarLen / RefLen, GRN_WIDTH_FOLLOWS_LENGTH);

	const float BodyLen = CarLen * K;
	const float BodyH = (bZX ? 0.62f : bGTR ? 0.76f : 0.72f) * K;
	const float TailX = -BodyLen * 0.5f;

	if (HeroBody)
	{
		// The scan, fitted to the length on the card: uniform scale so its
		// X extent is the car's length, standing on the road at Z 0. Its
		// own aero, lamps and glass come with it; the primitive kit and
		// wing are NOT layered on top of art that already has them.
		UStaticMeshComponent* Shell = NewObject<UStaticMeshComponent>(Parent);
		Shell->SetStaticMesh(HeroBody);
		Shell->RegisterComponent();
		Shell->AttachToComponent(AttachTo, FAttachmentTransformRules::KeepRelativeTransform);
		const FBox Bounds = HeroBody->GetBoundingBox();
		const FVector Size = Bounds.GetSize();
		const float Fit = Size.X > 1.f ? (BodyLen * 100.f) / Size.X : 1.f;
		Shell->SetRelativeScale3D(FVector(Fit));
		Shell->SetRelativeLocation(FVector(-Bounds.GetCenter().X * Fit, -Bounds.GetCenter().Y * Fit, -Bounds.Min.Z * Fit));
		if (Hero->PaintSlot >= 0 && Hero->PaintSlot < Shell->GetNumMaterials() && Rig.PaintMid)
		{
			Shell->SetMaterial(Hero->PaintSlot, Rig.PaintMid);
		}
		if (Hero->TailSlot >= 0 && Hero->TailSlot < Shell->GetNumMaterials() && Rig.TailMid)
		{
			Shell->SetMaterial(Hero->TailSlot, Rig.TailMid);
		}
		Shell->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	}
	else
	{
	// Lower body: one long slab, nose/tail wedges per silhouette
	Box(Parent, AttachTo, FVector(0, 0, 0.30f * K + BodyH * 0.5f),
		FVector(BodyLen, CarWidth * K, BodyH), Rig.PaintMid);

	// Glasshouse: cab-back fastback on the ZX, upright box otherwise
	const float CabLen = (bZX ? 2.2f : 1.9f) * K;
	const float CabX = (bZX ? -0.7f : -0.15f) * K;
	const float CabH = (bZX ? 0.42f : 0.5f) * K;
	Box(Parent, AttachTo, FVector(CabX, 0, 0.30f * K + BodyH + CabH * 0.5f),
		FVector(CabLen, CarWidth * 0.816f * K, CabH), Glass,
		FRotator(bZX ? -6.f : 0.f, 0.f, 0.f));

	// Nose wedge
	Box(Parent, AttachTo, FVector(BodyLen * 0.5f - 0.25f * K, 0, 0.30f * K + BodyH * 0.72f),
		FVector(0.7f * K, CarWidth * 0.974f * K, BodyH * 0.5f), Rig.PaintMid,
		FRotator(bZX ? 9.f : 5.f, 0.f, 0.f));

	// Tail lamps: quad rings on the coupe, a full-width band otherwise
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

	// Factory time-attack aero: swan-neck wing, splitter, canards, skirts.
	// The kit's wing replaces the garage part — never two wings.
	if (bAttackKit)
	{
		// Swan-neck GT wing well above the deck
		Box(Parent, AttachTo, FVector(TailX + 0.05f * K, 0, 1.62f * K),
			FVector(0.5f, 1.95f * K, 0.05f), Rig.PaintMid, FRotator(-10.f, 0.f, 0.f));
		for (float Y : { -0.55f, 0.55f })
		{
			Box(Parent, AttachTo, FVector(TailX + 0.12f * K, Y * K, 1.28f * K),
				FVector(0.2f, 0.05f, 0.6f), Dark, FRotator(9.f, 0.f, 0.f));
		}
		for (float Y : { -0.99f, 0.99f })
		{
			Box(Parent, AttachTo, FVector(TailX + 0.05f * K, Y * K, 1.62f * K),
				FVector(0.54f, 0.03f, 0.3f), Dark);
		}
		// Front splitter past the bumper, canards on the corners
		Box(Parent, AttachTo, FVector(BodyLen * 0.5f - 0.1f * K, 0, 0.14f * K),
			FVector(0.7f, 1.95f * K, 0.035f), Dark);
		for (float Side : { -1.f, 1.f })
		{
			for (float Z : { 0.34f, 0.47f })
			{
				Box(Parent, AttachTo, FVector(BodyLen * 0.5f - 0.16f * K, Side * 0.85f * K, Z * K),
					FVector(0.18f, 0.3f, 0.02f), Dark, FRotator(-14.f, 0.f, Side * 17.f));
			}
		}
		// Side skirts along the rockers
		for (float Side : { -1.f, 1.f })
		{
			Box(Parent, AttachTo, FVector(0, Side * 0.93f * K, 0.16f * K),
				FVector(2.7f * K, 0.08f, 0.1f), Dark);
		}
	}
	// Optional GT wing — the player's choice, never forced
	else if (bWing)
	{
		Box(Parent, AttachTo, FVector(TailX + 0.15f * K, 0, (bGTR ? 1.31f : 1.25f) * K),
			FVector(0.42f, 1.8f * K, 0.05f), Rig.PaintMid, FRotator(-7.f, 0.f, 0.f));
		for (float Y : { -0.62f, 0.62f })
		{
			Box(Parent, AttachTo, FVector(TailX + 0.18f * K, Y * K, 1.1f * K),
				FVector(0.16f, 0.06f, 0.26f), Dark);
		}
	}
	} // primitives

	// Wheels: cylinders on their sides, fronts forward per style stance.
	// The attack kit runs forged bronze; everything else gunmetal dark.
	UMaterialInstanceDynamic* WheelMat =
		bAttackKit ? Mid(Parent, FLinearColor(0.38f, 0.22f, 0.07f)) : Dark;
	const float WzF = (bZX ? 1.52f : bGTR ? 1.45f : 1.42f) * K;
	const float WzR = -(bZX ? 1.48f : bGTR ? 1.45f : 1.42f) * K;
	for (const FVector2D& W : { FVector2D(WzF, -0.94f * K), FVector2D(WzF, 0.94f * K),
	                            FVector2D(WzR, -0.94f * K), FVector2D(WzR, 0.94f * K) })
	{
		UStaticMeshComponent* Wheel = NewObject<UStaticMeshComponent>(Parent);
		Wheel->RegisterComponent();
		Wheel->AttachToComponent(AttachTo, FAttachmentTransformRules::KeepRelativeTransform);
		Wheel->SetRelativeLocation(FVector(W.X, W.Y, GRN_TYRE_RADIUS_M * K) * 100.f);
		if (HeroWheel)
		{
			// The art's wheel, scaled to the diameter the primitive had so
			// the hub height above stays right; mirrored onto the far side
			// so the face is outboard on both.
			Wheel->SetStaticMesh(HeroWheel);
			Rig.bHeroWheels = true;
			const FVector Size = HeroWheel->GetBoundingBox().GetSize();
			const float Fit = Size.Z > 1.f ? (0.8f * K * 100.f) / Size.Z : 1.f;
			Wheel->SetRelativeScale3D(FVector(Fit, W.Y < 0.f ? -Fit : Fit, Fit));
			if (Hero->WheelSlot >= 0 && Hero->WheelSlot < Wheel->GetNumMaterials())
			{
				Wheel->SetMaterial(Hero->WheelSlot, WheelMat);
			}
		}
		else
		{
			Wheel->SetStaticMesh(Cyl());
			Wheel->SetRelativeRotation(FRotator(0.f, 0.f, 90.f));
			Wheel->SetRelativeScale3D(FVector(0.8f * K, 0.29f * K, 0.8f * K));
			Wheel->SetMaterial(0, WheelMat);
		}
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
	// The tyre the web publishes → degrees per second at road speed
	const float DegPerSec = FMath::RadiansToDegrees(SpeedMs / GRN_TYRE_RADIUS_M);
	// The primitive is a cylinder rolled onto its side, so its own Z is
	// the axle and the spin is a local yaw; a hero wheel is authored with
	// the axle along Y, so its spin is a local pitch.
	const FRotator Step = Rig.bHeroWheels
		? FRotator(DegPerSec * Dt, 0.f, 0.f)
		: FRotator(0.f, DegPerSec * Dt, 0.f);
	for (UStaticMeshComponent* W : Rig.Wheels)
	{
		if (W) W->AddLocalRotation(Step);
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
