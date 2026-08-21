// GENERATED FILE — do not edit by hand.
// Produced by scripts/export-unity-data.mjs from the web build's
// src/game/{track,rivals,mods,handling}.ts. Regenerate with:
//
//     npm run sync:unity
//
// One web unit = one metre = one Unity unit, so the numbers below are
// used as-is. Verified against the live API by `npm run check:unity`.

using UnityEngine;

public enum BodyStyle { Sedan, ZX, GTR, RX7 }

public static class GRNData
{
    /// <summary>Payload shape this build understands; the API client
    /// refuses live data that does not match.</summary>
    public const int ApiVersion = 1;

    public const float RoadHalfWidth = 7f;
    public static readonly float[] Lanes = { -5.25f, -1.75f, 1.75f, 5.25f };

    public struct TrackPoint { public float X, Z; }
    public static readonly TrackPoint[] ControlPoints =
    {
        new TrackPoint { X = 800f, Z = 0f },
        new TrackPoint { X = 770f, Z = -350f },
        new TrackPoint { X = 820f, Z = -700f },
        new TrackPoint { X = 760f, Z = -1100f },
        new TrackPoint { X = 830f, Z = -1500f },
        new TrackPoint { X = 760f, Z = -1950f },
        new TrackPoint { X = 800f, Z = -2350f },
        new TrackPoint { X = 850f, Z = -2700f },
        new TrackPoint { X = 1050f, Z = -2950f },
        new TrackPoint { X = 1400f, Z = -2900f },
        new TrackPoint { X = 2115f, Z = -2583f },
        new TrackPoint { X = 2586f, Z = -1958f },
        new TrackPoint { X = 2696f, Z = -1184f },
        new TrackPoint { X = 2416f, Z = -453f },
        new TrackPoint { X = 1818f, Z = 50f },
        new TrackPoint { X = 1050f, Z = 200f },
    };

    public class Rival
    {
        public string Id, Name, ArabicName, Crew, Area;
        public Color Body, Accent;
        public float TopSpeedKmh;
        public BodyStyle Style;
        public int PrizeKd;
        public string IntroAr, WinAr, LoseAr;
    }

