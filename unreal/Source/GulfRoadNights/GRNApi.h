#pragma once

// Live data API client.
//
// At boot the game asks the web build's /api/grn/v1/gamedata for the
// authoritative track, roster, showroom and handling constants. If the
// fetch succeeds the runtime tables replace the ones baked into
// GRNTypes.h; if it fails — offline, LAN party, Steam Deck on a plane —
// the baked tables stand in and the game plays exactly as before.
//
// The same subsystem talks to the hub server's REST surface for lap
// submission and cloud career sync.

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "GRNTypes.h"
#include "GRNApi.generated.h"

/** The payload version this client understands. */
#define GRN_API_VERSION 1

USTRUCT()
struct FGRNRuntimeRival
{
	GENERATED_BODY()

	UPROPERTY() FString Id;
	UPROPERTY() FString Name;
	UPROPERTY() FString ArabicName;
	UPROPERTY() FString Crew;
	UPROPERTY() FString Area;
	UPROPERTY() FColor BodyColor = FColor::White;
	UPROPERTY() float TopSpeedKmh = 240.f;
	UPROPERTY() int32 PrizeKd = 400;
	EGRNBodyStyle Style = EGRNBodyStyle::Sedan;
};

USTRUCT()
struct FGRNRuntimeCar
{
	GENERATED_BODY()

	UPROPERTY() FString Id;
	UPROPERTY() FString Name;
	UPROPERTY() int32 Price = 0;
	UPROPERTY() float Power = 1.f;
	UPROPERTY() float TopSpeedKmh = 180.f;
	UPROPERTY() float Grip = 12.f;
	UPROPERTY() float Brake = 26.f;
	UPROPERTY() FColor Paint = FColor::White;
	EGRNBodyStyle Style = EGRNBodyStyle::Sedan;
	/** Factory time-attack aero (wing, splitter, bronze wheels). */
	UPROPERTY() bool bAttackKit = false;
};

DECLARE_MULTICAST_DELEGATE_OneParam(FGRNOnGameDataReady, bool /*bFromNetwork*/);

UCLASS()
class UGRNApiSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;

	/** Where the web build lives. Override with -grnapi=<url> on the command line. */
	FString BaseUrl = TEXT("http://localhost:3000");
	/** Hub server REST root. Override with -grnhub=<url>. */
	FString HubUrl = TEXT("http://localhost:8787");

	/** Kick the boot fetch. Safe to call again; the last reply wins. */
	void FetchGameData();

	/** Fires once the tables are usable — from the network or the fallback. */
	FGRNOnGameDataReady OnGameDataReady;

	bool IsLive() const { return bLive; }
	bool IsReady() const { return bReady; }

	// ------------------------------------------------------------ tables
	// These prefer live data and fall back to the compiled-in tables, so
	// callers never branch on where the numbers came from.
	int32 NumRivals() const;
	FGRNRuntimeRival GetRival(int32 Index) const;
	int32 NumCars() const;
	FGRNRuntimeCar GetCar(int32 Index) const;
	/** Live track control points in UE space, or empty to use the baked ones. */
	const TArray<FVector>& GetTrackPoints() const { return TrackPoints; }

	// -------------------------------------------------------- hub writes
	void SubmitLap(const FString& PlayerName, int32 LapMs);
	void PushCareer(const FString& PlayerName, int32 RivalIndex, int32 Kd, int32 Xp);
	DECLARE_DELEGATE_ThreeParams(FGRNOnCareerPulled, bool /*bFound*/, int32 /*RivalIndex*/, int32 /*Kd*/);
	void PullCareer(const FString& PlayerName, FGRNOnCareerPulled Done);

private:
	void ParseGameData(const FString& Json);
	void FinishReady(bool bFromNetwork);

	bool bLive = false;   // served by the API rather than the baked tables
	bool bReady = false;  // safe to read
	TArray<FGRNRuntimeRival> Rivals;
	TArray<FGRNRuntimeCar> Cars;
	TArray<FVector> TrackPoints;
};
