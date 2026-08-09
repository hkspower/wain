using UnityEngine;

// Gulf Road Nights — Unity port. Zero scene setup required: this spawns
// the whole game into whatever scene is open when you press Play.
public static class Bootstrap
{
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
    static void Init()
    {
        if (Object.FindObjectOfType<GameController>() != null) return;
        var go = new GameObject("GulfRoadNights");
        go.AddComponent<GameController>();
    }
}
