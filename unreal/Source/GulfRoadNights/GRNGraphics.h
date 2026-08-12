#pragma once

// Pushes the renderer to its ceiling: native desktop resolution at
// fullscreen, cinematic scalability, and the Lumen / virtual shadow map /
// TSR quality dials at max. Applied once at boot; players can still pull
// individual dials down from the console (or a future settings UMG) —
// this sets the ceiling, not a cage.

#include "CoreMinimal.h"

class UObject;

namespace GRNGraphics
{
	/** Apply everything: resolution, scalability, per-feature quality. */
	void ApplyMax(UObject* WorldContext);
}
