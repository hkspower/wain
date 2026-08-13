#include "GRNGameMode.h"
#include "GRNTrack.h"
#include "GRNVehiclePawn.h"
#include "GRNRival.h"
#include "GRNWorldBuilder.h"
#include "GRNSaveGame.h"
#include "GRNHud.h"
#include "GRNTraffic.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Kismet/GameplayStatics.h"
#include "GRNGraphics.h"
#include "GRNApi.h"
#include "Engine/GameInstance.h"

AGRNGameMode::AGRNGameMode()
{
	PrimaryActorTick.bCanEverTick = true;
	DefaultPawnClass = AGRNVehiclePawn::StaticClass();
	HUDClass = AGRNHud::StaticClass();
}

void AGRNGameMode::BeginPlay()
{
	Super::BeginPlay();

	// Renderer to its ceiling before anything draws
	GRNGraphics::ApplyMax(this);
	// Then the NVIDIA path and any -grn4k / -grn2k override on top
	GRNGraphics::ApplyCommandLineOverrides(this);

	// Ask the web build for the authoritative tables, then build the
	// world from whatever answers first — live data or the baked ones.
	// The fetch has its own 6 s timeout, so boot can never hang on it.
	Api = GetGameInstance()->GetSubsystem<UGRNApiSubsystem>();
	if (Api)
	{
		Api->OnGameDataReady.AddUObject(this, &AGRNGameMode::BuildWorldAndStart);
		Api->FetchGameData();
	}
	else
	{
		BuildWorldAndStart(false);
	}
}

void AGRNGameMode::BuildWorldAndStart(bool bLiveData)
{
	UWorld* World = GetWorld();
	Track = World->SpawnActor<AGRNTrack>();
	if (Api && bLiveData && Api->GetTrackPoints().Num() >= 4)
	{
		Track->RebuildFrom(Api->GetTrackPoints());
	}
	World->SpawnActor<AGRNWorldBuilder>()->Build(Track);

	Player = Cast<AGRNVehiclePawn>(UGameplayStatics::GetPlayerPawn(this, 0));
	if (Player)
	{
		Player->Track = Track;
		Player->S = 0.f;
		Player->Lat = GRNLanes[1];
	}

	LoadProgress();
	ApplyCar(CurrentCarIdx);
	// 30, matching the web build. A PC target has the headroom, and a
	// sparse corniche is the fastest way to make a city feel like a demo.
	for (int32 i = 0; i < 30; i++)
	{
		AGRNTraffic* T = World->SpawnActor<AGRNTraffic>();
		T->Init(Track, Player, i);
		Traffic.Add(T);
	}
	SpawnRival();

	const int32 Total = Api ? Api->NumRivals() : GRNRivalCount;
	ShowMessage(RivalIndex < Total
		? FString::Printf(TEXT("Find %s — close in and flash 3x to challenge"),
			*(Api ? Api->GetRival(RivalIndex).Name : FString(GRNRivals[RivalIndex].Name)))
		: TEXT("King of Gulf Road — every street is yours"));
	if (bLiveData)
	{
		UE_LOG(LogTemp, Log, TEXT("GRN: booted on live API data"));
	}
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
	if (Phase != EGRNPhase::Cinematic) UpdateTrafficCollisions(Dt);
}

void AGRNGameMode::UpdateTrafficCollisions(float Dt)
{
	// Ported from the web engine: severity comes from the closing speed,
	// the way it does on a real bumper — matching the flow and tapping a
	// car is a shunt, arriving 80 km/h faster is a wreck. Margins sized
	// to the 1.12x presence scale.
	if (!Player) return;
	using namespace GRNHandling;
	for (AGRNTraffic* T : Traffic)
	{
		const float DsM = Track->DeltaAhead(Player->S, T->S) / 100.f;
		const float DLatM = FMath::Abs(T->Lat - Player->Lat) / 100.f;
		if (FMath::Abs(DsM) < 4.4f && DLatM < 2.1f)
		{
			const float Rel = Player->SpeedMs - T->SpeedMs; // + = we ran into them
			const float Sev = FMath::Min(1.f, FMath::Abs(Rel) / TrafficClosingFull);
			if (Rel >= 0.f)
			{
				// We hit them: the closing speed is mostly shed, harder
				// hits shed proportionally more of it
				Player->SpeedMs = FMath::Max(0.f, T->SpeedMs + Rel * (0.4f - 0.25f * Sev));
				if (DsM >= 0.f) Player->S = Track->Wrap(T->S - GRN_M(5.0f));
			}
			else
			{
				// They hit us: shoved forward by a share of the striker's
				// momentum, never slingshotted to its full speed
				Player->SpeedMs += FMath::Abs(Rel) * 0.45f;
				if (DsM < 0.f) Player->S = Track->Wrap(T->S + GRN_M(5.0f));
			}
			// The nose glances off toward the open side
			const float Shove = (Player->Lat - T->Lat) >= 0.f ? 1.f : -1.f;
			Player->Lat += GRN_M(Shove * (0.4f + 0.9f * Sev));
			Player->Heading += Shove * 0.06f * (0.5f + Sev);
			Player->DriftYaw = Player->DriftYaw * 0.25f + Shove * 0.12f * Sev;
			if (Phase == EGRNPhase::Battle)
			{
				Player->Sp = FMath::Max(0.f, Player->Sp - FMath::RoundToFloat(4.f + 8.f * Sev));
			}
			break;
		}
	}
}

