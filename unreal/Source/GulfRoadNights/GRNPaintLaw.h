#pragma once

// The car paint, as numbers: how glossy each finish is and how metallic
// each colour is. Engine-free, for the same reason GRNSim.h is.
//
// WHERE THE NUMBERS COME FROM
//
// The web build, which measured them. src/game/cars.ts builds the paint
// as a basecoat at roughness 0.24 (PAINT_BASE_ROUGHNESS) under a
// clearcoat at 0.045, and sweeps of that pair against live frames are
// recorded beside it (0.29/0.13 put 68% of the body inside the
// highlight; 0.18/0.06 put 17% there and was the knee until the street
// lamps lit the cars and the web's gloss pass moved both). src/game/
// mods.ts carries the three finishes; cars.ts's
// paintMetalness carries the metalness law. Every value below is one of
// those, and scripts/check-unreal-project.mjs reads the TypeScript and
// fails if any of them moves without this file moving with it.
//
// WHY THE LAW IS HERE AND NOT JUST ITS CONSTANTS
//
// A table of matching constants proves less than it looks — the README's
// "What a constant check cannot see" is two stories of exactly that. So
// the law itself is in this header, as code, and the check compiles it
// with a bare g++ (no Unreal needed, which is the point of being
// engine-free) and evaluates it against the web's own paintMetalness on
// every paint on the wall, every showroom car and every rival. The claim
// is "the port paints the same metal as the web", and that is what gets
// compared.
//
// WHAT IS NOT HERE, ON PURPOSE
//
// - envScale (mods.ts) scales three.js's environment map. Lumen has no
//   such dial — the reflection is the scene, traced — so there is no
//   physical thing for it to drive.
// - Flake and orange peel. The web team measured both making the car
//   look worse at night (cars.ts, the tilted-clearcoat-normal notes),
//   and a port that adds what the source of truth took out is not a
//   port.

#include <cstdint>

/** How the lacquer is finished — mods.ts PaintFinish. */
enum class EGRNFinish : uint8_t
{
	Gloss,
	Satin,
	Matte,
};

namespace GRNPaintLaw
{
	/** Basecoat roughness before a finish adds to it. cars.ts:
	 *  `roughness: 0.18 + FINISHES[finish].roughnessAdd`. */
	constexpr float BaseRoughness = 0.24f;

	/** Dielectric specular in the metalness workflow: 0.5 is F0 0.04,
	 *  the 1.5-IOR plastic three.js's MeshPhysicalMaterial also assumes.
	 *  The clear coat layer carries its own fixed F0 0.04 on top. */
	constexpr float Specular = 0.5f;

	/** One finish, mods.ts FinishSpec minus envScale (see above). */
	struct FFinishSpec
	{
		/** Strength of the clear coat layer, 0..1. */
		float ClearCoat;
		/** Roughness of the clear coat itself. */
		float ClearCoatRoughness;
		/** Added to BaseRoughness for the basecoat. */
		float RoughnessAdd;
		/** Scales the law's metalness. Matte HAS to pull it down: a matte
		 *  car that kept 0.95 metalness had no diffuse term at all and
		 *  rendered as a dim mirror of the night sky (mods.ts). */
		float MetalScale;
	};

	/** mods.ts FINISHES, indexed by EGRNFinish. Gloss's clear coat is
	 *  0.045: at 0.13 it blurred the lamp it reflected into a smudge, and
	 *  0.06 was the old knee, set while three's fixed 0.0525 floor hid
	 *  anything below it (the web now lowers that floor where the probe
	 *  can serve a sharper mip; Unreal has no such floor). */
	constexpr FFinishSpec Finishes[3] = {
		/* Gloss */ { 1.0f, 0.045f, 0.0f, 1.0f },
		/* Satin */ { 0.45f, 0.42f, 0.10f, 0.8f },
		/* Matte */ { 0.0f, 1.0f, 0.32f, 0.25f },
	};

	inline const FFinishSpec& Finish(EGRNFinish F)
	{
		const int I = static_cast<int>(F);
		return Finishes[(I >= 0 && I < 3) ? I : 0];
	}

	// ---- the metalness law (cars.ts paintMetalness) --------------------
	//
	// Metallic in the mid-tones, falling away at both ends. Pale paints go
	// toward solid because at metalness near 1 the diffuse term vanishes
	// and a white car becomes a mirror of whatever the sky is doing —
	// here a sodium band, and the web fleet's pale cars came out gold.
	// Near-blacks go toward solid because F0 IS the base colour in a
	// metalness workflow, and 0x0d0e11 reflects about half a percent of
	// the light: measured on the web, 56.3% of a metallic black car's
	// bodywork sat at or under 8/255.
	//
	// On sRGB BYTES, not on linear colour. The web computes luminance
	// from `hex / 255` with Rec.709 weights, so this does too; feeding it
	// an FLinearColor would move every knee.

