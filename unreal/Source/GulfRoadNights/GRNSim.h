#pragma once

// The game's actual logic, in C++ that does not need Unreal to compile.
//
// WHAT THIS REPLACES
//
// GRNVehiclePawn::UpdateHandling used to carry its own simplified copy
// of the web model, written before src/game/drift.ts, brakes.ts and
// grip.ts existed. It had no brake lock, no ABS, no fade, no momentum
// spin, no counter-steer, no chain scoring, no feint, no lift-off, no
// load transfer and no downforce. src/game/handling.ts said so out
// loud, in a comment against driftYawClamp:
//
//   "GRNVehiclePawn.cpp still clamps with this, which means the two
//    builds now drift differently even though every constant here
//    agrees — the ports carry the numbers but not yet src/game/drift.ts"
//
// That is the gap this closes. The three solvers below are ports of
// those three files, statement for statement, and they read every
// number out of GRNSimConstants.h, which the generator writes from
// src/game/handling.ts. So the numbers cannot drift apart, and now
// neither can the arithmetic.
//
// WHY IT IS ENGINE-FREE
//
// No CoreMinimal.h, no FMath, no UObject — <cmath> and float. That is
// not stylistic. A header that pulls in the engine can only be compiled
// by the engine, and a solver only Unreal can compile is a solver
// nobody can test: the most anyone could check is that a table of
// constants matched, which is precisely the check that passed for
// months while the two builds drifted differently.
//
// Compiled here by a bare g++ (see tests/parity.mjs), driven through
// the same scripted inputs as the TypeScript, and compared step by step.
// The claim "the UE5 port runs the game's logic" is a claim about a
// trajectory, and that is what gets checked.
//
// PRECISION
//
// double, not float, and deliberately. This is a stateful integrator
// with thresholds in it — the spin trip, the lock margin, the critical
// angle — and near one of those a part-per-million difference is the
// difference between spinning and not. The web build runs in doubles
// because JavaScript has nothing else; matching it is the cheapest way
// to make "the two builds agree" a statement about the model rather
// than about rounding. The engine-facing wrappers take and return
// float, so nothing outside this file has to care.

#include "GRNSimConstants.h"
#include <cmath>

/**
 * THE TICK.
 *
 * 120 Hz, and not a round number chosen for looking tidy. The drift
 * solver integrates a runaway term past the critical angle and trips a
 * spin at a threshold; the brake solver builds lock over about a tenth
 * of a second. A step of 1/60 resolves the lock ramp in six samples and
 * the spin entry in one, which is enough to make a slide that goes round
 * at one frame rate not go round at another. 1/120 halves both and costs
 * a few microseconds of scalar arithmetic per car.
 *
 * The max-steps cap is the spiral guard. If a frame takes longer than
 * the steps it owes, the accumulator asks for more steps next frame,
 * which takes longer still, and a hitch becomes a stall. Past the cap
 * the backlog is dropped and the simulation runs slow for a moment,
 * which is the right failure: a game that stutters is playable and one
 * that locks up is not.
 */
constexpr float GRNSimHz = 120.f;
constexpr float GRNSimStep = 1.f / GRNSimHz;
constexpr int GRNSimMaxSteps = 8;
constexpr float GRNSimMaxFrame = 0.25f;

namespace GRNSim
{
	// ------------------------------------------------------------ helpers

	inline double Sign(double V) { return V > 0.0 ? 1.0 : (V < 0.0 ? -1.0 : 0.0); }
	inline double Clamp(double V, double Lo, double Hi) { return V < Lo ? Lo : (V > Hi ? Hi : V); }
	inline double Min(double A, double B) { return A < B ? A : B; }
	inline double Max(double A, double B) { return A > B ? A : B; }

