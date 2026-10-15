using System;
using System.Collections.Generic;
using System.Numerics;
using System.Text;

namespace NightRacer.Cars
{
    /// <summary>What a car's material is FOR — decides the URP recipe.</summary>
    public enum MatRole
    {
        Default, Paint, Glass, GlassTint, Decal, Plate, HeadLamp, TailLens, TailCore,
        Lamp, NightFloor, Disc, Metal, Tyre, ExhaustBore, Driver,
    }

    /// <summary>A texture slot on a material: which glTF texture, and its
    /// KHR_texture_transform already converted to a Unity _ST (the V axis
    /// is flipped on the way in — see CarAssetReader).</summary>
    public sealed class TexRef
    {
        public int Texture = -1;
        public float ScaleU = 1, ScaleV = 1, OffsetU, OffsetV;
        /// <summary>normalTexture.scale (normal strength); 1 elsewhere.</summary>
        public float Strength = 1;
    }

    /// <summary>One glTF material, every value linear, as the web built it.</summary>
    public sealed class CarMat
    {
        public int Index;
        public string Name = "";
        public MatRole Role;
        public float[] BaseColor = { 1, 1, 1, 1 };
        public float Metallic = 1, Roughness = 1;
        public float[] Emissive = { 0, 0, 0 };
        /// <summary>KHR_materials_emissive_strength (1 when absent). The
        /// exporter writes the as-built idle level here; plates, decals and
        /// reflectors carry 0 and their real night level in NightFloor.</summary>
        public float EmissiveStrength = 1;
        /// <summary>extras.nightFloor: emissive at full night, or -1.</summary>
        public float NightFloor = -1;
        /// <summary>extras.baseEnvIntensity: the web's reflection gain on
        /// the per-car metals, or 0 when the material has none.</summary>
        public float BaseEnvIntensity;
        public bool HasClearcoat;
        public float Clearcoat, ClearcoatRoughness;
        public bool Blend, DoubleSided;
        public TexRef BaseTex, NormalTex, MetalRoughTex, EmissiveTex;
    }

    public sealed class CarTex
    {
        public int Index;
        public byte[] Image;
        public string Mime = "image/png";
        /// <summary>GL enums as in the file: 33071 clamp, 33648 mirror, 10497 repeat.</summary>
        public int WrapS = 10497, WrapT = 10497;
        public int MinFilter = 9987, MagFilter = 9729;
        /// <summary>Data, not colour: used as a normal or metal-roughness map.</summary>
        public bool Linear;
    }

    /// <summary>All the geometry of one material within one part, in the
    /// part's own space (Unity axes, metres, relative to the part pivot).</summary>
    public sealed class Chunk
    {
        public int Material;
        public float[] Positions;   // xyz
        public float[] Normals;     // xyz
        public float[] Uvs;         // uv, or null when no primitive had any
        public int[] Indices;       // triangles, Unity winding
        public int VertexCount => Positions.Length / 3;
    }

    /// <summary>A rigid part of the car: the body, the hood, the rear
    /// window, the rear wing, or one wheel (barrel, face, rotor and lugs,
    /// spinning about its own hub, with its tyre as a part of its own).</summary>
    public sealed class Part
    {
        public string Name = "Body";
        /// <summary>Pivot in car space (Unity axes). Zero for the body
        /// panels (they sit where they are on the car); the hub for a wheel
        /// and its tyre.</summary>
        public Vector3 Pivot;
        public Chunk[] Chunks = Array.Empty<Chunk>();
        public bool IsWheel, Front;
        /// <summary>-1 left, 0 centre (the trike's nose wheel), +1 right.</summary>
        public int Side;
        public float Radius;
        /// <summary>On a wheel: its tyre, a part of its own on the same hub.</summary>
        public Part Tyre;
        public int TriangleCount
        {
            get { int t = 0; foreach (var c in Chunks) t += c.Indices.Length / 3; return t; }
        }
    }

