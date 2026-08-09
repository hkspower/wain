using UnityEngine;

// Procedural engine/wind audio via OnAudioFilterRead — no clips needed.
// One-shot effects (bumps, scrapes, stings) are short synthesized bursts.
public class EngineAudio : MonoBehaviour
{
    float rpm = 0.12f, throttle, kmh;
    float phase, sampleRate = 48000f;
    bool muted;
    System.Random rng = new System.Random();
    float burstLevel, burstDecay, burstTone, burstPhase;

    void Awake()
    {
        sampleRate = AudioSettings.outputSampleRate;
        var src = gameObject.AddComponent<AudioSource>();
        src.loop = true;
        src.Play(); // silent source keeps the filter graph pulled
    }

    public void Set(float rpmFrac, float throttleIn, float speedKmh)
    {
        rpm = rpmFrac; throttle = throttleIn; kmh = speedKmh;
    }

    public void ToggleMute() => muted = !muted;
    public void Bump() => Burst(0.5f, 6f, 70f);
    public void Scrape() => Burst(0.25f, 9f, 2600f);
    public void BattleSting() => Burst(0.3f, 3f, 440f);

    void Burst(float level, float decay, float tone)
    {
        burstLevel = level; burstDecay = decay; burstTone = tone;
    }

    void OnAudioFilterRead(float[] data, int channels)
    {
        if (muted)
        {
            System.Array.Clear(data, 0, data.Length);
            return;
        }
        float freq = 42f + rpm * 96f;
        float engGain = 0.05f + throttle * 0.1f;
        float windGain = Mathf.Pow(Mathf.Min(kmh / 330f, 1f), 2f) * 0.15f;
        float dt = 1f / sampleRate;

        for (int i = 0; i < data.Length; i += channels)
        {
            phase += freq * dt;
            float saw = 2f * (phase - Mathf.Floor(phase)) - 1f;
            float sub = Mathf.Sign(Mathf.Sin(phase * Mathf.PI)); // square an octave down
            float noise = (float)(rng.NextDouble() * 2 - 1);
            float sample = saw * 0.5f * engGain + sub * 0.25f * engGain + noise * windGain * 0.5f;

            if (burstLevel > 0.001f)
            {
                burstPhase += burstTone * dt;
                float burst = burstTone < 200f
                    ? Mathf.Sin(burstPhase * 2f * Mathf.PI)       // low thump
                    : noise;                                       // hiss/sting
                sample += burst * burstLevel;
                burstLevel -= burstLevel * burstDecay * dt;
            }

            sample = Mathf.Clamp(sample, -0.9f, 0.9f);
            for (int c = 0; c < channels; c++) data[i + c] = sample;
        }
    }
}
