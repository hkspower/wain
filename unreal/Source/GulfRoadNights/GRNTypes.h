#pragma once

// GENERATED FILE — do not edit by hand.
// Produced by scripts/export-unreal-data.mjs from the web build's
// src/game/{track,rivals,mods}.ts. Regenerate with:  npm run sync:unreal
//
// One web unit = one metre = 100 UE units (GRN_M). The handling block
// at the bottom mirrors src/game/engine.ts; the generator carries it so
// a regeneration never loses it.

#include "CoreMinimal.h"
#include "GRNSimConstants.h"

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

enum class EGRNBodyStyle : uint8 { Sedan, ZX, GTR, RX7, Hatch, Pony };

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

// -------------------------------------------------------------- engines
// Two fours, two sixes and a V8. The curve is a Gaussian bump on a floor,
// normalised so every engine's mean torque across the usable rev range is
// exactly 1.0 — see GRNEngineTorque below, and src/game/engines.ts for
// why that normalisation is the whole design.

enum class EGRNEngineLayout : uint8 { Inline, Flat, Vee };

struct FGRNEngineDef
{
	const TCHAR* Id;
	const TCHAR* Name;
	int32 Cylinders;
	EGRNEngineLayout Layout;
	float Litres;
	float IdleRpm;
	float RedlineRpm;
	/** Torque curve, in rev-range fraction: where it peaks, how wide that
	 *  peak is, and what is left down at idle. */
	float PeakAt;
	float Breadth;
	float Floor;
	float PowerMult;
	float MassKg;
	/** How much of the note sits on the sub-octave. */
	float SubMix;
	/** Cross-plane half-order lope. Non-zero on the V8 alone. */
	float LopeDepth;
	int32 Price;
};

static const FGRNEngineDef GRNEngines[] = {
	{ TEXT("i4-16"), TEXT("Sadu 1.6 VTC"), 4, EGRNEngineLayout::Inline, 1.6f, 850.0f, 8400.0f, 0.88f, 0.24f, 0.26f, 0.93f, -42.0f, 0.20f, 0.00f, 900 },
	{ TEXT("i4-20t"), TEXT("Bahri 2.0T"), 4, EGRNEngineLayout::Inline, 2.0f, 800.0f, 6800.0f, 0.50f, 0.30f, 0.50f, 1.00f, 0.0f, 0.30f, 0.00f, 2200 },
	{ TEXT("f6-25"), TEXT("Nejma Flat-Six"), 6, EGRNEngineLayout::Flat, 2.5f, 900.0f, 7800.0f, 0.72f, 0.34f, 0.44f, 1.05f, 12.0f, 0.34f, 0.00f, 3800 },
	{ TEXT("i6-30tt"), TEXT("Sahil 3.0 TT"), 6, EGRNEngineLayout::Inline, 3.0f, 750.0f, 7000.0f, 0.58f, 0.46f, 0.66f, 1.10f, 48.0f, 0.38f, 0.00f, 5200 },
	{ TEXT("v8-57"), TEXT("Ghazi 5.7 V8"), 8, EGRNEngineLayout::Vee, 5.7f, 700.0f, 6200.0f, 0.24f, 0.36f, 0.46f, 1.12f, 115.0f, 0.50f, 0.24f, 6500 },
};
static const int32 GRNEngineCount = UE_ARRAY_COUNT(GRNEngines);

/** Lowest rev fraction the gearbox ever asks for — the curve is
 *  normalised over [this, 1], not [0, 1]. */
static const float GRNMinRevFraction = 0.12f;

/** Mean raw torque over the usable range, so the shape can be normalised
 *  without integrating it at runtime. Computed by the generator from the
 *  same numbers above. */
static const float GRNEngineNorm[] = {
	0.609410f,
	0.862994f,
	0.850061f,
	0.954355f,
	0.799539f,
};

/** Torque multiplier at a point in the rev range. Averages to exactly
 *  1.0 for every engine: a swap redistributes power, it never adds any. */
static FORCEINLINE float GRNEngineTorque(int32 EngineIndex, float Rev)
{
	const FGRNEngineDef& E = GRNEngines[EngineIndex];
	const float R = FMath::Clamp(Rev, 0.0f, 1.0f);
	const float D = R - E.PeakAt;
	const float Raw = E.Floor + (1.0f - E.Floor) * FMath::Exp(-(D * D) / (2.0f * E.Breadth * E.Breadth));
	return Raw / GRNEngineNorm[EngineIndex];
}

