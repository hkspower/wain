#pragma once

// GENERATED FILE — do not edit by hand.
// Produced by scripts/export-unreal-data.mjs from src/game/handling.ts
// and src/game/rig.ts. Regenerate with:  npm run sync:unreal
//
// PLAIN C++ ON PURPOSE. No CoreMinimal.h, no UE types, nothing that
// needs the engine to compile — because GRNSim.h includes this and
// GRNSim.h is compiled by a bare g++ in the parity test. A number that
// only Unreal can read is a number nobody can check.

// -------------------------------------------------------- handling model
// Mirrors src/game/handling.ts — parsed from it, never hand-copied. If a
// constant is added there, rerunning this generator publishes it here.

namespace GRNHandling
{
	constexpr float Ceiling = 115.f;
	constexpr float ThrustK = 19.f;
	constexpr float DragA = 0.0012f;
	constexpr float DragB = 1.2f;
	constexpr float SteerSmoothRate = 7.f;
	constexpr float CasterRate = 2.4f;
	constexpr float HeadingClamp = 0.45f;
	constexpr float FlashRangeM = 60.f;
	constexpr float DriftMinSpeed = 14.f;
	constexpr float DriftAngleBase = 0.38f;
	constexpr float DriftAngleSpeedK = 0.28f;
	constexpr float DriftEngageRate = 3.4f;
	constexpr float DriftRecoverRate = 2.3f;
	constexpr float DriftYawClamp = 0.75f;
	constexpr float DriftLatScrub = 0.5f;
	constexpr float DriftDriveLoss = 1.1f;
	constexpr float DriftEstablished = 0.12f;
	constexpr float DriftRecoverCounterK = 3.2f;
	constexpr float DriftOverRotate = 0.42f;
	constexpr float DriftCounterRate = 2.6f;
	constexpr float DriftCriticalAngle = 0.72f;
	constexpr float DriftRunawayRate = 1.6f;
	constexpr float DriftSpinAngle = 1.05f;
	constexpr float DriftSpinTripRate = 0.05f;
	constexpr float DriftSpinEntryRate = 2.6f;
	constexpr float DriftSpinEntrySpeedK = 5.f;
	constexpr float DriftSpinEntryRef = 78.f;
	constexpr float DriftSpinFriction = 1.5f;
	constexpr float DriftSpinSlowK = 2.2f;
	constexpr float DriftSpinDamp = 0.16f;
	constexpr float DriftSpinEndRate = 0.5f;
	constexpr float DriftSpinDragBase = 0.18f;
	constexpr float DriftSpinDragK = 1.35f;
	constexpr float DriftSpinMaxTime = 6.f;
	constexpr float DriftScrubBase = 0.05f;
	constexpr float DriftScrubK = 0.24f;
	constexpr float DriftBrakeEntry = 0.12f;
	constexpr float DriftBrakeAngleK = 0.45f;
	constexpr float DriftFeintRate = 4.2f;
	constexpr float DriftFeintLoad = 0.3f;
	constexpr float DriftFeintMinSpeed = 20.f;
	constexpr float DriftFeintWindow = 0.45f;
	constexpr float DriftFeintAngleK = 0.55f;
	constexpr float DriftScoreK = 3.2f;
	constexpr float DriftScoreMinDeg = 8.f;
	constexpr float DriftScoreMinSpeed = 12.f;
	constexpr float DriftLinkWindow = 0.9f;
	constexpr float DriftChainMax = 5.f;
	constexpr float BrakeLockMargin = 1.f;
	constexpr float BrakeSlideFriction = 0.72f;
	constexpr float BrakeLockSteer = 0.25f;
	constexpr float BrakeLockRate = 12.f;
	constexpr float AbsHold = 0.97f;
	constexpr float AbsHz = 14.f;
	constexpr float BrakeHeatK = 0.105f;
	constexpr float BrakeCoolBase = 0.008f;
	constexpr float BrakeCoolK = 0.0016f;
	constexpr float BrakeFadeStart = 320.f;
	constexpr float BrakeFadeFull = 620.f;
	constexpr float BrakeFadeMax = 0.45f;
	constexpr float BrakeRotateK = 0.85f;
	constexpr float BrakeRotateMinSpeed = 12.f;
	constexpr float EngineBrakeK = 2.4f;
	constexpr float CgHeightM = 0.52f;
	constexpr float WheelbaseM = 2.62f;
	constexpr float StaticFrontLoad = 0.53f;
	constexpr float LoadLagRate = 6.5f;
	constexpr float LoadClamp = 0.82f;
	constexpr float TyreLoadExp = 0.85f;
	constexpr float SteerLoadExp = 0.6f;
	constexpr float SteerScaleMin = 0.8f;
	constexpr float SteerScaleMax = 1.22f;
	constexpr float DriveScaleMin = 0.7f;
	constexpr float DriveScaleMax = 1.12f;
	constexpr float AwdDriveLoss = 0.96f;
	constexpr float FwdThrottleSteerLoss = 0.3f;
	constexpr float FwdTorqueSteer = 0.045f;
	constexpr float PowerOverRwd = 1.f;
	constexpr float PowerOverAwd = 0.45f;
	constexpr float PowerOverFwd = 0.1f;
	constexpr float DownforceRefSpeed = 70.f;
	constexpr float DownforceMax = 6.f;
	constexpr float DriftLiftEntry = 0.18f;
	constexpr float DriftLiftAngleK = 0.3f;
	constexpr float TractionBase = 0.8f;
	constexpr float TractionRampSpeed = 22.f;
	constexpr float BrakeGripK = 1.05f;
	constexpr float BrakePadK = 0.25f;
	constexpr float TrailBrakeK = 0.6f;
	constexpr float LatDemandSpeed = 40.f;
	constexpr float UndersteerK = 0.35f;
	constexpr float CornerScrubK = 0.3f;
	constexpr float CornerScrubSpeed = 40.f;
	constexpr float PowerOverSpin = 1.2f;
	constexpr float PowerOverSteer = 0.5f;
	constexpr float PowerOverMinSpeed = 18.f;
	constexpr float PowerOverThrottle = 0.85f;
	constexpr float PowerOverAngleK = 0.6f;
	constexpr float CrashLatFull = 12.f;
	constexpr float CrashSpeedLossK = 0.28f;
	constexpr float CrashReboundK = 5.f;
	constexpr float TrafficClosingFull = 22.f;
}

