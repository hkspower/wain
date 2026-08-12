#pragma once

// The TXR rules, Kuwait edition: cruise the loop, find the rival, flash
// three times inside a rolling window to challenge, and the trailing car
// bleeds Spirit Points until one bar is empty. Wins pay KD and XP;
// progress persists in a SaveGame slot.

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "GRNTypes.h"
#include "GRNGameMode.generated.h"

class AGRNTrack;
class AGRNVehiclePawn;
class AGRNRival;
class AGRNTraffic;
class AGRNWorldBuilder;
class UGRNSaveGame;
class ACameraActor;

UENUM()
enum class EGRNPhase : uint8 { Cruise, Cinematic, Battle, Results, Paused };

UCLASS()
class AGRNGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	AGRNGameMode();

	virtual void BeginPlay() override;
	virtual void Tick(float Dt) override;

	// ------------------------------------------------------ battle ritual
	void TryFlash();
	void TogglePause();

	EGRNPhase Phase = EGRNPhase::Cruise;

	UPROPERTY() AGRNTrack* Track = nullptr;
	UPROPERTY() AGRNVehiclePawn* Player = nullptr;
	UPROPERTY() AGRNRival* Rival = nullptr;

	// Live HUD state, drawn by AGRNHud
	FString Message;
	float MessageUntil = 0.f;
	int32 FlashCount = 0;
	float FlashWindowUntil = 0.f;

	// Career (persisted)
	int32 RivalIndex = 0;
	int32 Kd = 2500;
	int32 Xp = 0;

	// Pre-battle cinematic clock (wall time, 4.2 s, skippable)
	float CineT = 0.f;
	void SkipCinematic();

	/** Lives for the session; owns the data API and hub REST calls. */
	UPROPERTY() class UGRNApiSubsystem* Api = nullptr;

	/** Showroom: apply a car's spec + silhouette to the player. */
	void ApplyCar(int32 CarIdx);
	/** Dev showroom cycling (Tab / D-pad) until the UMG garage lands. */
	void CycleCar();
	int32 CurrentCarIdx = 0;
	FString CurrentCarId = TEXT("wain-special");

private:
	void BuildWorldAndStart(bool bLiveData);
	void SpawnRival();
	void StartBattle();
	void WinBattle();
	void LoseBattle();
	void ShowMessage(const FString& Text, float Seconds = 3.5f);
	void SaveProgress();
	void LoadProgress();
	void UpdateBattle(float Dt);
	void UpdateCinematic(float Dt);

	float BattleDriftBank = 0.f;
	UPROPERTY() TArray<AGRNTraffic*> Traffic;
	UPROPERTY() ACameraActor* CineCamera = nullptr;
	void UpdateTrafficCollisions(float Dt);
	static constexpr TCHAR SaveSlot[] = TEXT("GulfRoadNights");
};