/** The note: a four-stroke fires Cylinders/2 times per crank revolution. */
static FORCEINLINE float GRNEngineFiringHz(int32 EngineIndex, float Rev)
{
	const FGRNEngineDef& E = GRNEngines[EngineIndex];
	const float Rpm = E.IdleRpm + (E.RedlineRpm - E.IdleRpm) * FMath::Clamp(Rev, 0.0f, 1.0f);
	return (Rpm / 60.0f) * (E.Cylinders * 0.5f);
}

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
	/** Which wheels the engine drives. See GRNSim::SolveLoad — it decides
	 *  which axle's load the engine may use, and the load transfer does
	 *  the rest. */
	GRNSim::EDrivetrain Drive;
	/** Index into GRNEngines — what the car left the factory with. */
	int32 Engine;
	/** Tank, litres. */
	float TankLitres;
	/** Overall length, metres. The shell is scaled until it measures
	 *  this — see createCar in src/game/cars.ts. */
	float LengthM;
	/** Legends that must be beaten before the showroom will sell it.
	 *  0 for everything money can buy. */
	int32 LockedRivals;
	/** Parts fitted at the factory, comma separated, empty for most. */
	const TCHAR* FactoryBuild;
};

static const FGRNCarDef GRNCars[] = {
	{ TEXT("zeta-300-gtr"), TEXT("Zeta 300 GTR"), 240000, 1.70f, 405.0f, 18.0f, 46.0f, FColor(0x3B, 0x2A, 0x5A), EGRNBodyStyle::ZX, true, GRNSim::EDrivetrain::AWD, 3, 70.0f, 4.53f, 8, TEXT("twin-turbo,intake,ecu,exhaust-ti,brakes-carbon,tires-slick,lsd,coilovers,cage,rack,weight,nos") },
	{ TEXT("efreet-rx-kai"), TEXT("Efreet RX Kai"), 120000, 1.66f, 400.0f, 17.5f, 44.0f, FColor(0xF2, 0xB9, 0x0D), EGRNBodyStyle::RX7, true, GRNSim::EDrivetrain::RWD, 3, 55.0f, 4.42f, 0, TEXT("") },
	{ TEXT("sahara-v12"), TEXT("Sahara GT-12"), 96000, 1.62f, 385.0f, 16.4f, 42.0f, FColor(0xB8, 0x86, 0x0B), EGRNBodyStyle::ZX, true, GRNSim::EDrivetrain::RWD, 4, 90.0f, 4.62f, 0, TEXT("") },
	{ TEXT("falcon-720"), TEXT("Falcon 720 Veloce"), 71000, 1.50f, 360.0f, 15.8f, 40.0f, FColor(0xC1, 0x12, 0x1F), EGRNBodyStyle::ZX, true, GRNSim::EDrivetrain::RWD, 4, 72.0f, 4.54f, 0, TEXT("") },
	{ TEXT("storm-s8"), TEXT("Desert Storm S8"), 54000, 1.40f, 335.0f, 15.2f, 38.0f, FColor(0x1F, 0x29, 0x33), EGRNBodyStyle::Sedan, true, GRNSim::EDrivetrain::AWD, 3, 68.0f, 4.80f, 0, TEXT("") },
	{ TEXT("anniversary-30"), TEXT("Bareed 30 Anniversary"), 35000, 1.31f, 300.0f, 12.4f, 33.0f, FColor(0xF2, 0xF2, 0xEE), EGRNBodyStyle::Pony, false, GRNSim::EDrivetrain::RWD, 4, 61.0f, 4.92f, 0, TEXT("") },
	{ TEXT("kaiju-r"), TEXT("Kaiju R"), 38000, 1.34f, 310.0f, 16.2f, 38.0f, FColor(0x3F, 0x66, 0xC4), EGRNBodyStyle::GTR, true, GRNSim::EDrivetrain::AWD, 3, 74.0f, 4.60f, 0, TEXT("") },
	{ TEXT("efreet-rx"), TEXT("Efreet RX"), 31000, 1.30f, 295.0f, 14.8f, 35.0f, FColor(0xD7, 0x26, 0x3D), EGRNBodyStyle::RX7, false, GRNSim::EDrivetrain::RWD, 2, 60.0f, 4.30f, 0, TEXT("") },
	{ TEXT("zeta-300"), TEXT("Zeta 300"), 27000, 1.26f, 275.0f, 13.9f, 34.0f, FColor(0xC1, 0x27, 0x2D), EGRNBodyStyle::ZX, false, GRNSim::EDrivetrain::AWD, 3, 70.0f, 4.31f, 0, TEXT("") },
	{ TEXT("gulf-coupe-rs"), TEXT("Gulf Coupe RS"), 33000, 1.28f, 285.0f, 14.6f, 35.0f, FColor(0xCB, 0x20, 0x27), EGRNBodyStyle::Hatch, false, GRNSim::EDrivetrain::FWD, 1, 50.0f, 4.28f, 0, TEXT("") },
	{ TEXT("salmiya-turbo"), TEXT("Salmiya Turbo GT"), 24000, 1.20f, 255.0f, 13.8f, 32.0f, FColor(0xB8, 0x4D, 0xD6), EGRNBodyStyle::Sedan, false, GRNSim::EDrivetrain::FWD, 1, 60.0f, 4.64f, 0, TEXT("") },
	{ TEXT("hawally-2t"), TEXT("Hawally Sport 2.0T"), 16000, 1.12f, 240.0f, 13.2f, 30.0f, FColor(0xF5, 0xC2, 0x11), EGRNBodyStyle::Sedan, false, GRNSim::EDrivetrain::FWD, 1, 55.0f, 4.56f, 0, TEXT("") },
	{ TEXT("deera-sedan"), TEXT("Deera Sedan"), 8500, 1.05f, 220.0f, 12.6f, 28.0f, FColor(0xDF, 0xE3, 0xE8), EGRNBodyStyle::Sedan, false, GRNSim::EDrivetrain::FWD, 1, 60.0f, 4.70f, 0, TEXT("") },
	{ TEXT("jahra-pickup"), TEXT("Jahra Pickup"), 6000, 1.00f, 195.0f, 12.0f, 27.0f, FColor(0x6E, 0x7F, 0x8D), EGRNBodyStyle::Sedan, false, GRNSim::EDrivetrain::RWD, 4, 80.0f, 5.16f, 0, TEXT("") },
	{ TEXT("sharq-hatch"), TEXT("Sharq Hatch"), 2200, 0.98f, 205.0f, 12.4f, 27.0f, FColor(0x16, 0xA3, 0x4A), EGRNBodyStyle::Hatch, false, GRNSim::EDrivetrain::FWD, 0, 42.0f, 3.95f, 0, TEXT("") },
	{ TEXT("wain-special"), TEXT("Wain Special"), 0, 1.00f, 180.0f, 12.0f, 26.0f, FColor(0xF2, 0xF4, 0xF7), EGRNBodyStyle::Sedan, false, GRNSim::EDrivetrain::RWD, 0, 50.0f, 4.45f, 0, TEXT("") },
};
static const int32 GRNCarCount = UE_ARRAY_COUNT(GRNCars);