// ------------------------------------------------ the same, exactly
//
// The identical constants at full precision, for GRNSim.h.
//
// The float set above is what the rest of the port uses and must stay
// float: it is threaded through FMath::Min(1.f, x) and FVector(...) in a
// dozen places, and template deduction on FMath::Min(float, double)
// does not compile. But a float constant is not the number that is in
// handling.ts — 0.105f is 0.10499999672174454 — and the solvers are
// stateful integrators with THRESHOLDS in them. Measured, that
// difference put the drift chain on a different step on step 452 of a
// scripted run: not a rounding error in the output, a different
// decision, because the score gate was crossed one frame apart.
//
// Two representations of one source, generated together, so they cannot
// drift from each other or from the web build.

namespace GRNExact
{
	constexpr double Ceiling = 115;
	constexpr double ThrustK = 19;
	constexpr double DragA = 0.0012;
	constexpr double DragB = 1.2;
	constexpr double SteerSmoothRate = 7;
	constexpr double CasterRate = 2.4;
	constexpr double HeadingClamp = 0.45;
	constexpr double FlashRangeM = 60;
	constexpr double DriftMinSpeed = 14;
	constexpr double DriftAngleBase = 0.38;
	constexpr double DriftAngleSpeedK = 0.28;
	constexpr double DriftEngageRate = 3.4;
	constexpr double DriftRecoverRate = 2.3;
	constexpr double DriftYawClamp = 0.75;
	constexpr double DriftLatScrub = 0.5;
	constexpr double DriftDriveLoss = 1.1;
	constexpr double DriftEstablished = 0.12;
	constexpr double DriftRecoverCounterK = 3.2;
	constexpr double DriftOverRotate = 0.42;
	constexpr double DriftCounterRate = 2.6;
	constexpr double DriftCriticalAngle = 0.72;
	constexpr double DriftRunawayRate = 1.6;
	constexpr double DriftSpinAngle = 1.05;
	constexpr double DriftSpinTripRate = 0.05;
	constexpr double DriftSpinEntryRate = 2.6;
	constexpr double DriftSpinEntrySpeedK = 5;
	constexpr double DriftSpinEntryRef = 78;
	constexpr double DriftSpinFriction = 1.5;
	constexpr double DriftSpinSlowK = 2.2;
	constexpr double DriftSpinDamp = 0.16;
	constexpr double DriftSpinEndRate = 0.5;
	constexpr double DriftSpinDragBase = 0.18;
	constexpr double DriftSpinDragK = 1.35;
	constexpr double DriftSpinMaxTime = 6;
	constexpr double DriftScrubBase = 0.05;
	constexpr double DriftScrubK = 0.24;
	constexpr double DriftBrakeEntry = 0.12;
	constexpr double DriftBrakeAngleK = 0.45;
	constexpr double DriftFeintRate = 4.2;
	constexpr double DriftFeintLoad = 0.3;
	constexpr double DriftFeintMinSpeed = 20;
	constexpr double DriftFeintWindow = 0.45;
	constexpr double DriftFeintAngleK = 0.55;
	constexpr double DriftScoreK = 3.2;
	constexpr double DriftScoreMinDeg = 8;
	constexpr double DriftScoreMinSpeed = 12;
	constexpr double DriftLinkWindow = 0.9;
	constexpr double DriftChainMax = 5;
	constexpr double BrakeLockMargin = 1;
	constexpr double BrakeSlideFriction = 0.72;
	constexpr double BrakeLockSteer = 0.25;
	constexpr double BrakeLockRate = 12;
	constexpr double AbsHold = 0.97;
	constexpr double AbsHz = 14;
	constexpr double BrakeHeatK = 0.105;
	constexpr double BrakeCoolBase = 0.008;
	constexpr double BrakeCoolK = 0.0016;
	constexpr double BrakeFadeStart = 320;
	constexpr double BrakeFadeFull = 620;
	constexpr double BrakeFadeMax = 0.45;
	constexpr double BrakeRotateK = 0.85;
	constexpr double BrakeRotateMinSpeed = 12;
	constexpr double EngineBrakeK = 2.4;
	constexpr double CgHeightM = 0.52;
	constexpr double WheelbaseM = 2.62;
	constexpr double StaticFrontLoad = 0.53;
	constexpr double LoadLagRate = 6.5;
	constexpr double LoadClamp = 0.82;
	constexpr double TyreLoadExp = 0.85;
	constexpr double SteerLoadExp = 0.6;
	constexpr double SteerScaleMin = 0.8;
	constexpr double SteerScaleMax = 1.22;
	constexpr double DriveScaleMin = 0.7;
	constexpr double DriveScaleMax = 1.12;
	constexpr double AwdDriveLoss = 0.96;
	constexpr double FwdThrottleSteerLoss = 0.3;
	constexpr double FwdTorqueSteer = 0.045;
	constexpr double PowerOverRwd = 1;
	constexpr double PowerOverAwd = 0.45;
	constexpr double PowerOverFwd = 0.1;
	constexpr double DownforceRefSpeed = 70;
	constexpr double DownforceMax = 6;
	constexpr double DriftLiftEntry = 0.18;
	constexpr double DriftLiftAngleK = 0.3;
	constexpr double TractionBase = 0.8;
	constexpr double TractionRampSpeed = 22;
	constexpr double BrakeGripK = 1.05;
	constexpr double BrakePadK = 0.25;
	constexpr double TrailBrakeK = 0.6;
	constexpr double LatDemandSpeed = 40;
	constexpr double UndersteerK = 0.35;
	constexpr double CornerScrubK = 0.3;
	constexpr double CornerScrubSpeed = 40;
	constexpr double PowerOverSpin = 1.2;
	constexpr double PowerOverSteer = 0.5;
	constexpr double PowerOverMinSpeed = 18;
	constexpr double PowerOverThrottle = 0.85;
	constexpr double PowerOverAngleK = 0.6;
	constexpr double CrashLatFull = 12;
	constexpr double CrashSpeedLossK = 0.28;
	constexpr double CrashReboundK = 5;
	constexpr double TrafficClosingFull = 22;
}

