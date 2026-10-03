#pragma once

// Pushes the renderer to its ceiling: native desktop resolution at
// fullscreen, cinematic scalability, and the Lumen / virtual shadow map /
// TSR quality dials at max. Applied once at boot; players can still pull
// individual dials down from the console (or a future settings UMG) —
// this sets the ceiling, not a cage.

#include "CoreMinimal.h"

class UObject;
class ULocalLightComponent;

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
	 *  line so a build can be pointed at a resolution without recompiling.
	 *  Also -grnnomegalights: MegaLights off for the session, and with it
	 *  every lamp and headlight shadow (see MegaLightsActive). */
	void ApplyCommandLineOverrides(UObject* WorldContext);

	/**
	 * Is MegaLights going to draw this project's local lights?
	 *
	 * The street lamps and headlights ask this before they turn shadows
	 * on. Under MegaLights a shadowed light costs a fixed amount per
	 * pixel, however many there are — which is what makes ~170 shadowed
	 * sodium lamps along 7.3 km affordable at all. Without it each one is
	 * its own shadow map, and the old unshadowed lamps are the right
	 * answer. Four things must say yes:
	 *
	 *  - r.MegaLights.EnableForProject, the project switch
	 *    (DefaultEngine.ini). An engine with no MegaLights has no such
	 *    variable and answers false.
	 *  - r.MegaLights.Allow. NOT, at boot, the scalability rung's say:
	 *    ApplyMax raises every group to Cinematic before the world is
	 *    built, and Cinematic says yes, so the Low and Medium entries in
	 *    DefaultScalability.ini are never what the first build reads. What
	 *    can still say no here is what outranks scalability — a device
	 *    profile, -grnnomegalights, the console — and a rung lowered later
	 *    in the session (FollowMegaLights re-lights for that).
	 *  - An SM6 renderer. MegaLights is SM6-only on desktop; a GPU that
	 *    runs this game at SM5 has no MegaLights at all, and the project
	 *    switch above says yes regardless.
	 *  - Hardware ray tracing. The lamps keep MegaLights' default shadow
	 *    method, ray tracing. Without hardware RT MegaLights falls back
	 *    to tracing the global distance field, whose quality Epic calls
	 *    significantly reduced, and whether 5.8 takes that path for every
	 *    light on every such card is not something this repository could
	 *    confirm. Saying no there costs the shadows on a GPU that might
	 *    have drawn them; saying yes wrongly costs a shadow map per lamp.
	 *
	 * What it still cannot see is anything the renderer decides per view
	 * (a post-process volume turning MegaLights off, say). The MegaLights
	 * visualisation in the editor's view modes is the check for that.
	 */
	bool MegaLightsActive();

	/**
	 * Make Light's shadows follow MegaLightsActive() — now, and again
	 * whenever r.MegaLights.Allow or r.MegaLights.EnableForProject
	 * changes for the rest of the process. Returns what it set.
	 *
	 * Asking once at build time is not enough on its own. MegaLights
	 * reads r.MegaLights.Allow every frame; a lamp built once would not.
	 * Without this, lowering the rung mid-session (`scalability 1`, or
	 * sg.ShadowQuality) has DefaultScalability.ini switch MegaLights off
	 * under ~170 lamps and ~30 headlights still built shadowed — one
	 * shadow map each, the exact cost the rung was lowered to shed. Every
	 * light made through here is tagged, so the change can find it again
	 * in whatever world it is in, with no list of lights to outlive that
	 * world.
	 */
	bool FollowMegaLights(ULocalLightComponent* Light);
}
