#include "GRNGameMode.h"
#include "GRNTrack.h"
#include "GRNVehiclePawn.h"
#include "GRNRival.h"
#include "GRNWorldBuilder.h"
#include "GRNSaveGame.h"
#include "GRNHud.h"
#include "Kismet/GameplayStatics.h"

AGRNGameMode::AGRNGameMode()
{
	PrimaryActorTick.bCanEverTick = true;
	DefaultPawnClass = AGRNVehiclePawn::StaticClass();
	HUDClass = AGRNHud::StaticClass();
}

void AGRNGameMode::BeginPlay()
{
	Super::BeginPlay();

	UWorld* World = GetWorld();
	Track = World->SpawnActor<AGRNTrack>();
	World->SpawnActor<AGRNWorldBuilder>()->Build(Track);

	Player = Cast<AGRNVehiclePawn>(UGameplayStatics::GetPlayerPawn(this, 0));
	if (Player)
	{
		Player->Track = Track;
		Player->S = 0.f;
		Player->Lat = GRNLanes[1];
	}

	LoadProgress();
	SpawnRival();
	ShowMessage(RivalIndex < GRNRivalCount
		? FString::Printf(TEXT("Find %s — close in and flash 3x to challenge"), GRNRivals[RivalIndex].Name)
		: TEXT("King of Gulf Road — every street is yours"));
}

void AGRNGameMode::Tick(float Dt)
{
	Super::Tick(Dt);
	switch (Phase)
	{
	case EGRNPhase::Battle: UpdateBattle(Dt); break;
	case EGRNPhase::Cinematic: UpdateCinematic(Dt); break;
	default: break;
	}
}

void AGRNGameMode::SpawnRival()
{
	if (Rival) { Rival->Destroy(); Rival = nullptr; }
	if (RivalIndex >= GRNRivalCount || !Player) return;
	Rival = GetWorld()->SpawnActor<AGRNRival>();
	Rival->Init(Track, Player, RivalIndex);
}

void AGRNGameMode::TryFlash()
{
	if (Phase != EGRNPhase::Cruise || !Rival || Rival->State != EGRNRivalState::Cruise) return;
	const float GapM = Track->DeltaAhead(Player->S, Rival->S) / 100.f;
	if (GapM < 2.f || GapM > GRNHandling::FlashRangeM) return;

	const float Now = GetWorld()->GetTimeSeconds();
	if (Now > FlashWindowUntil) FlashCount = 0;
	FlashWindowUntil = Now + 3.f;
	FlashCount++;

	if (FlashCount >= 3)
	{
		FlashCount = 0;
		// The pre-battle film: slow-motion orbit, then the green flag
		Phase = EGRNPhase::Cinematic;
		CineT = 0.f;
		UGameplayStatics::SetGlobalTimeDilation(this, 0.22f);
		ShowMessage(FString::Printf(TEXT("CHALLENGER — %s · %s"),
			GRNRivals[Rival->DefIndex].Name, GRNRivals[Rival->DefIndex].Crew), 4.5f);
	}
}

void AGRNGameMode::UpdateCinematic(float Dt)
{
	// Wall-clock: dilation slows Dt, so divide it back out
	CineT += Dt / FMath::Max(0.05f, UGameplayStatics::GetGlobalTimeDilation(this));
	if (CineT >= 4.2f) SkipCinematic();
}

void AGRNGameMode::SkipCinematic()
{
	if (Phase != EGRNPhase::Cinematic) return;
	UGameplayStatics::SetGlobalTimeDilation(this, 1.f);
	StartBattle();
}

void AGRNGameMode::StartBattle()
{
	Phase = EGRNPhase::Battle;
	Player->Sp = 100.f;
	Rival->Sp = 100.f;
	Rival->State = EGRNRivalState::Battle;
	BattleDriftBank = 0.f;
	Player->DriftRun = 0.f;
	ShowMessage(TEXT("GO — يلا!"), 2.5f);
}

