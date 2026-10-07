// The body's springs, the hub solve and Ackermann, from GRNMotion.h, one
// line a case — tests/motion-parity.mjs runs the same cases through
// src/game/attitude.ts and suspension.ts.
//
//   g++ -O2 -std=c++17 -I unreal/Source/GulfRoadNights tools/parity/motion.cpp -o /tmp/motion
#include "GRNMotion.h"
#include <cstdio>
#include <cstdint>

int main()
{
	using namespace GRNMotion;
	uint32_t S = 20261007u;
	auto U = [&]() { S = (uint32_t)((1103515245u * (uint64_t)S + 12345u) & 0xffffffffu); return (double)S / 4294967296.0; };
	auto R = [&](double Lo, double Hi) { return Lo + U() * (Hi - Lo); };

	std::printf("kind,a,b,c,d,e,f\n");
	// Springs, driven through a script that swings both axes past their clamps.
	FAttitude A;
	for (int i = 0; i < 3000; ++i)
	{
		if (i % 150 == 0) { /* new demand every 1.25 s at 120 Hz */ }
		const double Lat = std::sin(i * 0.013) * 22.0 + R(-2, 2);
		const double Lng = std::cos(i * 0.021) * 14.0 + R(-1, 1);
		StepAttitude(A, Lat, Lng, RollMaxRad(2.6), 1.0 / 120.0);
		if (i % 10 == 0) std::printf("att,%.12g,%.12g,%.12g,%.12g,%.12g,%.12g\n", Lat, Lng, A.Roll, A.Pitch, A.RollVel, A.PitchVel);
	}
	// A dropped frame: the clamp on the step.
	StepAttitude(A, 9.0, -6.0, RollMaxRad(4.2), 0.5);
	std::printf("att,%.12g,%.12g,%.12g,%.12g,%.12g,%.12g\n", 9.0, -6.0, A.Roll, A.Pitch, A.RollVel, A.PitchVel);
	// Hubs. Web x is to the left, z forward; here Y is right, X forward.
	for (int i = 0; i < 400; ++i)
	{
		const double Xw = R(-1.0, 1.0), Zw = R(-1.6, 1.6), Rest = R(0.3, 0.55);
		const double Roll = R(-0.12, 0.12), Pitch = R(-0.06, 0.06);
		const FWheelSolve W = SolveWheel(Rest, Zw, -Xw, Roll, Pitch);
		std::printf("hub,%.12g,%.12g,%.12g,%.12g,%.12g,%.12g\n", Xw, Zw, Rest, Roll, Pitch, W.Z);
		std::printf("cam,%.12g,%.12g,%.12g,%.12g,%.12g,%.12g\n", Roll, 0.0, 0.0, 0.0, 0.0, W.Camber);
	}
	// Ackermann: web minusX is the left wheel in the web frame (+x is left),
	// so the left/right of ours map to plusX/minusX swapped.
	for (int i = 0; i < 200; ++i)
	{
		const double Inner = R(-0.52, 0.52), L = R(2.2, 3.4), T = R(1.4, 1.9);
		const FSteer St = SteerAngles(Inner, L, T);
		std::printf("ack,%.12g,%.12g,%.12g,%.12g,%.12g,%.12g\n", Inner, L, T, St.Left, St.Right, 0.0);
	}
	return 0;
}
