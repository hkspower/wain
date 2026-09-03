// The C++ half of the crash parity check (tests/crash.mjs).
//
// Prints the same ladder as tools/parity/crash-ladder.mjs, formatted
// identically, so the two builds can be diffed line for line. Compiled
// by a bare g++ — GRNSim.h needs no Unreal, which is the whole reason
// the solver lives there rather than in the pawn.
#include "GRNSim.h"
#include <cstdio>

// Signed zero is a formatting difference, not a numeric one: a parallel
// graze imparts exactly no rotation, and -0.0 and +0.0 are the same
// number. Adding 0.0 normalises the sign bit so the diff is about the
// model rather than about printf.
static double Z(double V) { return V + 0.0; }

int main()
{
	const double Full = GRNExact::CrashLatFull;
	const double Cases[][3] = {
		{ Full, 0.0, 1 }, { Full, 0.6, 1 }, { Full, -0.6, 1 },
		{ Full / 2, 0.6, 1 }, { Full * 4, -0.6, -1 }, { 2, 0.6, 1 },
	};
	for (const auto& C : Cases)
	{
		GRNSim::FImpact H = GRNSim::SolveWallImpact(C[0], C[1], C[2], 0.0);
		printf("wall into=%.3f hd=%+.2f side=%+.0f sev=%.6f yaw=%+.6f kick=%+.6f spin=%d nose=%d mul=%.6f slip=%+.6f hdg=%+.6f\n",
			C[0], C[1], C[2], Z(H.Severity), Z(H.Yaw), Z(H.Kick), (int)H.Spin, (int)H.NoseFirst,
			Z(H.SpeedMul), Z(H.SlipVel), Z(H.Heading));
	}
	for (int Fb = 0; Fb < 2; ++Fb)
	{
		GRNSim::FImpact T = GRNSim::SolveTrafficImpact(GRNExact::TrafficClosingFull, 0.2, 1, Fb != 0, 0.0);
		printf("traffic fromBehind=%d sev=%.6f yaw=%+.6f kick=%+.6f spin=%d\n", Fb, Z(T.Severity), Z(T.Yaw), Z(T.Kick), (int)T.Spin);
	}
	printf("scrape %.6f %.6f\n", GRNSim::ScrapeDrag(0.0), GRNSim::ScrapeDrag(1.0));
	return 0;
}