	/** Wrap into (-pi, pi]. A spin ends with the body normalised to
	 *  where it is actually pointing, not to how far it travelled to get
	 *  there — carrying seven radians out would have the recovery unwind
	 *  the whole rotation backwards. Mirrors normaliseAngle in drift.ts. */
	inline double NormaliseAngle(double A)
	{
		const double Tau = 6.283185307179586;
		while (A > 3.141592653589793) A -= Tau;
		while (A <= -3.141592653589793) A += Tau;
		return A;
	}

	// ------------------------------------------------------- load / grip
	//
	// src/game/grip.ts. The car pitches, the load moves, and the grip
	// goes with it: dive under braking presses the front tyres in and
	// lifts the rear, squat under power does the reverse. None of this
	// existed on the UE side at all.

	struct FLoadState
	{
		/** Longitudinal acceleration in g, LAGGED. Positive under power. */
		double PitchG = 0.0;
	};

	struct FLoadResult
	{
		double Front = GRNExact::StaticFrontLoad;
		double Rear = 1.0 - GRNExact::StaticFrontLoad;
		double RearLight = 0.0;
		double SteerScale = 1.0;
		double DriveScale = 1.0;
		double PitchG = 0.0;
	};

	/**
	 * One frame of weight transfer.
	 *
	 * The lag is the suspension, not a smoothing convenience — it is why
	 * trail braking is a technique and not a switch. Solved instantly the
	 * car flips its balance on a one-frame brake tap.
	 */
	inline FLoadResult SolveLoad(FLoadState& S, double Dt, double ALong)
	{
		using namespace GRNExact;
		const double G = 9.81;
		const double Target = ALong / G;
		S.PitchG += (Target - S.PitchG) * Min(1.0, Dt * LoadLagRate);

		// dW/W = a*h / (g*L). Under braking the shift is forward.
		const double Shift = -S.PitchG * (CgHeightM / WheelbaseM);
		const double Front = Min(LoadClamp, Max(1.0 - LoadClamp, StaticFrontLoad + Shift));
		const double Rear = 1.0 - Front;
		const double StaticRear = 1.0 - StaticFrontLoad;

		FLoadResult R;
		R.Front = Front;
		R.Rear = Rear;
		R.RearLight = Max(0.0, 1.0 - Rear / StaticRear);
		// Sub-linear in load: a tyre carrying twice as much does not hold
		// twice as much, and that exponent is what keeps the squat loop
		// convergent.
		R.SteerScale = Clamp(std::pow(Front / StaticFrontLoad, SteerLoadExp), SteerScaleMin, SteerScaleMax);
		R.DriveScale = Clamp(std::pow(Rear / StaticRear, TyreLoadExp), DriveScaleMin, DriveScaleMax);
		R.PitchG = S.PitchG;
		return R;
	}

	/** Lateral grip at a speed: the tyres, plus what the bodywork is
	 *  pressing them into the road with. v-squared, because that is what
	 *  air does. */
	inline double GripAtSpeed(double GripAccel, double Downforce, double Speed)
	{
		if (!(Downforce > 0.0)) return GripAccel;
		const double V = Speed / GRNExact::DownforceRefSpeed;
		return GripAccel + Min(GRNExact::DownforceMax, Downforce * V * V);
	}

	// ------------------------------------------------------------ brakes
	//
	// src/game/brakes.ts. Lock, ABS, fade, and the rotation a light rear
	// gives up — none of which the port had.

	struct FBrakeTune
	{
		double GripAccel = 12.0;
		double BrakeForce = 26.0;
		double BrakeThermalMult = 1.0;
		bool bHasAbs = true;
	};

	struct FBrakeState
	{
		double Lock = 0.0;
		double Temp = 0.0;
		double Pulse = 0.0;
	};

	struct FBrakeResult
	{
		double Decel = 0.0;
		double Lock = 0.0;
		double Fade = 0.0;
		bool bAbs = false;
		double SteerScale = 1.0;
		double Rotate = 0.0;
		double Temp = 0.0;
	};

