using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NightRacer.Cars;
using UnityEditor;
using UnityEngine;

namespace NightRacer.CarsEditor
{
    /// <summary>
    /// Every car its own Unity asset.
    ///
    /// Reads each game car from the GLB the web build exports and writes it
    /// into the project as assets:
    ///
    ///   Assets/Resources/Cars/&lt;id&gt;/
    ///     &lt;id&gt;.prefab               the whole car (CarRig on the root), with the
    ///                               parts below nested as prefab instances
    ///     Parts/Hood.prefab         the bonnet panel
    ///     Parts/RearWindow.prefab   the back glass
    ///     Parts/RearWing.prefab     the wing (the seven cars that have one)
    ///     Parts/Tyre-F.prefab       the front tyre (the right one is it mirrored)
    ///     Parts/Tyre-R.prefab       the rear tyre
    ///     Meshes/*.asset            every mesh, by part
    ///     Materials/*.mat           every material (URP Complex Lit paint with its
    ///                               clear coat, glass, lamps at their strengths…)
    ///     Textures/*.png            plates, decals, tyre and seat maps
    ///
    /// Edit Parts/Tyre-F.prefab and every front wheel of that car follows; the
    /// game (CarLibrary) loads the prefab from Resources before it would ever
    /// read a GLB, so a baked car starts instantly and ships in a build with
    /// its shader variants (they are referenced by real material assets).
    ///
    /// Menu:  Night Racer ▸ Bake Cars to Assets
    /// Batch: Unity -batchmode -projectPath unity -executeMethod
    ///        NightRacer.CarsEditor.CarAssetBaker.BakeBatch [-only a,b] -quit
    ///        (tools/unity/bake-cars.sh does this)
    ///
    /// The baked folder is generated (hundreds of MB of mesh data under Force
    /// Text serialization) and git-ignored; bake again after re-exporting.
    /// </summary>
    public static class CarAssetBaker
    {
        public const string Root = "Assets/Resources/Cars";
        const string Shared = Root + "/_Shared";

        static void Log(string s) => Debug.Log("[bake] " + s);

        [MenuItem("Night Racer/Bake Cars to Assets")]
        public static void BakeMenu()
        {
            var ids = AllIds();
            int ok = 0;
            try
            {
                for (int i = 0; i < ids.Count; i++)
                {
                    if (EditorUtility.DisplayCancelableProgressBar("Baking cars", ids[i], (float)i / ids.Count)) break;
                    if (Bake(ids[i])) ok++;
                }
            }
            finally { EditorUtility.ClearProgressBar(); }
            EditorUtility.DisplayDialog("Night Racer", $"Baked {ok} of {ids.Count} cars into {Root}.", "OK");
        }

        /// <summary>-executeMethod entry: bakes all, or -only a,b; exits 0
        /// when every requested car baked.</summary>
        public static void BakeBatch()
        {
            var args = Environment.GetCommandLineArgs();
            List<string> ids = AllIds();
            int at = Array.IndexOf(args, "-only");
            if (at >= 0 && at + 1 < args.Length)
                ids = args[at + 1].Split(',').Select(s => s.Trim()).Where(s => s.Length > 0).ToList();
            int failed = 0;
            foreach (var id in ids)
            {
                try { if (!Bake(id)) failed++; }
                catch (Exception e) { failed++; Debug.LogError($"[bake] {id}: {e}"); }
            }
            Log($"{ids.Count - failed} of {ids.Count} cars baked into {Root}");
            EditorApplication.Exit(failed == 0 ? 0 : 1);
        }

        /// <summary>The catalogue's cars that have a GLB to bake from.</summary>
        public static List<string> AllIds()
        {
            var ids = new List<string>();
            foreach (var c in GRNData.Cars)
                if (CarLibrary.PathFor(c.Id) != null) ids.Add(c.Id);
            return ids;
        }

