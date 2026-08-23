// Drive the UE5 port's solvers through a scripted lap and print what
// they did, one line a step.
//
//   g++ -O2 -std=c++17 -I unreal/Source/GulfRoadNights tools/parity/parity.cpp -o /tmp/parity
//
// tests/parity.mjs runs the IDENTICAL script through src/game/drift.ts,
// brakes.ts and grip.ts and compares the two trajectories step by step.
// That is the point: a contract test that only compares constants
// passed for months while GRNVehiclePawn.cpp was running a different,
// older model, because a table of numbers agreeing says nothing about
// what is done with them.
//
// The script is generated here rather than read from a file so there is
// no parser to disagree about — the same integer LCG in both languages,
// producing the same doubles, in the same order. Integer arithmetic is
// exact in both, so the inputs are identical by construction and any
// difference in the output is a difference in the model.

#include "GRNSim.h"
#include <cstdio>
#include <cstdint>

/**
 * The input script.
 *
 * A 32-bit LCG with the constants glibc uses, seeded once. Every value
 * a solver needs is derived from it, and both sides implement the same
 * three lines. JavaScript numbers are doubles and hold a 32-bit integer
 * exactly, so `(a * x + c) % 2^32` is the same sequence in both.
 */
struct Script
{
	uint32_t State;
	explicit Script(uint32_t Seed) : State(Seed) {}
	uint32_t Next()
	{
		State = (uint32_t)((1103515245u * (uint64_t)State + 12345u) & 0xffffffffu);
		return State;
	}
	/** A double in [0,1). */
	double Unit() { return (double)Next() / 4294967296.0; }
	/** A double in [Lo,Hi). */
	double Range(double Lo, double Hi) { return Lo + Unit() * (Hi - Lo); }
};