    /// <summary>
    /// One car out of a game GLB, ready to become Unity meshes: geometry
    /// baked into car space and grouped by material (one draw per material
    /// per part instead of ~180 renderers), wheels split out on their hubs,
    /// lamps located, every material and texture described.
    /// </summary>
    public sealed class CarAsset
    {
        public string Id = "";
        public CarMat[] Materials = Array.Empty<CarMat>();
        public CarTex[] Textures = Array.Empty<CarTex>();
        /// <summary>Everything that is not one of the parts below.</summary>
        public Part Body = new Part();
        /// <summary>The bonnet: the paint ahead of the windscreen that faces
        /// the sky, between the fenders. Cut out of the body shell, which in
        /// the export is one mesh.</summary>
        public Part Hood;
        /// <summary>The rear window: the canopy glass behind its middle that
        /// faces backwards. Null on a car without one.</summary>
        public Part RearWindow;
        /// <summary>The rear wing (the web's `wing` node), on the seven cars
        /// that carry one; null on the rest.</summary>
        public Part RearWing;
        /// <summary>Front first, then left before right: fl, fr, rl, rr —
        /// or nose, rl, rr on the three-wheeled Black Demon. Each carries
        /// its tyre in Tyre.</summary>
        public Part[] Wheels = Array.Empty<Part>();
        /// <summary>The static parts that exist, body first.</summary>
        public IEnumerable<Part> Panels
        {
            get
            {
                yield return Body;
                if (Hood != null) yield return Hood;
                if (RearWindow != null) yield return RearWindow;
                if (RearWing != null) yield return RearWing;
            }
        }
        /// <summary>Car-space centres of each headlamp (`lamp-core` nodes)
        /// and tail lamp (`taillamp-core` geometry), Unity axes.</summary>
        public Vector3[] HeadLamps = Array.Empty<Vector3>();
        public Vector3[] TailLamps = Array.Empty<Vector3>();
        public Vector3 Min, Max;
        /// <summary>The front edge of the cabin glass (the windscreen's
        /// foot), car-space z: where the hood stops.</summary>
        public float WindscreenZ;
        /// <summary>gloss, satin or matte, read off the paint's coat.</summary>
        public string Finish = "gloss";
        public int Triangles;
        public CarMat Paint
        {
            get { foreach (var m in Materials) if (m.Role == MatRole.Paint) return m; return null; }
        }
    }

    /// <summary>
    /// Reads the GLBs tools/shots/export-cars.mjs writes (three.js
    /// GLTFExporter r184): one scene, matrices only, one triangle primitive
    /// per mesh, float positions/normals/UVs, 16- or 32-bit indices, PNG
    /// images, and the extensions KHR_materials_clearcoat,
    /// KHR_materials_emissive_strength, KHR_texture_transform and
    /// KHR_materials_specular. It is a reader for these files, not a
    /// general glTF importer, and refuses what it does not understand
    /// rather than guessing.
    ///
    /// glTF is right-handed and Unity left-handed. The conversion is the
    /// one glTFast makes: negate X on positions and normals, reverse each
    /// triangle's winding, and flip V (v' = 1 - v) — so a car keeps its
    /// nose on +Z and its driver in the left seat, now on -X.
    /// </summary>
    public static class CarAssetReader
    {
        const uint GlbMagic = 0x46546C67, ChunkJson = 0x4E4F534A, ChunkBin = 0x004E4942;

        /// <summary>Decal skins sit on the paint (the web keeps them apart
        /// with polygonOffset, which a GLB cannot carry): lift them this far
        /// along their normals so they never z-fight.</summary>
        public const float DecalLift = 0.0015f;

        public static CarAsset Read(byte[] glb, string id)
        {
            if (glb == null || glb.Length < 20 || BitConverter.ToUInt32(glb, 0) != GlbMagic)
                throw new FormatException($"{id}: not a GLB");
            int jsonLen = (int)BitConverter.ToUInt32(glb, 12);
            if (BitConverter.ToUInt32(glb, 16) != ChunkJson) throw new FormatException($"{id}: first chunk is not JSON");
            var json = Encoding.UTF8.GetString(glb, 20, jsonLen);
            int binAt = 20 + jsonLen;
            byte[] bin = null;
            int binOff = 0;
            if (binAt + 8 <= glb.Length && BitConverter.ToUInt32(glb, binAt + 4) == ChunkBin)
            {
                bin = glb;
                binOff = binAt + 8;
            }
            var root = MiniJson.Parse(json);
            var reader = new Ctx(id, root, bin, binOff);
            return reader.Build();
        }

        /// <summary>One primitive, already in car space (Unity axes).</summary>
        sealed class Geo
        {
            public int Material;
            public float[] Pos, Nrm, Uv;
            public int[] Indices;
        }

        sealed class Ctx
        {
            readonly string id;
            readonly object root;
            readonly byte[] bin;
            readonly int binOff;
            readonly List<object> nodes, meshes, accessors, views, mats, texs, images, samplers;
            readonly CarAsset car = new CarAsset();
            readonly Matrix4x4[] world;
            readonly int[] parent;

            public Ctx(string id, object root, byte[] bin, int binOff)
            {
                this.id = id;
                this.root = root;
                this.bin = bin;
                this.binOff = binOff;
                nodes = MiniJson.A(root, "nodes") ?? new List<object>();
                meshes = MiniJson.A(root, "meshes") ?? new List<object>();
                accessors = MiniJson.A(root, "accessors") ?? new List<object>();
                views = MiniJson.A(root, "bufferViews") ?? new List<object>();
                mats = MiniJson.A(root, "materials") ?? new List<object>();
                texs = MiniJson.A(root, "textures") ?? new List<object>();
                images = MiniJson.A(root, "images") ?? new List<object>();
                samplers = MiniJson.A(root, "samplers") ?? new List<object>();
                world = new Matrix4x4[nodes.Count];
                parent = new int[nodes.Count];
                for (int i = 0; i < parent.Length; i++) parent[i] = -1;
                var required = MiniJson.A(root, "extensionsRequired");
                if (required != null && required.Count > 0)
                    throw new FormatException($"{id}: requires {string.Join(", ", required)}, which this reader does not support");
            }