    public static readonly Rival[] Rivals =
    {
        new Rival {
            Id = "abu-shanab", Name = "Abu Shanab", ArabicName = "أبو شنب",
            Crew = "Salmiya Street Kings", Area = "Salmiya",
            Body = Hex(0xC8CDD6), Accent = Hex(0x16A34A),
            TopSpeedKmh = 232f, Style = BodyStyle.Sedan, PrizeKd = 400,
            IntroAr = "هلا والله! يلا ورني شنو عندك يا بطل",
            WinAr = "هاهاها! روح تعلم السواقة وبعدين تعال",
            LoseAr = "ما شاء الله عليك... خذت الليلة مني",
        },
        new Rival {
            Id = "bint-aldeera", Name = "Bint Al-Deera", ArabicName = "بنت الديرة",
            Crew = "Gulf Road Gazelles", Area = "Sharq",
            Body = Hex(0xB84DD6), Accent = Hex(0xFFFFFF),
            TopSpeedKmh = 246f, Style = BodyStyle.Sedan, PrizeKd = 700,
            IntroAr = "تبي تتحداني؟ يلا نشوف شطارتك",
            WinAr = "قلت لك، شارع الخليج لي أنا",
            LoseAr = "زين لعبت... بس هالمرة وبس",
        },
        new Rival {
            Id = "al-daboos", Name = "Al-Daboos", ArabicName = "الدبوس",
            Crew = "Hawally Night Hawks", Area = "Hawally",
            Body = Hex(0xF5C211), Accent = Hex(0x111111),
            TopSpeedKmh = 261f, Style = BodyStyle.ZX, PrizeKd = 1000,
            IntroAr = "أنا الدبوس! محد يعديني في حولي",
            WinAr = "ولا يهمك، تدرب زين وتعال مرة ثانية",
            LoseAr = "عيل صدق إنك سريع... احترمتك",
        },
        new Rival {
            Id = "bu-machboos", Name = "Bu Machboos", ArabicName = "بو مجبوس",
            Crew = "Fahaheel Phantoms", Area = "Fahaheel",
            Body = Hex(0xE8641B), Accent = Hex(0xFFFFFF),
            TopSpeedKmh = 277f, Style = BodyStyle.GTR, PrizeKd = 1300,
            IntroAr = "اللي يخسر يعزم على المجبوس... اتفقنا؟",
            WinAr = "يلا! المجبوس عليك الليلة، هاهاها",
            LoseAr = "خذ فوزك... بس مجبوسي أطيب، صدقني",
        },
        new Rival {
            Id = "al-saqer", Name = "Al-Saqer", ArabicName = "الصقر",
            Crew = "Jahra Junoon", Area = "Jahra",
            Body = Hex(0xC1121F), Accent = Hex(0x111111),
            TopSpeedKmh = 293f, Style = BodyStyle.ZX, PrizeKd = 1600,
            IntroAr = "الصقر يصيد في الليل... انتبه لنفسك",
            WinAr = "الصقر ما يطيح مرتين",
            LoseAr = "صدت الصقر... لك كل الاحترام",
        },
        new Rival {
            Id = "bu-torab", Name = "Bu Torab", ArabicName = "بو تراب",
            Crew = "Doha Dust Devils", Area = "Doha",
            Body = Hex(0x565F6B), Accent = Hex(0xD97706),
            TopSpeedKmh = 301f, Style = BodyStyle.ZX, PrizeKd = 1900,
            IntroAr = "الغبار اللي وراك؟ هذا أنا... بو تراب",
            WinAr = "قلت لك، التراب ما يخون أهله",
            LoseAr = "فحطت علي صج... خذها بشرف",
        },
        new Rival {
            Id = "al-sayyaf", Name = "Al-Sayyaf", ArabicName = "السياف",
            Crew = "Bayan Blade Runners", Area = "Bayan",
            Body = Hex(0x0F766E), Accent = Hex(0xE2E8F0),
            TopSpeedKmh = 307f, Style = BodyStyle.GTR, PrizeKd = 2200,
            IntroAr = "السيف قطع قبلك خمسة... إنت السادس",
            WinAr = "قطعة نظيفة... مثل ما وعدتك",
            LoseAr = "نصلك أحد من نصلي... السيف لك",
        },
        new Rival {
            Id = "shabah-alkhaleej", Name = "Shabah Al-Khaleej", ArabicName = "شبح الخليج",
            Crew = "???", Area = "Gulf Road",
            Body = Hex(0x0A0A0C), Accent = Hex(0x38E8FF),
            TopSpeedKmh = 318f, Style = BodyStyle.GTR, PrizeKd = 2500,
            IntroAr = "وصلت للنهاية... بس الشبح ما ينهزم",
            WinAr = "ارجع لما تكون جاهز",
            LoseAr = "الشارع لك... يا ملك الخليج",
        },
    };

    public enum EngineLayout { Inline, Flat, Vee }

    /// <summary>One of the five. The curve is a Gaussian bump on a floor,
    /// normalised so every engine's mean torque over the usable rev range
    /// is exactly 1.0 — see src/game/engines.ts for why.</summary>
    public class Engine
    {
        public string Id, Name;
        public int Cylinders;
        public EngineLayout Layout;
        public float Litres, IdleRpm, RedlineRpm;
        public float PeakAt, Breadth, Floor, PowerMult, MassKg;
        public float SubMix, LopeDepth;
        public int Price;
        /// <summary>Mean of the raw curve over the usable range, baked by
        /// the generator so nothing has to integrate it at runtime.</summary>
        public float Norm;
    }

