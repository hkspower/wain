#include "GRNPaint.h"
#include "Containers/StringConv.h"
#include "HAL/IConsoleManager.h"
#include "Materials/MaterialInterface.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Misc/OutputDevice.h"
#include "Misc/PackageName.h"
#include "UObject/SoftObjectPath.h"
#include "UObject/UObjectGlobals.h"

DEFINE_LOG_CATEGORY(LogGRNPaint);

namespace
{
	enum class EPaintState : uint8
	{
		Unprobed,
		Substrate,
		Basic,
	};

	// The state is cached, never the UMaterialInterface* — the same rule
	// as GRNHeroArt's probe, for the same reason: a raw static pointer to
	// a UObject is unrooted and can dangle after a collection. Both
	// statics are trivially destructible, so nothing runs at exit either.
	EPaintState GPaintState = EPaintState::Unprobed;
	/** Why the state is what it is. Only ever a string literal. */
	const TCHAR* GPaintWhy = TEXT("no car has been painted yet");

	int32 PaintSubstrateValue()
	{
		const IConsoleVariable* Cv = IConsoleManager::Get().FindConsoleVariable(GRNPaint::SubstrateCVar);
		return Cv ? Cv->GetInt() : -1;
	}

	/**
	 * Decide which paint this session draws, in the order it goes wrong.
	 *
	 * Substrate first, because without it the asset is not merely absent
	 * but meaningless — its whole graph hangs off Front Material, which a
	 * legacy project ignores. Then existence, asked of the package system
	 * rather than by loading, so a project that has simply never built the
	 * asset does not print a load failure for a file nobody expected.
	 * Then the load and the class, each of which names itself.
	 */
	void ProbePaint()
	{
		if (PaintSubstrateValue() <= 0)
		{
			GPaintState = EPaintState::Basic;
			GPaintWhy = TEXT("r.Substrate is off in this project, so there is no clear coat to render — it is on in ")
				TEXT("the repository's DefaultEngine.ini; turning it on needs an editor restart and a shader recompile");
			return;
		}
		if (!FPackageName::DoesPackageExist(GRNPaint::MaterialPackageName()))
		{
			GPaintState = EPaintState::Basic;
			GPaintWhy = TEXT("the generated clear coat is not in this project yet — open the editor once (the ")
				TEXT("GulfRoadNightsEditor module builds it) or run: UnrealEditor-Cmd GulfRoadNights.uproject -run=GRNBuildPaint");
			return;
		}
		UObject* Found = FSoftObjectPath(GRNPaint::MaterialPath).TryLoad();
		if (!Found)
		{
			GPaintState = EPaintState::Basic;
			GPaintWhy = TEXT("the generated clear coat is on disk but did not load — rebuild it with ")
				TEXT("-run=GRNBuildPaint -force");
			return;
		}
		if (!Cast<UMaterialInterface>(Found))
		{
			GPaintState = EPaintState::Basic;
			GPaintWhy = TEXT("something that is not a material lives at the paint's path — delete it and run ")
				TEXT("-run=GRNBuildPaint");
			return;
		}
		GPaintState = EPaintState::Substrate;
		GPaintWhy = TEXT("generated asset loaded and Substrate is on");
	}

	void ProbePaintOnce()
	{
		if (GPaintState != EPaintState::Unprobed) return;
		ProbePaint();
		// Said once, at Display. A car drawn in the fallback is not broken,
		// and the log is the only place the difference would otherwise
		// show — a glossy car and a slightly less glossy one look like the
		// same working game.
		UE_LOG(LogGRNPaint, Display, TEXT("%s"), *GRNPaint::StatusLine());
	}

	/**
	 * `GRN.Paint.Status` in the console.
	 *
	 * Asks again rather than repeating the boot answer, so building the
	 * asset in the editor mid-session and running this is enough to switch
	 * — the next car built (Tab cycles yours) picks it up. Cars already on
	 * the road keep the MID they were given.
	 */
	void GRNPaintStatusCommand(FOutputDevice& Ar)
	{
		GPaintState = EPaintState::Unprobed;
		ProbePaint();
		Ar.Logf(TEXT("GRN.Paint: %s"), *GRNPaint::StatusLine());
		Ar.Logf(TEXT("GRN.Paint: asset %s, %s = %d"), GRNPaint::MaterialPath, GRNPaint::SubstrateCVar,
			PaintSubstrateValue());
		Ar.Logf(TEXT("GRN.Paint: cars built from now on use this; a car already on the road keeps its paint until rebuilt"));
	}

	FAutoConsoleCommandWithOutputDevice GRNPaintStatusCmd(
		TEXT("GRN.Paint.Status"),
		TEXT("Which car paint this build draws — the generated Substrate clear coat or the basic-shape fallback — and why."),
		FConsoleCommandWithOutputDeviceDelegate::CreateStatic(&GRNPaintStatusCommand));
}