int main()
{
	using namespace GRNSim;

	// How long the run-up is, in steps. Measured, not guessed: at 90
	// steps the car reached 20 m/s and the trail-brake entry peaked at
	// 0.058 rad/s against a threshold of 0.12, because that entry is
	// scaled by (v-12)/18 and 20 m/s is less than half of it. At 240 the
	// car arrives at about 30 and everything downstream has something to
	// work with.
	const int RunUp = 240;

	Script Rng(20260822u);
	int Hold = 0;
	int Mode = 6; // so the first cycle starts at 0
	int HoldTotal = 0;
	int Phase = 0;
	double Way = 1.0;
	bool bHandbrake = false;

	FBrakeTune Tune;
	Tune.GripAccel = 12.4;
	Tune.BrakeForce = 30.0;
	Tune.BrakeThermalMult = 1.0; // stock discs, so fade is reachable

	double Speed = 30.0;
	double Steer = 0.0;
	double Throttle = 0.0;
	double Brake = 0.0;
	double Downforce = 0.9;

	// Driven, not sampled.
	//
	// White noise on the inputs never spins the car and never gets the
	// discs hot: a solver with rate limits, hysteresis and thresholds is
	// only exercised by inputs held long enough to reach them. The first
	// version of this script resampled every input independently and
	// produced a run with zero spins in four thousand steps, which would
	// have "proved" that the spin model matched by never invoking it.
	//
	// So: six manoeuvres, held for a stretch each, and every one of them
	// is a thing a driver does on purpose. Between them they reach every
	// part the port was missing.
	//
	// No sin, no cos, no transcendentals ANYWHERE in the script — only
	// integer and rational arithmetic. libm's sin and JavaScript's
	// Math.sin are allowed to differ in the last place, and a script that
	// disagrees with itself makes the whole comparison meaningless.
	const int Steps = 8000;
	const double Dt = 1.0 / 120.0;

	std::printf("step,angle,spinRate,scrub,chain,run,lock,temp,rotate,decel,front,steerScale,driveScale,grip\n");

	// Two passes over the same script: without ABS, then with it. The
	// controller is a whole branch of the brake solver — it bleeds the
	// pedal back to 97% of the limit and pulses at 14 Hz — and with it
	// switched off for the whole run that branch is never taken and its
	// parity is never checked.
	// Six passes: three drivetrains, each with ABS off and on. Two was
	// enough while every car in the game was a rear-driver; it is not
	// enough now, and a parity run that only ever exercises one
	// drivetrain proves the ports agree about one third of the model.
	for (int Pass = 0; Pass < 6; Pass++)
	{
	Tune.bHasAbs = (Pass % 2) == 1;
	const GRNSim::EDrivetrain Drive =
		Pass < 2 ? GRNSim::EDrivetrain::RWD
		: Pass < 4 ? GRNSim::EDrivetrain::FWD
		: GRNSim::EDrivetrain::AWD;
	FDriftState Drift;
	FBrakeState Brakes;
	FLoadState Load;
	Rng = Script(20260822u);
	Speed = 30.0;
	Hold = 0; Mode = 6; Phase = 0; Way = 1.0; bHandbrake = false;

	for (int i = 0; i < Steps; i++)
	{
		if (Hold <= 0)
		{
			// Cycled, not drawn. Coverage by construction rather than by
			// luck: with the manoeuvres chosen at random the fade stint —
			// which has to run for a thousand steps to get a disc to 320
			// degrees — crowded four of the other six out of a four
			// thousand step pass, and the run "proved" parity on branches
			// it never took. The generator still decides which way each
			// one goes and how long it is held.
			Mode = (Mode + 1) % 7;
			Hold = 20 + (int)(Rng.Next() % 90u);
			// ...and threshold braking gets held long enough to FADE.
			// Heat is decel times speed against a cooling term with an
			// eighteen-second time constant, so reaching the 320 degrees
			// fade starts at takes six or seven seconds of continuous
			// braking — which is what the ten-stop fade test in
			// tests/physics.mjs does, and what this has to do too.
			if (Mode == 2) Hold += 1400;
			// The trail-brake entry needs the pedal EASED, not buried:
			// rotation is weight times spare front grip and their product
			// peaks partway through the travel. Mode 3 ramps the pedal
			// off at 0.02 a step, so it has to run long enough to get
			// down to about a quarter pedal before the entry can trip.
			if (Mode == 3) Hold += RunUp + 120;
			// The handbrake entry is held far longer than the rest, and it
			// has to be: from the entry cap at 0.40 rad the sustain term
			// winds the angle on at about 0.38 rad/s, so reaching the
			// 1.05 rad spin trip takes the better part of two seconds —
			// after a run-up long enough to have the speed the entry
			// needs at all. Held for the same fifth of a second as
			// everything else, this script produced not one spin in four
			// thousand steps, which would have "proved" the spin model
			// matched by never once invoking it.
			if (Mode == 4) Hold += RunUp + 640;
			if (Mode == 5) Hold += 200;
			if (Mode == 6) Hold += RunUp + 100;
			HoldTotal = Hold;
			Phase = 0;
			Way = (Rng.Next() % 2u) ? 1.0 : -1.0;
		}
		Hold--;
		Phase++;

		switch (Mode)
		{
		case 0: // cruising, weaving gently in lane
			Steer = Way * 0.15 * ((Phase % 40) < 20 ? 1.0 : -1.0);
			Throttle = 0.5; Brake = 0.0; bHandbrake = false;
			break;
		case 1: // flat out, straight
			Steer = 0.0; Throttle = 1.0; Brake = 0.0; bHandbrake = false;
			break;
		case 2: // threshold braking, long enough to heat the discs
			Steer = Way * 0.1; Throttle = 0.0; Brake = 1.0; bHandbrake = false;
			break;
		// Modes 3, 4 and 6 open with a run-up, and they have to.
		// Every one of them needs SPEED — the trail entry is scaled by
		// (v-12)/18, the handbrake entry wants 14 m/s and power-over 18 —
		// and each follows whatever left the car where it did. Following
		// the fade stint, which ends on the speed floor, all three fired
		// exactly nothing. A driver accelerates into a corner before
		// doing anything interesting in it; so does this.
		case 3: { // trail braking in: easing off as the lock goes on
			if (Phase <= RunUp) { Steer = 0.0; Throttle = 1.0; Brake = 0.0; bHandbrake = false; break; }
			const int Q = Phase - RunUp;
			// From a HALF pedal, not a buried one: rotation is weight
			// times SPARE front grip and their product peaks partway
			// through the travel, so a pedal on the floor rotates nothing.
			// Left-foot braking: a light pedal held against part throttle,
			// at MODERATE lock. Sized from the arithmetic rather than
			// nudged toward it — rotation is weight times SPARE front
			// grip, and the two things that were killing spare were the
			// speed collapsing (so the throttle holds it up) and full
			// lock eating the brake ceiling through the friction circle
			// (so the lock comes back to 0.6). Ramping a pedal down from
			// half, at full lock, peaked at 0.115 against a 0.12 trip.
			(void)Q;
			Steer = Way * 0.6; Throttle = 0.85; Brake = 0.32; bHandbrake = false;
			break;
		}
		case 4: { // handbrake entry, then lock INTO it on the throttle —
			// the way a slide is turned into a spin
			if (Phase <= RunUp) { Steer = 0.0; Throttle = 1.0; Brake = 0.0; bHandbrake = false; break; }
			const int Q = Phase - RunUp;
			Steer = Way * 0.9;
			Throttle = Q > 12 ? 1.0 : 0.2;
			Brake = 0.0; bHandbrake = Q <= 12;
			// ...and then hands off, which is the other thing that had
			// never happened in this script: a big angle dropped with no
			// correction snaps back with a jolt, and every manoeuvre here
			// used to be followed by another one holding lots of lock.
			// Hands off — but only after the slide has had time to go all
			// the way. Dropped at 200 the lock came off at almost exactly
			// the step the angle reached the spin trip, and the car
			// recovered instead of going round.
			if (Q > 280) { Steer = 0.0; Throttle = 0.4; }
			break;
		}
		case 6: // lifting off mid-corner. Gentle lock and a brush of
			// pedal: enough deceleration to take the weight off the rear,
			// not enough rotation to trip the trail entry, which outranks
			// this one. That gap is exactly where lift-off oversteer is.
			if (Phase <= RunUp) { Steer = 0.0; Throttle = 1.0; Brake = 0.0; bHandbrake = false; break; }
			// A three-tenths pedal, not a tenth. The lift entry needs the
			// rear unloaded past 0.18, and the harness's own longitudinal
			// model puts 0.1 of brake at 1.4 m/s^2 — which unloads it to
			// 0.112 and never trips. Still far below the trail entry's
			// rotation threshold, which is the gap this manoeuvre is for.
			Steer = Way * 0.3; Throttle = 0.0; Brake = 0.3; bHandbrake = false;
			break;
		default: { // transitions: lock flicked from one side to the other,
			// which is what links a drift chain — and then the wheel is
			// let go, SLOWLY.
			//
			// The release has to be slow, and that is the whole point of
			// it. A big angle dropped with no correction snaps back with
			// a jolt, but an ABRUPT release is a fast reversal of lock at
			// speed, which is a feint — so it arms the feint entry, the
			// feint entry owns the next 0.45 s, and the recover branch
			// where the jolt lives is never reached. Letting go over half
			// a second is 1.9 rad/s of lock, under the 4.2 the feint
			// detector trips at, so the car simply comes back on grip.
			const int Release = HoldTotal - 180;
			if (Phase > Release)
			{
				// From whichever side the flick happened to be on when the
				// release began. Ramping from a fixed side jumped the
				// wheel across centre half the time — 1.9 rad in one step,
				// which is a fast reversal at speed, which is a feint,
				// which arms the very entry the slow release exists to
				// avoid.
				const double S0 = (((Release / 40) % 2) ? Way : -Way);
				const int R = Phase - Release;
				if (R <= 90)
				{
					// Hold the slide first, and for long enough. There has to
					// be a big angle to snap back FROM: released straight
					// out of a flick the car was passing through centre,
					// and even a quarter-second hold only reached 0.27 rad
					// against a jolt threshold of 0.3. Three quarters of a
					// second on the throttle at full lock winds it past
					// half a radian.
					Steer = S0 * 0.95; Throttle = 0.95;
				}
				else
				{
					const double T = Min(1.0, (R - 90) / 60.0);
					Steer = S0 * 0.95 * (1.0 - T);
					Throttle = 0.3;
				}
				Brake = 0.0; bHandbrake = false;
				break;
			}
			Steer = (((Phase / 40) % 2) ? Way : -Way) * 0.95;
			// Enough throttle to light the rears, so power-over holds the
			// angle between flicks. At 0.7 the slide collapsed under grip
			// before the next flick and the chain never linked: linking
			// needs a LIVE slide reversed through centre, not two
			// separate ones.
			Throttle = 0.95; Brake = 0.0; bHandbrake = false;
			break;
		}
		}
		// Straighten between manoeuvres. Two reasons, and the second is
		// the one that matters: a driver does straighten up, and a big
		// angle DROPPED with no correction is the only way to reach the
		// snap-back jolt — every manoeuvre here used to be followed
		// immediately by another one holding a lot of lock, which counts
		// as counter-steer and takes the jolt branch off the table.
		if (Phase <= 30) Steer = 0.0;

		// A crude longitudinal model, enough to move the state around:
		// what matters is that both sides see the same numbers.
		const double Grip = GripAtSpeed(Tune.GripAccel, Downforce, Speed);
		const FLoadResult L = SolveLoad(Load, Dt, (Throttle * 9.0 - Brake * 14.0) - 1.2, Drive, Throttle);
		const double LatDemand = Min(1.0, std::fabs(Steer) * Speed / GRNExact::LatDemandSpeed);
		const FBrakeResult B = SolveBrakes(Brakes, Tune, Dt, Brake, Speed, LatDemand, Steer, Throttle, Grip);

		FDriftInput In;
		In.Dt = Dt;
		In.Speed = Speed;
		In.Steer = Steer;
		In.Throttle = Throttle;
		In.bHandbrake = bHandbrake;
		In.Wheelspin = Throttle > 0.85 ? (Throttle - 0.85) * 14.0 : 0.0;
		In.BrakeRotate = B.Rotate;
		In.RearLight = L.RearLight;
		In.Drive = Drive;
		In.DriftAngleMult = 1.0;
		const FDriftResult D = SolveDrift(Drift, In);

		Speed += (Throttle * 9.0 * L.DriveScale - B.Decel - 1.2) * Dt;
		Speed *= 1.0 - D.ScrubRate * Dt;
		// A road-speed floor rather than a standstill. Brake heat is
		// force times SPEED, so a script that lets the car trickle to a
		// halt stops heating the discs the moment it gets there and can
		// never reach fade — which starts at 320 degrees.
		if (Speed < 12.0) Speed = 12.0;
		if (Speed > 95.0) Speed = 95.0;

		std::printf("%d,%.12g,%.12g,%.12g,%.12g,%.12g,%.12g,%.12g,%.12g,%.12g,%.12g,%.12g,%.12g,%.12g\n",
			Pass * Steps + i, D.Angle, D.SpinRate, D.ScrubRate, D.Chain, Drift.Run,
			B.Lock, B.Temp, B.Rotate, B.Decel,
			L.Front, L.SteerScale, L.DriveScale, Grip);
	}
	}
	return 0;
}
