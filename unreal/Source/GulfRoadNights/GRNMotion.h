#pragma once

// How a shell moves on its springs, and where its wheels go while it does.
//
// The port had the handling model and none of the motion that goes with
// it: the body was a rigid slab laid on the road, so a car through the
// sweeper at 1.4 g sat as flat as one parked, never dived under the
// brakes, and its four wheels pointed straight ahead at full lock. This
// is src/game/attitude.ts and src/game/suspension.ts carried over
// number for number, in the same engine-free style as GRNSim.h so the
// parity test can build it with a plain g++ and drive it against the
// TypeScript (tests/motion-parity.mjs).
//
// CONVENTIONS. The numbers are the web build's. Roll is positive with the
// RIGHT side down — the same as Unreal's FRotator::Roll — and pitch is
// positive with the NOSE DOWN, which is the opposite of FRotator::Pitch:
// the pawn writes Pitch = -Pitch. Offsets are in the car's frame, X
// forward and Y right, Unreal's, where the web has +z forward and +x to
// the left; the mapping (x_web = -y, z_web = x) is exercised by the
// parity test rather than trusted.

#include <algorithm>
#include <cmath>

namespace GRNMotion
{
	// Attitude springs (attitude.ts ATTITUDE).
	constexpr double RollRefAccel = 14.0;
	constexpr double PitchPerAccel = 0.0039;
	constexpr double PitchDiveMax = 0.045;
	constexpr double PitchSquatMax = -0.02;
	constexpr double RollK = 95.0;
	constexpr double RollC = 13.5;
	constexpr double PitchK = 120.0;
	constexpr double PitchC = 16.0;
	constexpr double MaxStep = 1.0 / 30.0;

	// Suspension (handling.ts).
	constexpr double SuspStrokeM = 0.17;
	constexpr double SuspCamberGain = 0.2;
	constexpr double RoadWheelLock = 0.52;

	/** Degrees of lean per g of cornering, by silhouette (mods.ts
	 *  ROLL_DEG_PER_G) — the sedan's, which is what a car the port has
	 *  not been told about gets. */
	constexpr double SedanRollDegPerG = 4.2;
	/** Radians of roll at the acceleration the target saturates at
	 *  (mods.ts rollMaxRad). */
	inline double RollMaxRad(double DegPerG)
	{
		return DegPerG * (RollRefAccel / 9.81) * 3.14159265358979323846 / 180.0;
	}

	struct FAttitude
	{
		double Roll = 0.0;      // + right side down
		double Pitch = 0.0;     // + nose down
		double RollVel = 0.0;
		double PitchVel = 0.0;
	};

	inline double Clamp(double X, double Lo, double Hi) { return X < Lo ? Lo : X > Hi ? Hi : X; }

	/** The rate the direction of TRAVEL turns, times speed: the road's own
	 *  curvature plus the change in slip angle. Right turns are positive. */
	inline double LateralAccel(double Curvature, double Speed, double BetaRate)
	{
		return (Curvature * Speed + BetaRate) * Speed;
	}

	/** One frame of the springs. */
	inline void StepAttitude(FAttitude& A, double LatAccel, double LongAccel, double RollMax, double Dt)
	{
		const double RollTarget = Clamp(-LatAccel / RollRefAccel, -1.0, 1.0) * RollMax;
		const double PitchTarget = Clamp(-LongAccel * PitchPerAccel, PitchSquatMax, PitchDiveMax);
		const double Ds = std::min(Dt, MaxStep);
		A.RollVel += ((RollTarget - A.Roll) * RollK - A.RollVel * RollC) * Ds;
		A.Roll += A.RollVel * Ds;
		A.PitchVel += ((PitchTarget - A.Pitch) * PitchK - A.PitchVel * PitchC) * Ds;
		A.Pitch += A.PitchVel * Ds;
	}

	/**
	 * Where a hub must sit, in the body's frame, for its contact patch to
	 * stay on a flat road. X is forward, Y to the right, Roll right-down,
	 * Pitch nose-down. The yaw is outside both and does not change a
	 * point's height, so the height row of the roll-then-pitch matrix is
	 * all this needs, solved for the hub's own height:
	 *
	 *     worldZ = x sin(pitchDown) + cos(pitchDown) (z cos(roll) - y sin(roll))
	 *
	 * which reduces to RestZ when the car is level.
	 */
	inline double HubHeight(double RestZ, double X, double Y, double Roll, double PitchDown)
	{
		const double Cr = std::cos(Roll);
		const double Cp = std::cos(PitchDown);
		const double Denom = Cr * Cp;
		if (std::fabs(Denom) < 1e-6) return RestZ;
		return (RestZ + Cp * std::sin(Roll) * Y + std::sin(PitchDown) * X) / Denom;
	}

	struct FWheelSolve
	{
		double Z = 0.0;        // hub height in the body's frame
		double Camber = 0.0;   // lean to give the wheel, + right side down
		double Travel = 0.0;   // + is the hub rising in the body
		bool bLifted = false;
	};

	inline FWheelSolve SolveWheel(double RestZ, double X, double Y, double Roll, double PitchDown,
		double Stroke = SuspStrokeM, double CamberGain = SuspCamberGain)
	{
		const double Want = HubHeight(RestZ, X, Y, Roll, PitchDown);
		const double Travel = Want - RestZ;
		const double Capped = std::max(-Stroke, std::min(Stroke, Travel));
		FWheelSolve R;
		R.Z = RestZ + Capped;
		// Cancel the body's roll, less what the geometry gains.
		R.Camber = -Roll * (1.0 - CamberGain);
		R.Travel = Capped;
		R.bLifted = std::fabs(Travel) > Stroke + 1e-9;
		return R;
	}

	struct FSteer { double Left = 0.0; double Right = 0.0; };

	/**
	 * Ackermann. `Inner` is the signed angle of the inside wheel, right
	 * turns positive: the inside wheel runs the tighter arc and turns
	 * further, by cot(outer) - cot(inner) = track / wheelbase.
	 */
	inline FSteer SteerAngles(double Inner, double Wheelbase, double Track)
	{
		const double A = std::fabs(Inner);
		if (A < 1e-9 || !(Wheelbase > 0.0) || !(Track >= 0.0)) return { Inner, Inner };
		const double Outer = std::atan(Wheelbase / (Wheelbase / std::tan(A) + Track));
		return Inner > 0.0 ? FSteer{ Outer, A } : FSteer{ -A, -Outer };
	}
}
