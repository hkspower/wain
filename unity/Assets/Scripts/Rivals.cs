using UnityEngine;

// The six bosses of the Gulf Road, in battle order — same roster, speeds
// and Kuwaiti dialect lines as the web build (src/game/rivals.ts).
public class RivalDef
{
    public string Id, Name, ArabicName, Crew;
    public Color Body, Accent;
    public float TopSpeedKmh;
    public string IntroAr, WinAr, LoseAr; // spoken via ElevenLabs
    public float VoiceStability = 0.5f;   // per-character delivery

    public static readonly RivalDef[] All =
    {
        new RivalDef {
            Id = "abu-shanab", Name = "Abu Shanab", ArabicName = "أبو شنب",
            Crew = "Salmiya Street Kings",
            Body = Hex(0xC8CDD6), Accent = Hex(0x16A34A), TopSpeedKmh = 232,
            IntroAr = "هلا والله! يلا ورني شنو عندك يا بطل",
            WinAr = "هاهاها! روح تعلم السواقة وبعدين تعال",
            LoseAr = "ما شاء الله عليك... خذت الليلة مني",
        },
        new RivalDef {
            Id = "bint-aldeera", Name = "Bint Al-Deera", ArabicName = "بنت الديرة",
            Crew = "Gulf Road Gazelles",
            Body = Hex(0xB84DD6), Accent = Color.white, TopSpeedKmh = 246,
            IntroAr = "تبي تتحداني؟ يلا نشوف شطارتك",
            WinAr = "قلت لك، شارع الخليج لي أنا",
            LoseAr = "زين لعبت... بس هالمرة وبس",
        },
        new RivalDef {
            Id = "al-daboos", Name = "Al-Daboos", ArabicName = "الدبوس",
            Crew = "Hawally Night Hawks",
            Body = Hex(0xF5C211), Accent = Hex(0x111111), TopSpeedKmh = 261,
            IntroAr = "أنا الدبوس! محد يعديني في حولي",
            WinAr = "ولا يهمك، تدرب زين وتعال مرة ثانية",
            LoseAr = "عيل صدق إنك سريع... احترمتك",
        },
        new RivalDef {
            Id = "bu-machboos", Name = "Bu Machboos", ArabicName = "بو مجبوس",
            Crew = "Fahaheel Phantoms",
            Body = Hex(0xE8641B), Accent = Color.white, TopSpeedKmh = 277,
            IntroAr = "اللي يخسر يعزم على المجبوس... اتفقنا؟",
            WinAr = "يلا! المجبوس عليك الليلة، هاهاها",
            LoseAr = "خذ فوزك... بس مجبوسي أطيب، صدقني",
        },
        new RivalDef {
            Id = "al-saqer", Name = "Al-Saqer", ArabicName = "الصقر",
            Crew = "Jahra Junoon",
            Body = Hex(0xC1121F), Accent = Hex(0x111111), TopSpeedKmh = 293,
            IntroAr = "الصقر يصيد في الليل... انتبه لنفسك",
            WinAr = "الصقر ما يطيح مرتين",
            LoseAr = "صدت الصقر... لك كل الاحترام",
        },
        new RivalDef {
            Id = "shabah-alkhaleej", Name = "Shabah Al-Khaleej", ArabicName = "شبح الخليج",
            Crew = "???",
            Body = Hex(0x0A0A0C), Accent = Hex(0x38E8FF), TopSpeedKmh = 318,
            IntroAr = "وصلت للنهاية... بس الشبح ما ينهزم",
            WinAr = "ارجع لما تكون جاهز",
            LoseAr = "الشارع لك... يا ملك الخليج",
            VoiceStability = 0.9f,
        },
    };

    static Color Hex(int rgb) =>
        new Color(((rgb >> 16) & 255) / 255f, ((rgb >> 8) & 255) / 255f, (rgb & 255) / 255f);
}