	inline double BrakeCeiling(const FBrakeTune& Tune, double LatDemand, double GripNow)
	{
		using namespace GRNExact;
		const double Grip = GripNow > 0.0 ? GripNow : Tune.GripAccel;
		const double Flat = Grip * BrakeGripK + Tune.BrakeForce * BrakePadK;
		// Friction circle: front tyres steering hard have less left to
		// stop with.
		return Flat * std::sqrt(1.0 - TrailBrakeK * LatDemand * LatDemand);
	}

	inline FBrakeResult SolveBrakes(FBrakeState& S, const FBrakeTune& Tune, double Dt,
		double BrakeIn, double Speed, double LatDemand, double Steer, double Throttle,
		double GripNow)
	{
		using namespace GRNExact;
		const double Brake = Clamp(BrakeIn, 0.0, 1.0);
		const double Ceiling = BrakeCeiling(Tune, Clamp(LatDemand, 0.0, 1.0), GripNow);

		// Fade. Heat is what the discs absorbed; it leaves with the air
		// over them, so a car that keeps moving cools and one crawling on
		// hot brakes does not.
		const double Fade =
			Min(1.0, Max(0.0, (S.Temp - BrakeFadeStart) / (BrakeFadeFull - BrakeFadeStart))) * BrakeFadeMax;
		const double PadForce = Tune.BrakeForce * (1.0 - Fade);

		// Engine braking goes into the DEMAND, not onto the answer: the
		// tyre does not care which end of the driveshaft a retarding
		// torque came from.
		const double EngineBrake = (1.0 - Throttle) * EngineBrakeK * Min(1.0, Speed / 12.0);

		const double Demand = Brake * PadForce + EngineBrake;
		const double OverDrive = Ceiling > 0.0 ? Demand / Ceiling : 0.0;

		double Decel = 0.0;
		bool bAbs = false;
		if (OverDrive > BrakeLockMargin)
		{
			if (Tune.bHasAbs)
			{
				bAbs = true;
				S.Pulse += Dt * AbsHz * 3.141592653589793 * 2.0;
				Decel = Ceiling * AbsHold;
				S.Lock += (0.0 - S.Lock) * Min(1.0, Dt * BrakeLockRate);
			}
			else
			{
				S.Lock += (1.0 - S.Lock) * Min(1.0, Dt * BrakeLockRate);
				Decel = Ceiling;
			}
		}
		else
		{
			S.Lock += (0.0 - S.Lock) * Min(1.0, Dt * BrakeLockRate);
			Decel = Min(Demand, Ceiling);
		}
		if (S.Lock < 1e-3) S.Lock = 0.0;

		// A sliding tyre has a lower coefficient than one at the edge of
		// rotating. This is the whole reason threshold braking exists.
		Decel *= 1.0 - S.Lock * (1.0 - BrakeSlideFriction);

		const double PadShare = Demand > 1e-4 ? (Brake * PadForce) / Demand : 0.0;
		const double Capacity = Max(0.2, Tune.BrakeThermalMult);
		S.Temp += ((Decel * PadShare * Speed * BrakeHeatK) / Capacity) * Dt;
		S.Temp -= S.Temp * (BrakeCoolBase + Speed * BrakeCoolK) * Dt;
		if (S.Temp < 0.0) S.Temp = 0.0;

		// Rotation peaks in the MIDDLE of the pedal's travel, which is the
		// whole point of the technique: weight rises with the pedal,
		// spare front grip falls with it, and their product peaks partway
		// through. Bury it and all the weight in the world sits on a
		// front tyre with nothing left to turn with.
		const double Flat = Tune.GripAccel * BrakeGripK + Tune.BrakeForce * BrakePadK;
		const double Weight = Min(1.0, Decel / Max(Flat, 1e-3));
		const double Spare = Max(0.0, 1.0 - Min(1.0, Demand / Max(Ceiling, 1e-3)));

		FBrakeResult R;
		R.Decel = Decel;
		R.Lock = S.Lock;
		R.Fade = Fade;
		R.bAbs = bAbs;
		R.SteerScale = 1.0 - S.Lock * (1.0 - BrakeLockSteer);
		R.Rotate = Sign(Steer) * Min(1.0, std::fabs(Steer)) * Weight * Spare * (1.0 - S.Lock) *
			Min(1.0, Max(0.0, Speed - BrakeRotateMinSpeed) / 18.0);
		R.Temp = S.Temp;
		return R;
	}

