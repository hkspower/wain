#include "GRNShowcase.h"
#include "GRNGameMode.h"
#include "GRNVehiclePawn.h"
#include "GRNTrack.h"
#include "GRNTraffic.h"
#include "GRNRival.h"
#include "GRNApi.h"
#include "GRNTypes.h"
#include "Engine/StaticMesh.h"
#include "Kismet/GameplayStatics.h"

namespace
{
	AGRNGameMode* ShowcaseMode(UObject* WorldContextObject)
	{
		return Cast<AGRNGameMode>(UGameplayStatics::GetGameMode(WorldContextObject));
	}
}

bool UGRNShowcase::SelectCar(UObject* WorldContextObject, const FString& CarId)
{
	AGRNGameMode* GM = ShowcaseMode(WorldContextObject);
	if (!GM || !GM->Player)
	{
		UE_LOG(LogTemp, Warning, TEXT("GRNShowcase: no game mode or player yet — call this after the world has built"));
		return false;
	}
	// The same table ApplyCar reads: the live API's cars when it has
	// them, the compiled-in ones otherwise.
	const int32 Total = GM->Api ? GM->Api->NumCars() : GRNCarCount;
	for (int32 I = 0; I < Total; ++I)
	{
		const FString Id = GM->Api ? GM->Api->GetCar(I).Id : FString(GRNCars[I].Id);
		if (Id == CarId)
		{
			GM->ApplyCar(I);
			UE_LOG(LogTemp, Log, TEXT("GRNShowcase: player is now %s (car %d of %d)"), *CarId, I, Total);
			return true;
		}
	}
	UE_LOG(LogTemp, Warning, TEXT("GRNShowcase: no car called %s in %d"), *CarId, Total);
	return false;
}

bool UGRNShowcase::WearArt(UObject* WorldContextObject, UStaticMesh* Body, int32 PaintSlot, FName PaintParam)
{
	AGRNGameMode* GM = ShowcaseMode(WorldContextObject);
	if (!GM || !GM->Player || !Body)
	{
		UE_LOG(LogTemp, Warning, TEXT("GRNShowcase: WearArt needs a built world and a body mesh"));
		return false;
	}
	FGRNHeroAssets& Art = GM->Player->HeroAssets;
	Art.Body = TSoftObjectPtr<UStaticMesh>(Body);
	Art.Wheel.Reset();
	Art.PaintSlot = PaintSlot;
	Art.PaintParam = PaintParam;
	Art.TailSlot = -1;
	Art.TailParam = NAME_None;
	// The import is the whole car, wheels and all: the factory builds
	// none of its own. They do not turn, which a parked still never sees.
	Art.bBodyHasWheels = true;
	// Rebuild through the game's own path so the card's length, paint
	// law and finish still apply to whatever the art leaves to them.
	GM->ApplyCar(GM->CurrentCarIdx);
	UE_LOG(LogTemp, Log, TEXT("GRNShowcase: player wears %s (paint slot %d, parameter %s)"),
		*Body->GetName(), PaintSlot, *PaintParam.ToString());
	return true;
}

bool UGRNShowcase::ParkPlayer(UObject* WorldContextObject, float StationM, float LateralM, float YawOffsetDeg, bool bFreeze)
{
	AGRNGameMode* GM = ShowcaseMode(WorldContextObject);
	if (!GM || !GM->Player || !GM->Track)
	{
		UE_LOG(LogTemp, Warning, TEXT("GRNShowcase: ParkPlayer needs a built world"));
		return false;
	}
	AGRNVehiclePawn* P = GM->Player;
	// Track space is centimetres; the stations are the web build's metres.
	P->S = GM->Track->Wrap(StationM * 100.f);
	P->Lat = LateralM * 100.f;
	P->SpeedMs = 0.f;
	P->Heading = 0.f;
	P->DriftYaw = 0.f;
	FVector Pos;
	FRotator Rot;
	GM->Track->Pose(P->S, P->Lat, Pos, Rot);
	Rot.Yaw += YawOffsetDeg;
	P->SetActorLocationAndRotation(Pos, Rot);
	if (bFreeze)
	{
		// The pawn's tick runs the handling model, the camera and the
		// driver. A parked car wants none of them moving between the
		// warm-up frames and the one that is kept.
		P->SetActorTickEnabled(false);
	}
	UE_LOG(LogTemp, Log, TEXT("GRNShowcase: parked at %.0f m, lat %.2f m, yaw %+.0f%s"),
		StationM, LateralM, YawOffsetDeg, bFreeze ? TEXT(", frozen") : TEXT(""));
	return true;
}

int32 UGRNShowcase::ClearOthers(UObject* WorldContextObject)
{
	AGRNGameMode* GM = ShowcaseMode(WorldContextObject);
	if (!GM) return 0;
	int32 N = 0;
	auto Quiet = [&N](AActor* A)
	{
		if (!A) return;
		A->SetActorHiddenInGame(true);
		A->SetActorEnableCollision(false);
		A->SetActorTickEnabled(false);
		++N;
	};
	TArray<AActor*> Cars;
	UGameplayStatics::GetAllActorsOfClass(WorldContextObject, AGRNTraffic::StaticClass(), Cars);
	for (AActor* A : Cars) Quiet(A);
	Quiet(GM->Rival);
	UE_LOG(LogTemp, Log, TEXT("GRNShowcase: cleared %d other cars off the road"), N);
	return N;
}

FTransform UGRNShowcase::PlayerTransform(UObject* WorldContextObject)
{
	AGRNGameMode* GM = ShowcaseMode(WorldContextObject);
	return GM && GM->Player ? GM->Player->GetActorTransform() : FTransform::Identity;
}
