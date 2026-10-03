#pragma once

// Car paint for the primitive shells: a Substrate clear coat when this
// project has one, the engine's basic-shape material when it does not.
//
// WHY A GENERATED ASSET AND NOT A MATERIAL BUILT HERE
//
// A packaged game cannot create a UMaterial. Shaders are compiled at cook
// time; at runtime the only thing that can be made is a dynamic instance
// of a material that already exists. So the clear coat is an asset —
// /Game/GRN/Generated/M_GRNCarPaint_v1 — built by the GulfRoadNightsEditor
// module (automatically the first time the editor opens, or headless with
// `-run=GRNBuildPaint`) and cooked from the always-cook list in
// DefaultGame.ini. It lives under Content/, which is gitignored, so the
// repository stays reviewable text: the graph that makes the asset is
// C++ in GRNPaintBuilder.cpp, not a binary nobody can diff.
//
// THE FALLBACK IS THE POINT
//
// This port was built to play with or without things — the live API, the
// Fab art — and the paint follows the same rule. If Substrate is off, or
// the asset was never built, or it fails to load, every car gets exactly
// the paint it had before this file existed: a dynamic instance of the
// basic-shape material with `Color` set. The game is never worse for the
// asset being missing, only less glossy, and it says which it chose once
// at the volume the answer deserves and again on `GRN.Paint.Status`.
//
// THE NAMES LIVE HERE AND NOWHERE ELSE
//
// The asset path and every parameter name are spelled once, below, and
// the editor module that builds the graph includes this header for them.
// A parameter the graph calls one thing and the instance sets as another
// is a silent no-op — SetScalarParameterValue on a name the parent does
// not expose does nothing at all — so scripts/check-unreal-project.mjs
// fails if any of these strings is typed anywhere else in either module.
//
// constexpr TCHAR pointers rather than static FNames, for the reason
// GRNHeroArt.cpp gives: an FName at file scope is a dynamic initialiser
// that runs before the name table it registers in is guaranteed to exist.

#include "CoreMinimal.h"
#include "GRNPaintLaw.h"

class UObject;
class UMaterialInterface;
class UMaterialInstanceDynamic;

/** Its own category, as GRNApi has, because the only evidence of a
 *  fallback is a log line and LogTemp is where nobody filters. */
DECLARE_LOG_CATEGORY_EXTERN(LogGRNPaint, Log, All);

namespace GRNPaint
{
	// ---- the generated asset ---------------------------------------------
	//
	// The version is in the NAME. A graph that changes becomes _v2, and an
	// old _v1 left in somebody's Content/ is then simply absent as far as
	// the game is concerned, rather than present and wrong.
	constexpr const TCHAR* MaterialPath = TEXT("/Game/GRN/Generated/M_GRNCarPaint_v1.M_GRNCarPaint_v1");

	// ---- its parameters ---------------------------------------------------
	//
	// `Color` deliberately shares its name with the basic-shape material's
	// only parameter, so FGRNCarRig::PaintParam stays `Color` on either
	// path and a respray never needs to know which one the car got.
	constexpr const TCHAR* ParamColor = TEXT("Color");
	constexpr const TCHAR* ParamMetalness = TEXT("Metalness");
	constexpr const TCHAR* ParamSpecular = TEXT("Specular");
	constexpr const TCHAR* ParamBaseRoughness = TEXT("BaseRoughness");
	constexpr const TCHAR* ParamClearCoat = TEXT("ClearCoat");
	constexpr const TCHAR* ParamClearCoatRoughness = TEXT("ClearCoatRoughness");

	/** The project switch the clear coat needs. Read-only at runtime: it
	 *  is set from DefaultEngine.ini at startup and changing it means a
	 *  restart and a shader recompile. */
	constexpr const TCHAR* SubstrateCVar = TEXT("r.Substrate");

	/** "/Game/GRN/Generated/M_GRNCarPaint_v1": MaterialPath before the
	 *  dot. Derived rather than typed a second time, so the package and
	 *  the object can never name two different things. Inline, so the
	 *  editor module can use it without linking against this one. */
	inline FString MaterialPackageName()
	{
		const FString Path(MaterialPath);
		int32 Dot = INDEX_NONE;
		return Path.FindChar(TEXT('.'), Dot) ? Path.Left(Dot) : Path;
	}

	/** "M_GRNCarPaint_v1": MaterialPath after the dot. */
	inline FString MaterialAssetName()
	{
		const FString Path(MaterialPath);
		int32 Dot = INDEX_NONE;
		if (Path.FindChar(TEXT('.'), Dot)) return Path.Mid(Dot + 1);
		int32 Slash = INDEX_NONE;
		return Path.FindLastChar(TEXT('/'), Slash) ? Path.Mid(Slash + 1) : Path;
	}

	// Everything below is defined in GRNPaint.cpp and NOT exported from
	// this module, so the editor module must not call it (a modular editor
	// build would fail to link). It does not need to: it reads the names
	// and the GRNPaintLaw numbers above, which are all inline.

	/** The web's metalness law (GRNPaintLaw::Metalness) for a colour the
	 *  caller holds as sRGB bytes — which every car colour in this port
	 *  is, in FGRNCarDef, FGRNRivalDef and the API. Before the finish
	 *  scales it. */
	float Metalness(const FColor& Srgb);

	/** The finish a showroom car leaves the factory in; Gloss for an id
	 *  this port does not know. */
	EGRNFinish FactoryFinish(const FString& CarId);

	/** "gloss" / "satin" / "matte", as the API spells them. Anything else
	 *  is Gloss, which is what every car in this port was before. */
	EGRNFinish FinishFromString(const FString& Name);

	const TCHAR* FinishName(EGRNFinish Finish);

	/**
	 * The paint MID for a primitive shell.
	 *
	 * The Substrate clear coat with every parameter set when the probe
	 * found it; otherwise a dynamic instance of BasicBase with `Color`
	 * only, exactly what GRNCarFactory made before. Null only when there
	 * is no Substrate paint AND no BasicBase. Metal is the law's value
	 * before the finish — the finish's MetalScale is applied here, once.
	 * Game thread only: the first call probes.
	 */
	UMaterialInstanceDynamic* CreatePaintMid(UObject* Outer, UMaterialInterface* BasicBase,
		const FLinearColor& Color, float Metal, EGRNFinish Finish);

	/** Which paint, and why, in one line — printed once at the first car
	 *  and by `GRN.Paint.Status`. */
	FString StatusLine();
}
