using UnityEngine;

// Gulf Road Nights — Unity port. Zero scene setup required: this spawns
// the whole game into whatever scene is open when you press Play.
public static class Bootstrap
{
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
    static void Init()
    {
        if (Object.FindObjectOfType<GameController>() != null) return;

        // The data client goes up first so its fetch is already in flight
        // by the time the controller spawns the world. It never blocks:
        // the generated tables are live from frame one and the API only
        // replaces them if it answers, so the game starts instantly
        // offline and the roster upgrades in place if the server responds.
        var api = new GameObject("GRNApi");
        api.AddComponent<GRNApi>();

        var go = new GameObject("GulfRoadNights");
        go.AddComponent<GameController>();
    }
}
