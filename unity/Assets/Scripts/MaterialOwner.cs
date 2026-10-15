using System.Collections.Generic;
using NightRacer.Cars;
using UnityEngine;

/// <summary>
/// Owns the Material instances a runtime-built object made for itself and
/// destroys them with it.
///
/// A `new Material` is a native object that outlives the renderer it was
/// assigned to: destroying the car's GameObject frees the meshes' renderers
/// and leaves every material behind until a scene unload. The procedural
/// cars mint a set per car (paint, glass, lamps, wheels, the contact
/// shadow), and the rival is respawned on every battle, so a session leaked
/// a car's worth of materials per rival. The game's own models do this in
/// CarRig.OnDestroy; this is the same for the stand-ins.
///
/// Its own file, named after the class: Unity serializes a MonoBehaviour
/// only through a script asset whose file name matches the class
/// (scripts/check-unity-monobehaviours.mjs holds the line).
/// </summary>
[DisallowMultipleComponent]
public sealed class MaterialOwner : MonoBehaviour
{
    readonly List<Material> owned = new List<Material>();

    /// <summary>Take ownership of <paramref name="m"/> (null and repeats are
    /// ignored) and hand it back, so a call can wrap the factory.</summary>
    public Material Own(Material m)
    {
        if (m != null && !owned.Contains(m)) owned.Add(m);
        return m;
    }

    /// <summary>The owner on <paramref name="go"/>, added on first use.</summary>
    public static MaterialOwner On(GameObject go)
    {
        var o = go.GetComponent<MaterialOwner>();
        return o != null ? o : go.AddComponent<MaterialOwner>();
    }

    void OnDestroy()
    {
        // Kill, not Destroy: the studio builds and tears cars down in edit
        // mode, where Destroy is refused.
        foreach (var m in owned) CarModel.Kill(m);
        owned.Clear();
    }
}
