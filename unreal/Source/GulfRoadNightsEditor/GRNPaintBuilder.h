#pragma once

// Builds the car paint — GRNPaint::MaterialPath — as a real material
// asset, from C++, so the repository carries the GRAPH as reviewable text
// and never the binary it produces.
//
// WHY C++ AND NOT THE ALTERNATIVES
//
// - Unreal Python would need the Python and Editor Scripting plugins, its
//   API is labelled experimental, and every pin is a string: a pin Epic
//   renames is a silently unconnected input and a car that renders grey.
//   Here every node INPUT is a C++ member (`Coat->ClearCoatRoughness`),
//   so a renamed input is a compile error on the first 5.x that renames
//   it — the failure moves from "looks wrong in a still" to "does not
//   build", which is the one this repository can see.
// - A committed MaterialX file imported through Interchange does arrive
//   as a native Substrate material, but MaterialX-to-Substrate is on
//   Epic's roadmap as experimental, and the parameter names would be the
//   importer's to choose rather than GRNPaint.h's.
//
// THE GRAPH (v1)
//
//   Color, Metalness, Specular ──► Substrate Metalness-To-DiffuseAlbedo-F0
//                                        │ DiffuseAlbedo, F0
//   BaseRoughness ──────────────┐        ▼
//   ClearCoat ──────────────────┼──► Substrate Simple Clear Coat ──► Front Material
//   ClearCoatRoughness ─────────┘
//
// The Simple Clear Coat node is the one Epic built to carry legacy clear
// coat into Substrate, so it renders in the Blendable GBuffer format this
// project sets (r.Substrate.ProjectGBufferFormat=0) and costs one slab.
// A true two-slab vertical layer — coat slab over base slab, weighted by
// ClearCoat — needs the Adaptive format and costs more per pixel; it is
// the v2 to build only if side-by-side stills say v1 is not enough.
//
// Node OUTPUTS have no C++ member to name, so they are found by name and
// a missing one fails the build of the asset with the names that ARE
// there, rather than connecting output 0 and hoping.

#include "CoreMinimal.h"

namespace GRNPaintBuilder
{
	enum class EResult : uint8
	{
		/** Created or rebuilt, and saved. */
		Built,
		/** Already on disk and not forced; nothing touched. */
		AlreadyThere,
		/** r.Substrate is off: the graph would hang off a Front Material
		 *  input this project ignores, so it is not built at all. */
		SubstrateOff,
		/** Something went wrong; the message says what. */
		Failed,
	};

	/**
	 * Build the paint if it is missing, or always when bForce. Rebuilds an
	 * existing asset IN PLACE — its expressions cleared and remade — rather
	 * than replacing the object, so anything already referencing it keeps
	 * a valid pointer. OutMessage is one line for a human either way.
	 */
	EResult Build(bool bForce, FString& OutMessage);

	const TCHAR* ResultName(EResult Result);
}
