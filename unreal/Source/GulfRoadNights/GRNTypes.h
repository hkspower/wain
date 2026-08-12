#pragma once

// GENERATED FILE — do not edit by hand.
// Produced by scripts/export-unreal-data.mjs from the web build's
// src/game/{track,rivals,mods}.ts. Regenerate with:  npm run sync:unreal
//
// One web unit = one metre = 100 UE units (GRN_M). The handling block
// at the bottom mirrors src/game/engine.ts; the generator carries it so
// a regeneration never loses it.

#include "CoreMinimal.h"

#define GRN_M(x) ((x) * 100.0f)

static const float GRNRoadHalfWidth = GRN_M(7.0f);
static const float GRNLanes[4] = { GRN_M(-5.25f), GRN_M(-1.75f), GRN_M(1.75f), GRN_M(5.25f) };

struct FGRNTrackPoint { float X; float Z; };
static const FGRNTrackPoint GRNControlPoints[] = {
	{ 800, 0 },
	{ 770, -350 },
	{ 820, -700 },
	{ 760, -1100 },
	{ 830, -1500 },
	{ 760, -1950 },
	{ 800, -2350 },
	{ 850, -2700 },
	{ 1050, -2950 },
	{ 1400, -2900 },
	{ 1650, -2500 },
	{ 1700, -2000 },
	{ 1620, -1400 },
	{ 1700, -800 },
	{ 1650, -300 },
	{ 1400, 150 },
	{ 1050, 200 },
};

// ------------------------------------------------------------- rivals

enum class EGRNBodyStyle : uint8 { Sedan, ZX, GTR };

struct FGRNRivalDef
{
	const TCHAR* Name;
	const TCHAR* ArabicName;
	const TCHAR* Crew;
	const TCHAR* Area;
	FColor BodyColor;
	float TopSpeedKmh;
	EGRNBodyStyle Style;
};

static const FGRNRivalDef GRNRivals[] = {
	{ TEXT("Abu Shanab"), TEXT("أبو شنب"), TEXT("Salmiya Street Kings"), TEXT("Salmiya"), FColor(0xC8, 0xCD, 0xD6), 232.0f, EGRNBodyStyle::Sedan },
	{ TEXT("Bint Al-Deera"), TEXT("بنت الديرة"), TEXT("Gulf Road Gazelles"), TEXT("Sharq"), FColor(0xB8, 0x4D, 0xD6), 246.0f, EGRNBodyStyle::Sedan },
	{ TEXT("Al-Daboos"), TEXT("الدبوس"), TEXT("Hawally Night Hawks"), TEXT("Hawally"), FColor(0xF5, 0xC2, 0x11), 261.0f, EGRNBodyStyle::ZX },
	{ TEXT("Bu Machboos"), TEXT("بو مجبوس"), TEXT("Fahaheel Phantoms"), TEXT("Fahaheel"), FColor(0xE8, 0x64, 0x1B), 277.0f, EGRNBodyStyle::GTR },
	{ TEXT("Al-Saqer"), TEXT("الصقر"), TEXT("Jahra Junoon"), TEXT("Jahra"), FColor(0xC1, 0x12, 0x1F), 293.0f, EGRNBodyStyle::ZX },
	{ TEXT("Shabah Al-Khaleej"), TEXT("شبح الخليج"), TEXT("???"), TEXT("Gulf Road"), FColor(0x0A, 0x0A, 0x0C), 318.0f, EGRNBodyStyle::GTR },
};
static const int32 GRNRivalCount = UE_ARRAY_COUNT(GRNRivals);

// ------------------------------------------------------------- showroom

struct FGRNCarDef
{
	const TCHAR* Id;
	const TCHAR* Name;
	int32 Price;
	float Power;
	float TopSpeed;
	float Grip;
	float Brake;
	FColor Paint;
	EGRNBodyStyle Style;
};