	// ------------------------------------------------------------- drift
	//
	// src/game/drift.ts. A slide is a balance held on opposite lock, not
	// an angle that settles at a cap — and a spin is momentum against
	// friction, not a clock. The port had neither.

	struct FDriftState
	{
		double Angle = 0.0;
		double Run = 0.0;
		double Chain = 1.0;
		double SpinT = 0.0;
		double SpinRate = 0.0;
		double SpinSwept = 0.0;
		double SinceSlide = 99.0;
		double LastSide = 0.0;
		double LastSteer = 0.0;
		double FeintT = 0.0;
	};

	enum class EDriftEntry : unsigned char { None, Handbrake, Power, Brake, Feint, Lift };

	struct FDriftInput
	{
		double Dt = 0.0;
		double Speed = 0.0;
		double Steer = 0.0;
		double Throttle = 0.0;
		bool bHandbrake = false;
		double Wheelspin = 0.0;
		double BrakeRotate = 0.0;
		double RearLight = 0.0;
		double DriftAngleMult = 1.0;
	};

	struct FDriftResult
	{
		double Angle = 0.0;
		bool bSpinning = false;
		bool bSpun = false;
		double ScrubRate = 0.0;
		double Gained = 0.0;
		double Chain = 1.0;
		double Banked = 0.0;
		bool bLinked = false;
		double Jolt = 0.0;
		double SpinRate = 0.0;
		double SpinDeg = 0.0;
		EDriftEntry Entry = EDriftEntry::None;
	};

	inline void BreakChain(FDriftState& S)
	{
		S.Run = 0.0;
		S.Chain = 1.0;
		S.LastSide = 0.0;
		S.SinceSlide = 99.0;
	}

