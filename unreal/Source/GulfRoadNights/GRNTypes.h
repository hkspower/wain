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
	{ 2115, -2583 },
	{ 2586, -1958 },
	{ 2696, -1184 },
	{ 2416, -453 },
	{ 1818, 50 },
	{ 1050, 200 },
};

// ------------------------------------------------------------- rivals

enum class EGRNBodyStyle : uint8 { Sedan, ZX, GTR, RX7, Hatch };

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
	{ TEXT("Bu Torab"), TEXT("بو تراب"), TEXT("Doha Dust Devils"), TEXT("Doha"), FColor(0x56, 0x5F, 0x6B), 301.0f, EGRNBodyStyle::ZX },
	{ TEXT("Al-Sayyaf"), TEXT("السياف"), TEXT("Bayan Blade Runners"), TEXT("Bayan"), FColor(0x0F, 0x76, 0x6E), 307.0f, EGRNBodyStyle::GTR },
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
	float TopSpeedKmh; // governed limit, km/h
	float Grip;
	float Brake;
	FColor Paint;
	EGRNBodyStyle Style;
	/** Factory time-attack aero (wing, splitter, bronze wheels). */
	bool bAttackKit;
};

static const FGRNCarDef GRNCars[] = {
	{ TEXT("efreet-rx-kai"), TEXT("Efreet RX Kai"), 120000, 1.66f, 400.0f, 17.5f, 44.0f, FColor(0xF2, 0xB9, 0x0D), EGRNBodyStyle::RX7, true },
	{ TEXT("sahara-v12"), TEXT("Sahara GT-12"), 96000, 1.62f, 385.0f, 16.4f, 42.0f, FColor(0xB8, 0x86, 0x0B), EGRNBodyStyle::ZX, false },
	{ TEXT("falcon-720"), TEXT("Falcon 720 Veloce"), 71000, 1.50f, 360.0f, 15.8f, 40.0f, FColor(0xC1, 0x12, 0x1F), EGRNBodyStyle::ZX, false },
	{ TEXT("storm-s8"), TEXT("Desert Storm S8"), 54000, 1.40f, 335.0f, 15.2f, 38.0f, FColor(0x1F, 0x29, 0x33), EGRNBodyStyle::Sedan, false },
	{ TEXT("kaiju-r"), TEXT("Kaiju R"), 38000, 1.34f, 310.0f, 16.2f, 38.0f, FColor(0x3F, 0x66, 0xC4), EGRNBodyStyle::GTR, false },
	{ TEXT("efreet-rx"), TEXT("Efreet RX"), 31000, 1.30f, 295.0f, 14.8f, 35.0f, FColor(0xD7, 0x26, 0x3D), EGRNBodyStyle::RX7, false },
	{ TEXT("zeta-300"), TEXT("Zeta 300"), 27000, 1.26f, 275.0f, 13.9f, 34.0f, FColor(0xC1, 0x27, 0x2D), EGRNBodyStyle::ZX, false },
	{ TEXT("gulf-coupe-rs"), TEXT("Gulf Coupe RS"), 33000, 1.28f, 285.0f, 14.6f, 35.0f, FColor(0xCB, 0x20, 0x27), EGRNBodyStyle::Hatch, false },
	{ TEXT("salmiya-turbo"), TEXT("Salmiya Turbo GT"), 24000, 1.20f, 255.0f, 13.8f, 32.0f, FColor(0xB8, 0x4D, 0xD6), EGRNBodyStyle::Sedan, false },
	{ TEXT("hawally-2t"), TEXT("Hawally Sport 2.0T"), 16000, 1.12f, 240.0f, 13.2f, 30.0f, FColor(0xF5, 0xC2, 0x11), EGRNBodyStyle::Sedan, false },
	{ TEXT("deera-sedan"), TEXT("Deera Sedan"), 8500, 1.05f, 220.0f, 12.6f, 28.0f, FColor(0xDF, 0xE3, 0xE8), EGRNBodyStyle::Sedan, false },
	{ TEXT("jahra-pickup"), TEXT("Jahra Pickup"), 6000, 1.00f, 195.0f, 12.0f, 27.0f, FColor(0x6E, 0x7F, 0x8D), EGRNBodyStyle::Sedan, false },
	{ TEXT("sharq-hatch"), TEXT("Sharq Hatch"), 2200, 0.98f, 205.0f, 12.4f, 27.0f, FColor(0x16, 0xA3, 0x4A), EGRNBodyStyle::Sedan, false },
	{ TEXT("wain-special"), TEXT("Wain Special"), 0, 1.00f, 180.0f, 12.0f, 26.0f, FColor(0xF2, 0xF4, 0xF7), EGRNBodyStyle::Sedan, false },
};
static const int32 GRNCarCount = UE_ARRAY_COUNT(GRNCars);