	constexpr double LumR = 0.2126;
	constexpr double LumG = 0.7152;
	constexpr double LumB = 0.0722;
	/** At or above this luminance the paint falls toward solid. */
	constexpr double LightKnee = 0.5;
	/** How fast it falls past LightKnee, per unit of luminance. */
	constexpr double LightSlope = 1.9;
	/** Where the pale ramp starts from at LightKnee — the old 0.95 peak,
	 *  kept so pale paints above luminance 0.605 are exactly what they were;
	 *  the ramp is capped at Peak below that. */
	constexpr double LightStart = 0.95;
	/** The mid-tone metalness: 0.75 (cars.ts PAINT_METAL_TOP), down from
	 *  0.95 once the web's street lamps started lighting cars and a
	 *  quarter of diffuse kept reds red on panels that mirror the sky. */
	constexpr double Peak = 0.75;
	/** The least metal either end comes down to. */
	constexpr double Floor = 0.18;
	/** Below this luminance the paint ramps from Peak down to Floor.
	 *  Deliberately low: the web fleet's red has a luminance of 0.22, its
	 *  navy 0.18 and its purple 0.23, all three keep the full Peak, and
	 *  metallic reds and navies are real. Only the near-blacks, where F0
	 *  stops being physical, come down. */
	constexpr double DarkKnee = 0.16;

	/** paints.ts PAINTS with `solid: true`. A DECLARED solid is a solid
	 *  and gets metalness 0 — pigment under lacquer, whose gloss is the
	 *  clear coat's, not the basecoat's (the web measured a satin white
	 *  car's median 173 -> 183.5 and a black one's dead share 67.2% ->
	 *  64.6% going from 0.128 to 0). Looked up by exact hex, as the web
	 *  does; the hexes are unique (tests/paints.mjs). */
	constexpr uint32_t SolidHexes[] = {
		0x1a1b1fu, // paint-black
		0xf2f4f7u, // paint-white
		0x6d6a2fu, // paint-olive
		0x81565eu, // paint-molasses
		0xa7917bu, // paint-mudbrick
		0x07362du, // paint-diver
		0x7f9376u, // paint-sage
		0xffab95u, // paint-coral
		0xf7e21cu, // paint-yellow
	};

	/** paints.ts RETIRED_SWATCHES, resolved to today's hex. An old client
	 *  still sends the old swatch; without this it would lose its solid
	 *  treatment, because the solid lookup is by current hex. */
	struct FRetiredSwatch
	{
		uint32_t From;
		uint32_t To;
	};
	constexpr FRetiredSwatch RetiredSwatches[] = {
		{ 0x0d0e11u, 0x1a1b1fu }, // paint-black, before it was lifted
	};

	inline uint32_t CurrentHex(uint32_t Hex)
	{
		for (const FRetiredSwatch& R : RetiredSwatches)
		{
			if (R.From == Hex) return R.To;
		}
		return Hex;
	}

	inline bool IsDeclaredSolid(uint32_t Hex)
	{
		const uint32_t Now = CurrentHex(Hex);
		for (uint32_t S : SolidHexes)
		{
			if (S == Now) return true;
		}
		return false;
	}

	/** Metalness for a 0xRRGGBB paint, before the finish scales it. */
	inline double Metalness(uint32_t Hex)
	{
		if (IsDeclaredSolid(Hex)) return 0.0;
		// The luminance of the colour as sent, not of its current swatch —
		// the web reads `hex` here too.
		const double R = static_cast<double>((Hex >> 16) & 255u) / 255.0;
		const double G = static_cast<double>((Hex >> 8) & 255u) / 255.0;
		const double B = static_cast<double>(Hex & 255u) / 255.0;
		const double Lum = LumR * R + LumG * G + LumB * B;
		if (Lum >= LightKnee)
		{
			double V = LightStart - (Lum - LightKnee) * LightSlope;
			if (V > Peak) V = Peak;
			return V > Floor ? V : Floor;
		}
		if (Lum >= DarkKnee) return Peak;
		return Floor + (Peak - Floor) * (Lum / DarkKnee);
	}

	// ---- the finish each car leaves the factory in ----------------------
	//
	// mods.ts CARS[].finish, for the cars that are NOT gloss (gloss is the
	// default). The live API publishes `cars[].finish` and GRNApi reads it;
	// this is the same fact for the baked fallback, so a player on a plane
	// gets the same matte pickup as a player online. Rivals wear the
	// finish of the car they bring, as engine.ts does (`rivalCar?.finish`).
	//
	// Hand-written where the rest of the car table is generated, because
	// it arrived with the paint rather than with sync:unreal; the check
	// compares it with mods.ts in both directions, so it cannot drift
	// silently. It belongs in GRNTypes.h's car rows the next time the
	// generator is opened up.

	struct FCarFinish
	{
		const char* CarId;
		EGRNFinish Finish;
	};
	constexpr FCarFinish FactoryFinishes[] = {
		{ "efreet-rx-kai", EGRNFinish::Satin },
		{ "falcon-720", EGRNFinish::Matte },
		{ "efreet-rx", EGRNFinish::Satin },
		{ "hawally-2t", EGRNFinish::Satin },
		{ "jahra-pickup", EGRNFinish::Matte },
		{ "wain-special", EGRNFinish::Satin },
	};

	inline bool SameId(const char* A, const char* B)
	{
		if (!A || !B) return false;
		while (*A && *A == *B) { ++A; ++B; }
		return *A == *B;
	}

	/** The factory finish of the car with this id; Gloss for any car not
	 *  listed, including an unknown id. */
	inline EGRNFinish FactoryFinish(const char* CarId)
	{
		for (const FCarFinish& F : FactoryFinishes)
		{
			if (SameId(F.CarId, CarId)) return F.Finish;
		}
		return EGRNFinish::Gloss;
	}
}