static const FGRNCarDef GRNCars[] = {
	{ TEXT("sahara-v12"), TEXT("Sahara GT-12"), 96000, 1.62f, 26.0f, 16.4f, 42.0f, FColor(0xB8, 0x86, 0x0B), EGRNBodyStyle::ZX },
	{ TEXT("falcon-720"), TEXT("Falcon 720 Veloce"), 71000, 1.50f, 21.0f, 15.8f, 40.0f, FColor(0xC1, 0x12, 0x1F), EGRNBodyStyle::ZX },
	{ TEXT("storm-s8"), TEXT("Desert Storm S8"), 54000, 1.40f, 17.0f, 15.2f, 38.0f, FColor(0x1F, 0x29, 0x33), EGRNBodyStyle::Sedan },
	{ TEXT("kaiju-r"), TEXT("Kaiju R"), 38000, 1.34f, 15.0f, 16.2f, 38.0f, FColor(0x3F, 0x66, 0xC4), EGRNBodyStyle::GTR },
	{ TEXT("zeta-300"), TEXT("Zeta 300"), 27000, 1.26f, 12.0f, 13.9f, 34.0f, FColor(0xC1, 0x27, 0x2D), EGRNBodyStyle::ZX },
	{ TEXT("gulf-coupe-rs"), TEXT("Gulf Coupe RS"), 33000, 1.28f, 13.0f, 14.6f, 35.0f, FColor(0x2E, 0x8F, 0x96), EGRNBodyStyle::Sedan },
	{ TEXT("salmiya-turbo"), TEXT("Salmiya Turbo GT"), 24000, 1.20f, 10.0f, 13.8f, 32.0f, FColor(0xB8, 0x4D, 0xD6), EGRNBodyStyle::Sedan },
	{ TEXT("hawally-2t"), TEXT("Hawally Sport 2.0T"), 16000, 1.12f, 7.0f, 13.2f, 30.0f, FColor(0xF5, 0xC2, 0x11), EGRNBodyStyle::Sedan },
	{ TEXT("deera-sedan"), TEXT("Deera Sedan"), 8500, 1.05f, 4.0f, 12.6f, 28.0f, FColor(0xDF, 0xE3, 0xE8), EGRNBodyStyle::Sedan },
	{ TEXT("jahra-pickup"), TEXT("Jahra Pickup"), 6000, 1.00f, 2.0f, 12.0f, 27.0f, FColor(0x6E, 0x7F, 0x8D), EGRNBodyStyle::Sedan },
	{ TEXT("sharq-hatch"), TEXT("Sharq Hatch"), 2200, 0.98f, 1.0f, 12.4f, 27.0f, FColor(0x16, 0xA3, 0x4A), EGRNBodyStyle::Sedan },
	{ TEXT("wain-special"), TEXT("Wain Special"), 0, 1.00f, 0.0f, 12.0f, 26.0f, FColor(0xF2, 0xF4, 0xF7), EGRNBodyStyle::Sedan },
};
static const int32 GRNCarCount = UE_ARRAY_COUNT(GRNCars);

// -------------------------------------------------------- handling model
// Mirrors src/game/engine.ts. If tuning changes there, update here (the
// generator owns this block, so edit the generator).

namespace GRNHandling
{
	constexpr float Ceiling = 115.f;
	constexpr float ThrustK = 19.f;
	constexpr float DragA = 0.0012f;
	constexpr float DragB = 1.2f;
	constexpr float SteerSmoothRate = 7.f;
	constexpr float CasterRate = 2.4f;
	constexpr float HeadingClamp = 0.45f;
	constexpr float FlashRangeM = 60.f;

	constexpr float DriftMinSpeed = 14.f;
	constexpr float DriftAngleBase = 0.38f;
	constexpr float DriftAngleSpeedK = 0.28f;
	constexpr float DriftEngageRate = 3.4f;
	constexpr float DriftRecoverRate = 2.3f;
	constexpr float DriftYawClamp = 0.75f;
	constexpr float DriftLatScrub = 0.5f;
	constexpr float DriftDriveLoss = 1.1f;
}