            public CarAsset Build()
            {
                car.Id = id;
                ReadMaterials();
                ReadTextures();

                // Scene graph: world matrices from the scene's roots down.
                var scenes = MiniJson.A(root, "scenes");
                int sceneIndex = MiniJson.I(root, "scene", 0);
                var scene = scenes != null && sceneIndex < scenes.Count ? scenes[sceneIndex] : null;
                var roots = MiniJson.A(scene, "nodes");
                if (roots == null || roots.Count == 0) throw new FormatException($"{id}: no scene nodes");
                foreach (var r in roots) Walk((int)(double)r, -1, Matrix4x4.Identity);

                // Wheels: a node whose direct child draws the `tire` material.
                var wheelNodes = new List<int>();
                for (int n = 0; n < nodes.Count; n++)
                {
                    var kids = MiniJson.A(nodes[n], "children");
                    if (kids == null) continue;
                    foreach (var k in kids)
                        if (MeshUsesRole((int)(double)k, MatRole.Tyre)) { wheelNodes.Add(n); break; }
                }
                var inWheel = new int[nodes.Count];
                for (int i = 0; i < inWheel.Length; i++) inWheel[i] = -1;
                for (int w = 0; w < wheelNodes.Count; w++) MarkSubtree(wheelNodes[w], w, inWheel);

                // The rear wing, where the car has one, is a part of its own.
                var inWing = new bool[nodes.Count];
                for (int n = 0; n < nodes.Count; n++)
                    if (MiniJson.S(nodes[n], "name", "") == "wing") MarkFlag(n, inWing);

                var hubs = new Vector3[wheelNodes.Count];
                for (int w = 0; w < hubs.Length; w++)
                    hubs[w] = ToUnity(Vector3.Transform(Vector3.Zero, world[wheelNodes[w]]));

                // Every primitive in car space first, with where it came
                // from: the hood and the rear window are cut out of the body
                // shell and the canopy by where their triangles sit and which
                // way they face, and that needs the car's measurements.
                var all = new List<(Geo g, int wheel, bool wing)>();
                var tailCentres = new List<Vector3>();
                var headCentres = new List<Vector3>();
                Vector3 min = new Vector3(float.MaxValue), max = new Vector3(float.MinValue);
                float glassFront = float.MinValue, glassRear = float.MaxValue;
                int tris = 0;
                for (int n = 0; n < nodes.Count; n++)
                {
                    int meshIndex = MiniJson.I(nodes[n], "mesh", -1);
                    if (meshIndex < 0) continue;
                    var prims = MiniJson.A(meshes[meshIndex], "primitives");
                    if (prims == null) continue;
                    foreach (var prim in prims)
                    {
                        if (MiniJson.I(prim, "mode", 4) != 4) continue; // triangles only
                        var g = ReadPrimitive(prim, world[n]);
                        if (g == null) continue;
                        tris += g.Indices.Length / 3;
                        var role = g.Material >= 0 ? car.Materials[g.Material].Role : MatRole.Default;
                        for (int v = 0; v < g.Pos.Length; v += 3)
                        {
                            var p = new Vector3(g.Pos[v], g.Pos[v + 1], g.Pos[v + 2]);
                            min = Vector3.Min(min, p);
                            max = Vector3.Max(max, p);
                            if (role == MatRole.Glass && inWheel[n] < 0 && !inWing[n])
                            {
                                glassFront = Math.Max(glassFront, p.Z);
                                glassRear = Math.Min(glassRear, p.Z);
                            }
                        }
                        if (role == MatRole.TailCore) AddTailLamps(g.Pos, tailCentres);
                        all.Add((g, inWheel[n], inWing[n]));
                    }
                }
                if (glassFront < glassRear) { glassFront = max.Z * 0.3f; glassRear = min.Z * 0.3f; }
                float glassMid = (glassFront + glassRear) * 0.5f;
                float hoodHalf = (max.X - min.X) * 0.36f;
                float hoodFloor = max.Y * 0.38f;
                car.WindscreenZ = glassFront;

                // The hood: paint ahead of the windscreen's foot, facing the
                // sky, between the fenders (not over them), above the wheel
                // tops. The fenders and the nose's curve stay with the body.
                bool IsHood(Vector3 c, Vector3 nrm) =>
                    nrm.Y > 0.5f && c.Z > glassFront - 0.05f && c.Z < max.Z - 0.02f
                    && Math.Abs(c.X) < hoodHalf && c.Y > hoodFloor;
                // The rear window: canopy glass behind its middle that faces
                // backwards (a fastback's faces mostly up, which still counts:
                // its normal leans rearward). Side windows face sideways and
                // the windscreen forwards, so neither qualifies.
                bool IsRearWindow(Vector3 c, Vector3 nrm) =>
                    nrm.Z < -0.3f && c.Z < glassMid && nrm.Y > -0.2f;

                var body = new Builder();
                var hood = new Builder();
                var rearWindow = new Builder();
                var wing = new Builder();
                var rims = new Builder[wheelNodes.Count];
                var tyres = new Builder[wheelNodes.Count];
                for (int w = 0; w < rims.Length; w++) { rims[w] = new Builder(); tyres[w] = new Builder(); }
                foreach (var (g, w, onWing) in all)
                {
                    var role = g.Material >= 0 ? car.Materials[g.Material].Role : MatRole.Default;
                    if (w >= 0) { (role == MatRole.Tyre ? tyres[w] : rims[w]).Add(g, hubs[w]); continue; }
                    if (onWing) { wing.Add(g, Vector3.Zero); continue; }
                    if (role == MatRole.Paint) { Split(g, IsHood, hood, body); continue; }
                    if (role == MatRole.Glass) { Split(g, IsRearWindow, rearWindow, body); continue; }
                    body.Add(g, Vector3.Zero);
                }
                if (tris == 0) throw new FormatException($"{id}: no triangles");
                car.Triangles = tris;
                car.Min = min;
                car.Max = max;

                // Headlamps: each `lamp-core` node's own geometry centre.
                for (int n = 0; n < nodes.Count; n++)
                    if (MiniJson.S(nodes[n], "name", "") == "lamp-core")
                    {
                        var c = SubtreeCentre(n);
                        if (c.HasValue) headCentres.Add(c.Value);
                    }
                car.HeadLamps = headCentres.ToArray();
                car.TailLamps = tailCentres.ToArray();

                car.Body = body.ToPart("Body", Vector3.Zero);
                car.Hood = hood.Empty ? null : hood.ToPart("Hood", Vector3.Zero);
                car.RearWindow = rearWindow.Empty ? null : rearWindow.ToPart("RearWindow", Vector3.Zero);
                car.RearWing = wing.Empty ? null : wing.ToPart("RearWing", Vector3.Zero);
                var parts = new List<Part>();
                for (int w = 0; w < rims.Length; w++)
                {
                    var part = rims[w].ToPart("Wheel", hubs[w]);
                    part.IsWheel = true;
                    part.Front = hubs[w].Z > 0;
                    part.Side = Math.Abs(hubs[w].X) < 0.15f ? 0 : Math.Sign(hubs[w].X);
                    part.Tyre = tyres[w].ToPart("Tyre", hubs[w]);
                    part.Radius = TyreRadius(part.Tyre, hubs[w]);
                    parts.Add(part);
                }
                parts.Sort((a, b) =>
                {
                    if (a.Front != b.Front) return a.Front ? -1 : 1;
                    return a.Side.CompareTo(b.Side);
                });
                foreach (var p in parts)
                    p.Name = (p.Front ? "Wheel-F" : "Wheel-R") + (p.Side < 0 ? "L" : p.Side > 0 ? "R" : "C");
                car.Wheels = parts.ToArray();

                var paint = car.Paint;
                if (paint == null) car.Finish = "gloss";
                else if (!paint.HasClearcoat) car.Finish = "matte";
                else car.Finish = paint.Clearcoat >= 0.9f ? "gloss" : "satin";
                return car;
            }

