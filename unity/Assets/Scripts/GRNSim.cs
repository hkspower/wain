// The simulation, in C#.
//
// This is the Unity half of src/game/brakes.ts and src/game/grip.ts, and
// it is a transliteration of unreal/Source/GulfRoadNights/GRNSim.h rather
// than a fresh interpretation — that C++ is already verified step for
// step against the TypeScript by npm run test:parity, so porting the
// PORT keeps all three builds one solver instead of three opinions.
//
// WHY THIS FILE EXISTS
//
// Unity's braking was one line:
//
//     float braking = brakeAmt * 26f;
//
// A constant. No lock-up, no anti-lock, no disc temperature, no fade —
// so the Unity build could not be made to lock a wheel, could not fade
// its brakes down a long descent, and threshold braking, which is the
// whole skill the web build's brake model exists to reward, did nothing
// at all there. The ports carried the NUMBERS and wrote their own code
// around them, which is a weaker guarantee than it looks: check:unity
// could report ninety-six constants in agreement while the two builds
// stopped completely differently.
//
// PRECISION
//
// Everything here is double, and it reads GRNData.Exact rather than
// GRNData.Handling. Unity's own surface is float — Mathf, Vector3, the
// whole engine — but a float constant is not the number in handling.ts:
// 0.105f is 0.10499999672174454. These solvers are stateful integrators
// with thresholds in them, and on the UE5 port that exact shortcut put
// the drift chain on a different value at step 452 of a scripted run.
// Not a rounding difference in the output: a different DECISION, because
// a gate was crossed one frame apart. Cast to float at the boundary,
// where it costs nothing.
//
// WHAT IS NOT TRUE OF THIS FILE YET
//
// The C++ port is verified by trajectory — sixteen thousand steps of a
// scripted drive compared field by field against the TypeScript, worst
// disagreement 5e-12. This one is not, because there is no C# toolchain
// in the environment it was written in, so tests/parity.mjs cannot add a
// third column. What guards it today is that the constants are generated
// from one source and the code is a line-for-line transliteration of an
// already-verified port. What would actually verify it is compiling this
// file with `dotnet` or `mono` against the same scripted drive and
// diffing the same fourteen fields. That is a real gap and it is written
// here rather than left to be discovered.

using System;

public static class GRNSim
{
    // ------------------------------------------------------------ helpers
    static double Clamp(double v, double lo, double hi) => v < lo ? lo : (v > hi ? hi : v);
    static double Min(double a, double b) => a < b ? a : b;
    static double Max(double a, double b) => a > b ? a : b;
    static double Sign(double v) => v > 0.0 ? 1.0 : (v < 0.0 ? -1.0 : 0.0);

    /// <summary>
    /// Which wheels the engine drives.
    ///
    /// The enum only — SolveLoad still is not here, for the reason given
    /// below. It is declared so that GRNData's car table, which now
    /// carries a Drive per car, has a type to be, and so the Unity build
    /// can read the field even while the solver that consumes it is
    /// still missing.
    /// </summary>
    public enum Drivetrain { FWD, RWD, AWD }

    // --------------------------------------------------------------- grip
    //
    // Only the part the brake solver needs. src/game/grip.ts also carries
    // load transfer, and that is NOT here: it would have been a guess.
    // The rule this file follows is that every line is a transliteration
    // of an already-verified port, and writing a solveLoad from memory
    // would have broken it in the one way that is hard to see later —
    // code that looks like the others and is not.
    //
    // That gap now costs more than it did. Load transfer is where the
    // drivetrain lives: which axle's load the engine may use is the
    // whole model, so a Unity build without SolveLoad cannot tell a
    // front-driver from a rear-driver however faithfully it carries the
    // constants. The C++ port has it and tests/parity.mjs proves it
    // agrees with the web across 48,000 steps and all three layouts.
    // Porting SolveLoad here is a dozen lines; verifying it needs a C#
    // toolchain, which this environment does not have, and an unverified
    // transliteration of a solver is exactly what the paragraph above
    // refuses to write.
    //
    // The same sentence now applies to the tow — src/game/slipstream.ts,
    // ported to C++ in GRNSim.h and checked step for step by
    // tests/parity.mjs. It is twenty lines of stateless arithmetic and
    // it would be quicker to write than this note, which is precisely
    // why it is not here: the rule is not "port the hard ones carefully",
    // it is that nothing enters this file that no test in this repository
    // can run. A Unity build therefore has no slipstream at all, which is
    // a visible difference rather than a subtle one — cars behind other
    // cars carry their full drag — and that is a better failure than a
    // wake that is nearly right and answers to nobody.

    /// <summary>
    /// Lateral grip at this speed, aero included.
    ///
    /// Downforce is a v-squared term quoted as the m/s2 it delivers at a
    /// reference speed, so it scales by the square of the ratio rather
    /// than being added flat — and it is capped, because a wing does not
    /// keep giving forever.
    /// </summary>
    public static double GripAtSpeed(double gripAccel, double downforce, double speed)
    {
        if (!(downforce > 0.0)) return gripAccel;
        double v = speed / GRNData.Exact.DownforceRefSpeed;
        return gripAccel + Min(GRNData.Exact.DownforceMax, downforce * v * v);
    }

    // ------------------------------------------------------------- brakes
    //
    // src/game/brakes.ts.

    public struct BrakeTune
    {
        public double BrakeForce;        // pad force, m/s2, before tyre and heat
        public double GripAccel;         // lateral grip: the tyre's share of the ceiling
        public double BrakeThermalMult;  // heat capacity, relative to stock
        public bool HasAbs;
    }

    public struct BrakeState
    {
        public double Lock;   // 0..1 — how fully the tyres have stopped rotating
        public double Temp;   // disc temperature, degrees C above ambient
        public double Pulse;  // ABS modulation phase, radians
    }

