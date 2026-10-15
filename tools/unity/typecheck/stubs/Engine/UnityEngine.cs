// Unity 6000.0 engine API that the UnityEngine 2021.3.33 reference
// assemblies don't have, grafted onto the real types (see ../Graft.cs),
// and, marked [Existing], Unity 6's changes to members 2021.3 does have
// (a deprecation, a narrower type). Signatures copied from Unity's C#
// reference source at the tag the project pins,
// github.com/Unity-Technologies/UnityCsReference@6000.0.32f1 (file and
// line on each). Add a member when the project uses it and the check
// reports it missing; the grafter refuses members 2021.3 already has.
using System;
using UnityEngine.Rendering;

namespace UnityEngine
{
    [GraftOnto("UnityEngine.Object")]
    static class Object6000
    {
        // Runtime/Export/Scripting/UnityEngineObject.bindings.cs:435-596.
        // 2021.3 has these without the attribute; Unity 6 warns.
        const string FindObjectOfTypeObsolete =
            "Object.FindObjectOfType has been deprecated. Use Object.FindFirstObjectByType instead or if finding any instance is acceptable the faster Object.FindAnyObjectByType";
        const string FindObjectsOfTypeObsolete =
            "Object.FindObjectsOfType has been deprecated. Use Object.FindObjectsByType instead which lets you decide whether you need the results sorted or not.  FindObjectsOfType sorts the results by InstanceID but if you do not need this using FindObjectSortMode.None is considerably faster.";

        [Existing, Obsolete(FindObjectOfTypeObsolete, false)]
        public static T FindObjectOfType<T>() where T : Object => throw null;
        [Existing, Obsolete(FindObjectOfTypeObsolete, false)]
        public static T FindObjectOfType<T>(bool includeInactive) where T : Object => throw null;
        [Existing, Obsolete(FindObjectOfTypeObsolete, false)]
        public static Object FindObjectOfType(Type type) => throw null;
        [Existing, Obsolete(FindObjectOfTypeObsolete, false)]
        public static Object FindObjectOfType(Type type, bool includeInactive) => throw null;
        [Existing, Obsolete(FindObjectsOfTypeObsolete, false)]
        public static T[] FindObjectsOfType<T>() where T : Object => throw null;
        [Existing, Obsolete(FindObjectsOfTypeObsolete, false)]
        public static T[] FindObjectsOfType<T>(bool includeInactive) where T : Object => throw null;
        [Existing, Obsolete(FindObjectsOfTypeObsolete, false)]
        public static Object[] FindObjectsOfType(Type type) => throw null;
        [Existing, Obsolete(FindObjectsOfTypeObsolete, false)]
        public static Object[] FindObjectsOfType(Type type, bool includeInactive) => throw null;
    }

    [GraftOnto("UnityEngine.Resolution")]
    struct Resolution6000
    {
        // Runtime/Export/Graphics/Graphics.cs:27-31.
        public RefreshRate refreshRateRatio { get => throw null; set => throw null; }

        [Existing]
        [System.ComponentModel.EditorBrowsable(System.ComponentModel.EditorBrowsableState.Never)]
        [Obsolete("Resolution.refreshRate is obsolete. Use refreshRateRatio instead.", false)]
        public int refreshRate { get => throw null; set => throw null; }
    }

    [GraftOnto("UnityEngine.RenderSettings")]
    static class RenderSettings6000
    {
        // Runtime/Export/Graphics/GraphicsManagers.bindings.cs:60-73. In
        // 2021.3 customReflection is a Texture; Unity 6 narrows it to
        // Cubemap and deprecates it for customReflectionTexture.
        public static Texture customReflectionTexture { get => throw null; set => throw null; }

        [Existing]
        [Obsolete(@"RenderSettings.customReflection has been deprecated in favor of RenderSettings.customReflectionTexture.", false)]
        public static Cubemap customReflection { get => throw null; set => throw null; }
    }
}

namespace UnityEngine.Rendering
{
    [GraftOnto("UnityEngine.Rendering.RenderPipeline")]
    static class RenderPipeline6000
    {
        // Runtime/Export/RenderPipeline/RenderPipeline.cs:67-101.
        public static bool SupportsRenderRequest<RequestData>(Camera camera, RequestData data) => throw null;
        public static void SubmitRenderRequest<RequestData>(Camera camera, RequestData data) => throw null;

        public class StandardRequest
        {
            public RenderTexture destination = null;
            public int mipLevel = 0;
            public CubemapFace face = CubemapFace.Unknown;
            public int slice = 0;
        }
    }
}
