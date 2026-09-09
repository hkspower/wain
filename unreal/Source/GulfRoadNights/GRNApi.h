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

/**
 * The connector's own log category.
 *
 * It used to write to LogTemp, along with everything else in the engine
 * that has not been given a category. That matters more here than it
 * looks: this subsystem is BUILT to fall back — a failed fetch logs a
 * warning and the game plays on with the tables baked into GRNTypes.h —
 * so the log line is the only evidence that anything went wrong, and it
 * was in the one channel nobody filters for.
 *
 * On macOS that is not a hypothetical. A packaged Mac build refuses
 * cleartext http:// under App Transport Security, so the fetch fails,
 * the fallback catches it, and the game looks exactly like a working
 * one. `LogGRNApi` and the GRN.Api.Status command below exist so the
 * answer to "is it actually connected" is one line, not an inference.
 */
DECLARE_LOG_CATEGORY_EXTERN(LogGRNApi, Log, All);

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

	/**
	 * Why the tables are what they are, in one line, for a human.
	 *
	 * Printed at boot and by the GRN.Api.Status console command. The
	 * point is that "connected" and "quietly using the baked tables"
	 * stop looking the same from inside the game.
	 */
	FString StatusLine() const;

	/** What went wrong on the last attempt, empty if nothing did. */
	FString LastError;
	/** The HTTP code the last attempt came back with, 0 if it never got
	 *  that far — which on macOS is what an ATS refusal looks like. */
	int32 LastResponseCode = 0;

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