// -------------------------------------------------------- handling model
// Mirrors src/game/handling.ts — parsed from it, never hand-copied. If a
// constant is added there, rerunning this generator publishes it here.

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
	constexpr float DriftEstablished = 0.12f;
	constexpr float DriftRecoverCounterK = 3.2f;
	constexpr float DriftOverRotate = 0.42f;
	constexpr float DriftCounterRate = 2.6f;
	constexpr float DriftCriticalAngle = 0.72f;
	constexpr float DriftRunawayRate = 1.6f;
	constexpr float DriftSpinAngle = 1.05f;
	constexpr float DriftSpinTime = 1.15f;
	constexpr float DriftSpinDrag = 0.85f;
	constexpr float DriftSpinRate = 2.4f;
	constexpr float DriftSpinSweep = 2.2f;
	constexpr float DriftScrubBase = 0.05f;
	constexpr float DriftScrubK = 0.24f;
	constexpr float DriftBrakeEntry = 0.12f;
	constexpr float DriftBrakeAngleK = 0.45f;
	constexpr float DriftFeintRate = 4.2f;
	constexpr float DriftFeintLoad = 0.3f;
	constexpr float DriftFeintMinSpeed = 20.f;
	constexpr float DriftFeintWindow = 0.45f;
	constexpr float DriftFeintAngleK = 0.55f;
	constexpr float DriftScoreK = 3.2f;
	constexpr float DriftScoreMinDeg = 8.f;
	constexpr float DriftScoreMinSpeed = 12.f;
	constexpr float DriftLinkWindow = 0.9f;
	constexpr float DriftChainMax = 5.f;
	constexpr float BrakeLockMargin = 1.f;
	constexpr float BrakeSlideFriction = 0.72f;
	constexpr float BrakeLockSteer = 0.25f;
	constexpr float BrakeLockRate = 12.f;
	constexpr float AbsHold = 0.97f;
	constexpr float AbsHz = 14.f;
	constexpr float BrakeHeatK = 0.105f;
	constexpr float BrakeCoolBase = 0.008f;
	constexpr float BrakeCoolK = 0.0016f;
	constexpr float BrakeFadeStart = 320.f;
	constexpr float BrakeFadeFull = 620.f;
	constexpr float BrakeFadeMax = 0.45f;
	constexpr float BrakeRotateK = 0.85f;
	constexpr float BrakeRotateMinSpeed = 12.f;
	constexpr float EngineBrakeK = 2.4f;
	constexpr float TractionBase = 0.8f;
	constexpr float TractionRampSpeed = 22.f;
	constexpr float BrakeGripK = 1.05f;
	constexpr float BrakePadK = 0.25f;
	constexpr float TrailBrakeK = 0.6f;
	constexpr float LatDemandSpeed = 40.f;
	constexpr float UndersteerK = 0.35f;
	constexpr float CornerScrubK = 0.3f;
	constexpr float CornerScrubSpeed = 40.f;
	constexpr float PowerOverSpin = 1.2f;
	constexpr float PowerOverSteer = 0.5f;
	constexpr float PowerOverMinSpeed = 18.f;
	constexpr float PowerOverThrottle = 0.85f;
	constexpr float PowerOverAngleK = 0.6f;
	constexpr float CrashLatFull = 12.f;
	constexpr float CrashSpeedLossK = 0.28f;
	constexpr float CrashReboundK = 5.f;
	constexpr float TrafficClosingFull = 22.f;
}

// ------------------------------------------------------------------ rigs
// Mirrors src/game/rig.ts. Every figure in this game is posed by the
// analytic IK in GRNDriverRig.cpp rather than by an animation asset, and
// a solver is only as portable as the numbers it solves against. Lengths
// are metres — multiply by GRN_M for UE centimetres. Angles are radians
// and rates are per-second, in both engines.