void AGRNGameMode::ApplyCar(int32 CarIdx)
{
	const int32 CarTotal = Api ? Api->NumCars() : GRNCarCount;
	CurrentCarIdx = FMath::Clamp(CarIdx, 0, CarTotal - 1);
	if (!Player) return;
	const FGRNRuntimeCar Car = Api
		? Api->GetCar(CurrentCarIdx)
		: [&] { FGRNRuntimeCar C; const FGRNCarDef& D = GRNCars[CurrentCarIdx];
			C.Id = D.Id; C.Name = D.Name; C.Price = D.Price; C.Power = D.Power;
			C.TopSpeed = D.TopSpeed; C.Grip = D.Grip; C.Brake = D.Brake;
			C.Paint = D.Paint; C.Style = D.Style; C.bAttackKit = D.bAttackKit; return C; }();
	Player->PowerMult = Car.Power;
	Player->TopSpeedBonus = Car.TopSpeed;
	Player->GripAccel = Car.Grip;
	Player->BrakeForce = Car.Brake;
	// Wing only if the GT Wing part is owned — the player's choice
	bool bWing = false;
	if (UGRNSaveGame* Save = Cast<UGRNSaveGame>(
		UGameplayStatics::LoadGameFromSlot(SaveSlot, 0)))
	{
		bWing = Save->OwnedParts.Contains(TEXT("spoiler"));
	}
	Player->BuildRig(Car.Style, FLinearColor(Car.Paint), bWing, Car.bAttackKit);
	CurrentCarId = Car.Id;
}

void AGRNGameMode::CycleCar()
{
	if (Phase != EGRNPhase::Cruise) return;
	const int32 CarTotal = Api ? Api->NumCars() : GRNCarCount;
	ApplyCar((CurrentCarIdx + 1) % CarTotal);
	ShowMessage(FString::Printf(TEXT("Machine: %s"), *CurrentCarId), 2.f);
	SaveProgress();
}

void AGRNGameMode::SpawnRival()
{
	if (Rival) { Rival->Destroy(); Rival = nullptr; }
	const int32 Total = Api ? Api->NumRivals() : GRNRivalCount;
	if (RivalIndex >= Total || !Player) return;
	Rival = GetWorld()->SpawnActor<AGRNRival>();
	Rival->Api = Api;
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
		if (!CineCamera) CineCamera = GetWorld()->SpawnActor<ACameraActor>();
		if (APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0))
		{
			PC->SetViewTargetWithBlend(CineCamera, 0.f);
		}
		ShowMessage(FString::Printf(TEXT("CHALLENGER — %s · %s"),
			*Rival->DisplayName(), *Rival->CrewName()), 4.5f);
	}
}

