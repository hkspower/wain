using UnityEngine;

// The bosses of the Gulf Road, in battle order.
//
// This used to be a hand-typed copy of src/game/rivals.ts, and it had
// silently fallen two rivals behind the game — which is exactly what a
// duplicated table does over time. It is now a thin view over the
// generated GRNData (npm run sync:unity), preferring the live API tables
// when GRNApi has them.
//
// The shape below is kept as-is so GameController and ElevenLabsVoice
// need no changes: RivalDef.All still returns an array you can index.
public class RivalDef
{
    public string Id, Name, ArabicName, Crew, Area;
    public Color Body, Accent;
    public float TopSpeedKmh;
    public BodyStyle Style;
    public int PrizeKd;
    public string IntroAr, WinAr, LoseAr; // spoken via ElevenLabs
    public float VoiceStability = 0.5f;   // per-character delivery

    /// <summary>
    /// Live roster when the API answered, generated tables otherwise.
    /// Rebuilt on each access only when the source changes, so a race
    /// that starts offline and a race that starts online both see a
    /// stable array for their whole duration.
    /// </summary>
    public static RivalDef[] All
    {
        get
        {
            var source = GRNApi.Instance != null ? GRNApi.Instance.Rivals : GRNData.Rivals;
            if (cache != null && cachedSource == source) return cache;

            var built = new RivalDef[source.Count];
            for (int i = 0; i < source.Count; i++)
            {
                var r = source[i];
                built[i] = new RivalDef
                {
                    Id = r.Id, Name = r.Name, ArabicName = r.ArabicName,
                    Crew = r.Crew, Area = r.Area,
                    Body = r.Body, Accent = r.Accent,
                    TopSpeedKmh = r.TopSpeedKmh,
                    Style = r.Style,
                    PrizeKd = r.PrizeKd,
                    IntroAr = r.IntroAr, WinAr = r.WinAr, LoseAr = r.LoseAr,
                    // The final boss speaks flatter and colder than the rest
                    VoiceStability = i == source.Count - 1 ? 0.9f : 0.5f,
                };
            }
            cachedSource = source;
            cache = built;
            return cache;
        }
    }

    static RivalDef[] cache;
    static System.Collections.Generic.IReadOnlyList<GRNData.Rival> cachedSource;
}