        /// <summary>Bake one car. False when it has no GLB or failed.</summary>
        public static bool Bake(string id)
        {
            var t0 = DateTime.UtcNow;
            CarAsset asset;
            try { asset = CarLibrary.ReadGlb(id); }
            catch (Exception e) { Debug.LogError($"[bake] {id}: {e.Message}"); return false; }
            if (asset == null)
            {
                Debug.LogWarning($"[bake] {id}: no GLB (npm run cars:export)");
                return false;
            }

            string dir = Root + "/" + id;
            // A fresh folder: a part that no longer exists (a car that lost
            // its wing) must not survive from the last bake.
            if (AssetDatabase.IsValidFolder(dir)) AssetDatabase.DeleteAsset(dir);
            Folder(dir);
            Folder(dir + "/Textures");
            Folder(dir + "/Materials");
            Folder(dir + "/Meshes");
            Folder(dir + "/Parts");

            var textures = BakeTextures(asset, dir, out var metalGloss);
            var materials = new Material[asset.Materials.Length];
            for (int i = 0; i < materials.Length; i++)
            {
                var m = CarMaterials.Build(asset.Materials[i], textures, 1f, metalGloss);
                AssetDatabase.CreateAsset(m, $"{dir}/Materials/{i:00}-{Safe(asset.Materials[i].Name, "driver")}.mat");
                materials[i] = m;
            }

            var holder = new GameObject("CarAssetBaker");
            try
            {
                var model = CarModel.Build(asset, holder.transform, 1f, materials, textures, keepReadable: true);
                foreach (var kv in model.Meshes)
                    AssetDatabase.CreateAsset(kv.Value, $"{dir}/Meshes/{Safe(kv.Key, "mesh")}.asset");

                var root = model.Template;
                var rig = root.GetComponent<CarRig>();
                var shadow = root.transform.Find("ContactShadow");
                if (shadow != null) shadow.GetComponent<MeshRenderer>().sharedMaterial = SharedBlob();

                // The parts, each a prefab of its own, nested back in place.
                rig.Hood = Nest(rig.Hood, $"{dir}/Parts/Hood.prefab");
                rig.RearWindow = Nest(rig.RearWindow, $"{dir}/Parts/RearWindow.prefab");
                rig.RearWing = Nest(rig.RearWing, $"{dir}/Parts/RearWing.prefab");
                var tyrePrefabs = new Dictionary<bool, GameObject>();
                for (int i = 0; i < rig.Tyres.Length; i++)
                {
                    bool front = i < rig.WheelFront.Length && rig.WheelFront[i];
                    var tyre = rig.Tyres[i];
                    bool mirrored = tyre.transform.localScale.x < 0f;
                    if (!tyrePrefabs.TryGetValue(front, out var prefab) && !mirrored)
                    {
                        prefab = PrefabUtility.SaveAsPrefabAsset(tyre, $"{dir}/Parts/Tyre-{(front ? "F" : "R")}.prefab");
                        tyrePrefabs[front] = prefab;
                    }
                    if (prefab != null) rig.Tyres[i] = Swap(tyre, prefab);
                }
                // The mirrored tyres were visited before their axle's left
                // tyre only on a car that lists right before left — never, the
                // reader sorts left first — but if so, catch them now.
                for (int i = 0; i < rig.Tyres.Length; i++)
                {
                    bool front = i < rig.WheelFront.Length && rig.WheelFront[i];
                    if (PrefabUtility.IsPartOfPrefabInstance(rig.Tyres[i])) continue;
                    if (tyrePrefabs.TryGetValue(front, out var prefab)) rig.Tyres[i] = Swap(rig.Tyres[i], prefab);
                }

                // Anything still not an asset (a primitive with no material
                // falls back to a runtime default) gets saved too, so the
                // prefab never references a scene-only object.
                int extra = 0;
                foreach (var r in root.GetComponentsInChildren<Renderer>(true))
                {
                    var mats = r.sharedMaterials;
                    bool changed = false;
                    for (int k = 0; k < mats.Length; k++)
                        if (mats[k] != null && !AssetDatabase.Contains(mats[k]))
                        {
                            AssetDatabase.CreateAsset(mats[k], $"{dir}/Materials/extra-{extra++}.mat");
                            changed = true;
                        }
                    if (changed) r.sharedMaterials = mats;
                }

                // Slots by material, now that some renderers live in nested prefabs.
                rig.Scan(Of(asset, materials, MatRole.Paint), Of(asset, materials, MatRole.TailLens), Of(asset, materials, MatRole.TailCore));

                CarModel.SetLayer(root, CarModel.CarLayer);
                var carPrefab = PrefabUtility.SaveAsPrefabAsset(root, $"{dir}/{id}.prefab", out bool saved);
                if (!saved || carPrefab == null)
                {
                    Debug.LogError($"[bake] {id}: the prefab did not save");
                    return false;
                }
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(holder);
            }
            AssetDatabase.SaveAssets();
            Log($"{id}: {asset.Triangles:N0} triangles, {asset.Wheels.Length} wheels, parts " +
                $"hood{(asset.RearWindow != null ? ", rear window" : "")}{(asset.RearWing != null ? ", rear wing" : "")}, tyres — " +
                $"{(DateTime.UtcNow - t0).TotalSeconds:F1} s -> {dir}");
            return true;
        }

        /// <summary>Save a part as a prefab and put an instance of it where
        /// the part was. Returns the instance (or null for a missing part).</summary>
        static GameObject Nest(GameObject part, string path)
        {
            if (part == null) return null;
            var prefab = PrefabUtility.SaveAsPrefabAsset(part, path);
            return prefab != null ? Swap(part, prefab) : part;
        }

        static GameObject Swap(GameObject part, GameObject prefab)
        {
            var t = part.transform;
            var inst = (GameObject)PrefabUtility.InstantiatePrefab(prefab, t.parent);
            inst.name = part.name;
            inst.transform.localPosition = t.localPosition;
            inst.transform.localRotation = t.localRotation;
            inst.transform.localScale = t.localScale;
            inst.transform.SetSiblingIndex(t.GetSiblingIndex());
            inst.layer = part.layer;
            UnityEngine.Object.DestroyImmediate(part);
            return inst;
        }

