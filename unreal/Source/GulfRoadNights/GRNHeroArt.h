#pragma once

// Which imported car each silhouette wears.
//
// GRNCarFactory builds every machine out of engine primitives, and every
// actor that builds one carries an `Art → Hero Assets` slot for the day
// it does not have to. That slot is per-ACTOR, though, and the player
// cycles cars: one mesh set there puts a sports car's shell on a pickup
// the moment they buy one. What the fleet actually needs is art per
// SILHOUETTE, which is what this is.
//
// A table in code rather than a UDataAsset, because a UDataAsset is a
// binary .uasset and this project does not have those — see the README's
// first paragraph. It is also why the table holds plain string paths
// rather than asset references: nothing here depends on the art being
// present, and a project that has imported nothing builds and cooks
// exactly as it always did.
//
// The paths are the one thing that has to be right, and the one thing
// that cannot be checked from outside the editor. So they live in
// exactly one place, and a path that is wrong while its neighbours
// resolve says so by name in the log rather than quietly handing back a
// primitive car.

#include "CoreMinimal.h"
#include "GRNTypes.h"

struct FGRNHeroAssets;

namespace GRNHeroArt
{
	/**
	 * Fill whatever `Art` leaves empty from the per-silhouette table.
	 *
	 * The actor's own Hero Assets is an OVERRIDE and wins: a Body set by
	 * hand is never replaced, a Wheel set by hand is never replaced, and
	 * the two are independent — a hand-set wheel under a table body is a
	 * combination the factory already supports.
	 *
	 * A silhouette with no entry, or an entry whose art is not in this
	 * project, leaves `Art` untouched, and the factory then builds the
	 * primitives it always built. Game thread only: the first call
	 * probes every path once.
	 */
	void ApplyDefaults(EGRNBodyStyle Style, FGRNHeroAssets& Art);
}