float GRNPaint::Metalness(const FColor& Srgb)
{
	const uint32_t Hex = (static_cast<uint32_t>(Srgb.R) << 16) | (static_cast<uint32_t>(Srgb.G) << 8)
		| static_cast<uint32_t>(Srgb.B);
	return static_cast<float>(GRNPaintLaw::Metalness(Hex));
}

EGRNFinish GRNPaint::FactoryFinish(const FString& CarId)
{
	if (CarId.IsEmpty()) return EGRNFinish::Gloss;
	// Car ids are ASCII slugs ("jahra-pickup"); the table is engine-free,
	// so it holds them as char.
	const auto Ansi = StringCast<ANSICHAR>(*CarId);
	return GRNPaintLaw::FactoryFinish(Ansi.Get());
}

EGRNFinish GRNPaint::FinishFromString(const FString& Name)
{
	if (Name.Equals(TEXT("satin"), ESearchCase::IgnoreCase)) return EGRNFinish::Satin;
	if (Name.Equals(TEXT("matte"), ESearchCase::IgnoreCase)) return EGRNFinish::Matte;
	return EGRNFinish::Gloss;
}

const TCHAR* GRNPaint::FinishName(EGRNFinish Finish)
{
	switch (Finish)
	{
	case EGRNFinish::Satin: return TEXT("satin");
	case EGRNFinish::Matte: return TEXT("matte");
	case EGRNFinish::Gloss: return TEXT("gloss");
	}
	return TEXT("gloss");
}

UMaterialInstanceDynamic* GRNPaint::CreatePaintMid(UObject* Outer, UMaterialInterface* BasicBase,
	const FLinearColor& Color, float Metal, EGRNFinish Finish)
{
	ProbePaintOnce();

	if (GPaintState == EPaintState::Substrate)
	{
		// LoadObject on a loaded asset is a lookup, and the MIDs made from
		// it keep it alive; if every car has gone and it was collected,
		// this loads it again.
		if (UMaterialInterface* Paint = LoadObject<UMaterialInterface>(nullptr, GRNPaint::MaterialPath))
		{
			const GRNPaintLaw::FFinishSpec& F = GRNPaintLaw::Finish(Finish);
			// Not called `Mid`: GRNCarFactory.cpp has a file-local Mid(), and
			// a unity build that put the two files together would see this
			// local hide it — a shadowing error under UE's warning levels.
			UMaterialInstanceDynamic* CoatMid = UMaterialInstanceDynamic::Create(Paint, Outer);
			CoatMid->SetVectorParameterValue(GRNPaint::ParamColor, Color);
			// The finish scales the law, once, here — as cars.ts does with
			// `paintMetalness(body) * FINISHES[finish].metalScale`.
			CoatMid->SetScalarParameterValue(GRNPaint::ParamMetalness, FMath::Clamp(Metal, 0.f, 1.f) * F.MetalScale);
			CoatMid->SetScalarParameterValue(GRNPaint::ParamSpecular, GRNPaintLaw::Specular);
			CoatMid->SetScalarParameterValue(GRNPaint::ParamBaseRoughness, GRNPaintLaw::BaseRoughness + F.RoughnessAdd);
			CoatMid->SetScalarParameterValue(GRNPaint::ParamClearCoat, F.ClearCoat);
			CoatMid->SetScalarParameterValue(GRNPaint::ParamClearCoatRoughness, F.ClearCoatRoughness);
			return CoatMid;
		}
		// It was there at the probe and is not now. Drop to the fallback for
		// the rest of the session and say so, rather than retrying a load
		// that has already failed once for every car on the road.
		GPaintState = EPaintState::Basic;
		GPaintWhy = TEXT("the generated clear coat loaded once and then failed to — falling back for this session");
		UE_LOG(LogGRNPaint, Warning, TEXT("%s"), *GRNPaint::StatusLine());
	}

	// Exactly what GRNCarFactory made before this file existed.
	if (!BasicBase) return nullptr;
	UMaterialInstanceDynamic* BasicMid = UMaterialInstanceDynamic::Create(BasicBase, Outer);
	BasicMid->SetVectorParameterValue(GRNPaint::ParamColor, Color);
	return BasicMid;
}

FString GRNPaint::StatusLine()
{
	const TCHAR* Which = GPaintState == EPaintState::Substrate ? TEXT("SUBSTRATE clear coat")
		: GPaintState == EPaintState::Basic ? TEXT("BASIC shape material, Color only")
		: TEXT("not decided yet");
	return FString::Printf(TEXT("%s — %s"), Which, GPaintWhy);
}