    public static readonly Engine[] Engines =
    {
        new Engine {
            Id = "i4-16", Name = "Sadu 1.6 VTC", Cylinders = 4, Layout = EngineLayout.Inline,
            Litres = 1.6f, IdleRpm = 850f, RedlineRpm = 8400f,
            PeakAt = 0.88f, Breadth = 0.24f, Floor = 0.26f,
            PowerMult = 0.93f, MassKg = -42f,
            SubMix = 0.2f, LopeDepth = 0f, Price = 900,
            Norm = 0.609410f,
        },
        new Engine {
            Id = "i4-20t", Name = "Bahri 2.0T", Cylinders = 4, Layout = EngineLayout.Inline,
            Litres = 2f, IdleRpm = 800f, RedlineRpm = 6800f,
            PeakAt = 0.5f, Breadth = 0.3f, Floor = 0.5f,
            PowerMult = 1f, MassKg = 0f,
            SubMix = 0.3f, LopeDepth = 0f, Price = 2200,
            Norm = 0.862994f,
        },
        new Engine {
            Id = "f6-25", Name = "Nejma Flat-Six", Cylinders = 6, Layout = EngineLayout.Flat,
            Litres = 2.5f, IdleRpm = 900f, RedlineRpm = 7800f,
            PeakAt = 0.72f, Breadth = 0.34f, Floor = 0.44f,
            PowerMult = 1.05f, MassKg = 12f,
            SubMix = 0.34f, LopeDepth = 0f, Price = 3800,
            Norm = 0.850061f,
        },
        new Engine {
            Id = "i6-30tt", Name = "Sahil 3.0 TT", Cylinders = 6, Layout = EngineLayout.Inline,
            Litres = 3f, IdleRpm = 750f, RedlineRpm = 7000f,
            PeakAt = 0.58f, Breadth = 0.46f, Floor = 0.66f,
            PowerMult = 1.1f, MassKg = 48f,
            SubMix = 0.38f, LopeDepth = 0f, Price = 5200,
            Norm = 0.954355f,
        },
        new Engine {
            Id = "v8-57", Name = "Ghazi 5.7 V8", Cylinders = 8, Layout = EngineLayout.Vee,
            Litres = 5.7f, IdleRpm = 700f, RedlineRpm = 6200f,
            PeakAt = 0.24f, Breadth = 0.36f, Floor = 0.46f,
            PowerMult = 1.12f, MassKg = 115f,
            SubMix = 0.5f, LopeDepth = 0.24f, Price = 6500,
            Norm = 0.799539f,
        },
    };

    /// <summary>Lowest rev fraction the gearbox ever asks for.</summary>
    public const float MinRevFraction = 0.12f;

    /// <summary>Torque multiplier at a point in the rev range. Averages to
    /// exactly 1.0 for every engine: a swap redistributes power, never
    /// adds any.</summary>
    public static float EngineTorque(int engineIndex, float rev)
    {
        var e = Engines[engineIndex];
        float r = Mathf.Clamp01(rev);
        float d = r - e.PeakAt;
        float raw = e.Floor + (1f - e.Floor) * Mathf.Exp(-(d * d) / (2f * e.Breadth * e.Breadth));
        return raw / e.Norm;
    }

    /// <summary>The note: a four-stroke fires Cylinders/2 times per crank
    /// revolution.</summary>
    public static float EngineFiringHz(int engineIndex, float rev)
    {
        var e = Engines[engineIndex];
        float rpm = e.IdleRpm + (e.RedlineRpm - e.IdleRpm) * Mathf.Clamp01(rev);
        return (rpm / 60f) * (e.Cylinders * 0.5f);
    }

    public class Car
    {
        public string Id, Name;
        public int Price;
        public float Power, TopSpeedKmh, Grip, Brake;
        public Color Paint;
        public BodyStyle Style;
        /// <summary>Factory time-attack aero (wing, splitter, bronze wheels).</summary>
        public bool AttackKit;
        /// <summary>Index into Engines — what the car left the factory with.</summary>
        public int Engine;
        /// <summary>Tank, litres.</summary>
        public float TankLitres;
        /// <summary>Overall length, metres. The shell is scaled until it
        /// measures this — see createCar in src/game/cars.ts.</summary>
        public float LengthM;
        /// <summary>Legends that must be beaten before the showroom will
        /// sell it. 0 for everything money can buy.</summary>
        public int LockedRivals;
        /// <summary>Parts fitted at the factory. Empty for most.</summary>
        public string[] FactoryBuild;
    }