            // ----------------------------------------------------- scene

            void Walk(int n, int par, Matrix4x4 parentWorld)
            {
                parent[n] = par;
                var local = LocalMatrix(nodes[n]);
                world[n] = local * parentWorld; // row-vector convention: v * local * parent
                var kids = MiniJson.A(nodes[n], "children");
                if (kids == null) return;
                foreach (var k in kids) Walk((int)(double)k, n, world[n]);
            }

            static Matrix4x4 LocalMatrix(object node)
            {
                var m = MiniJson.F(node, "matrix");
                if (m != null && m.Length == 16)
                {
                    // glTF stores column-major for column vectors; read in
                    // order, that is exactly System.Numerics' row-vector form.
                    return new Matrix4x4(
                        m[0], m[1], m[2], m[3],
                        m[4], m[5], m[6], m[7],
                        m[8], m[9], m[10], m[11],
                        m[12], m[13], m[14], m[15]);
                }
                var t = MiniJson.F(node, "translation") ?? new float[] { 0, 0, 0 };
                var r = MiniJson.F(node, "rotation") ?? new float[] { 0, 0, 0, 1 };
                var s = MiniJson.F(node, "scale") ?? new float[] { 1, 1, 1 };
                return Matrix4x4.CreateScale(s[0], s[1], s[2])
                       * Matrix4x4.CreateFromQuaternion(new Quaternion(r[0], r[1], r[2], r[3]))
                       * Matrix4x4.CreateTranslation(t[0], t[1], t[2]);
            }

            void MarkSubtree(int n, int w, int[] inWheel)
            {
                inWheel[n] = w;
                var kids = MiniJson.A(nodes[n], "children");
                if (kids == null) return;
                foreach (var k in kids) MarkSubtree((int)(double)k, w, inWheel);
            }

            bool MeshUsesRole(int n, MatRole role)
            {
                int mesh = MiniJson.I(nodes[n], "mesh", -1);
                if (mesh < 0) return false;
                var prims = MiniJson.A(meshes[mesh], "primitives");
                if (prims == null) return false;
                foreach (var p in prims)
                {
                    int m = MiniJson.I(p, "material", -1);
                    if (m >= 0 && m < car.Materials.Length && car.Materials[m].Role == role) return true;
                }
                return false;
            }

