#include "GRNHeroArt.h"
#include "GRNCarFactory.h"
#include "Engine/StaticMesh.h"
#include "UObject/SoftObjectPath.h"

namespace
{
	/** One silhouette's art. Plain data — enums, ints and string
	 *  literals — so the table below is constant-initialised and has no
	 *  dynamic initialiser at all. See the note above GRNHeroArtTable. */
	struct FGRNHeroArtEntry
	{
		EGRNBodyStyle Style;
		/** Package.Asset for the body, or nullptr to stay primitive. */
		const TCHAR* BodyPath;
		/** A separate wheel, or nullptr when the body carries its own. */
		const TCHAR* WheelPath;
		/** True when the body mesh already has four wheels baked into it,
		 *  which is what converting a skeletal vehicle rig gives you. */
		bool bBodyHasWheels;
		int32 PaintSlot;
		int32 TailSlot;
		int32 WheelSlot;
		/** The vector parameter a respray drives on this art's material,
		 *  or nullptr to leave the art wearing the paint it was authored
		 *  with. There is no safe default: `Color` exists on the engine's
		 *  basic-shape material and on almost nothing else. */
		const TCHAR* PaintParam;
		/** The same, for the brake flare on the tail lamps. */
		const TCHAR* TailParam;
	};

	// ---------------------------------------------------------------
	// THE PATHS BELOW ARE UNCONFIRMED.
	//
	// They are written for Epic's free Vehicle Variety Pack, from its
	// published contents rather than from the pack itself: fab.com was
	// unreachable from the machine this was written on, so nobody has
	// seen these strings resolve. Expect to correct them once, here.
	//
	// To get the right one: import the pack (Window → Fab → Add to
	// project), find the mesh in the Content Browser, right-click →
	// Copy Reference. That gives exactly the Package.Asset form wanted
	// here. If a vehicle ships only a skeletal SK_ rig, bake a static
	// mesh from it first — a TSoftObjectPtr<UStaticMesh> aimed at a
	// USkeletalMesh resolves to null, and ProbeOnce below says so by
	// name rather than leaving you with a grey car and no explanation.
	//
	// The pack's fifth vehicle is a Box Truck, and no silhouette in this
	// game is a box truck, so it goes unused on purpose. Sedan, ZX, GTR,
	// RX7 and Pony have no counterpart in the pack and stay primitive —
	// and so, therefore, does civilian traffic, which is always Sedan.
	// ---------------------------------------------------------------
	const FGRNHeroArtEntry GRNHeroArtTable[] =
	{
		{ EGRNBodyStyle::Super,  TEXT("/Game/VehicleVarietyPack/Meshes/SM_SportsCar.SM_SportsCar"),
			nullptr, true, 0, -1, -1, nullptr, nullptr },
		{ EGRNBodyStyle::Hatch,  TEXT("/Game/VehicleVarietyPack/Meshes/SM_Hatchback.SM_Hatchback"),
			nullptr, true, 0, -1, -1, nullptr, nullptr },
		{ EGRNBodyStyle::Pickup, TEXT("/Game/VehicleVarietyPack/Meshes/SM_Pickup.SM_Pickup"),
			nullptr, true, 0, -1, -1, nullptr, nullptr },
		{ EGRNBodyStyle::SUV,    TEXT("/Game/VehicleVarietyPack/Meshes/SM_SUV.SM_SUV"),
			nullptr, true, 0, -1, -1, nullptr, nullptr },
	};

	// WHY THE TABLE IS POD AND THE SOFT POINTERS ARE BUILT AT RUNTIME
	//
	// A file-scope TMap<EGRNBodyStyle, FGRNHeroAssets> would be the
	// obvious shape and is the wrong one. A TMap has a dynamic
	// initialiser: it allocates through FMemory::Malloc, and UE chooses
	// its allocator during FEngineLoop::PreInit — so a global TMap
	// allocates before the allocator it will later be freed by exists.
	// TSoftObjectPtr is worse: constructing one builds an
	// FSoftObjectPath, which puts FNames into a global pool and runs
	// through redirect fixup that is only live after module load. And
	// static-initialisation order across translation units is undefined,
	// so even a correct map could be read before it was built.
	//
	// The table above is enums, ints and string literals, which is
	// constant-initialised with no dynamic initialiser at all — the same
	// shape as GRNRivals[] in GRNTypes.h. Every soft pointer is built
	// inside ApplyDefaults, at runtime, long after engine init. The only
	// mutable statics are the trivially-destructible probe results
	// below, so nothing runs at process exit either.

	enum : uint8 { ArtUnprobed = 0, ArtOk, ArtWrongClass, ArtAbsent };
	bool GProbed = false;
	uint8 GArtState[UE_ARRAY_COUNT(GRNHeroArtTable)] = {};