// ------------------------------------------------------------------ fuel
//
// An engine is an air pump: it swallows half its displacement every
// crank revolution, and at stoichiometric the petrol follows from the
// air. Nothing here is a thirst figure typed in per engine — the V8
// drinks two and a half times what the 1.6 does because it is two and a
// half times the pump, and for no other reason.

namespace GRNFuel
{
	/** How much faster the game burns than the world does. A tank is a
	 *  session rather than an afternoon. */
	constexpr float RateMultiplier = 8.f;
	/** Kuwait's 91-octane pump price. A thousand fils to the dinar. */
	constexpr int32 FilsPerLitre = 85;
	constexpr float PumpLitresPerSecond = 8.f;
	/** Above this the forecourt is something you drove past. */
	constexpr float PumpMaxKmh = 12.f;
	constexpr float AirGramsPerLitre = 1.2f;
	constexpr float AirFuelRatio = 14.7f;
	constexpr float PetrolGramsPerLitre = 745.f;
}

/** How much of each swallow is actually air. A closed throttle is mostly
 *  vacuum, which is why an idling engine burns a litre an hour. */
static FORCEINLINE float GRNVolumetricEfficiency(float Throttle, float Rev)
{
	const float Open = 0.22f + 0.73f * FMath::Clamp(Throttle, 0.0f, 1.0f);
	return Open * (1.0f - 0.12f * FMath::Max(0.0f, Rev - 0.75f));
}

/** Litres per second, before RateMultiplier. */
static FORCEINLINE float GRNFuelLitresPerSecond(int32 EngineIndex, float Throttle, float Rev)
{
	const FGRNEngineDef& E = GRNEngines[EngineIndex];
	const float Rpm = E.IdleRpm + (E.RedlineRpm - E.IdleRpm) * FMath::Clamp(Rev, 0.0f, 1.0f);
	const float AirLitres = (E.Litres * 0.5f) * (Rpm / 60.0f) * GRNVolumetricEfficiency(Throttle, Rev);
	return (AirLitres * GRNFuel::AirGramsPerLitre) /
		(GRNFuel::AirFuelRatio * GRNFuel::PetrolGramsPerLitre);
}

// --------------------------------------------------------------- forecourts
// Both are on the Second Ring: widening the road opens the barrier on
// both sides, which inland means more tarmac and on the corniche would
// mean a lane of asphalt over the beach.

struct FGRNStation { float S; float Lat; };
static const FGRNStation GRNStations[] = {
	{ 3900.f, 19.f },
	{ 6900.f, 19.f },
};
static const int32 GRNStationCount = UE_ARRAY_COUNT(GRNStations);
/** How far a forecourt reaches along the road, and how much wider it
 *  makes the carriageway. */
constexpr float GRNForecourtHalfSpan = 30.f;
constexpr float GRNForecourtExtraWidth = 10.f;

// -------------------------------------------------------- handling model
// The handling and rig constants live in GRNSimConstants.h, which this
// includes at the top. They are in their own file because GRNSim.h — the
// solvers themselves — must not depend on the engine: a header that
// pulls in CoreMinimal.h can only be compiled by Unreal, and a solver
// only Unreal can compile is a solver nobody can test.