        static Material Of(CarAsset a, Material[] mats, MatRole role)
        {
            for (int i = 0; i < a.Materials.Length; i++) if (a.Materials[i].Role == role) return mats[i];
            return null;
        }

        // ----------------------------------------------------------- textures

        /// <summary>Write each texture as a PNG and import it with the
        /// sampler and colour space the GLB asks for. Metal-roughness maps
        /// are written already repacked for URP (R metal, A smoothness).</summary>
        static Texture2D[] BakeTextures(CarAsset asset, string dir, out Texture2D[] metalGloss)
        {
            var list = new Texture2D[asset.Textures.Length];
            metalGloss = new Texture2D[asset.Textures.Length];
            var normals = new HashSet<int>();
            var mr = new Dictionary<int, CarMat>();
            foreach (var m in asset.Materials)
            {
                if (m.NormalTex != null) normals.Add(m.NormalTex.Texture);
                if (m.MetalRoughTex != null && !mr.ContainsKey(m.MetalRoughTex.Texture)) mr[m.MetalRoughTex.Texture] = m;
            }
            string project = Path.GetDirectoryName(Application.dataPath);
            var paths = new string[list.Length];
            var mgPaths = new string[list.Length];
            for (int i = 0; i < list.Length; i++)
            {
                var src = asset.Textures[i];
                if (src.Image == null) continue;
                paths[i] = $"{dir}/Textures/{asset.Id}-{i:00}.png";
                File.WriteAllBytes(Path.Combine(project, paths[i]), src.Image);
                if (mr.TryGetValue(i, out var owner))
                {
                    var tmp = new Texture2D(2, 2, TextureFormat.RGBA32, false, true);
                    if (tmp.LoadImage(src.Image, false))
                    {
                        var px = tmp.GetPixels32();
                        CarMaterials.RepackPixels(px, owner.Metallic, owner.Roughness);
                        tmp.SetPixels32(px);
                        tmp.Apply(false);
                        mgPaths[i] = $"{dir}/Textures/{asset.Id}-{i:00}-metalgloss.png";
                        File.WriteAllBytes(Path.Combine(project, mgPaths[i]), tmp.EncodeToPNG());
                    }
                    UnityEngine.Object.DestroyImmediate(tmp);
                }
            }
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            for (int i = 0; i < list.Length; i++)
            {
                if (paths[i] == null) continue;
                var src = asset.Textures[i];
                Configure(paths[i], src, normals.Contains(i), src.Linear);
                list[i] = AssetDatabase.LoadAssetAtPath<Texture2D>(paths[i]);
                if (mgPaths[i] != null)
                {
                    Configure(mgPaths[i], src, false, true);
                    metalGloss[i] = AssetDatabase.LoadAssetAtPath<Texture2D>(mgPaths[i]);
                }
            }
            return list;
        }

        static void Configure(string path, CarTex src, bool normal, bool linear)
        {
            var ti = AssetImporter.GetAtPath(path) as TextureImporter;
            if (ti == null) return;
            ti.textureType = normal ? TextureImporterType.NormalMap : TextureImporterType.Default;
            ti.sRGBTexture = !linear && !normal;
            ti.alphaIsTransparency = false;
            ti.mipmapEnabled = true;
            ti.wrapModeU = CarModel.Wrap(src.WrapS);
            ti.wrapModeV = CarModel.Wrap(src.WrapT);
            ti.filterMode = CarModel.Filter(src);
            ti.anisoLevel = 8;
            ti.isReadable = false;
            ti.SaveAndReimport();
        }

        // ----------------------------------------------------------- shared

        /// <summary>The contact-shadow blob as an asset, shared by every car.</summary>
        static Material SharedBlob()
        {
            Folder(Shared);
            string matPath = Shared + "/ContactShadow.mat";
            var mat = AssetDatabase.LoadAssetAtPath<Material>(matPath);
            if (mat != null) return mat;
            var texPath = Shared + "/ContactShadow.asset";
            var tex = AssetDatabase.LoadAssetAtPath<Texture2D>(texPath);
            if (tex == null)
            {
                var src = Mats.Blob();
                tex = new Texture2D(src.width, src.height, TextureFormat.RGBA32, true) { name = "ContactShadow", wrapMode = TextureWrapMode.Clamp };
                tex.SetPixels32(src.GetPixels32());
                tex.Apply(true);
                AssetDatabase.CreateAsset(tex, texPath);
            }
            mat = new Material(CarModel.BlobMaterial());
            mat.mainTexture = tex;
            if (mat.HasProperty("_BaseMap")) mat.SetTexture("_BaseMap", tex);
            AssetDatabase.CreateAsset(mat, matPath);
            return mat;
        }

        static void Folder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            var parent = Path.GetDirectoryName(path).Replace('\\', '/');
            Folder(parent);
            AssetDatabase.CreateFolder(parent, Path.GetFileName(path));
        }

        static string Safe(string s, string fallback)
        {
            if (string.IsNullOrEmpty(s)) return fallback;
            var chars = s.Select(c => char.IsLetterOrDigit(c) || c == '-' || c == '_' ? c : '-').ToArray();
            return new string(chars);
        }
    }
}
