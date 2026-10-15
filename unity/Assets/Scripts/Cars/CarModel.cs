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
        /// <summary>The source, kept only by a build with keepReadable (the
        /// baker); null in the game and when the model came from a prefab.</summary>
        public CarAsset Asset;
        public GameObject Template;
        public Texture2D[] Textures;
        public Material[] Materials;
        /// <summary>The meshes built, by part name ("Body", "Hood",
        /// "Tyre-F", "Wheel-FL"…), for the baker to save.</summary>
        public readonly Dictionary<string, Mesh> Meshes = new Dictionary<string, Mesh>();
        /// <summary>This car's contact-shadow lid and its material (on the
        /// template's "ContactShadow" renderer), for the baker to save.
        /// Readable only when built with keepReadable.</summary>
        public Texture2D ContactShadowTexture;
        public Material ContactShadowMaterial;

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
            // The asset is only needed while building; the game drops it
            // after (its parsed buffers are the GLB again, in managed memory).
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

            ContactShadow(root.transform, asset, model, keepReadable);
            SetLayer(root, CarLayer);
            model.Template = root;
            model.Asset = keepReadable ? asset : null;
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

        /// <summary>The web's contact-shadow lid (cars.ts contactShadowTexture),
        /// which the export strips. What grounds a car at night is not the
        /// moon's shadow (5.8 of 255 under it) but occlusion: the body is a
        /// lid over its patch of road. So: the body's footprint as a rounded
        /// rectangle at alpha 0.75 (radius 0.28 of its shorter side), a
        /// darker ellipse at 0.95 where each tyre meets the road, drawn hard
        /// and blurred once (a Gaussian of 0.055 of the texture), on a plane
        /// that reaches 0.44 m past the body all round — the band outside
        /// the sill is the only part anyone sees. Sized from this car, a
        /// tyre patch on each actual wheel (the Black Demon's nose wheel
        /// gets one, on the centre line).</summary>
        static void ContactShadow(Transform root, CarAsset a, CarModel model, bool keepReadable)
        {
            const float Reach = 0.44f;
            float bodyW = a.Max.X - a.Min.X, bodyL = a.Max.Z - a.Min.Z;
            float w = bodyW + Reach * 2f, l = bodyL + Reach * 2f;
            float cz = (a.Min.Z + a.Max.Z) * 0.5f;

            var quad = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Kill(quad.GetComponent<Collider>());
            quad.name = "ContactShadow";
            quad.transform.SetParent(root, false);
            // Above the lane paint (y 0.03), so it darkens markings too. The
            // quad's +Y (texture v) turns to the nose, its face to the sky.
            quad.transform.localPosition = new Vector3(0f, 0.035f, cz);
            quad.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
            quad.transform.localScale = new Vector3(w, l, 1f);

            var wheels = new Vector2[a.Wheels.Length];
            for (int i = 0; i < wheels.Length; i++)
                wheels[i] = new Vector2(0.5f + a.Wheels[i].Pivot.X / w, 0.5f + (a.Wheels[i].Pivot.Z - cz) / l);
            var tex = LidTexture(a.Id, bodyW / 2f / w, bodyL / 2f / l, wheels, keepReadable);
            var mat = Mats.AlphaBlend(Color.white, tex);
            mat.name = a.Id + "-ContactShadow";
            if (mat.HasProperty("_BaseMap")) mat.SetTexture("_BaseMap", tex);
            if (mat.HasProperty("_QueueOffset")) mat.SetFloat("_QueueOffset", CarMaterials.ShadowQueue);
            mat.renderQueue = (int)RenderQueue.Transparent + CarMaterials.ShadowQueue;

            var r = quad.GetComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false; // it IS a shadow; never a shadow of one
            r.reflectionProbeUsage = ReflectionProbeUsage.Off;
            model.ContactShadowTexture = tex;
            model.ContactShadowMaterial = mat;
        }

        /// <summary>The lid's alpha, 128 px square (black, alpha only).
        /// <paramref name="bodyU"/>/<paramref name="bodyV"/> are the body's
        /// half-width and half-length as fractions of the plane; the wheels
        /// are tyre-patch centres in plane UV, v toward the nose.</summary>
        public static Texture2D LidTexture(string id, float bodyU, float bodyV, Vector2[] wheels, bool keepReadable = false)
        {
            const int S = 128;
            var a = new float[S * S];
            float bw = bodyU * 2f * S, bh = bodyV * 2f * S;
            float rad = Mathf.Min(bw, bh) * 0.28f;
            float hx = bw * 0.5f - rad, hy = bh * 0.5f - rad;
            float ex = S * 0.055f, ey = S * 0.085f;
            for (int y = 0; y < S; y++)
                for (int x = 0; x < S; x++)
                {
                    float px = x + 0.5f, py = y + 0.5f;
                    // Rounded rectangle, by its signed distance.
                    float qx = Mathf.Abs(px - S * 0.5f) - hx, qy = Mathf.Abs(py - S * 0.5f) - hy;
                    float d = new Vector2(Mathf.Max(qx, 0f), Mathf.Max(qy, 0f)).magnitude + Mathf.Min(Mathf.Max(qx, qy), 0f) - rad;
                    float v = d <= 0f ? 0.75f : 0f;
                    // Tyre patches, composited over it (source-over).
                    foreach (var wh in wheels)
                    {
                        float tx = (px - wh.x * S) / ex, ty = (py - wh.y * S) / ey;
                        if (tx * tx + ty * ty <= 1f) { v = 0.95f + v * 0.05f; break; }
                    }
                    a[y * S + x] = v;
                }
            Blur(a, S, S * 0.055f);

            var px32 = new Color32[S * S];
            for (int i = 0; i < px32.Length; i++) px32[i] = new Color32(0, 0, 0, (byte)Mathf.RoundToInt(Mathf.Clamp01(a[i]) * 255f));
            var tex = new Texture2D(S, S, TextureFormat.RGBA32, true)
            {
                name = id + "-ContactShadow",
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Trilinear,
            };
            tex.SetPixels32(px32);
            tex.Apply(true, !keepReadable);
            return tex;
        }

        /// <summary>Separable Gaussian of std-dev <paramref name="sigma"/> px,
        /// transparent beyond the edges — the canvas filter blur() the web
        /// draws the lid through.</summary>
        static void Blur(float[] a, int s, float sigma)
        {
            int r = Mathf.CeilToInt(sigma * 3f);
            var k = new float[r * 2 + 1];
            float sum = 0f;
            for (int i = -r; i <= r; i++) sum += k[i + r] = Mathf.Exp(-i * i / (2f * sigma * sigma));
            for (int i = 0; i < k.Length; i++) k[i] /= sum;
            var t = new float[a.Length];
            for (int y = 0; y < s; y++)
                for (int x = 0; x < s; x++)
                {
                    float v = 0f;
                    for (int i = -r; i <= r; i++) { int xx = x + i; if (xx >= 0 && xx < s) v += a[y * s + xx] * k[i + r]; }
                    t[y * s + x] = v;
                }
            for (int y = 0; y < s; y++)
                for (int x = 0; x < s; x++)
                {
                    float v = 0f;
                    for (int i = -r; i <= r; i++) { int yy = y + i; if (yy >= 0 && yy < s) v += t[yy * s + x] * k[i + r]; }
                    a[y * s + x] = v;
                }
        }

        static Material blob;
        /// <summary>The unlit alpha-blend material the lid uses, as a template
        /// (no texture of its own; each car's lid is ContactShadowMaterial).</summary>
        public static Material BlobMaterial()
        {
            if (blob == null)
            {
                blob = Mats.AlphaBlend(Color.white);
                blob.name = "ContactShadow";
                if (blob.HasProperty("_QueueOffset")) blob.SetFloat("_QueueOffset", CarMaterials.ShadowQueue);
                blob.renderQueue = (int)RenderQueue.Transparent + CarMaterials.ShadowQueue;
            }
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
}