    public struct BrakeResult
    {
        public double Decel;       // m/s2 of retardation to apply this frame
        public double Lock;        // 0..1, for squeal, smoke and the HUD
        public double SteerScale;  // locked front tyres do not steer
        public double Rotate;      // rear rotation on offer, signed by the steering
        public double Fade;        // 0..1 of pad force currently lost to heat
        public bool Abs;           // true while the pedal is pulsing
        public double Temp;
    }

    public static BrakeState NewBrakeState()
    {
        return new BrakeState { Lock = 0.0, Temp = 0.0, Pulse = 0.0 };
    }

    /// <summary>
    /// The most retardation the tyres can take at this steering angle.
    ///
    /// Exported for the same reason it is exported in the other two
    /// builds: the drift solver needs to know how much of the grip budget
    /// braking is using, and a second copy of this expression is a second
    /// thing to keep in step.
    /// </summary>
    public static double BrakeCeiling(BrakeTune tune, double latDemand, double gripNow)
    {
        double grip = gripNow > 0.0 ? gripNow : tune.GripAccel;
        double flat = grip * GRNData.Exact.BrakeGripK +
                      tune.BrakeForce * GRNData.Exact.BrakePadK;
        // Friction circle: front tyres steering hard have less left to
        // stop with. Brakes and cornering spend from ONE budget, and
        // applying both undiminished bills the same tyre twice.
        return flat * Math.Sqrt(1.0 - GRNData.Exact.TrailBrakeK * latDemand * latDemand);
    }

    public static BrakeResult SolveBrakes(
        ref BrakeState s, BrakeTune tune, double dt,
        double brakeIn, double speed, double latDemand,
        double steer, double throttle, double gripNow)
    {
        double brake = Clamp(brakeIn, 0.0, 1.0);
        double ceiling = BrakeCeiling(tune, Clamp(latDemand, 0.0, 1.0), gripNow);

        // Fade. Heat is what the discs absorbed; it leaves with the air
        // over them, so a car that keeps moving cools and one crawling on
        // hot brakes does not.
        double fade = Min(1.0, Max(0.0,
            (s.Temp - GRNData.Exact.BrakeFadeStart) /
            (GRNData.Exact.BrakeFadeFull - GRNData.Exact.BrakeFadeStart))) *
            GRNData.Exact.BrakeFadeMax;
        double padForce = tune.BrakeForce * (1.0 - fade);

        // Engine braking goes into the DEMAND, not onto the answer: the
        // tyre does not care which end of the driveshaft a retarding
        // torque arrived from.
        double engineBrake = (1.0 - throttle) * GRNData.Exact.EngineBrakeK *
                             Min(1.0, speed / 12.0);

        double demand = brake * padForce + engineBrake;
        double overDrive = ceiling > 0.0 ? demand / ceiling : 0.0;

        double decel;
        bool abs = false;
        if (overDrive > GRNData.Exact.BrakeLockMargin)
        {
            if (tune.HasAbs)
            {
                abs = true;
                s.Pulse += dt * GRNData.Exact.AbsHz * Math.PI * 2.0;
                decel = ceiling * GRNData.Exact.AbsHold;
                s.Lock += (0.0 - s.Lock) * Min(1.0, dt * GRNData.Exact.BrakeLockRate);
            }
            else
            {
                s.Lock += (1.0 - s.Lock) * Min(1.0, dt * GRNData.Exact.BrakeLockRate);
                decel = ceiling;
            }
        }
        else
        {
            s.Lock += (0.0 - s.Lock) * Min(1.0, dt * GRNData.Exact.BrakeLockRate);
            decel = Min(demand, ceiling);
        }
        if (s.Lock < 1e-3) s.Lock = 0.0;

        // A sliding tyre has a lower coefficient than one at the edge of
        // rotating. This is the whole reason threshold braking exists, and
        // the whole reason a locked wheel takes LONGER to stop.
        decel *= 1.0 - s.Lock * (1.0 - GRNData.Exact.BrakeSlideFriction);

        double padShare = demand > 1e-4 ? (brake * padForce) / demand : 0.0;
        double capacity = Max(0.2, tune.BrakeThermalMult);
        s.Temp += ((decel * padShare * speed * GRNData.Exact.BrakeHeatK) / capacity) * dt;
        s.Temp -= s.Temp * (GRNData.Exact.BrakeCoolBase +
                            speed * GRNData.Exact.BrakeCoolK) * dt;
        if (s.Temp < 0.0) s.Temp = 0.0;

        // Rotation peaks in the MIDDLE of the pedal's travel, which is the
        // whole point of trail braking: weight rises with the pedal, spare
        // front grip falls with it, and their product peaks partway
        // through. Bury the pedal and all the weight in the world sits on
        // a front tyre with nothing left to turn with.
        double flat = tune.GripAccel * GRNData.Exact.BrakeGripK +
                      tune.BrakeForce * GRNData.Exact.BrakePadK;
        double weight = Min(1.0, decel / Max(flat, 1e-3));
        double spare = Max(0.0, 1.0 - Min(1.0, demand / Max(ceiling, 1e-3)));

        BrakeResult r;
        r.Decel = decel;
        r.Lock = s.Lock;
        r.Fade = fade;
        r.Abs = abs;
        r.SteerScale = 1.0 - s.Lock * (1.0 - GRNData.Exact.BrakeLockSteer);
        r.Rotate = Sign(steer) * Min(1.0, Math.Abs(steer)) * weight * spare *
                   (1.0 - s.Lock) *
                   Min(1.0, Max(0.0, speed - GRNData.Exact.BrakeRotateMinSpeed) / 18.0);
        r.Temp = s.Temp;
        return r;
    }
}
