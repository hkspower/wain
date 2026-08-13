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

	/**
	 * Top-end RTX profile — aimed at a 5090-class card driving 4K.
	 *
	 * Everything here costs real milliseconds and is deliberately NOT in
	 * the default path: denser Lumen tracing, ray-traced shadows at full
	 * sample count, Nanite and virtual shadow maps unclamped, and DLSS Ray
	 * Reconstruction plus Frame Generation where the plugin provides them.
	 * Frame Generation is left to the player rather than forced, because it
	 * adds latency — in a game decided by when you lift for a corner, that
	 * is a trade only the player should make.
	 */
	void ApplyRtxUltra(UObject* WorldContext, bool bFrameGeneration = false);

	/** Path tracer for stills. Not a gameplay mode — it converges over
	 *  many frames and is here for marketing captures. */
	void SetPathTracing(UObject* WorldContext, bool bEnabled);

	/**
	 * Frame pacing. Unlike the web build — where the browser locks
	 * rendering to v-sync and offers no way to switch it off — this is
	 * fully controllable here.
	 *
	 * bVSync trades tearing for a queued frame of latency. bGSync caps a
	 * few frames below the panel instead: on a G-Sync/FreeSync display
	 * that keeps the game inside the variable-refresh window, where there
	 * is neither tearing nor the v-sync latency, and crossing the ceiling
	 * is what drops you back out of it. CapFps of 0 means uncapped.
	 */
	void SetFramePacing(UObject* WorldContext, bool bVSync, float CapFps);

	/** G-Sync/FreeSync preset: v-sync off, capped just under RefreshHz.
	 *  Pass 0 to read the refresh rate from the current display mode. */
	void ApplyVrrPacing(UObject* WorldContext, float RefreshHz = 0.f);

	/** Parse -grn4k / -grn2k / -grn1080 / -grndlss=off from the command
	 *  line so a build can be pointed at a resolution without recompiling. */
	void ApplyCommandLineOverrides(UObject* WorldContext);
}
