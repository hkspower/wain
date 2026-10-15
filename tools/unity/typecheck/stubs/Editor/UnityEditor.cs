// Unity 6000.0 editor API that Unity3D.SDK's 2021.1 UnityEditor.dll
// doesn't have, grafted onto the real types (see ../Graft.cs). Signatures
// copied from Unity's C# reference source at the tag the project pins,
// github.com/Unity-Technologies/UnityCsReference@6000.0.32f1 (file and
// line on each). Add a member when the project uses it and the check
// reports it missing; the grafter refuses members 2021.1 already has.

namespace UnityEditor
{
    [GraftOnto("UnityEditor.TextureImporter")]
    class TextureImporter6000
    {
        // Editor/Mono/AssetPipeline/TextureImporter.bindings.cs: public
        // since 2021.2, the source image's size before any import scaling.
        public void GetSourceTextureWidthAndHeight(out int width, out int height) => throw null;
    }
}