    public static readonly Car[] Cars =
    {
        new Car {
            Id = "zeta-300-gtr", Name = "Zeta 300 GTR", Price = 240000,
            Power = 1.7f, TopSpeedKmh = 405f, Grip = 18f, Brake = 46f,
            Paint = Hex(0x3B2A5A), Style = BodyStyle.ZX, AttackKit = true,
            Engine = 3, TankLitres = 70f, LengthM = 4.53f,
            LockedRivals = 8,
            FactoryBuild = new[] { "twin-turbo", "intake", "ecu", "exhaust-ti", "brakes-carbon", "tires-slick", "lsd", "coilovers", "cage", "rack", "weight", "nos" },
        },
        new Car {
            Id = "efreet-rx-kai", Name = "Efreet RX Kai", Price = 120000,
            Power = 1.66f, TopSpeedKmh = 400f, Grip = 17.5f, Brake = 44f,
            Paint = Hex(0xF2B90D), Style = BodyStyle.RX7, AttackKit = true,
            Engine = 3, TankLitres = 55f, LengthM = 4.42f,
            LockedRivals = 0,
            FactoryBuild = new[] {  },
        },
        new Car {
            Id = "sahara-v12", Name = "Sahara GT-12", Price = 96000,
            Power = 1.62f, TopSpeedKmh = 385f, Grip = 16.4f, Brake = 42f,
            Paint = Hex(0xB8860B), Style = BodyStyle.ZX, AttackKit = false,
            Engine = 4, TankLitres = 90f, LengthM = 4.62f,
            LockedRivals = 0,
            FactoryBuild = new[] {  },
        },
        new Car {
            Id = "falcon-720", Name = "Falcon 720 Veloce", Price = 71000,
            Power = 1.5f, TopSpeedKmh = 360f, Grip = 15.8f, Brake = 40f,
            Paint = Hex(0xC1121F), Style = BodyStyle.ZX, AttackKit = false,
            Engine = 4, TankLitres = 72f, LengthM = 4.54f,
            LockedRivals = 0,
            FactoryBuild = new[] {  },
        },
        new Car {
            Id = "storm-s8", Name = "Desert Storm S8", Price = 54000,
            Power = 1.4f, TopSpeedKmh = 335f, Grip = 15.2f, Brake = 38f,
            Paint = Hex(0x1F2933), Style = BodyStyle.Sedan, AttackKit = false,
            Engine = 3, TankLitres = 68f, LengthM = 4.8f,
            LockedRivals = 0,
            FactoryBuild = new[] {  },
        },
        new Car {
            Id = "kaiju-r", Name = "Kaiju R", Price = 38000,
            Power = 1.34f, TopSpeedKmh = 310f, Grip = 16.2f, Brake = 38f,
            Paint = Hex(0x3F66C4), Style = BodyStyle.GTR, AttackKit = false,
            Engine = 3, TankLitres = 74f, LengthM = 4.6f,
            LockedRivals = 0,
            FactoryBuild = new[] {  },
        },
        new Car {
            Id = "efreet-rx", Name = "Efreet RX", Price = 31000,
            Power = 1.3f, TopSpeedKmh = 295f, Grip = 14.8f, Brake = 35f,
            Paint = Hex(0xD7263D), Style = BodyStyle.RX7, AttackKit = false,
            Engine = 2, TankLitres = 60f, LengthM = 4.3f,
            LockedRivals = 0,
            FactoryBuild = new[] {  },
        },
        new Car {
            Id = "zeta-300", Name = "Zeta 300", Price = 27000,
            Power = 1.26f, TopSpeedKmh = 275f, Grip = 13.9f, Brake = 34f,
            Paint = Hex(0xC1272D), Style = BodyStyle.ZX, AttackKit = false,
            Engine = 3, TankLitres = 70f, LengthM = 4.31f,
            LockedRivals = 0,
            FactoryBuild = new[] {  },
        },
        new Car {
            Id = "gulf-coupe-rs", Name = "Gulf Coupe RS", Price = 33000,
            Power = 1.28f, TopSpeedKmh = 285f, Grip = 14.6f, Brake = 35f,
            Paint = Hex(0xCB2027), Style = BodyStyle.Hatch, AttackKit = false,
            Engine = 1, TankLitres = 50f, LengthM = 4.28f,
            LockedRivals = 0,
            FactoryBuild = new[] {  },
        },
        new Car {
            Id = "salmiya-turbo", Name = "Salmiya Turbo GT", Price = 24000,
            Power = 1.2f, TopSpeedKmh = 255f, Grip = 13.8f, Brake = 32f,
            Paint = Hex(0xB84DD6), Style = BodyStyle.Sedan, AttackKit = false,
            Engine = 1, TankLitres = 60f, LengthM = 4.64f,
            LockedRivals = 0,
            FactoryBuild = new[] {  },
        },
        new Car {
            Id = "hawally-2t", Name = "Hawally Sport 2.0T", Price = 16000,
            Power = 1.12f, TopSpeedKmh = 240f, Grip = 13.2f, Brake = 30f,
            Paint = Hex(0xF5C211), Style = BodyStyle.Sedan, AttackKit = false,
            Engine = 1, TankLitres = 55f, LengthM = 4.56f,
            LockedRivals = 0,
            FactoryBuild = new[] {  },
        },
        new Car {
            Id = "deera-sedan", Name = "Deera Sedan", Price = 8500,
            Power = 1.05f, TopSpeedKmh = 220f, Grip = 12.6f, Brake = 28f,
            Paint = Hex(0xDFE3E8), Style = BodyStyle.Sedan, AttackKit = false,
            Engine = 1, TankLitres = 60f, LengthM = 4.7f,
            LockedRivals = 0,
            FactoryBuild = new[] {  },
        },
        new Car {
            Id = "jahra-pickup", Name = "Jahra Pickup", Price = 6000,
            Power = 1f, TopSpeedKmh = 195f, Grip = 12f, Brake = 27f,
            Paint = Hex(0x6E7F8D), Style = BodyStyle.Sedan, AttackKit = false,
            Engine = 4, TankLitres = 80f, LengthM = 5.35f,
            LockedRivals = 0,
            FactoryBuild = new[] {  },
        },
        new Car {
            Id = "sharq-hatch", Name = "Sharq Hatch", Price = 2200,
            Power = 0.98f, TopSpeedKmh = 205f, Grip = 12.4f, Brake = 27f,
            Paint = Hex(0x16A34A), Style = BodyStyle.Hatch, AttackKit = false,
            Engine = 0, TankLitres = 42f, LengthM = 3.95f,
            LockedRivals = 0,
            FactoryBuild = new[] {  },
        },
        new Car {
            Id = "wain-special", Name = "Wain Special", Price = 0,
            Power = 1f, TopSpeedKmh = 180f, Grip = 12f, Brake = 26f,
            Paint = Hex(0xF2F4F7), Style = BodyStyle.Sedan, AttackKit = false,
            Engine = 0, TankLitres = 50f, LengthM = 4.45f,
            LockedRivals = 0,
            FactoryBuild = new[] {  },
        },
    };