            Vector3? SubtreeCentre(int n)
            {
                Vector3 min = new Vector3(float.MaxValue), max = new Vector3(float.MinValue);
                bool any = false;
                void Visit(int k)
                {
                    int mesh = MiniJson.I(nodes[k], "mesh", -1);
                    if (mesh >= 0)
                        foreach (var p in MiniJson.A(meshes[mesh], "primitives") ?? new List<object>())
                        {
                            var g = ReadPrimitive(p, world[k]);
                            if (g == null) continue;
                            for (int v = 0; v < g.Pos.Length; v += 3)
                            {
                                var q = new Vector3(g.Pos[v], g.Pos[v + 1], g.Pos[v + 2]);
                                min = Vector3.Min(min, q);
                                max = Vector3.Max(max, q);
                                any = true;
                            }
                        }
                    var kids = MiniJson.A(nodes[k], "children");
                    if (kids != null) foreach (var c in kids) Visit((int)(double)c);
                }
                Visit(n);
                return any ? (min + max) * 0.5f : (Vector3?)null;
            }

            /// <summary>A tail lamp's position, or — for a light bar run
            /// across the whole tail, as the wedges carry — its two ends,
            /// which is where a glow belongs on a bar.</summary>
            static void AddTailLamps(float[] pos, List<Vector3> into)
            {
                Vector3 min = new Vector3(float.MaxValue), max = new Vector3(float.MinValue);
                for (int v = 0; v < pos.Length; v += 3)
                {
                    var p = new Vector3(pos[v], pos[v + 1], pos[v + 2]);
                    min = Vector3.Min(min, p);
                    max = Vector3.Max(max, p);
                }
                var c = (min + max) * 0.5f;
                if (min.X < -0.2f && max.X > 0.2f && max.X - min.X > 0.6f)
                {
                    into.Add(new Vector3(min.X + 0.15f, c.Y, c.Z));
                    into.Add(new Vector3(max.X - 0.15f, c.Y, c.Z));
                }
                else into.Add(c);
            }

            static float TyreRadius(Part tyre, Vector3 hub)
            {
                // Half the tyre's height about its own hub. The tyre is round
                // in the wheel's Y-Z plane (the length fit scales Y and Z
                // alike), so its Y extent is its diameter.
                float lo = float.MaxValue, hi = float.MinValue;
                foreach (var c in tyre.Chunks)
                    for (int v = 1; v < c.Positions.Length; v += 3)
                    {
                        lo = Math.Min(lo, c.Positions[v]);
                        hi = Math.Max(hi, c.Positions[v]);
                    }
                return hi > lo ? (hi - lo) * 0.5f : hub.Y;
            }

            void MarkFlag(int n, bool[] flags)
            {
                flags[n] = true;
                var kids = MiniJson.A(nodes[n], "children");
                if (kids == null) return;
                foreach (var k in kids) MarkFlag((int)(double)k, flags);
            }

            /// <summary>Send each triangle of <paramref name="g"/> to
            /// <paramref name="yes"/> or <paramref name="no"/> by where its
            /// centre is and which way its (averaged vertex) normal faces.</summary>
            static void Split(Geo g, Func<Vector3, Vector3, bool> test, Builder yes, Builder no)
            {
                var a = new List<int>();
                var b = new List<int>();
                for (int t = 0; t + 2 < g.Indices.Length; t += 3)
                {
                    int i0 = g.Indices[t], i1 = g.Indices[t + 1], i2 = g.Indices[t + 2];
                    var c = (P(g.Pos, i0) + P(g.Pos, i1) + P(g.Pos, i2)) / 3f;
                    var n = P(g.Nrm, i0) + P(g.Nrm, i1) + P(g.Nrm, i2);
                    float len = n.Length();
                    n = len > 1e-9f ? n / len : Vector3.UnitY;
                    (test(c, n) ? a : b).Add(t);
                }
                if (a.Count > 0) yes.Add(Subset(g, a), Vector3.Zero);
                if (b.Count > 0) no.Add(b.Count * 3 == g.Indices.Length ? g : Subset(g, b), Vector3.Zero);
            }

            static Vector3 P(float[] a, int i) => new Vector3(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);

            /// <summary>The triangles starting at the given index offsets, as a
            /// geometry of their own with only the vertices they use.</summary>
            static Geo Subset(Geo g, List<int> triStarts)
            {
                var map = new Dictionary<int, int>();
                var pos = new List<float>();
                var nrm = new List<float>();
                var uv = g.Uv != null ? new List<float>() : null;
                var idx = new int[triStarts.Count * 3];
                int k = 0;
                foreach (var t in triStarts)
                    for (int j = 0; j < 3; j++)
                    {
                        int old = g.Indices[t + j];
                        if (!map.TryGetValue(old, out int now))
                        {
                            now = map.Count;
                            map[old] = now;
                            pos.Add(g.Pos[old * 3]); pos.Add(g.Pos[old * 3 + 1]); pos.Add(g.Pos[old * 3 + 2]);
                            nrm.Add(g.Nrm[old * 3]); nrm.Add(g.Nrm[old * 3 + 1]); nrm.Add(g.Nrm[old * 3 + 2]);
                            if (uv != null) { uv.Add(g.Uv[old * 2]); uv.Add(g.Uv[old * 2 + 1]); }
                        }
                        idx[k++] = now;
                    }
                return new Geo { Material = g.Material, Pos = pos.ToArray(), Nrm = nrm.ToArray(), Uv = uv?.ToArray(), Indices = idx };
            }

