using System.Collections;
using System.IO;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

// ElevenLabs voices for the rivals — Arabic dialect lines through the
// multilingual TTS model, cached to disk so each line is billed once.
//
// Configure with unity/Assets/StreamingAssets/elevenlabs.json:
//   { "apiKey": "sk_...", "voiceId": "pNInz6obpgDQGcFmaJgB" }
// Without a key the game stays silent on voice lines (everything else works).
//
// Also exposes GenerateSfx() against the ElevenLabs sound-generation
// endpoint for one-off effect design (e.g. crowd, sirens) — cached the
// same way.
public class ElevenLabsVoice : MonoBehaviour
{
    [System.Serializable]
    class Config { public string apiKey = ""; public string voiceId = "pNInz6obpgDQGcFmaJgB"; }

    Config config = new Config();
    AudioSource source;
    bool warned;

    void Awake()
    {
        source = gameObject.AddComponent<AudioSource>();
        source.spatialBlend = 0f;
        var path = Path.Combine(Application.streamingAssetsPath, "elevenlabs.json");
        try
        {
            if (File.Exists(path)) config = JsonUtility.FromJson<Config>(File.ReadAllText(path));
        }
        catch { /* run silent */ }
        var env = System.Environment.GetEnvironmentVariable("ELEVENLABS_API_KEY");
        if (!string.IsNullOrEmpty(env)) config.apiKey = env;
    }

    /// Speak an Arabic line; clipId keys the on-disk cache.
    public void Speak(string text, string clipId, float stability = 0.5f)
    {
        if (string.IsNullOrEmpty(config.apiKey))
        {
            if (!warned) { Debug.Log("[ElevenLabs] no API key — voice lines disabled"); warned = true; }
            return;
        }
        StartCoroutine(SpeakCo(text, clipId, stability));
    }

    /// Generate a sound effect from a text prompt (ElevenLabs sound-generation).
    public void GenerateSfx(string prompt, string clipId, float durationSeconds = 2f)
    {
        if (string.IsNullOrEmpty(config.apiKey)) return;
        string body = "{\"text\":" + Quote(prompt) +
            ",\"duration_seconds\":" + durationSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture) + "}";
        StartCoroutine(FetchAndPlay("https://api.elevenlabs.io/v1/sound-generation", body, clipId));
    }

    IEnumerator SpeakCo(string text, string clipId, float stability)
    {
        string url = "https://api.elevenlabs.io/v1/text-to-speech/" + config.voiceId;
        string body = "{\"text\":" + Quote(text) +
            ",\"model_id\":\"eleven_multilingual_v2\"" +
            ",\"voice_settings\":{\"stability\":" + stability.ToString(System.Globalization.CultureInfo.InvariantCulture) +
            ",\"similarity_boost\":0.75}}";
        yield return FetchAndPlay(url, body, clipId);
    }

    IEnumerator FetchAndPlay(string url, string jsonBody, string clipId)
    {
        string cached = Path.Combine(Application.persistentDataPath, "elevenlabs-" + clipId + ".mp3");
        if (!File.Exists(cached))
        {
            using (var req = new UnityWebRequest(url, "POST"))
            {
                req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(jsonBody));
                req.downloadHandler = new DownloadHandlerBuffer();
                req.SetRequestHeader("Content-Type", "application/json");
                req.SetRequestHeader("xi-api-key", config.apiKey);
                req.SetRequestHeader("Accept", "audio/mpeg");
                yield return req.SendWebRequest();
                if (req.result != UnityWebRequest.Result.Success)
                {
                    Debug.LogWarning("[ElevenLabs] " + req.responseCode + " " + req.error);
                    yield break;
                }
                File.WriteAllBytes(cached, req.downloadHandler.data);
            }
        }
        using (var load = UnityWebRequestMultimedia.GetAudioClip("file://" + cached, AudioType.MPEG))
        {
            yield return load.SendWebRequest();
            if (load.result != UnityWebRequest.Result.Success) yield break;
            var clip = DownloadHandlerAudioClip.GetContent(load);
            if (clip != null) source.PlayOneShot(clip, 0.9f);
        }
    }

    static string Quote(string s)
    {
        var sb = new StringBuilder("\"");
        foreach (char c in s)
        {
            if (c == '"' || c == '\\') sb.Append('\\').Append(c);
            else if (c == '\n') sb.Append("\\n");
            else sb.Append(c);
        }
        return sb.Append('"').ToString();
    }
}