    /// <summary>Burning and buying petrol. An engine is an air pump: it
    /// swallows half its displacement per crank revolution, and at
    /// stoichiometric the fuel follows from the air. No engine here
    /// carries a thirst figure — the V8 drinks more because it is a
    /// bigger pump.</summary>
    public static class Fuel
    {
        /// <summary>Game burn against real burn: a tank is a session.</summary>
        public const float RateMultiplier = 8f;
        /// <summary>Kuwait's 91-octane price. A thousand fils to the dinar.</summary>
        public const int FilsPerLitre = 85;
        public const float PumpLitresPerSecond = 8f;
        /// <summary>Above this the forecourt is something you drove past.</summary>
        public const float PumpMaxKmh = 12f;
        public const float AirGramsPerLitre = 1.2f;
        public const float AirFuelRatio = 14.7f;
        public const float PetrolGramsPerLitre = 745f;
    }

    /// <summary>How much of each swallow is actually air.</summary>
    public static float VolumetricEfficiency(float throttle, float rev)
    {
        float open = 0.22f + 0.73f * Mathf.Clamp01(throttle);
        return open * (1f - 0.12f * Mathf.Max(0f, rev - 0.75f));
    }

    /// <summary>Litres per second, before RateMultiplier.</summary>
    public static float FuelLitresPerSecond(int engineIndex, float throttle, float rev)
    {
        var e = Engines[engineIndex];
        float rpm = e.IdleRpm + (e.RedlineRpm - e.IdleRpm) * Mathf.Clamp01(rev);
        float airLitres = (e.Litres * 0.5f) * (rpm / 60f) * VolumetricEfficiency(throttle, rev);
        return (airLitres * Fuel.AirGramsPerLitre) / (Fuel.AirFuelRatio * Fuel.PetrolGramsPerLitre);
    }

    /// <summary>Petrol stations: metres from the line, and how far off the
    /// centreline the apron sits. Both on the Second Ring — widening the
    /// road opens the barrier on both sides, which on the corniche would
    /// mean a lane of asphalt over the beach.</summary>
    public struct Station { public float S, Lat; }

    public static readonly Station[] Stations =
    {
        new Station { S = 3900f, Lat = 19f },
        new Station { S = 6900f, Lat = 19f },
    };

    public const float ForecourtHalfSpan = 30f;
    public const float ForecourtExtraWidth = 10f;

