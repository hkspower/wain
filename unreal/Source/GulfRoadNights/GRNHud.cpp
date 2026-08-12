#include "GRNHud.h"
#include "GRNGameMode.h"
#include "GRNVehiclePawn.h"
#include "GRNRival.h"
#include "GRNTrack.h"
#include "GRNApi.h"
#include "Engine/Canvas.h"
#include "Kismet/GameplayStatics.h"

void AGRNHud::DrawBar(float X, float Y, float W, float H, float Frac, FLinearColor Fill)
{
	DrawRect(FLinearColor(0.f, 0.f, 0.f, 0.55f), X, Y, W, H);
	DrawRect(Fill, X + 2, Y + 2, (W - 4) * FMath::Clamp(Frac, 0.f, 1.f), H - 4);
}

void AGRNHud::DrawHUD()
{
	Super::DrawHUD();
	AGRNGameMode* GM = Cast<AGRNGameMode>(UGameplayStatics::GetGameMode(this));
	if (!GM || !GM->Player || !Canvas) return;

	const float W = Canvas->SizeX;
	const float H = Canvas->SizeY;
	UFont* Font = GEngine->GetLargeFont();

	// Speed cluster, bottom left
	const int32 Kmh = FMath::RoundToInt(GM->Player->SpeedMs * 3.6f);
	DrawText(FString::Printf(TEXT("%d"), Kmh), FLinearColor::White, 40, H - 130, Font, 4.f);
	DrawText(TEXT("KM/H"), FLinearColor(1, 1, 1, 0.6f), 44, H - 44, Font, 1.f);

	// Roster progress, top left
	DrawText(FString::Printf(TEXT("RIVALS BEATEN: %d / %d   %d KD"),
		GM->RivalIndex, GM->Api ? GM->Api->NumRivals() : GRNRivalCount, GM->Kd),
		FLinearColor(1.f, 0.77f, 0.36f), 40, 36, Font, 1.2f);

	// Battle: twin SP bars top centre, drain mirrored from the game mode
	if (GM->Phase == EGRNPhase::Battle && GM->Rival)
	{
		const float BarW = FMath::Min(560.f, W * 0.6f);
		const float BX = (W - BarW) * 0.5f;
		DrawBar(BX, 30, BarW, 20, GM->Player->Sp / 100.f, FLinearColor(0.2f, 0.83f, 0.6f));
		DrawBar(BX, 58, BarW, 20, GM->Rival->Sp / 100.f, FLinearColor(0.96f, 0.25f, 0.37f));
		DrawText(GM->Rival->DisplayName(), FLinearColor::White, BX, 84, Font, 1.1f);
	}
	else if (GM->Rival && GM->Rival->State == EGRNRivalState::Cruise)
	{
		const float GapM = GM->Track->DeltaAhead(GM->Player->S, GM->Rival->S) / 100.f;
		if (FMath::Abs(GapM) < 900.f)
		{
			DrawText(FString::Printf(TEXT("Rival %d m %s"),
				FMath::Abs(FMath::RoundToInt(GapM)), GapM >= 0 ? TEXT("ahead") : TEXT("behind")),
				FLinearColor(1.f, 0.77f, 0.36f), W * 0.5f - 70, 90, Font, 1.1f);
			if (GapM >= 2.f && GapM <= GRNHandling::FlashRangeM)
			{
				DrawText(TEXT("FLASH 3x TO CHALLENGE  [F / gamepad X]"),
					FLinearColor(0.5f, 0.89f, 1.f), W * 0.5f - 150, 116, Font, 1.1f);
			}
		}
	}

	// Drift readout
	const float DriftDeg = FMath::RadiansToDegrees(FMath::Abs(GM->Player->DriftYaw));
	if (DriftDeg > 8.f)
	{
		DrawText(FString::Printf(TEXT("DRIFT %d°  +%d"),
			FMath::RoundToInt(DriftDeg), FMath::RoundToInt(GM->Player->DriftRun)),
			FLinearColor(0.5f, 0.89f, 1.f), W * 0.5f - 60, H * 0.62f, Font, 1.4f);
	}

	// Message toast
	if (GetWorld()->GetTimeSeconds() < GM->MessageUntil)
	{
		DrawText(GM->Message, FLinearColor::White, W * 0.5f - GM->Message.Len() * 5.5f, H * 0.32f, Font, 1.6f);
	}

	// Pause hint
	if (UGameplayStatics::IsGamePaused(this))
	{
		DrawRect(FLinearColor(0.f, 0.f, 0.f, 0.6f), 0, 0, W, H);
		DrawText(TEXT("PAUSED — Esc / Start to resume"), FLinearColor::White, W * 0.5f - 150, H * 0.45f, Font, 1.8f);
	}
}