// ------------------------------------------------------------------ rigs
// Mirrors src/game/rig.ts. Every figure in this game is posed by the
// analytic IK in GRNDriverRig.cpp rather than by an animation asset, and
// a solver is only as portable as the numbers it solves against. Lengths
// are metres — multiply by GRN_M for UE centimetres. Angles are radians
// and rates are per-second, in both engines.

namespace GRNRig
{
	constexpr float DriverShoulderX = 0.16f;
	constexpr float DriverShoulderY = 0.46f;
	constexpr float DriverShoulderZ = -0.04f;
	constexpr float DriverUpperArm = 0.29f;
	constexpr float DriverForeArm = 0.26f;
	constexpr float DriverHipX = 0.09f;
	constexpr float DriverHipY = 0.17f;
	constexpr float DriverHipZ = 0.05f;
	constexpr float DriverThigh = 0.27f;
	constexpr float DriverShin = 0.27f;
	constexpr float DriverHipPitch = -1.15f;
	constexpr float DriverKneePitch = 0.95f;
	constexpr float DriverHeadY = 0.52f;
	constexpr float DriverHeadZ = 0.02f;
	constexpr float DriverWheelY = 0.44f;
	constexpr float DriverWheelZ = 0.24f;
	constexpr float DriverWheelRake = -0.42f;
	constexpr float DriverLeanPerG = 0.115f;
	constexpr float DriverFoldPerG = 0.075f;
	constexpr float DriverLeanRate = 5.5f;
	constexpr float DriverHeadCounter = 0.45f;
	constexpr float DriverWheelRadius = 0.16f;
	constexpr float DriverGripLeft = 2.26194671f;
	constexpr float DriverGripRight = 0.879645943f;
	constexpr float DriverSteerLock = 2.4f;
	constexpr float DriverWheelRate = 12.f;
	constexpr float DriverPedalThrottleX = 0.1f;
	constexpr float DriverPedalBrakeX = -0.08f;
	constexpr float DriverPedalY = 0.09f;
	constexpr float DriverPedalZ = 0.46f;
	constexpr float DriverPedalPitch = -0.55f;
	constexpr float DriverPedalTravelZ = 0.05f;
	constexpr float DriverPedalTravelY = 0.015f;
	constexpr float DriverArmPoleX = 0.51f;
	constexpr float DriverArmPoleY = -0.04f;
	constexpr float DriverArmPoleZ = -0.06f;
	constexpr float DriverLegPoleX = 0.22f;
	constexpr float DriverLegPoleY = 1.1f;
	constexpr float DriverLegPoleZ = 0.42f;
	constexpr float DriverLookAheadM = 26.f;
	constexpr float DriverLookLatK = 0.4f;
	constexpr float DriverLookHeight = 1.1f;
	constexpr float DriverNeckYaw = 0.7f;
	constexpr float DriverNeckPitch = 0.28f;
	constexpr float DriverNeckRate = 5.f;
	constexpr float RivalSteerPerLat = 0.45f;
	constexpr float RivalSteerRate = 4.f;
	constexpr float RivalPedalRate = 6.f;
	constexpr float RivalThrottleAccel = 0.3f;
	constexpr float RivalThrottleScale = 8.f;
	constexpr float RivalBrakeAccel = -1.f;
	constexpr float RivalBrakeScale = 10.f;
	constexpr float RivalCruiseThrottle = 0.2f;
	constexpr float RivalGlanceGapM = 12.f;
	constexpr float RivalGlanceLatM = 1.2f;
	constexpr float SpectatorShoulderX = 0.2f;
	constexpr float SpectatorShoulderY = 1.28f;
	constexpr float SpectatorArmAbduction = 0.15f;
	constexpr float SpectatorUpperArm = 0.28f;
	constexpr float SpectatorForeArm = 0.25f;
	constexpr float SpectatorHeadY = 1.5f;
	constexpr float RacerShoulderX = 0.19f;
	constexpr float RacerShoulderY = 1.4f;
	constexpr float RacerUpperArm = 0.28f;
	constexpr float RacerForeArm = 0.26f;
	constexpr float RacerHeadY = 1.64f;
	constexpr float CrowdWatchRangeM = 90.f;
	constexpr float CrowdNeckYaw = 1.15f;
	constexpr float CrowdNeckPitch = 0.3f;
	constexpr float CrowdNeckRate = 6.f;
	constexpr float CrowdBodyRate = 1.2f;
	constexpr float CrowdRestRate = 1.5f;
	constexpr float CrowdWaveRangeM = 45.f;
	constexpr float CrowdLiftUpRate = 2.2f;
	constexpr float CrowdLiftDownRate = 1.1f;
	constexpr float CrowdWagHz = 6.5f;
	constexpr float CrowdWagAmp = 0.3f;
	constexpr float CrowdReach = 0.94f;
	constexpr float CrowdRaiseUp = 0.87f;
	constexpr float CrowdRaiseOut = 0.45f;
	constexpr float CrowdStillEvery = 3.f;
	constexpr float CrowdPoleX = 0.6f;
	constexpr float CrowdPoleY = -0.2f;
	constexpr float CrowdPoleZ = 0.05f;
}
