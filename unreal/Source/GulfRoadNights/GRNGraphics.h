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
	/** Output target. Native follows the desktop; the fixed modes let a
	 *  player render 4K on a 1440p panel or vice versa. */
	enum class EPreset : uint8
	{
		Native,   // whatever the desktop reports
		UHD4K,    // 3840 x 2160
		QHD2K,    // 2560 x 1440
		FHD1080,  // 1920 x 1080
	};

	/** Apply everything: resolution, scalability, per-feature quality. */
	void ApplyMax(UObject* WorldContext);

	/** Switch output resolution at runtime. Fullscreen is preserved. */
	void ApplyPreset(UObject* WorldContext, EPreset Preset);

	/**
	 * NVIDIA path. DLSS and Reflex live in optional plugins, so this only
	 * takes effect when those plugins are present in the build — the
	 * console variables are simply unrecognised otherwise, which is
	 * harmless. Ray tracing itself is engine-native and always applied.
	 *
	 * bPreferQuality picks DLSS Quality over Performance: at 4K the
	 * Quality preset renders 1440p internally, which on an RTX card is
	 * both faster and sharper than native 4K with TSR.
	 */
	void ApplyNvidia(UObject* WorldContext, bool bPreferQuality = true);

	/** Parse -grn4k / -grn2k / -grn1080 / -grndlss=off from the command
	 *  line so a build can be pointed at a resolution without recompiling. */
	void ApplyCommandLineOverrides(UObject* WorldContext);
}