            static Vector3 ToUnity(Vector3 v) => new Vector3(-v.X, v.Y, v.Z);

            // ------------------------------------------------- primitives

            Geo ReadPrimitive(object prim, Matrix4x4 m)
            {
                var attrs = MiniJson.O(prim, "attributes");
                int pa = MiniJson.I(attrs, "POSITION", -1);
                if (pa < 0) return null;
                int na = MiniJson.I(attrs, "NORMAL", -1);
                int ua = MiniJson.I(attrs, "TEXCOORD_0", -1);
                int ia = MiniJson.I(prim, "indices", -1);
                var pos = ReadFloats(pa, 3);
                int count = pos.Length / 3;
                var nrm = na >= 0 ? ReadFloats(na, 3) : null;
                var uv = ua >= 0 ? ReadFloats(ua, 2) : null;
                int[] idx;
                if (ia >= 0) idx = ReadIndices(ia);
                else
                {
                    idx = new int[count];
                    for (int i = 0; i < count; i++) idx[i] = i;
                }
                var g = new Geo { Material = MiniJson.I(prim, "material", -1) };
                if (g.Material >= car.Materials.Length) g.Material = -1;

                // Normals go through the inverse transpose, so the length
                // fit's non-uniform scale bends them the way it bends the
                // surface.
                Matrix4x4.Invert(m, out var inv);
                var nm = Matrix4x4.Transpose(inv);
                bool mirrored = m.GetDeterminant() < 0;
                g.Pos = new float[count * 3];
                g.Nrm = new float[count * 3];
                for (int v = 0; v < count; v++)
                {
                    var p = Vector3.Transform(new Vector3(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]), m);
                    g.Pos[v * 3] = -p.X;
                    g.Pos[v * 3 + 1] = p.Y;
                    g.Pos[v * 3 + 2] = p.Z;
                    Vector3 n = Vector3.UnitY;
                    if (nrm != null)
                    {
                        n = Vector3.TransformNormal(new Vector3(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]), nm);
                        float len = n.Length();
                        n = len > 1e-12f ? n / len : Vector3.UnitY;
                    }
                    g.Nrm[v * 3] = -n.X;
                    g.Nrm[v * 3 + 1] = n.Y;
                    g.Nrm[v * 3 + 2] = n.Z;
                }
                if (uv != null)
                {
                    g.Uv = new float[count * 2];
                    for (int v = 0; v < count; v++)
                    {
                        g.Uv[v * 2] = uv[v * 2];
                        g.Uv[v * 2 + 1] = 1f - uv[v * 2 + 1];
                    }
                }
                // Negating X mirrors the mesh, which reverses every
                // triangle's facing; a mirrored node matrix reverses it again.
                bool flip = !mirrored;
                int tri = idx.Length - idx.Length % 3;
                g.Indices = new int[tri];
                for (int t = 0; t < tri; t += 3)
                {
                    g.Indices[t] = idx[t];
                    g.Indices[t + 1] = flip ? idx[t + 2] : idx[t + 1];
                    g.Indices[t + 2] = flip ? idx[t + 1] : idx[t + 2];
                }
                if (g.Material >= 0 && car.Materials[g.Material].Role == MatRole.Decal)
                    for (int v = 0; v < count * 3; v++) g.Pos[v] += g.Nrm[v] * DecalLift;
                return g;
            }

            float[] ReadFloats(int accessor, int width)
            {
                var a = accessors[accessor];
                if (MiniJson.I(a, "componentType", 0) != 5126)
                    throw new FormatException($"{id}: accessor {accessor} is not float");
                if (MiniJson.Has(a, "sparse")) throw new FormatException($"{id}: sparse accessors are not supported");
                int count = MiniJson.I(a, "count", 0);
                var view = views[MiniJson.I(a, "bufferView", 0)];
                int stride = MiniJson.I(view, "byteStride", 0);
                if (stride == 0) stride = width * 4;
                int at = binOff + MiniJson.I(view, "byteOffset", 0) + MiniJson.I(a, "byteOffset", 0);
                var r = new float[count * width];
                for (int i = 0; i < count; i++)
                    for (int c = 0; c < width; c++)
                        r[i * width + c] = BitConverter.ToSingle(bin, at + i * stride + c * 4);
                return r;
            }