	const TCHAR* StyleName(EGRNBodyStyle S)
	{
		switch (S)
		{
		case EGRNBodyStyle::Sedan:  return TEXT("Sedan");
		case EGRNBodyStyle::ZX:     return TEXT("ZX");
		case EGRNBodyStyle::GTR:    return TEXT("GTR");
		case EGRNBodyStyle::RX7:    return TEXT("RX7");
		case EGRNBodyStyle::Hatch:  return TEXT("Hatch");
		case EGRNBodyStyle::Pony:   return TEXT("Pony");
		case EGRNBodyStyle::Pickup: return TEXT("Pickup");
		case EGRNBodyStyle::Super:  return TEXT("Super");
		case EGRNBodyStyle::SUV:    return TEXT("SUV");
		}
		return TEXT("?");
	}

	/**
	 * Resolve every path once and remember only what happened.
	 *
	 * The state is cached, never the UStaticMesh*: a raw static pointer
	 * to a UObject is unrooted and can dangle after a collection. A
	 * TSoftObjectPtr in a local is safe to hold and cheap to resolve
	 * again, which is what ApplyDefaults hands the factory.
	 */
	void ProbeOnce()
	{
		if (GProbed) return;
		GProbed = true;

		int32 Found = 0;
		for (int32 I = 0; I < UE_ARRAY_COUNT(GRNHeroArtTable); ++I)
		{
			const FGRNHeroArtEntry& E = GRNHeroArtTable[I];
			if (!E.BodyPath) { GArtState[I] = ArtAbsent; continue; }
			UObject* O = FSoftObjectPath(E.BodyPath).TryLoad();
			if (!O) { GArtState[I] = ArtAbsent; continue; }
			if (!Cast<UStaticMesh>(O))
			{
				GArtState[I] = ArtWrongClass;
				// Always loud: this is the likeliest way the Vehicle
				// Variety Pack goes wrong, because its vehicles are
				// skeletal rigs and a soft pointer to a UStaticMesh
				// aimed at one simply casts to null further down.
				UE_LOG(LogTemp, Warning,
					TEXT("GRNHeroArt: %s art %s is a %s, not a UStaticMesh — bake a static mesh "
						"from the rig and point GRNHeroArt.cpp at that"),
					StyleName(E.Style), E.BodyPath, *O->GetClass()->GetName());
				continue;
			}
			GArtState[I] = ArtOk;
			++Found;
		}

		if (Found == 0)
		{
			// The normal state for a fresh clone, for CI, and for anyone
			// who has not imported the pack. Every car builds primitives,
			// which is exactly what it did before this file existed, so
			// this is a note and not a complaint.
			UE_LOG(LogTemp, Log,
				TEXT("GRNHeroArt: no imported car art in this project; every car builds its "
					"primitive shell. Paths live in GRNHeroArt.cpp."));
			return;
		}

		// Some of the pack is here and some of it is not, which almost
		// always means one line is mistyped rather than four files are
		// missing. Name them.
		for (int32 I = 0; I < UE_ARRAY_COUNT(GRNHeroArtTable); ++I)
		{
			if (GArtState[I] != ArtAbsent || !GRNHeroArtTable[I].BodyPath) continue;
			UE_LOG(LogTemp, Warning,
				TEXT("GRNHeroArt: %s art %s did not resolve, though %d of %d entries did — "
					"check the path in GRNHeroArt.cpp (Content Browser → Copy Reference)"),
				StyleName(GRNHeroArtTable[I].Style), GRNHeroArtTable[I].BodyPath,
				Found, (int32)UE_ARRAY_COUNT(GRNHeroArtTable));
		}
	}
}

void GRNHeroArt::ApplyDefaults(EGRNBodyStyle Style, FGRNHeroAssets& Art)
{
	ProbeOnce();

	for (int32 I = 0; I < UE_ARRAY_COUNT(GRNHeroArtTable); ++I)
	{
		const FGRNHeroArtEntry& E = GRNHeroArtTable[I];
		if (E.Style != Style || GArtState[I] != ArtOk) continue;

		// Body and wheel are filled independently, so a hand-set wheel
		// under a table body keeps working.
		if (!Art.HasBody())
		{
			Art.Body = TSoftObjectPtr<UStaticMesh>(FSoftObjectPath(E.BodyPath));
			Art.PaintSlot = E.PaintSlot;
			Art.TailSlot = E.TailSlot;
			Art.bBodyHasWheels = E.bBodyHasWheels;
			Art.PaintParam = E.PaintParam ? FName(E.PaintParam) : NAME_None;
			Art.TailParam = E.TailParam ? FName(E.TailParam) : NAME_None;
		}
		if (Art.Wheel.IsNull() && E.WheelPath)
		{
			Art.Wheel = TSoftObjectPtr<UStaticMesh>(FSoftObjectPath(E.WheelPath));
			Art.WheelSlot = E.WheelSlot;
		}
		return;
	}
}