void AGRNGameMode::UpdateCinematic(float Dt)
{
	// Wall-clock: dilation slows Dt, so divide it back out
	CineT += Dt / FMath::Max(0.05f, UGameplayStatics::GetGlobalTimeDilation(this));
	if (CineT >= 4.2f) { SkipCinematic(); return; }
	if (!CineCamera || !Rival || !Player) return;

	// Same three shots as the web build: orbit the rival's machine, a low
	// side pass of yours, then fall back into the chase.
	const float T = CineT;
	auto Ease = [](float X) { X = FMath::Clamp(X, 0.f, 1.f); return 1.f - FMath::Square(1.f - X); };
	FVector Focus, Cam;
	if (T < 1.8f)
	{
		const float K = Ease(T / 1.8f);
		FVector Pos; FRotator Rot;
		Track->Pose(Rival->S, Rival->Lat, Pos, Rot);
		const FVector Fwd = Track->TangentAt(Rival->S);
		const FVector Side = Track->SideAt(Rival->S);
		const float A = 2.55f - 1.35f * K;
		Cam = Pos + (Fwd * FMath::Cos(A) + Side * FMath::Sin(A)) * GRN_M(6.2f - 1.2f * K)
			+ FVector(0, 0, GRN_M(1.5f - 0.7f * K));
		Focus = Pos + FVector(0, 0, GRN_M(0.6f));
	}
	else if (T < 3.1f)
	{
		const float K = Ease((T - 1.8f) / 1.3f);
		FVector Pos; FRotator Rot;
		Track->Pose(Player->S, Player->Lat, Pos, Rot);
		const FVector Fwd = Track->TangentAt(Player->S);
		const FVector Side = Track->SideAt(Player->S);
		Cam = Pos + Side * GRN_M(4.6f) + Fwd * GRN_M(2.2f - 2.8f * K) + FVector(0, 0, GRN_M(1.05f));
		Focus = Pos + FVector(0, 0, GRN_M(0.55f));
	}
	else
	{
		const float K = Ease((T - 3.1f) / 1.1f);
		FVector Pos; FRotator Rot;
		Track->Pose(Player->S, Player->Lat, Pos, Rot);
		const FVector Fwd = Track->TangentAt(Player->S);
		const FVector Side = Track->SideAt(Player->S);
		const FVector From = Pos + Side * GRN_M(4.2f) - Fwd * GRN_M(2.5f) + FVector(0, 0, GRN_M(1.1f));
		const FVector To = Pos - Fwd * GRN_M(9.5f) + FVector(0, 0, GRN_M(3.4f));
		Cam = FMath::Lerp(From, To, K);
		Focus = Pos + Fwd * GRN_M(K * 14.f) + FVector(0, 0, GRN_M(FMath::Lerp(0.55f, 1.4f, K)));
	}
	CineCamera->SetActorLocation(Cam);
	CineCamera->SetActorRotation((Focus - Cam).Rotation());
}

void AGRNGameMode::SkipCinematic()
{
	if (Phase != EGRNPhase::Cinematic) return;
	UGameplayStatics::SetGlobalTimeDilation(this, 1.f);
	if (APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0))
	{
		PC->SetViewTargetWithBlend(Player, 0.3f); // hand back to the chase
	}
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

	const int32 Payout = Api ? Api->GetRival(RivalIndex).PrizeKd : 400 + RivalIndex * 300;
	Kd += Payout;
	Xp += 150 + 40 * (RivalIndex + 1) + FMath::Min(120, FMath::RoundToInt(BattleDriftBank / 25.f));
	RivalIndex++;
	SaveProgress();

	const int32 Total = Api ? Api->NumRivals() : GRNRivalCount;
	if (RivalIndex >= Total)
	{
		ShowMessage(TEXT("KING OF GULF ROAD — كل الشوارع لك"), 6.f);
	}
	else
	{
		ShowMessage(FString::Printf(TEXT("VICTORY — +%d KD. Next: %s"), Payout,
			*(Api ? Api->GetRival(RivalIndex).Name : FString(GRNRivals[RivalIndex].Name))), 4.f);
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
		*Rival->DisplayName()), 4.f);
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
	Save->CurrentCar = CurrentCarId;
	UGameplayStatics::SaveGameToSlot(Save, SaveSlot, 0);
	// Mirror the career to the hub so any device can pick it up
	if (Api) Api->PushCareer(TEXT("player"), RivalIndex, Kd, Xp);
}

void AGRNGameMode::LoadProgress()
{
	if (UGRNSaveGame* Save = Cast<UGRNSaveGame>(UGameplayStatics::LoadGameFromSlot(SaveSlot, 0)))
	{
		RivalIndex = FMath::Clamp(Save->RivalIndex, 0, Api ? Api->NumRivals() : GRNRivalCount);
		Kd = Save->Kd;
		Xp = Save->Xp;
		const int32 CarTotal = Api ? Api->NumCars() : GRNCarCount;
		for (int32 i = 0; i < CarTotal; i++)
		{
			const FString Id = Api ? Api->GetCar(i).Id : FString(GRNCars[i].Id);
			if (Save->CurrentCar == Id) { CurrentCarIdx = i; break; }
		}
	}
}
