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
    ///     Textures/*.png            plates, decals, tyre and seat maps, and
    ///                               ContactShadow.png (its material sits in Materials)
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
    /// A rebake writes over the assets where they are (CopySerialized into
    /// the existing object, prefabs saved onto their own path), so every GUID
    /// — and every scene, prefab or material that points at one — survives;
    /// only files this bake no longer writes (a car that lost its wing) are
    /// deleted. The source is the newer of the two GLBs (CarLibrary.NewestGlb),
    /// and its mtime is stamped on CarRig.SourceTicks so CarLibrary can tell
    /// a stale bake in the Editor.
    /// </summary>
    public static class CarAssetBaker
    {
        public const string Root = "Assets/Resources/Cars";
        /// <summary>Asset paths this bake wrote; anything else in the car's
        /// folder afterwards is from an older bake and goes.</summary>
        static readonly HashSet<string> written = new HashSet<string>();

        static void Log(string s) => Debug.Log("[bake] " + s);

        [MenuItem("Night Racer/Bake Cars to Assets")]
        public static void BakeMenu()
        {
            Linear();
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
            Linear();
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

        /// <summary>The materials are built for, and the paint law measured
        /// in, linear colour; a Gamma project bakes the sRGB/linear importer
        /// flags against the wrong space, so the baker sets it first.</summary>
        static void Linear()
        {
            if (PlayerSettings.colorSpace == ColorSpace.Linear) return;
            PlayerSettings.colorSpace = ColorSpace.Linear;
            Log("Player colour space set to Linear");
        }

        /// <summary>Bake one car. False when it has no GLB or failed.</summary>
        public static bool Bake(string id)
        {
            var t0 = DateTime.UtcNow;
            Linear();
            var glb = CarLibrary.NewestGlb(id);
            CarAsset asset;
            try { asset = CarLibrary.ReadGlb(id); }
            catch (Exception e) { Debug.LogError($"[bake] {id}: {e.Message}"); return false; }
            if (asset == null)
            {
                Debug.LogWarning($"[bake] {id}: no GLB (npm run cars:export)");
                return false;
            }

            string dir = Root + "/" + id;
            written.Clear();
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
                PersistEnvBlack(m);
                materials[i] = Put(m, $"{dir}/Materials/{i:00}-{Safe(asset.Materials[i].Name, "driver")}.mat");
                if (materials[i] != m) UnityEngine.Object.DestroyImmediate(m);
            }

            var holder = new GameObject("CarAssetBaker");
            try
            {
                // Readable while the bake serializes them (a mesh whose CPU
                // copy was dropped saves empty); cleared on the assets below.
                var model = CarModel.Build(asset, holder.transform, 1f, materials, textures, keepReadable: true);
                var root = model.Template;
                var meshes = new List<Mesh>();
                var swap = new Dictionary<Mesh, Mesh>();
                foreach (var kv in model.Meshes)
                {
                    var saved = Put(kv.Value, $"{dir}/Meshes/{Safe(kv.Key, "mesh")}.asset");
                    meshes.Add(saved);
                    if (saved != kv.Value) swap[kv.Value] = saved;
                }
                foreach (var mf in root.GetComponentsInChildren<MeshFilter>(true))
                    if (mf.sharedMesh != null && swap.TryGetValue(mf.sharedMesh, out var to)) mf.sharedMesh = to;
                foreach (var m in swap.Keys) UnityEngine.Object.DestroyImmediate(m);

                var rig = root.GetComponent<CarRig>();
                rig.SourceTicks = glb.Ticks;
                ContactShadow(root, dir);

                // Anything still not an asset (a primitive with no material
                // falls back to a runtime default) gets saved too, before the
                // parts become prefabs, so no prefab references a scene-only
                // object.
                int extra = 0;
                foreach (var r in root.GetComponentsInChildren<Renderer>(true))
                {
                    var mats = r.sharedMaterials;
                    bool changed = false;
                    for (int k = 0; k < mats.Length; k++)
                        if (mats[k] != null && !AssetDatabase.Contains(mats[k]))
                        {
                            PersistEnvBlack(mats[k]);
                            mats[k] = Put(mats[k], $"{dir}/Materials/extra-{extra++}.mat");
                            changed = true;
                        }
                    if (changed) r.sharedMaterials = mats;
                }

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
                        prefab = SavePrefab(tyre, $"{dir}/Parts/Tyre-{(front ? "F" : "R")}.prefab");
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

                // Slots by material, now that some renderers live in nested prefabs.
                rig.Scan(Of(asset, materials, MatRole.Paint), Of(asset, materials, MatRole.TailLens), Of(asset, materials, MatRole.TailCore));

                CarModel.SetLayer(root, CarModel.CarLayer);
                string carPath = $"{dir}/{id}.prefab";
                written.Add(carPath);
                var carPrefab = PrefabUtility.SaveAsPrefabAsset(root, carPath, out bool ok);
                if (!ok || carPrefab == null)
                {
                    Debug.LogError($"[bake] {id}: the prefab did not save");
                    return false;
                }

                // Saved: the game never reads a car's vertices back, so the
                // assets drop their CPU copy (half the memory in a player).
                foreach (var m in meshes) Unreadable(m);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(holder);
            }
            AssetDatabase.SaveAssets();
            Prune(dir);
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
            var prefab = SavePrefab(part, path);
            return prefab != null ? Swap(part, prefab) : part;
        }

        /// <summary>SaveAsPrefabAsset onto an existing prefab replaces its
        /// contents and keeps its GUID, so nesting and scene references to
        /// it hold across a rebake.</summary>
        static GameObject SavePrefab(GameObject go, string path)
        {
            written.Add(path);
            return PrefabUtility.SaveAsPrefabAsset(go, path);
        }

        // ------------------------------------------------------ in-place save

        /// <summary>Save <paramref name="obj"/> at <paramref name="path"/>,
        /// into the asset already there when there is one of its type
        /// (CopySerialized: same object, same GUID, new contents). Returns
        /// the asset to reference — the existing one, in which case the
        /// caller still owns, and should destroy, <paramref name="obj"/>.</summary>
        static T Put<T>(T obj, string path) where T : UnityEngine.Object
        {
            written.Add(path);
            var existing = AssetDatabase.LoadAssetAtPath<T>(path);
            if (existing != null && existing != obj)
            {
                string name = existing.name;
                EditorUtility.CopySerialized(obj, existing);
                existing.name = name;
                EditorUtility.SetDirty(existing);
                return existing;
            }
            if (existing == null)
            {
                // Something of another type in the way (a renamed role).
                if (AssetDatabase.LoadMainAssetAtPath(path) != null) AssetDatabase.DeleteAsset(path);
                AssetDatabase.CreateAsset(obj, path);
            }
            return obj;
        }

        /// <summary>Clear m_IsReadable on a saved mesh asset. Mesh has no
        /// setter for it (UploadMeshData(true) only frees the live copy, and
        /// would leave nothing to serialize), so through the serialized
        /// property, as the inspector would.</summary>
        static void Unreadable(Mesh mesh)
        {
            if (mesh == null) return;
            var so = new SerializedObject(mesh);
            var p = so.FindProperty("m_IsReadable");
            if (p == null || !p.boolValue) return;
            p.boolValue = false;
            so.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(mesh);
        }

        /// <summary>Delete every file in the car's folder this bake did not
        /// write (a part, mesh or material the car no longer has).</summary>
        static void Prune(string dir)
        {
            string project = Path.GetDirectoryName(Application.dataPath);
            string full = Path.Combine(project, dir);
            if (!Directory.Exists(full)) return;
            int n = 0;
            foreach (var f in Directory.GetFiles(full, "*", SearchOption.AllDirectories))
            {
                if (f.EndsWith(".meta", StringComparison.OrdinalIgnoreCase)) continue;
                string path = dir + f.Substring(full.Length).Replace('\\', '/');
                if (written.Contains(path)) continue;
                if (AssetDatabase.DeleteAsset(path)) n++;
            }
            if (n > 0) Log($"{dir}: removed {n} stale file{(n == 1 ? "" : "s")}");
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
            var hq = new HashSet<int>(); // plates and decals: lettering, fine lines
            var mr = new Dictionary<int, CarMat>();
            foreach (var m in asset.Materials)
            {
                if (m.NormalTex != null) normals.Add(m.NormalTex.Texture);
                if (m.Role == MatRole.Decal || m.Role == MatRole.Plate)
                {
                    if (m.BaseTex != null) hq.Add(m.BaseTex.Texture);
                    if (m.EmissiveTex != null) hq.Add(m.EmissiveTex.Texture);
                }
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
                written.Add(paths[i]);
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
                        written.Add(mgPaths[i]);
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
                Configure(paths[i], src, normals.Contains(i), src.Linear, hq.Contains(i));
                list[i] = AssetDatabase.LoadAssetAtPath<Texture2D>(paths[i]);
                if (mgPaths[i] != null)
                {
                    Configure(mgPaths[i], src, false, true, false);
                    metalGloss[i] = AssetDatabase.LoadAssetAtPath<Texture2D>(mgPaths[i]);
                }
            }
            return list;
        }

        /// <summary>Importer settings for a baked texture. The size cap is
        /// the source's own (next power of two, at least 2048, at most 8192),
        /// never the 2048 default that halved the 4096 decal sheets; plates
        /// and decals (<paramref name="hq"/>) compress at high quality (BC7)
        /// so their lettering keeps its edges.</summary>
        static void Configure(string path, CarTex src, bool normal, bool linear, bool hq)
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
            ti.GetSourceTextureWidthAndHeight(out int w, out int h);
            ti.maxTextureSize = Mathf.Clamp(Mathf.NextPowerOfTwo(Mathf.Max(w, h)), 2048, 8192);
            ti.textureCompression = hq ? TextureImporterCompression.CompressedHQ : TextureImporterCompression.Compressed;
            ti.SaveAndReimport();
        }

        // ------------------------------------------------- reflection factor

        const string EnvBlackPath = Root + "/_Shared/EnvFactorBlack.asset";

        /// <summary>NightReflections.EnvFactor points a material's
        /// _OcclusionMap at a runtime 1x1 black texture; a .mat cannot keep a
        /// reference to an object that is not an asset (it saves as None, and
        /// URP's default white map then gives the material full reflection).
        /// So the baker keeps one copy of it as an asset, shared by every car
        /// and outside any car's folder (Prune never sees it), and points the
        /// material at that.</summary>
        static void PersistEnvBlack(Material m)
        {
            if (m == null || !m.HasProperty("_OcclusionMap")) return;
            var black = NightReflections.EnvBlack;
            if (m.GetTexture("_OcclusionMap") != black) return;
            m.SetTexture("_OcclusionMap", EnvBlackAsset());
        }

        static Texture2D EnvBlackAsset()
        {
            var tex = AssetDatabase.LoadAssetAtPath<Texture2D>(EnvBlackPath);
            if (tex != null) return tex;
            Folder(Root + "/_Shared");
            tex = new Texture2D(1, 1, TextureFormat.RGBA32, false, true)
            {
                name = "EnvFactorBlack",
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Point,
            };
            tex.SetPixel(0, 0, Color.black);
            tex.Apply(false, false);
            AssetDatabase.CreateAsset(tex, EnvBlackPath);
            return tex;
        }

        // ---------------------------------------------------- contact shadow

        /// <summary>CarModel gives the car a contact-shadow quad whose texture
        /// and material are made at runtime; a prefab cannot keep either, so
        /// both are saved here, in the car's folder (each car's lid is its
        /// own footprint), and the quad pointed at them.</summary>
        static void ContactShadow(GameObject root, string dir)
        {
            var t = root.transform.Find("ContactShadow");
            MeshRenderer r = t != null ? t.GetComponent<MeshRenderer>() : null;
            if (r == null)
                foreach (var mr in root.GetComponentsInChildren<MeshRenderer>(true))
                    if (mr.name.Contains("ContactShadow")) { r = mr; break; }
            if (r == null || r.sharedMaterial == null) return;
            var src = r.sharedMaterial;
            var tex = src.mainTexture as Texture2D;
            if (tex == null && src.HasProperty("_BaseMap")) tex = src.GetTexture("_BaseMap") as Texture2D;

            Texture2D saved = null;
            if (tex != null && !AssetDatabase.Contains(tex))
            {
                string texPath = $"{dir}/Textures/ContactShadow.png";
                written.Add(texPath);
                File.WriteAllBytes(Path.Combine(Path.GetDirectoryName(Application.dataPath), texPath), Png(tex));
                AssetDatabase.ImportAsset(texPath, ImportAssetOptions.ForceSynchronousImport);
                if (AssetImporter.GetAtPath(texPath) is TextureImporter ti)
                {
                    ti.textureType = TextureImporterType.Default;
                    ti.sRGBTexture = true;
                    ti.alphaSource = TextureImporterAlphaSource.FromInput;
                    ti.alphaIsTransparency = true;
                    ti.mipmapEnabled = true;
                    ti.wrapMode = TextureWrapMode.Clamp;
                    ti.filterMode = FilterMode.Trilinear;
                    ti.isReadable = false;
                    ti.textureCompression = TextureImporterCompression.CompressedHQ; // smooth alpha ramps band under BC3
                    ti.SaveAndReimport();
                }
                saved = AssetDatabase.LoadAssetAtPath<Texture2D>(texPath);
            }
            else saved = tex;

            var mat = new Material(src) { name = "ContactShadow" };
            if (saved != null)
            {
                mat.mainTexture = saved;
                if (mat.HasProperty("_BaseMap")) mat.SetTexture("_BaseMap", saved);
            }
            var asset = Put(mat, $"{dir}/Materials/ContactShadow.mat");
            if (asset != mat) UnityEngine.Object.DestroyImmediate(mat);
            r.sharedMaterial = asset;
            // The runtime lid CarModel made for this build is now copied
            // into assets; free it rather than leak a texture and a material
            // per bake.
            if (tex != null && tex != saved && !AssetDatabase.Contains(tex)) UnityEngine.Object.DestroyImmediate(tex);
            if (!AssetDatabase.Contains(src)) UnityEngine.Object.DestroyImmediate(src);
        }

        /// <summary>PNG bytes of a runtime texture, read back through a
        /// render target when it is not CPU-readable.</summary>
        static byte[] Png(Texture2D tex)
        {
            if (tex.isReadable) return tex.EncodeToPNG();
            var rt = RenderTexture.GetTemporary(tex.width, tex.height, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
            var was = RenderTexture.active;
            Graphics.Blit(tex, rt);
            RenderTexture.active = rt;
            var copy = new Texture2D(tex.width, tex.height, TextureFormat.RGBA32, false);
            copy.ReadPixels(new Rect(0, 0, tex.width, tex.height), 0, 0);
            copy.Apply(false);
            RenderTexture.active = was;
            RenderTexture.ReleaseTemporary(rt);
            var png = copy.EncodeToPNG();
            UnityEngine.Object.DestroyImmediate(copy);
            return png;
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