    /// <summary>Mirrors src/game/handling.ts. The contract test proves the
    /// values here match what the browser is actually racing.</summary>
    public static class Handling
    {
        public const float Ceiling = 115f;
        public const float ThrustK = 19f;
        public const float DragA = 0.0012f;
        public const float DragB = 1.2f;
        public const float SteerSmoothRate = 7f;
        public const float CasterRate = 2.4f;
        public const float HeadingClamp = 0.45f;
        public const float FlashRangeM = 60f;
        public const float DriftMinSpeed = 14f;
        public const float DriftAngleBase = 0.38f;
        public const float DriftAngleSpeedK = 0.28f;
        public const float DriftEngageRate = 3.4f;
        public const float DriftRecoverRate = 2.3f;
        public const float DriftYawClamp = 0.75f;
        public const float DriftLatScrub = 0.5f;
        public const float DriftDriveLoss = 1.1f;
        public const float DriftEstablished = 0.12f;
        public const float DriftRecoverCounterK = 3.2f;
        public const float DriftOverRotate = 0.42f;
        public const float DriftCounterRate = 2.6f;
        public const float DriftCriticalAngle = 0.72f;
        public const float DriftRunawayRate = 1.6f;
        public const float DriftSpinAngle = 1.05f;
        public const float DriftSpinTripRate = 0.05f;
        public const float DriftSpinEntryRate = 2.6f;
        public const float DriftSpinEntrySpeedK = 5f;
        public const float DriftSpinEntryRef = 78f;
        public const float DriftSpinFriction = 1.5f;
        public const float DriftSpinSlowK = 2.2f;
        public const float DriftSpinDamp = 0.16f;
        public const float DriftSpinEndRate = 0.5f;
        public const float DriftSpinDragBase = 0.18f;
        public const float DriftSpinDragK = 1.35f;
        public const float DriftSpinMaxTime = 6f;
        public const float DriftScrubBase = 0.05f;
        public const float DriftScrubK = 0.24f;
        public const float DriftBrakeEntry = 0.12f;
        public const float DriftBrakeAngleK = 0.45f;
        public const float DriftFeintRate = 4.2f;
        public const float DriftFeintLoad = 0.3f;
        public const float DriftFeintMinSpeed = 20f;
        public const float DriftFeintWindow = 0.45f;
        public const float DriftFeintAngleK = 0.55f;
        public const float DriftScoreK = 3.2f;
        public const float DriftScoreMinDeg = 8f;
        public const float DriftScoreMinSpeed = 12f;
        public const float DriftLinkWindow = 0.9f;
        public const float DriftChainMax = 5f;
        public const float BrakeLockMargin = 1f;
        public const float BrakeSlideFriction = 0.72f;
        public const float BrakeLockSteer = 0.25f;
        public const float BrakeLockRate = 12f;
        public const float AbsHold = 0.97f;
        public const float AbsHz = 14f;
        public const float BrakeHeatK = 0.105f;
        public const float BrakeCoolBase = 0.008f;
        public const float BrakeCoolK = 0.0016f;
        public const float BrakeFadeStart = 320f;
        public const float BrakeFadeFull = 620f;
        public const float BrakeFadeMax = 0.45f;
        public const float BrakeRotateK = 0.85f;
        public const float BrakeRotateMinSpeed = 12f;
        public const float EngineBrakeK = 2.4f;
        public const float CgHeightM = 0.52f;
        public const float WheelbaseM = 2.62f;
        public const float StaticFrontLoad = 0.53f;
        public const float LoadLagRate = 6.5f;
        public const float LoadClamp = 0.82f;
        public const float TyreLoadExp = 0.85f;
        public const float SteerLoadExp = 0.6f;
        public const float SteerScaleMin = 0.8f;
        public const float SteerScaleMax = 1.22f;
        public const float DriveScaleMin = 0.7f;
        public const float DriveScaleMax = 1.12f;
        public const float DownforceRefSpeed = 70f;
        public const float DownforceMax = 6f;
        public const float DriftLiftEntry = 0.18f;
        public const float DriftLiftAngleK = 0.3f;
        public const float TractionBase = 0.8f;
        public const float TractionRampSpeed = 22f;
        public const float BrakeGripK = 1.05f;
        public const float BrakePadK = 0.25f;
        public const float TrailBrakeK = 0.6f;
        public const float LatDemandSpeed = 40f;
        public const float UndersteerK = 0.35f;
        public const float CornerScrubK = 0.3f;
        public const float CornerScrubSpeed = 40f;
        public const float PowerOverSpin = 1.2f;
        public const float PowerOverSteer = 0.5f;
        public const float PowerOverMinSpeed = 18f;
        public const float PowerOverThrottle = 0.85f;
        public const float PowerOverAngleK = 0.6f;
        public const float CrashLatFull = 12f;
        public const float CrashSpeedLossK = 0.28f;
        public const float CrashReboundK = 5f;
        public const float TrafficClosingFull = 22f;
    }

    static Color Hex(int rgb) =>
        new Color(((rgb >> 16) & 255) / 255f, ((rgb >> 8) & 255) / 255f, (rgb & 255) / 255f);
}
