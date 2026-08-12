#include "GRNTrack.h"
#include "GRNTypes.h"
#include "Components/SplineComponent.h"

AGRNTrack::AGRNTrack()
{
	PrimaryActorTick.bCanEverTick = false;

	Spline = CreateDefaultSubobject<USplineComponent>(TEXT("Spline"));
	RootComponent = Spline;
	Spline->ClearSplinePoints(false);

	// Web (x, z) → UE (Y, X): forward down the corniche is +X, the sea
	// sits on the low-Y side for the whole coastal leg.
	const int32 Count = UE_ARRAY_COUNT(GRNControlPoints);
	for (int32 i = 0; i < Count; i++)
	{
		const FGRNTrackPoint& P = GRNControlPoints[i];
		Spline->AddSplinePoint(FVector(GRN_M(P.Z), GRN_M(P.X), 0.f), ESplineCoordinateSpace::World, false);
	}
	Spline->SetClosedLoop(true, true);
	Spline->UpdateSpline();
}

float AGRNTrack::LapLength() const
{
	return Spline->GetSplineLength();
}

float AGRNTrack::Wrap(float S) const
{
	const float L = LapLength();
	S = FMath::Fmod(S, L);
	return S < 0.f ? S + L : S;
}

float AGRNTrack::DeltaAhead(float FromS, float ToS) const
{
	const float L = LapLength();
	float D = Wrap(ToS) - Wrap(FromS);
	if (D > L * 0.5f) D -= L;
	if (D < -L * 0.5f) D += L;
	return D;
}

FVector AGRNTrack::PointAt(float S) const
{
	return Spline->GetLocationAtDistanceAlongSpline(Wrap(S), ESplineCoordinateSpace::World);
}

FVector AGRNTrack::TangentAt(float S) const
{
	FVector T = Spline->GetTangentAtDistanceAlongSpline(Wrap(S), ESplineCoordinateSpace::World);
	T.Z = 0.f;
	return T.GetSafeNormal();
}

FVector AGRNTrack::SideAt(float S) const
{
	// Right-hand side vector on the ground plane
	const FVector T = TangentAt(S);
	return FVector(-T.Y, T.X, 0.f);
}

void AGRNTrack::Pose(float S, float Lat, FVector& OutPos, FRotator& OutRot) const
{
	const FVector P = PointAt(S);
	const FVector Side = SideAt(S);
	OutPos = P + Side * Lat;
	OutRot = TangentAt(S).Rotation();
}