            int[] ReadIndices(int accessor)
            {
                var a = accessors[accessor];
                int type = MiniJson.I(a, "componentType", 0);
                int count = MiniJson.I(a, "count", 0);
                var view = views[MiniJson.I(a, "bufferView", 0)];
                int at = binOff + MiniJson.I(view, "byteOffset", 0) + MiniJson.I(a, "byteOffset", 0);
                var r = new int[count];
                switch (type)
                {
                    case 5121: for (int i = 0; i < count; i++) r[i] = bin[at + i]; break;
                    case 5123: for (int i = 0; i < count; i++) r[i] = BitConverter.ToUInt16(bin, at + i * 2); break;
                    case 5125: for (int i = 0; i < count; i++) r[i] = (int)BitConverter.ToUInt32(bin, at + i * 4); break;
                    default: throw new FormatException($"{id}: index type {type}");
                }
                return r;
            }

            // -------------------------------------------------- materials

            void ReadMaterials()
            {
                var list = new CarMat[mats.Count];
                for (int i = 0; i < mats.Count; i++)
                {
                    var src = mats[i];
                    var m = new CarMat { Index = i, Name = MiniJson.S(src, "name", "") };
                    var pbr = MiniJson.O(src, "pbrMetallicRoughness");
                    m.BaseColor = MiniJson.F(pbr, "baseColorFactor") ?? new float[] { 1, 1, 1, 1 };
                    m.Metallic = (float)MiniJson.N(pbr, "metallicFactor", 1);
                    m.Roughness = (float)MiniJson.N(pbr, "roughnessFactor", 1);
                    m.Emissive = MiniJson.F(src, "emissiveFactor") ?? new float[] { 0, 0, 0 };
                    m.Blend = MiniJson.S(src, "alphaMode", "OPAQUE") == "BLEND";
                    m.DoubleSided = Bool(src, "doubleSided");
                    var ext = MiniJson.O(src, "extensions");
                    var strength = MiniJson.O(ext, "KHR_materials_emissive_strength");
                    m.EmissiveStrength = strength != null ? (float)MiniJson.N(strength, "emissiveStrength", 1) : 1f;
                    var coat = MiniJson.O(ext, "KHR_materials_clearcoat");
                    if (coat != null)
                    {
                        m.HasClearcoat = true;
                        m.Clearcoat = (float)MiniJson.N(coat, "clearcoatFactor", 0);
                        m.ClearcoatRoughness = (float)MiniJson.N(coat, "clearcoatRoughnessFactor", 0);
                    }
                    var extras = MiniJson.O(src, "extras");
                    m.NightFloor = (float)MiniJson.N(extras, "nightFloor", -1);
                    m.BaseEnvIntensity = (float)MiniJson.N(extras, "baseEnvIntensity", 0);
                    m.BaseTex = Tex(MiniJson.O(pbr, "baseColorTexture"));
                    m.MetalRoughTex = Tex(MiniJson.O(pbr, "metallicRoughnessTexture"));
                    m.NormalTex = Tex(MiniJson.O(src, "normalTexture"));
                    if (m.NormalTex != null) m.NormalTex.Strength = (float)MiniJson.N(MiniJson.O(src, "normalTexture"), "scale", 1);
                    m.EmissiveTex = Tex(MiniJson.O(src, "emissiveTexture"));
                    m.Role = Classify(m);
                    list[i] = m;
                }
                car.Materials = list;
            }

            static bool Bool(object o, string key) =>
                o is Dictionary<string, object> d && d.TryGetValue(key, out var v) && v is bool b && b;

            static TexRef Tex(Dictionary<string, object> info)
            {
                if (info == null) return null;
                var t = new TexRef { Texture = MiniJson.I(info, "index", -1) };
                if (t.Texture < 0) return null;
                var tt = MiniJson.O(MiniJson.O(info, "extensions"), "KHR_texture_transform");
                float su = 1, sv = 1, ou = 0, ov = 0;
                if (tt != null)
                {
                    var s = MiniJson.F(tt, "scale");
                    var o = MiniJson.F(tt, "offset");
                    if (s != null && s.Length == 2) { su = s[0]; sv = s[1]; }
                    if (o != null && o.Length == 2) { ou = o[0]; ov = o[1]; }
                }
                // glTF samples at uv*s + o with V down the image; the reader
                // stores v' = 1 - v, so the same texel is reached in Unity at
                // v'*s + (1 - s - o).
                t.ScaleU = su;
                t.ScaleV = sv;
                t.OffsetU = ou;
                t.OffsetV = 1f - sv - ov;
                return t;
            }

            static MatRole Classify(CarMat m)
            {
                switch (m.Name)
                {
                    case "paint": return MatRole.Paint;
                    case "glass": return MatRole.Glass;
                    case "sun-band": return MatRole.GlassTint;
                    case "decal": return MatRole.Decal;
                    case "plate": return MatRole.Plate;
                    case "headlamp-core":
                    case "headlamp-lens": return MatRole.HeadLamp;
                    case "taillamp-lens": return MatRole.TailLens;
                    case "taillamp-core": return MatRole.TailCore;
                    case "indicator":
                    case "reverse-lamp": return MatRole.Lamp;
                    case "reflector":
                    case "reflector-amber":
                    case "hot-stripe": return MatRole.NightFloor;
                    case "disc": return MatRole.Disc;
                    case "chrome":
                    case "rim":
                    case "rim-bronze":
                    case "rim-black":
                    case "exhaust-tip-titanium": return MatRole.Metal;
                    case "tire": return MatRole.Tyre;
                    case "exhaust-bore": return MatRole.ExhaustBore;
                    case "": return MatRole.Driver;
                }
                return m.NightFloor >= 0 ? MatRole.NightFloor : MatRole.Default;
            }