namespace GRNRig
{
	constexpr float DriverShoulderX = 0.16f;
	constexpr float DriverShoulderY = 0.46f;
	constexpr float DriverShoulderZ = -0.04f;
	constexpr float DriverUpperArm = 0.29f;
	constexpr float DriverForeArm = 0.26f;
	constexpr float DriverHipX = 0.09f;
	constexpr float DriverHipY = 0.17f;
	constexpr float DriverHipZ = 0.05f;
	constexpr float DriverThigh = 0.27f;
	constexpr float DriverShin = 0.27f;
	constexpr float DriverHipPitch = -1.15f;
	constexpr float DriverKneePitch = 0.95f;
	constexpr float DriverHeadY = 0.52f;
	constexpr float DriverHeadZ = 0.02f;
	constexpr float DriverWheelY = 0.44f;
	constexpr float DriverWheelZ = 0.24f;
	constexpr float DriverWheelRake = -0.42f;
	constexpr float DriverWheelRadius = 0.16f;
	constexpr float DriverGripLeft = 2.26194671f;
	constexpr float DriverGripRight = 0.879645943f;
	constexpr float DriverSteerLock = 2.4f;
	constexpr float DriverWheelRate = 12.f;
	constexpr float DriverPedalThrottleX = 0.1f;
	constexpr float DriverPedalBrakeX = -0.08f;
	constexpr float DriverPedalY = 0.09f;
	constexpr float DriverPedalZ = 0.46f;
	constexpr float DriverPedalPitch = -0.55f;
	constexpr float DriverPedalTravelZ = 0.05f;
	constexpr float DriverPedalTravelY = 0.015f;
	constexpr float DriverArmPoleX = 0.51f;
	constexpr float DriverArmPoleY = -0.04f;
	constexpr float DriverArmPoleZ = -0.06f;
	constexpr float DriverLegPoleX = 0.22f;
	constexpr float DriverLegPoleY = 1.1f;
	constexpr float DriverLegPoleZ = 0.42f;
	constexpr float DriverLookAheadM = 26.f;
	constexpr float DriverLookLatK = 0.4f;
	constexpr float DriverLookHeight = 1.1f;
	constexpr float DriverNeckYaw = 0.7f;
	constexpr float DriverNeckPitch = 0.28f;
	constexpr float DriverNeckRate = 5.f;
	constexpr float RivalSteerPerLat = 0.45f;
	constexpr float RivalSteerRate = 4.f;
	constexpr float RivalPedalRate = 6.f;
	constexpr float RivalThrottleAccel = 0.3f;
	constexpr float RivalThrottleScale = 8.f;
	constexpr float RivalBrakeAccel = -1.f;
	constexpr float RivalBrakeScale = 10.f;
	constexpr float RivalCruiseThrottle = 0.2f;
	constexpr float RivalGlanceGapM = 12.f;
	constexpr float RivalGlanceLatM = 1.2f;
	constexpr float SpectatorShoulderX = 0.2f;
	constexpr float SpectatorShoulderY = 1.28f;
	constexpr float SpectatorArmAbduction = 0.15f;
	constexpr float SpectatorUpperArm = 0.28f;
	constexpr float SpectatorForeArm = 0.25f;
	constexpr float SpectatorHeadY = 1.5f;
	constexpr float RacerShoulderX = 0.19f;
	constexpr float RacerShoulderY = 1.4f;
	constexpr float RacerUpperArm = 0.28f;
	constexpr float RacerForeArm = 0.26f;
	constexpr float RacerHeadY = 1.64f;
	constexpr float CrowdWatchRangeM = 90.f;
	constexpr float CrowdNeckYaw = 1.15f;
	constexpr float CrowdNeckPitch = 0.3f;
	constexpr float CrowdNeckRate = 6.f;
	constexpr float CrowdBodyRate = 1.2f;
	constexpr float CrowdRestRate = 1.5f;
	constexpr float CrowdWaveRangeM = 45.f;
	constexpr float CrowdLiftUpRate = 2.2f;
	constexpr float CrowdLiftDownRate = 1.1f;
	constexpr float CrowdWagHz = 6.5f;
	constexpr float CrowdWagAmp = 0.3f;
	constexpr float CrowdReach = 0.94f;
	constexpr float CrowdRaiseUp = 0.87f;
	constexpr float CrowdRaiseOut = 0.45f;
	constexpr float CrowdStillEvery = 3.f;
	constexpr float CrowdPoleX = 0.6f;
	constexpr float CrowdPoleY = -0.2f;
	constexpr float CrowdPoleZ = 0.05f;
}
