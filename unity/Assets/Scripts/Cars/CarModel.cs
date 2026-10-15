using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace NightRacer.Cars
{
    /// <summary>
    /// One game car as a Unity template, built from a CarAsset:
    ///
    ///   Car-&lt;id&gt;            CarRig
    ///    ├ Body              everything that is none of the parts below
    ///    ├ Hood              the bonnet panel
    ///    ├ RearWindow        the back glass
    ///    ├ RearWing          the wing, on the seven cars that have one
    ///    ├ Wheel-FL          hub pivot (yaw to steer)
    ///    │  └ Spin           rotate about local X to roll
    ///    │     ├ Rim         barrel, face, rotor, lugs
    ///    │     └ Tyre        one tyre per axle, mirrored onto the right
    ///    ├ … the other wheels
    ///    └ ContactShadow
    ///
    /// Each part is one mesh with a submesh per material. The template is
    /// kept inactive; every car on the road is an Instantiate of it (meshes
    /// and materials shared) that then takes its own paint and tail-lamp
    /// materials so it can be repainted and can brake alone. The Editor
    /// baker (CarAssetBaker) saves the same hierarchy as a prefab per car
    /// with its parts as prefabs of their own.
    /// </summary>
    public sealed class CarModel
    {
        /// <summary>The layer cars draw on, kept out of the car reflection
        /// probe (a car must not reflect itself, as on the web).</summary>
        public const int CarLayer = 9;

        public string Id;
        /// <summary>The source, when built from a GLB; null when the model
        /// came from a baked prefab.</summary>
        public CarAsset Asset;
        public GameObject Template;
        public Texture2D[] Textures;
        public Material[] Materials;
        /// <summary>The meshes built, by part name ("Body", "Hood",
        /// "Tyre-F", "Wheel-FL"…), for the baker to save.</summary>
        public readonly Dictionary<string, Mesh> Meshes = new Dictionary<string, Mesh>();

        /// <summary>A model backed by a baked prefab (Assets/Resources/Cars).</summary>
        public static CarModel FromPrefab(string id, GameObject prefab) =>
            new CarModel { Id = id, Template = prefab };

        /// <summary>Build the template on the main thread from a CarAsset
        /// already read (CarAssetReader.Read is thread-safe and can run on a
        /// worker). <paramref name="holder"/> is an inactive parent so the
        /// template never renders. The baker passes its own asset-backed
        /// <paramref name="materials"/> and keeps the meshes readable so it
        /// can save them; the game lets both default.</summary>
        public static CarModel Build(CarAsset asset, Transform holder, float night = 1f,
            Material[] materials = null, Texture2D[] textures = null, bool keepReadable = false)
        {
            var model = new CarModel { Id = asset.Id, Asset = asset };
            if (materials == null)
            {
                model.Textures = textures ?? BuildTextures(asset);
                model.Materials = new Material[asset.Materials.Length];
                for (int i = 0; i < asset.Materials.Length; i++)
                    model.Materials[i] = CarMaterials.Build(asset.Materials[i], model.Textures, night);
                // Free the CPU copies now the GPU has them (the metal-rough
                // repack, the one thing that read pixels, has run).
                if (!keepReadable)
                    foreach (var t in model.Textures) if (t != null && t.isReadable) t.Apply(false, true);
            }
            else
            {
                model.Materials = materials;
                model.Textures = textures;
            }

            var root = new GameObject("Car-" + asset.Id);
            root.transform.SetParent(holder, false);
            var rig = root.AddComponent<CarRig>();
            rig.CarId = asset.Id;
            rig.Finish = asset.Finish;

            foreach (var panel in asset.Panels)
            {
                var go = Part(panel, root.transform, model, panel.Name, keepReadable);
                if (panel == asset.Body) rig.Body = go.GetComponent<MeshRenderer>();
                else if (panel == asset.Hood) rig.Hood = go;
                else if (panel == asset.RearWindow) rig.RearWindow = go;
                else if (panel == asset.RearWing) rig.RearWing = go;
            }

            // One tyre mesh per axle, from the left (or centre) wheel; the
            // right-hand tyre is the same mesh mirrored (tools/unity/carcheck
            // checks that it is, on all 17 cars).
            var tyreMesh = new Dictionary<bool, (Mesh mesh, Material[] mats, int side)>();
            var wheels = new List<Transform>();
            var steers = new List<Transform>();
            var radii = new List<float>();
            var front = new List<bool>();
            var tyres = new List<GameObject>();
            foreach (var w in asset.Wheels)
            {
                var steer = new GameObject(w.Name).transform;
                steer.SetParent(root.transform, false);
                steer.localPosition = ToUnity(w.Pivot);
                var spin = new GameObject("Spin").transform;
                spin.SetParent(steer, false);
                Part(w, spin, model, "Rim", keepReadable, meshName: w.Name);

                GameObject tyre;
                if (w.Side > 0 && tyreMesh.TryGetValue(w.Front, out var src))
                {
                    tyre = new GameObject("Tyre");
                    tyre.transform.SetParent(spin, false);
                    tyre.transform.localScale = new Vector3(-1f, 1f, 1f);
                    tyre.AddComponent<MeshFilter>().sharedMesh = src.mesh;
                    var r = tyre.AddComponent<MeshRenderer>();
                    r.sharedMaterials = src.mats;
                    Dress(r);
                }
                else
                {
                    tyre = Part(w.Tyre, spin, model, "Tyre", keepReadable, meshName: "Tyre-" + (w.Front ? "F" : "R"));
                    if (!tyreMesh.ContainsKey(w.Front))
                        tyreMesh[w.Front] = (tyre.GetComponent<MeshFilter>().sharedMesh, tyre.GetComponent<MeshRenderer>().sharedMaterials, w.Side);
                }
                tyres.Add(tyre);
                wheels.Add(spin);
                steers.Add(steer);
                radii.Add(w.Radius);
                front.Add(w.Front);
            }
            rig.Wheels = wheels.ToArray();
            rig.SteerPivots = steers.ToArray();
            rig.WheelRadii = radii.ToArray();
            rig.WheelFront = front.ToArray();
            rig.Tyres = tyres.ToArray();

            rig.HeadLamps = ToUnity(asset.HeadLamps);
            rig.TailLamps = ToUnity(asset.TailLamps);
            rig.Length = asset.Max.Z - asset.Min.Z;
            rig.Width = asset.Max.X - asset.Min.X;
            rig.Height = asset.Max.Y - asset.Min.Y;
            rig.Front = asset.Max.Z;
            rig.Rear = asset.Min.Z;

            var tailLens = Index(asset, MatRole.TailLens);
            var tailCore = Index(asset, MatRole.TailCore);
            rig.TailLensColor = tailLens >= 0 ? CarMaterials.Linear(asset.Materials[tailLens].Emissive) : new Color(1f, 0f, 0f);
            rig.TailCoreColor = tailCore >= 0 ? CarMaterials.Linear(asset.Materials[tailCore].Emissive) : new Color(1f, 0.01f, 0f);
            int paint = Index(asset, MatRole.Paint);
            rig.Scan(paint >= 0 ? model.Materials[paint] : null,
                tailLens >= 0 ? model.Materials[tailLens] : null,
                tailCore >= 0 ? model.Materials[tailCore] : null);

            ContactShadow(root.transform, asset);
            SetLayer(root, CarLayer);
            model.Template = root;
            return model;
        }

        /// <summary>A car on the road: a clone of the template with its own
        /// paint and tail-lamp materials.</summary>
        public CarRig Spawn(Transform parent = null)
        {
            var go = Object.Instantiate(Template, parent);
            go.name = "Car-" + Id;
            go.SetActive(true);
            var rig = go.GetComponent<CarRig>();
            rig.OwnMaterials();
            return rig;
        }

        // ---------------------------------------------------------- parts

        static GameObject Part(Part part, Transform parent, CarModel model, string name, bool keepReadable, string meshName = null)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var mesh = new Mesh { name = model.Id + "-" + (meshName ?? name) };
            int vertices = 0;
            foreach (var c in part.Chunks) vertices += c.VertexCount;
            mesh.indexFormat = vertices > 65535 ? IndexFormat.UInt32 : IndexFormat.UInt16;

            var pos = new List<Vector3>(vertices);
            var nrm = new List<Vector3>(vertices);
            var uv = new List<Vector2>(vertices);
            bool anyUv = false;
            foreach (var c in part.Chunks) anyUv |= c.Uvs != null;
            var bases = new int[part.Chunks.Length];
            for (int k = 0; k < part.Chunks.Length; k++)
            {
                var c = part.Chunks[k];
                bases[k] = pos.Count;
                for (int v = 0; v < c.VertexCount; v++)
                {
                    pos.Add(new Vector3(c.Positions[v * 3], c.Positions[v * 3 + 1], c.Positions[v * 3 + 2]));
                    nrm.Add(new Vector3(c.Normals[v * 3], c.Normals[v * 3 + 1], c.Normals[v * 3 + 2]));
                    if (anyUv) uv.Add(c.Uvs != null ? new Vector2(c.Uvs[v * 2], c.Uvs[v * 2 + 1]) : Vector2.zero);
                }
            }
            mesh.SetVertices(pos);
            mesh.SetNormals(nrm);
            if (anyUv) mesh.SetUVs(0, uv);
            mesh.subMeshCount = part.Chunks.Length;
            var mats = new Material[part.Chunks.Length];
            bool needsTangents = false;
            for (int k = 0; k < part.Chunks.Length; k++)
            {
                var c = part.Chunks[k];
                mesh.SetTriangles(c.Indices, k, false, bases[k]);
                mats[k] = c.Material >= 0 && c.Material < model.Materials.Length ? model.Materials[c.Material] : DefaultMaterial();
                if (c.Material >= 0 && model.Asset.Materials[c.Material].NormalTex != null) needsTangents = true;
            }
            mesh.RecalculateBounds();
            if (needsTangents && anyUv) mesh.RecalculateTangents();
            if (!keepReadable) mesh.UploadMeshData(true);
            model.Meshes[meshName ?? name] = mesh;

            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterials = mats;
            Dress(renderer);
            return go;
        }

        static void Dress(MeshRenderer r)
        {
            r.shadowCastingMode = ShadowCastingMode.On;
            r.receiveShadows = true;
            r.reflectionProbeUsage = ReflectionProbeUsage.BlendProbesAndSkybox;
        }

        static int Index(CarAsset a, MatRole role)
        {
            for (int i = 0; i < a.Materials.Length; i++) if (a.Materials[i].Role == role) return i;
            return -1;
        }

        static Material fallback;
        static Material DefaultMaterial()
        {
            if (fallback == null)
                fallback = CarMaterials.Build(new CarMat { Name = "default", BaseColor = new[] { 0.2f, 0.2f, 0.2f, 1f }, Metallic = 0, Roughness = 0.6f }, null, 1f);
            return fallback;
        }

        // ------------------------------------------------------- textures

        /// <summary>Decode a car's textures (readable, so the metal-rough
        /// repack can read them; Build frees them afterwards).</summary>
        public static Texture2D[] BuildTextures(CarAsset asset)
        {
            var list = new Texture2D[asset.Textures.Length];
            for (int i = 0; i < list.Length; i++)
            {
                var src = asset.Textures[i];
                if (src.Image == null) continue;
                var t = new Texture2D(2, 2, TextureFormat.RGBA32, true, src.Linear)
                {
                    name = asset.Id + "-tex" + i,
                };
                if (!t.LoadImage(src.Image, false))
                {
                    Debug.LogWarning($"[cars] {asset.Id}: texture {i} did not decode");
                    Kill(t);
                    continue;
                }
                t.wrapModeU = Wrap(src.WrapS);
                t.wrapModeV = Wrap(src.WrapT);
                t.filterMode = Filter(src);
                t.anisoLevel = 8;
                list[i] = t;
            }
            return list;
        }

        public static TextureWrapMode Wrap(int gl) =>
            gl == 33071 ? TextureWrapMode.Clamp : gl == 33648 ? TextureWrapMode.Mirror : TextureWrapMode.Repeat;

        public static FilterMode Filter(CarTex src)
        {
            bool mips = src.MinFilter == 9984 || src.MinFilter == 9985 || src.MinFilter == 9986 || src.MinFilter == 9987;
            return src.MagFilter == 9728 && !mips ? FilterMode.Point : mips ? FilterMode.Trilinear : FilterMode.Bilinear;
        }

        // ------------------------------------------------------- grounding

        /// <summary>The export strips the web's contact-shadow lid, and the
        /// moon's shadow alone barely grounds a car (cars.ts measured 5.8
        /// of 255 under it). The port's own soft blob stands in.</summary>
        static void ContactShadow(Transform root, CarAsset a)
        {
            var quad = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Kill(quad.GetComponent<Collider>());
            quad.name = "ContactShadow";
            quad.transform.SetParent(root, false);
            float cz = (a.Min.Z + a.Max.Z) * 0.5f;
            quad.transform.localPosition = new Vector3(0f, 0.035f, cz);
            quad.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
            float width = 0f;
            foreach (var w in a.Wheels) width = Mathf.Max(width, Mathf.Abs(w.Pivot.X) * 2f + 0.5f);
            if (width <= 0f) width = (a.Max.X - a.Min.X) * 0.9f;
            quad.transform.localScale = new Vector3(width + 0.44f, (a.Max.Z - a.Min.Z) + 0.44f, 1f);
            var r = quad.GetComponent<MeshRenderer>();
            r.sharedMaterial = BlobMaterial();
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
        }

        static Material blob;
        /// <summary>The contact-shadow material (the baker saves it as an asset).</summary>
        public static Material BlobMaterial()
        {
            if (blob == null) blob = Mats.AlphaBlend(Color.white, Mats.Blob());
            return blob;
        }

        /// <summary>Destroy that also works in edit mode (the studio and the
        /// baker build and tear down cars without entering Play).</summary>
        public static void Kill(Object o)
        {
            if (o == null) return;
            if (Application.isPlaying) Object.Destroy(o);
            else Object.DestroyImmediate(o);
        }

        public static void SetLayer(GameObject go, int layer)
        {
            go.layer = layer;
            foreach (Transform c in go.transform) SetLayer(c.gameObject, layer);
        }

        static Vector3 ToUnity(System.Numerics.Vector3 v) => new Vector3(v.X, v.Y, v.Z);

        static Vector3[] ToUnity(System.Numerics.Vector3[] v)
        {
            var r = new Vector3[v.Length];
            for (int i = 0; i < v.Length; i++) r[i] = ToUnity(v[i]);
            return r;
        }
    }

    /// <summary>
    /// The handles a game car exposes: wheels on their hubs (spin about the
    /// axle, the front pair steer), its separable parts, the paint and
    /// tail-lamp material slots wherever they are (the hood and the wing are
    /// paint too), and where its lamps are. Every field is serialized, so a
    /// baked prefab carries it.
    /// </summary>
    public sealed class CarRig : MonoBehaviour
    {
        public string CarId;
        public string Finish = "gloss";
        public MeshRenderer Body;
        /// <summary>The parts that are assets of their own once baked.</summary>
        public GameObject Hood, RearWindow, RearWing;
        public GameObject[] Tyres = new GameObject[0];
        /// <summary>The spinning part of each wheel, fl, fr, rl, rr (nose,
        /// rl, rr on the trike). Rotate about local X to roll.</summary>
        public Transform[] Wheels = new Transform[0];
        /// <summary>Each wheel's hub pivot; yaw the front ones to steer.</summary>
        public Transform[] SteerPivots = new Transform[0];
        public float[] WheelRadii = new float[0];
        public bool[] WheelFront = new bool[0];
        public Vector3[] HeadLamps = new Vector3[0], TailLamps = new Vector3[0];
        public float Length, Width, Height, Front, Rear;
        public Color TailLensColor, TailCoreColor;
        /// <summary>Material slots by renderer: PaintRenderers[i] slot
        /// PaintSlots[i] is paint, and so on.</summary>
        public Renderer[] PaintRenderers = new Renderer[0], TailLensRenderers = new Renderer[0], TailCoreRenderers = new Renderer[0];
        public int[] PaintSlots = new int[0], TailLensSlots = new int[0], TailCoreSlots = new int[0];

        Material paint, tailLens, tailCore;
        float brake = -1f;

        /// <summary>Record every renderer slot under this car that uses these
        /// materials. Run when the car is built, and again by the baker after
        /// its parts become nested prefabs.</summary>
        public void Scan(Material paintMat, Material lensMat, Material coreMat)
        {
            var pr = new List<Renderer>(); var ps = new List<int>();
            var lr = new List<Renderer>(); var ls = new List<int>();
            var cr = new List<Renderer>(); var cs = new List<int>();
            foreach (var r in GetComponentsInChildren<Renderer>(true))
            {
                var mats = r.sharedMaterials;
                for (int k = 0; k < mats.Length; k++)
                {
                    if (mats[k] == null) continue;
                    if (mats[k] == paintMat) { pr.Add(r); ps.Add(k); }
                    else if (mats[k] == lensMat) { lr.Add(r); ls.Add(k); }
                    else if (mats[k] == coreMat) { cr.Add(r); cs.Add(k); }
                }
            }
            PaintRenderers = pr.ToArray(); PaintSlots = ps.ToArray();
            TailLensRenderers = lr.ToArray(); TailLensSlots = ls.ToArray();
            TailCoreRenderers = cr.ToArray(); TailCoreSlots = cs.ToArray();
        }

        /// <summary>Give this car its own paint and tail-lamp materials, so
        /// repainting or braking it touches nobody else.</summary>
        public void OwnMaterials()
        {
            paint = Own(PaintRenderers, PaintSlots);
            tailLens = Own(TailLensRenderers, TailLensSlots);
            tailCore = Own(TailCoreRenderers, TailCoreSlots);
        }

        static Material Own(Renderer[] renderers, int[] slots)
        {
            Material mine = null;
            for (int i = 0; i < renderers.Length && i < slots.Length; i++)
            {
                var r = renderers[i];
                if (r == null) continue;
                var mats = r.sharedMaterials;
                if (slots[i] >= mats.Length || mats[slots[i]] == null) continue;
                if (mine == null) mine = new Material(mats[slots[i]]);
                mats[slots[i]] = mine;
                r.sharedMaterials = mats;
            }
            return mine;
        }

        /// <summary>The paint material this car owns (null before OwnMaterials).</summary>
        public Material Paint => paint;
        /// <summary>The tail-lamp core material this car owns.</summary>
        public Material TailCore => tailCore;

        /// <summary>Repaint in an sRGB colour from the game data.</summary>
        public void Repaint(Color srgb)
        {
            if (paint != null) CarMaterials.Repaint(paint, srgb, Finish);
        }

        /// <summary>Tail lamps from idle (0) to full brake (1).</summary>
        public void SetBrake(float k)
        {
            k = Mathf.Clamp01(k);
            if (Mathf.Abs(k - brake) < 0.01f) return;
            brake = k;
            if (tailLens != null)
                CarMaterials.SetLinear(tailLens, "_EmissionColor",
                    TailLensColor * Mathf.Lerp(CarMaterials.TailLensIdle, CarMaterials.TailLensBrake, k));
            if (tailCore != null)
                CarMaterials.SetLinear(tailCore, "_EmissionColor",
                    TailCoreColor * Mathf.Lerp(CarMaterials.TailCoreIdle, CarMaterials.TailCoreBrake, k));
        }

        /// <summary>Roll every wheel through <paramref name="metres"/> of
        /// road, each at its own radius (the trike's front wheel is 0.29 m,
        /// its rears 0.41).</summary>
        public void Roll(float metres)
        {
            for (int i = 0; i < Wheels.Length; i++)
            {
                float r = i < WheelRadii.Length && WheelRadii[i] > 0.05f ? WheelRadii[i] : 0.35f;
                Wheels[i].Rotate(metres / r * Mathf.Rad2Deg, 0f, 0f, Space.Self);
            }
        }

        /// <summary>Steer the front wheels, degrees (+ = right).</summary>
        public void Steer(float degrees)
        {
            for (int i = 0; i < SteerPivots.Length; i++)
                if (i < WheelFront.Length && WheelFront[i])
                    SteerPivots[i].localRotation = Quaternion.Euler(0f, degrees, 0f);
        }

        void OnDestroy()
        {
            CarModel.Kill(paint);
            CarModel.Kill(tailLens);
            CarModel.Kill(tailCore);
        }
    }
}