            void ReadTextures()
            {
                var list = new CarTex[texs.Count];
                for (int i = 0; i < texs.Count; i++)
                {
                    var t = texs[i];
                    var tex = new CarTex { Index = i };
                    int src = MiniJson.I(t, "source", -1);
                    if (src >= 0 && src < images.Count)
                    {
                        var img = images[src];
                        tex.Mime = MiniJson.S(img, "mimeType", "image/png");
                        int bv = MiniJson.I(img, "bufferView", -1);
                        if (bv < 0) throw new FormatException($"{id}: image {src} is not embedded");
                        var view = views[bv];
                        int len = MiniJson.I(view, "byteLength", 0);
                        tex.Image = new byte[len];
                        Buffer.BlockCopy(bin, binOff + MiniJson.I(view, "byteOffset", 0), tex.Image, 0, len);
                    }
                    int smp = MiniJson.I(t, "sampler", -1);
                    if (smp >= 0 && smp < samplers.Count)
                    {
                        var s = samplers[smp];
                        tex.WrapS = MiniJson.I(s, "wrapS", 10497);
                        tex.WrapT = MiniJson.I(s, "wrapT", 10497);
                        tex.MinFilter = MiniJson.I(s, "minFilter", 9987);
                        tex.MagFilter = MiniJson.I(s, "magFilter", 9729);
                    }
                    list[i] = tex;
                }
                // Data maps are linear; everything else is colour (sRGB).
                foreach (var m in car.Materials)
                {
                    if (m.NormalTex != null && m.NormalTex.Texture < list.Length) list[m.NormalTex.Texture].Linear = true;
                    if (m.MetalRoughTex != null && m.MetalRoughTex.Texture < list.Length) list[m.MetalRoughTex.Texture].Linear = true;
                }
                car.Textures = list;
            }
        }

        /// <summary>Accumulates primitives into one chunk per material,
        /// relative to the part's pivot.</summary>
        sealed class Builder
        {
            sealed class Acc
            {
                public readonly List<float> Pos = new List<float>(), Nrm = new List<float>(), Uv = new List<float>();
                public readonly List<int> Idx = new List<int>();
                public bool AnyUv;
            }

            readonly SortedDictionary<int, Acc> byMat = new SortedDictionary<int, Acc>();

            public bool Empty
            {
                get { foreach (var kv in byMat) if (kv.Value.Idx.Count > 0) return false; return true; }
            }

            public void Add(Geo g, Vector3 pivot)
            {
                if (!byMat.TryGetValue(g.Material, out var a)) byMat[g.Material] = a = new Acc();
                int baseVertex = a.Pos.Count / 3;
                int count = g.Pos.Length / 3;
                // A chunk that had no UVs so far gets zeros for them, so the
                // arrays stay parallel once one primitive brings some.
                if (g.Uv != null && !a.AnyUv)
                {
                    a.AnyUv = true;
                    for (int v = 0; v < baseVertex; v++) { a.Uv.Add(0); a.Uv.Add(0); }
                }
                for (int v = 0; v < count; v++)
                {
                    a.Pos.Add(g.Pos[v * 3] - pivot.X);
                    a.Pos.Add(g.Pos[v * 3 + 1] - pivot.Y);
                    a.Pos.Add(g.Pos[v * 3 + 2] - pivot.Z);
                    a.Nrm.Add(g.Nrm[v * 3]);
                    a.Nrm.Add(g.Nrm[v * 3 + 1]);
                    a.Nrm.Add(g.Nrm[v * 3 + 2]);
                    if (a.AnyUv)
                    {
                        a.Uv.Add(g.Uv != null ? g.Uv[v * 2] : 0f);
                        a.Uv.Add(g.Uv != null ? g.Uv[v * 2 + 1] : 0f);
                    }
                }
                foreach (var i in g.Indices) a.Idx.Add(baseVertex + i);
            }

            public Part ToPart(string name, Vector3 pivot)
            {
                var chunks = new List<Chunk>();
                foreach (var kv in byMat)
                {
                    if (kv.Value.Idx.Count == 0) continue;
                    chunks.Add(new Chunk
                    {
                        Material = kv.Key,
                        Positions = kv.Value.Pos.ToArray(),
                        Normals = kv.Value.Nrm.ToArray(),
                        Uvs = kv.Value.AnyUv ? kv.Value.Uv.ToArray() : null,
                        Indices = kv.Value.Idx.ToArray(),
                    });
                }
                return new Part { Name = name, Pivot = pivot, Chunks = chunks.ToArray() };
            }
        }
    }
}