void AGRNGameMode::UpdateBattle(float Dt)
{
	if (!Rival || !Player) return;
	const float GapM = Track->DeltaAhead(Player->S, Rival->S) / 100.f;

	// The trailing car bleeds SP; big gaps bleed faster — identical
	// drain curve to the web engine
	if (GapM > 4.f)
	{
		float Drain = 1.7f + FMath::Min(GapM, 160.f) * 0.04f;
		if (GapM > 230.f) Drain += 16.f;
		Player->Sp = FMath::Max(0.f, Player->Sp - Drain * Dt);
	}
	else if (GapM < -4.f)
	{
		const float Lead = -GapM;
		float Drain = 1.7f + FMath::Min(Lead, 160.f) * 0.04f;
		if (Lead > 230.f) Drain += 16.f;
		Rival->Sp = FMath::Max(0.f, Rival->Sp - Drain * Dt);
	}

	if (Rival->Sp <= 0.f) WinBattle();
	else if (Player->Sp <= 0.f) LoseBattle();
}

void AGRNGameMode::WinBattle()
{
	Rival->State = EGRNRivalState::Defeated;
	Phase = EGRNPhase::Cruise;
	BattleDriftBank += Player->DriftRun;
	Player->DriftRun = 0.f;

	const int32 Payout = 400 + RivalIndex * 300;
	Kd += Payout;
	Xp += 150 + 40 * (RivalIndex + 1) + FMath::Min(120, FMath::RoundToInt(BattleDriftBank / 25.f));
	RivalIndex++;
	SaveProgress();

	if (RivalIndex >= GRNRivalCount)
	{
		ShowMessage(TEXT("KING OF GULF ROAD — كل الشوارع لك"), 6.f);
	}
	else
	{
		ShowMessage(FString::Printf(TEXT("VICTORY — +%d KD. Next: %s"), Payout, GRNRivals[RivalIndex].Name), 4.f);
		FTimerHandle H;
		GetWorldTimerManager().SetTimer(H, [this]() { SpawnRival(); }, 2.6f, false);
	}
}

void AGRNGameMode::LoseBattle()
{
	Rival->State = EGRNRivalState::Cruise;
	Phase = EGRNPhase::Cruise;
	Xp += 30;
	SaveProgress();
	ShowMessage(FString::Printf(TEXT("DEFEATED — %s takes the night. Flash to rematch"),
		GRNRivals[Rival->DefIndex].Name), 4.f);
	Rival->Sp = 100.f;
	Player->Sp = 100.f;
}

void AGRNGameMode::TogglePause()
{
	if (Phase == EGRNPhase::Cinematic) { SkipCinematic(); return; }
	APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0);
	const bool bNow = !UGameplayStatics::IsGamePaused(this);
	UGameplayStatics::SetGamePaused(this, bNow);
	if (PC) PC->bShowMouseCursor = bNow;
}

void AGRNGameMode::ShowMessage(const FString& Text, float Seconds)
{
	Message = Text;
	MessageUntil = GetWorld()->GetTimeSeconds() + Seconds;
}

void AGRNGameMode::SaveProgress()
{
	UGRNSaveGame* Save = Cast<UGRNSaveGame>(
		UGameplayStatics::CreateSaveGameObject(UGRNSaveGame::StaticClass()));
	Save->RivalIndex = RivalIndex;
	Save->Kd = Kd;
	Save->Xp = Xp;
	UGameplayStatics::SaveGameToSlot(Save, SaveSlot, 0);
}

void AGRNGameMode::LoadProgress()
{
	if (UGRNSaveGame* Save = Cast<UGRNSaveGame>(UGameplayStatics::LoadGameFromSlot(SaveSlot, 0)))
	{
		RivalIndex = FMath::Clamp(Save->RivalIndex, 0, GRNRivalCount);
		Kd = Save->Kd;
		Xp = Save->Xp;
	}
}