	inline FDriftResult SolveDrift(FDriftState& S, const FDriftInput& I)
	{
		using namespace GRNExact;
		const double Dt = I.Dt;
		const double Mult = I.DriftAngleMult;

		FDriftResult Out;
		Out.Angle = S.Angle;
		Out.Chain = S.Chain;

		// The feint: a fast REVERSAL of lock at speed, not merely a fast
		// hand. Turning in hard from straight is turning in hard.
		const double PrevSteer = S.LastSteer;
		const double SteerRate = Dt > 0.0 ? (I.Steer - PrevSteer) / Dt : 0.0;
		S.LastSteer = I.Steer;
		const bool bReversed =
			std::fabs(SteerRate) > DriftFeintRate &&
			std::fabs(PrevSteer) > DriftFeintLoad &&
			Sign(SteerRate) == -Sign(PrevSteer) &&
			I.Speed > DriftFeintMinSpeed;
		if (bReversed) S.FeintT = DriftFeintWindow;
		else S.FeintT = Max(0.0, S.FeintT - Dt);

		// A spin runs its course, and the course is momentum against
		// friction. Coulomb, so the rate falls linearly and it has a
		// definite end rather than an asymptote.
		if (S.SpinT > 0.0)
		{
			S.SpinT += Dt;
			double Dir = Sign(S.SpinRate);
			if (Dir == 0.0) Dir = Sign(S.Angle);
			if (Dir == 0.0) Dir = 1.0;
			const double Slow = 1.0 + DriftSpinSlowK * (1.0 - Min(1.0, I.Speed / DriftSpinEntryRef));
			const double BrakeRate = DriftSpinFriction * Slow + std::fabs(S.SpinRate) * DriftSpinDamp;
			S.SpinRate -= Dir * BrakeRate * Dt;
			if (Sign(S.SpinRate) != Dir) S.SpinRate = 0.0;
			const double Step = S.SpinRate * Dt;
			S.Angle += Step;
			S.SpinSwept += std::fabs(Step);

			Out.Angle = S.Angle;
			Out.bSpinning = true;
			Out.SpinRate = S.SpinRate;
			Out.SpinDeg = (S.SpinSwept * 180.0) / 3.141592653589793;
			Out.ScrubRate = DriftSpinDragBase + DriftSpinDragK * std::fabs(std::sin(S.Angle));
			Out.Chain = S.Chain;

			if (std::fabs(S.SpinRate) < DriftSpinEndRate || S.SpinT > DriftSpinMaxTime)
			{
				S.SpinT = 0.0;
				S.SpinRate = 0.0;
				S.Angle = NormaliseAngle(S.Angle);
			}
			return Out;
		}

		const double Side = Sign(S.Angle);
		const bool bEstablished = std::fabs(S.Angle) > DriftEstablished;
		const double Opposite = (bEstablished && Sign(I.Steer) == -Side) ? std::fabs(I.Steer) : 0.0;
		const double Into = (bEstablished && Sign(I.Steer) == Side) ? std::fabs(I.Steer) : 0.0;

		// Entries. Each is a different way of getting the rear past its
		// limit, and each has its own reach.
		const bool bPowerOver =
			I.Wheelspin > PowerOverSpin &&
			std::fabs(I.Steer) > PowerOverSteer &&
			I.Speed > PowerOverMinSpeed &&
			I.Throttle > PowerOverThrottle;
		const bool bTrail = std::fabs(I.BrakeRotate) > DriftBrakeEntry && I.Speed > DriftMinSpeed;
		const bool bFeint = S.FeintT > 0.0 && I.Speed > DriftFeintMinSpeed;
		// Lift-off, ranked BELOW the trail-brake entry: standing on the
		// brakes also unloads the rear, so without that ordering every
		// trail-braked corner would report itself as a lift.
		const bool bLift =
			I.RearLight > DriftLiftEntry &&
			I.Throttle < 0.1 &&
			std::fabs(I.Steer) > 0.2 &&
			I.Speed > DriftMinSpeed;

		double EntryScale = 0.0;
		if (I.bHandbrake) { EntryScale = 1.0; Out.Entry = EDriftEntry::Handbrake; }
		else if (bPowerOver) { EntryScale = PowerOverAngleK; Out.Entry = EDriftEntry::Power; }
		else if (bTrail) { EntryScale = DriftBrakeAngleK; Out.Entry = EDriftEntry::Brake; }
		else if (bFeint) { EntryScale = DriftFeintAngleK; Out.Entry = EDriftEntry::Feint; }
		else if (bLift)
		{
			EntryScale = DriftLiftAngleK * Min(1.0, I.RearLight / 0.4);
			Out.Entry = EDriftEntry::Lift;
		}

		double Rate = 0.0;
		if (EntryScale > 0.0 && I.Speed > DriftMinSpeed)
		{
			double Dir;
			if (std::fabs(I.Steer) > 0.12) Dir = Sign(I.Steer);
			else if (bTrail) Dir = Sign(I.BrakeRotate);
			else Dir = Side;
			if (Dir != 0.0)
			{
				const double Cap =
					(DriftAngleBase + DriftAngleSpeedK * Min(1.0, I.Speed / 55.0)) * EntryScale * Mult;
				const double Target = Dir * Cap * Min(1.0, std::fabs(I.Steer) + 0.45);
				// One-sided on purpose: the entry DRAGS the tail out to
				// its angle, it does not haul the car back in once the
				// driver has sent it further.
				const bool bBeyond = Sign(S.Angle) == Dir && std::fabs(S.Angle) > std::fabs(Target);
				if (!bBeyond) Rate += (Target - S.Angle) * DriftEngageRate;
			}
		}
		else if (S.Angle != 0.0)
		{
			const double Prev = S.Angle;
			Rate -= (S.Angle * (DriftRecoverRate + Opposite * DriftRecoverCounterK)) / Mult;
			if (std::fabs(Prev) > 0.3 && std::fabs(Prev + Rate * Dt) <= 0.3 && Opposite < 0.2)
			{
				Out.Jolt = 0.18;
			}
		}

		// Sustain: an established slide is a balance you hold, not a
		// value that settles. Lock into it with throttle keeps rotating
		// the car; opposite lock is what stops it.
		if (bEstablished)
		{
			Rate += Side * Into * (0.35 + I.Throttle * 0.65) * DriftOverRotate;
			Rate -= Side * Opposite * DriftCounterRate;
			const double Excess = std::fabs(S.Angle) - DriftCriticalAngle * Mult;
			if (Excess > 0.0) Rate += Side * Excess * DriftRunawayRate;
		}

		S.Angle += Rate * Dt;
		if (std::fabs(S.Angle) < 0.005 && EntryScale == 0.0) S.Angle = 0.0;

		// Gone. Still LEAVING, not merely out there: a body already
		// coming back under counter-steer is not spinning however far
		// round it happens to be pointing.
		const bool bLeaving = Sign(Rate) == Sign(S.Angle) && std::fabs(Rate) > DriftSpinTripRate;
		if (bLeaving && std::fabs(S.Angle) > DriftSpinAngle * Mult)
		{
			double Dir = Sign(S.Angle);
			if (Dir == 0.0) Dir = 1.0;
			S.SpinRate = Dir * (std::fabs(Rate) + DriftSpinEntryRate +
				DriftSpinEntrySpeedK * Min(1.0, I.Speed / DriftSpinEntryRef));
			S.SpinT = Dt > 0.0 ? Dt : 1e-3;
			S.SpinSwept = 0.0;
			BreakChain(S);
			Out.bSpun = true;
			Out.bSpinning = true;
			Out.Angle = S.Angle;
			Out.SpinRate = S.SpinRate;
			Out.ScrubRate = DriftSpinDragBase + DriftSpinDragK * std::fabs(std::sin(S.Angle));
			Out.Chain = 1.0;
			return Out;
		}

		// Scrub, gated on actually being sideways: the base term is what
		// a slide costs for existing, and charging it to a car pointing
		// straight is a permanent headwind.
		Out.ScrubRate = std::fabs(S.Angle) > DriftEstablished
			? (DriftScrubBase + std::fabs(S.Angle) * DriftScrubK) * (1.0 - I.Throttle * 0.55)
			: 0.0;

		// Score: angle times speed, stepped every time a live slide is
		// reversed through centre.
		const double Deg = (std::fabs(S.Angle) * 180.0) / 3.141592653589793;
		const bool bScoring = Deg > DriftScoreMinDeg && I.Speed > DriftScoreMinSpeed;
		if (bScoring)
		{
			const double NowSide = Sign(S.Angle);
			if (S.LastSide != 0.0 && NowSide != S.LastSide && S.SinceSlide < DriftLinkWindow)
			{
				S.Chain = Min(DriftChainMax, S.Chain + 1.0);
				Out.bLinked = true;
			}
			S.LastSide = NowSide;
			S.SinceSlide = 0.0;
			Out.Gained = Deg * ((I.Speed * 3.6) / 100.0) * DriftScoreK * S.Chain * Dt;
			S.Run += Out.Gained;
		}
		else
		{
			S.SinceSlide += Dt;
			if (S.Run > 0.0 && S.SinceSlide >= DriftLinkWindow)
			{
				Out.Banked = S.Run;
				S.Run = 0.0;
				S.Chain = 1.0;
				S.LastSide = 0.0;
			}
		}

		Out.Angle = S.Angle;
		Out.Chain = S.Chain;
		return Out;
	}
}
