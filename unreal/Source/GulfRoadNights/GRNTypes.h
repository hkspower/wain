#pragma once

// Shared data for Gulf Road Nights — a 1:1 port of the web game's
// src/game/{track,rivals,mods}.ts. One web unit = one metre = 100 UE
// units; the GRN_M macro keeps every ported constant readable.

#include "CoreMinimal.h"

#define GRN_M(x) ((x) * 100.0f)

// One unit = one metre. The circuit traces the real Gulf Road: south
// along the corniche from Kuwait Towers past Salmiya to Ras Al-Ard,
// then back north on the inland expressway.
// (Web z maps to UE X-forward, web x to UE Y — a straight axis swap.)
static const float GRNRoadHalfWidth = GRN_M(7.0f); // 4 lanes, 3.5 m each
static const float GRNLanes[4] = { GRN_M(-5.25f), GRN_M(-1.75f), GRN_M(1.75f), GRN_M(5.25f) };

struct FGRNTrackPoint { float X; float Z; };
static const FGRNTrackPoint GRNControlPoints[] = {
	{ 800, 0 }, { 770, -350 }, { 820, -700 }, { 760, -1100 },
	{ 830, -1500 }, { 760, -1950 }, { 800, -2350 }, { 850, -2700 },
	{ 1050, -2950 }, { 1400, -2900 },
	{ 1650, -2500 }, { 1700, -2000 }, { 1620, -1400 }, { 1700, -800 }, { 1650, -300 },
	{ 1400, 150 }, { 1050, 200 },
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
	{ TEXT("Abu Shanab"),       TEXT("أبو شنب"),   TEXT("Salmiya Street Kings"), TEXT("Salmiya"),  FColor(0xC8, 0xCD, 0xD6), 232.f, EGRNBodyStyle::Sedan },
	{ TEXT("Bint Al-Deera"),    TEXT("بنت الديرة"), TEXT("Gulf Road Gazelles"),   TEXT("Sharq"),    FColor(0xB8, 0x4D, 0xD6), 246.f, EGRNBodyStyle::Sedan },
	{ TEXT("Al-Daboos"),        TEXT("الدبوس"),    TEXT("Hawally Night Hawks"),  TEXT("Hawally"),  FColor(0xF5, 0xC2, 0x11), 261.f, EGRNBodyStyle::ZX },
	{ TEXT("Bu Machboos"),      TEXT("بو مجبوس"),  TEXT("Fahaheel Phantoms"),    TEXT("Fahaheel"), FColor(0xE8, 0x64, 0x1B), 277.f, EGRNBodyStyle::GTR },
	{ TEXT("Al-Saqer"),         TEXT("الصقر"),     TEXT("Jahra Junoon"),         TEXT("Jahra"),    FColor(0xC1, 0x12, 0x1F), 293.f, EGRNBodyStyle::ZX },
	{ TEXT("Shabah Al-Khaleej"),TEXT("شبح الخليج"), TEXT("???"),                  TEXT("Gulf Road"),FColor(0x14, 0x16, 0x1C), 312.f, EGRNBodyStyle::GTR },
};
static const int32 GRNRivalCount = UE_ARRAY_COUNT(GRNRivals);

// ------------------------------------------------------------- showroom

struct FGRNCarDef
{
	const TCHAR* Id;
	const TCHAR* Name;
	int32 Price;      // KD
	float Power;      // accel multiplier
	float TopSpeed;   // ceiling bonus (km/h-ish, matches the web model)
	float Grip;
	float Brake;
	FColor Paint;
	EGRNBodyStyle Style;
};

static const FGRNCarDef GRNCars[] = {
	{ TEXT("sahara-v12"),  TEXT("Sahara GT-12"),      96000, 1.62f, 26.f, 16.4f, 42.f, FColor(0xB8, 0x86, 0x0B), EGRNBodyStyle::ZX },
	{ TEXT("falcon-720"),  TEXT("Falcon 720 Veloce"), 71000, 1.50f, 21.f, 15.8f, 40.f, FColor(0xC1, 0x12, 0x1F), EGRNBodyStyle::ZX },
	{ TEXT("kaiju-r"),     TEXT("Kaiju R"),           38000, 1.34f, 15.f, 16.2f, 38.f, FColor(0x3F, 0x66, 0xC4), EGRNBodyStyle::GTR },
	{ TEXT("zeta-300"),    TEXT("Zeta 300"),          27000, 1.26f, 12.f, 13.9f, 34.f, FColor(0xC1, 0x27, 0x2D), EGRNBodyStyle::ZX },
	{ TEXT("gulf-coupe"),  TEXT("Gulf Coupe RS"),     33000, 1.28f, 13.f, 14.6f, 35.f, FColor(0x2E, 0x8F, 0x96), EGRNBodyStyle::Sedan },
	{ TEXT("salmiya-t"),   TEXT("Salmiya Turbo GT"),  24000, 1.20f, 10.f, 13.8f, 32.f, FColor(0xB8, 0x4D, 0xD6), EGRNBodyStyle::Sedan },
	{ TEXT("hawally-2t"),  TEXT("Hawally Sport 2.0T"),16000, 1.12f,  7.f, 13.2f, 30.f, FColor(0xF5, 0xC2, 0x11), EGRNBodyStyle::Sedan },
	{ TEXT("wain-special"),TEXT("Wain Special"),          0, 1.00f,  0.f, 12.0f, 26.f, FColor(0xF2, 0xF4, 0xF7), EGRNBodyStyle::Sedan },
};
static const int32 GRNCarCount = UE_ARRAY_COUNT(GRNCars);

// -------------------------------------------------------- handling model
// The exact constants from src/game/engine.ts — the two builds must feel
// identical. All speeds in m/s inside the model; convert at the edges.

namespace GRNHandling
{
	constexpr float Ceiling = 115.f;          // + car topSpeed bonus
	constexpr float ThrustK = 19.f;           // thrust = 19 * power * (1 - v/ceiling)
	constexpr float DragA = 0.0012f;          // drag = A*v^2 + B, scaled 0.35 on throttle
	constexpr float DragB = 1.2f;
	constexpr float SteerSmoothRate = 7.f;
	constexpr float CasterRate = 2.4f;
	constexpr float HeadingClamp = 0.45f;
	constexpr float FlashRangeM = 60.f;

	// Drift (see updatePlayer in the web engine)
	constexpr float DriftMinSpeed = 14.f;     // m/s to break the rear loose
	constexpr float DriftAngleBase = 0.38f;
	constexpr float DriftAngleSpeedK = 0.28f; // * min(1, v/55)
	constexpr float DriftEngageRate = 3.4f;
	constexpr float DriftRecoverRate = 2.3f;  // + counterSteer * 3.2
	constexpr float DriftYawClamp = 0.75f;
	constexpr float DriftLatScrub = 0.5f;     // * min(1, |yaw|/0.5)
	constexpr float DriftDriveLoss = 1.1f;    // driveGrip = 1 - min(0.55, |yaw|*1.1)
}
