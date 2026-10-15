// tools/unity/carcheck: the Unity port's GLB car reader, run against the
// game's own cars outside Unity.
//
//   npm run cars:export          # press/renders/glb/<id>.glb (needs npm run dev)
//   npm run test:unity-cars      # this
//
// Reads every car with CarAssetReader exactly as the Unity port does and
// checks what it made against facts read independently out of each
// file's JSON: triangles, size, wheels on their hubs, tyre radii, lamps,
// the paint's finish, the emissive strengths glTFast would have dropped.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Numerics;
using NightRacer.Cars;

static partial class Program
{
    static int failures;
    static void Check(bool ok, string what)
    {
        if (!ok) { failures++; Console.WriteLine("  FAIL " + what); }
    }

    static int Main(string[] args)
    {
        string repo = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../.."));
        if (!Directory.Exists(Path.Combine(repo, "press"))) repo = Directory.GetCurrentDirectory();
        string dir = args.Length > 0 ? args[0] : Path.Combine(repo, "press/renders/glb");
        var files = Directory.Exists(dir) ? Directory.GetFiles(dir, "*.glb").OrderBy(f => f).ToArray() : new string[0];
        if (files.Length == 0)
        {
            Console.WriteLine($"no GLBs in {dir} — run `npm run cars:export` first");
            return 2;
        }
        Console.WriteLine($"{files.Length} cars from {dir}\n");
        Console.WriteLine("id                 tris     L x W x H (m)        wheels  radius  hubs z F/R     head tail finish  parts");
        foreach (var f in files)
        {
            string id = Path.GetFileNameWithoutExtension(f);
            var bytes = File.ReadAllBytes(f);
            var sw = System.Diagnostics.Stopwatch.StartNew();
            CarAsset car;
            try { car = CarAssetReader.Read(bytes, id); }
            catch (Exception e) { failures++; Console.WriteLine($"{id}: FAIL {e.Message}"); continue; }
            long ms = sw.ElapsedMilliseconds;
            var json = Raw.Json(bytes);

            var size = car.Max - car.Min;
            int chunkTris = car.Panels.Sum(p => p.TriangleCount) + car.Wheels.Sum(w => w.TriangleCount + w.Tyre.TriangleCount);
            Console.WriteLine($"{id,-18} {car.Triangles,7:N0}  {size.Z:F2} x {size.X:F3} x {size.Y:F3}   {car.Wheels.Length}     " +
                $"{string.Join("/", car.Wheels.Select(w => w.Radius.ToString("F3")).Distinct())}  " +
                $"{string.Join("/", car.Wheels.Select(w => w.Pivot.Z.ToString("F2")).Distinct())}   {car.HeadLamps.Length,3} {car.TailLamps.Length,3}  {car.Finish,-6} " +
                $"{car.Body.Chunks.Length}+{string.Join(",", car.Wheels.Select(w => w.Chunks.Length))}  {ms} ms");
            Console.WriteLine($"{"",18} screen foot z {car.WindscreenZ:F2} · hood {Area(car.Hood):F2} m² at z {CentreOf(car.Hood).Z:F2} y {CentreOf(car.Hood).Y:F2} · " +
                $"rear window {Area(car.RearWindow):F2} m² at z {CentreOf(car.RearWindow).Z:F2} · " +
                $"wing {(car.RearWing == null ? "-" : car.RearWing.TriangleCount.ToString("N0") + " tris")} · " +
                $"tyre {car.Wheels[0].Tyre.TriangleCount:N0} tris, mirror {(TyresMirror(car) ? "yes" : "no")}");

            // 1. Every triangle in the file is in exactly one chunk.
            Check(chunkTris == car.Triangles, $"{id}: chunks hold {chunkTris} triangles, the file {car.Triangles}");
            Check(car.Triangles == Raw.Triangles(json), $"{id}: read {car.Triangles} triangles, the file has {Raw.Triangles(json)}");

            // 2. Size and frame: ground at 0, nose +Z, length = the card.
            Check(Math.Abs(car.Min.Y) < 0.003f, $"{id}: lowest point at y {car.Min.Y:F4}, not on the ground");
            var cars = Raw.Cars(repo);
            if (cars.TryGetValue(id, out var lengthM))
                Check(Math.Abs(size.Z - lengthM) < 0.01f, $"{id}: {size.Z:F3} m long against the card's {lengthM}");
            Check(car.HeadLamps.Length >= 2 && car.HeadLamps.All(h => h.Z > car.Max.Z - 0.6f), $"{id}: headlamps not at the nose");
            Check(car.TailLamps.Length >= 2 && car.TailLamps.All(t => t.Z < car.Min.Z + 0.8f), $"{id}: tail lamps not at the tail");

            // 3. Wheels: as many as the file's tyres, on their hubs, round.
            int tyres = Raw.TyreNodes(json);
            Check(car.Wheels.Length == tyres, $"{id}: {car.Wheels.Length} wheels against {tyres} tyre groups");
            Check(car.Wheels.Length == (id == "black-demon" ? 3 : 4), $"{id}: {car.Wheels.Length} wheels");
            foreach (var w in car.Wheels)
            {
                Check(Math.Abs(w.Radius - w.Pivot.Y) < 0.012f, $"{id} {w.Name}: tyre radius {w.Radius:F3} but the hub is {w.Pivot.Y:F3} up");
                // The tyre is its own part, on the same hub, only tyre.
                Check(w.Tyre != null && w.Tyre.Chunks.Length == 1 && car.Materials[w.Tyre.Chunks[0].Material].Role == MatRole.Tyre,
                    $"{id} {w.Name}: tyre part is not exactly the tyre");
                Check(w.Chunks.All(c => car.Materials[c.Material].Role != MatRole.Tyre), $"{id} {w.Name}: tyre left in the rim");
                // The tyre is round about its own hub: its Y and Z extents match.
                var tyre = w.Tyre.Chunks[0];
                float ylo = float.MaxValue, yhi = float.MinValue, zlo = float.MaxValue, zhi = float.MinValue;
                for (int v = 0; v < tyre.Positions.Length; v += 3)
                {
                    ylo = Math.Min(ylo, tyre.Positions[v + 1]); yhi = Math.Max(yhi, tyre.Positions[v + 1]);
                    zlo = Math.Min(zlo, tyre.Positions[v + 2]); zhi = Math.Max(zhi, tyre.Positions[v + 2]);
                }
                Check(Math.Abs((yhi - ylo) - (zhi - zlo)) < 0.01f, $"{id} {w.Name}: tyre not round about its hub ({yhi - ylo:F3} x {zhi - zlo:F3})");
                Check(Math.Abs(yhi + ylo) < 0.01f && Math.Abs(zhi + zlo) < 0.01f, $"{id} {w.Name}: pivot is not the tyre's centre");
            }
            var names = car.Wheels.Select(w => w.Name).ToArray();
            Check(id == "black-demon" ? names.SequenceEqual(new[] { "Wheel-FC", "Wheel-RL", "Wheel-RR" })
                                      : names.SequenceEqual(new[] { "Wheel-FL", "Wheel-FR", "Wheel-RL", "Wheel-RR" }),
                $"{id}: wheel order {string.Join(",", names)}");
            // Left is -X in Unity (the driver's side: glTF +X).
            foreach (var w in car.Wheels.Where(w => w.Side != 0))
                Check(Math.Sign(w.Pivot.X) == w.Side, $"{id} {w.Name}: side {w.Side} at x {w.Pivot.X:F3}");

            // 3b. The panels made into separate assets: a hood on every car,
            // forward, on top, a plausible size; a rear window on every car,
            // rearward; the rear wing exactly where the file has a `wing`.
            Check(car.Hood != null && Area(car.Hood) > 0.35f && Area(car.Hood) < 3.5f, $"{id}: hood area {Area(car.Hood):F2} m²");
            if (car.Hood != null)
            {
                var hc = CentreOf(car.Hood);
                Check(hc.Z > 0.3f && hc.Y > car.Max.Y * 0.33f && Math.Abs(hc.X) < 0.1f, $"{id}: hood centred at {hc}");
                Check(car.Hood.Chunks.All(c => car.Materials[c.Material].Role == MatRole.Paint), $"{id}: hood has non-paint");
            }
            Check(car.RearWindow != null && Area(car.RearWindow) > 0.12f, $"{id}: rear window area {Area(car.RearWindow):F2} m²");
            if (car.RearWindow != null)
            {
                var rc = CentreOf(car.RearWindow);
                Check(rc.Z < 0f && Math.Abs(rc.X) < 0.15f, $"{id}: rear window centred at {rc}");
            }
            Check((car.RearWing != null) == Raw.HasNode(json, "wing"), $"{id}: rear wing part {(car.RearWing != null)} but wing node {Raw.HasNode(json, "wing")}");
            Check(car.Body.Chunks.Any(c => car.Materials[c.Material].Role == MatRole.Paint), $"{id}: the body kept no paint");

            // 4. The driver sits on the left (-X in Unity): the steering wheel
            // and seat, unnamed materials, average left of centre.
            var driver = car.Body.Chunks.Where(c => car.Materials[c.Material].Role == MatRole.Driver).ToArray();
            if (driver.Length > 0)
            {
                double sx = 0; int n = 0;
                foreach (var c in driver) for (int v = 0; v < c.Positions.Length; v += 3) { sx += c.Positions[v]; n++; }
                Check(sx / n < -0.1, $"{id}: driver at x {sx / n:F2}, not in the left seat");
            }

            // 5. Materials: the paint, its finish, emissive strengths kept.
            var paint = car.Paint;
            Check(paint != null, $"{id}: no paint");
            if (paint != null)
            {
                string want = Raw.Finish(repo, id);
                if (want != null) Check(car.Finish == want, $"{id}: finish {car.Finish}, cars.json says {want}");
            }
            // The paint law (PaintLaw.cs, used to repaint traffic and rivals)
            // must give back the metalness the web baked into each factory
            // paint, from the catalogue colour and the finish.
            int? hex = Raw.Hex(repo, id);
            if (paint != null && hex.HasValue)
            {
                float law = PaintLaw.Metalness(hex.Value) * PaintLaw.FinishMetalScale(car.Finish);
                Check(Math.Abs(law - paint.Metallic) < 0.006f, $"{id}: paint law gives {law:F3}, the GLB {paint.Metallic:F3}");
            }
            var core = car.Materials.FirstOrDefault(m => m.Name == "headlamp-core");
            Check(core != null && Math.Abs(core.EmissiveStrength - 4.2f) < 0.01f, $"{id}: headlamp-core strength {core?.EmissiveStrength}");
            foreach (var m in car.Materials.Where(m => m.Name == "plate" || m.Name == "decal"))
                Check(m.EmissiveStrength == 0 && m.NightFloor > 0, $"{id}: {m.Name} strength {m.EmissiveStrength} floor {m.NightFloor}");
            var tyreMat = car.Materials.First(m => m.Role == MatRole.Tyre);
            Check(tyreMat.BaseTex != null && Math.Abs(tyreMat.BaseTex.ScaleU - 18) < 1e-3 && tyreMat.NormalTex != null,
                $"{id}: tyre maps/transform missing");
            foreach (var t in car.Textures)
                Check(t.Image != null && t.Image.Length > 8 && t.Image[1] == (byte)'P' && t.Image[2] == (byte)'N', $"{id}: texture {t.Index} is not a PNG");

            // 6. Normals are unit length and UVs present where the file had them.
            foreach (var c in car.Panels.SelectMany(p => p.Chunks).Concat(car.Wheels.SelectMany(w => w.Chunks.Concat(w.Tyre.Chunks))))
            {
                Check(c.Normals.Length == c.Positions.Length, $"{id}: chunk {c.Material} normals");
                Check(c.Uvs == null || c.Uvs.Length / 2 == c.VertexCount, $"{id}: chunk {c.Material} uvs");
                Check(c.Indices.All(i => i >= 0 && i < c.VertexCount), $"{id}: chunk {c.Material} index out of range");
                for (int v = 0; v < c.Normals.Length; v += 3 * 97)
                {
                    float l = new Vector3(c.Normals[v], c.Normals[v + 1], c.Normals[v + 2]).Length();
                    if (Math.Abs(l - 1) > 1e-3f) { Check(false, $"{id}: normal length {l}"); break; }
                }
            }

            // 7. Facing: after the X mirror and the winding swap, the body's
            // outer skin still faces out. Sum over the paint's triangles of
            // (geometric normal . vertex normal) must be positive.
            var paintChunk = car.Body.Chunks.FirstOrDefault(c => car.Materials[c.Material].Role == MatRole.Paint);
            if (paintChunk != null)
            {
                double agree = 0;
                for (int t = 0; t < paintChunk.Indices.Length; t += 3)
                {
                    Vector3 P(int i) => new Vector3(paintChunk.Positions[i * 3], paintChunk.Positions[i * 3 + 1], paintChunk.Positions[i * 3 + 2]);
                    Vector3 N(int i) => new Vector3(paintChunk.Normals[i * 3], paintChunk.Normals[i * 3 + 1], paintChunk.Normals[i * 3 + 2]);
                    int a = paintChunk.Indices[t], b = paintChunk.Indices[t + 1], cc = paintChunk.Indices[t + 2];
                    // Unity is left-handed: a clockwise triangle (seen from
                    // its front) has normal (b-a) x (c-a) toward the viewer.
                    var g = Vector3.Cross(P(b) - P(a), P(cc) - P(a));
                    agree += Vector3.Dot(g, N(a) + N(b) + N(cc));
                }
                Check(agree > 0, $"{id}: paint winding faces inward ({agree:F3})");
            }
        }
        Console.WriteLine(failures == 0 ? "\nall cars read cleanly." : $"\n{failures} problem(s).");
        return failures == 0 ? 0 : 1;
    }
}

static partial class Program
{
    static Vector3 CentreOf(Part p)
    {
        if (p == null) return new Vector3(float.NaN);
        Vector3 lo = new Vector3(float.MaxValue), hi = new Vector3(float.MinValue);
        foreach (var c in p.Chunks)
            for (int v = 0; v < c.Positions.Length; v += 3)
            {
                var q = new Vector3(c.Positions[v], c.Positions[v + 1], c.Positions[v + 2]) + p.Pivot;
                lo = Vector3.Min(lo, q); hi = Vector3.Max(hi, q);
            }
        return (lo + hi) * 0.5f;
    }

    static float Area(Part p)
    {
        if (p == null) return 0f;
        double a = 0;
        foreach (var c in p.Chunks)
            for (int t = 0; t < c.Indices.Length; t += 3)
            {
                Vector3 P(int i) => new Vector3(c.Positions[i * 3], c.Positions[i * 3 + 1], c.Positions[i * 3 + 2]);
                a += Vector3.Cross(P(c.Indices[t + 1]) - P(c.Indices[t]), P(c.Indices[t + 2]) - P(c.Indices[t])).Length() * 0.5;
            }
        return (float)a;
    }

    /// <summary>Is the right-hand tyre the left one mirrored? Then one tyre
    /// asset serves both sides (scale x -1 on the right).</summary>
    static bool TyresMirror(CarAsset car)
    {
        var l = car.Wheels.FirstOrDefault(w => w.Side < 0);
        var r = car.Wheels.FirstOrDefault(w => w.Side > 0 && w.Front == l?.Front);
        if (l == null || r == null) return false;
        var a = l.Tyre.Chunks[0].Positions;
        var b = r.Tyre.Chunks[0].Positions;
        if (a.Length != b.Length) return false;
        var sa = new List<(int, int, int)>();
        var sb = new List<(int, int, int)>();
        for (int v = 0; v < a.Length; v += 3)
        {
            sa.Add(((int)Math.Round(-a[v] * 1000), (int)Math.Round(a[v + 1] * 1000), (int)Math.Round(a[v + 2] * 1000)));
            sb.Add(((int)Math.Round(b[v] * 1000), (int)Math.Round(b[v + 1] * 1000), (int)Math.Round(b[v + 2] * 1000)));
        }
        sa.Sort(); sb.Sort();
        int off = 0;
        for (int i = 0; i < sa.Count; i++)
            if (Math.Abs(sa[i].Item1 - sb[i].Item1) > 2 || Math.Abs(sa[i].Item2 - sb[i].Item2) > 2 || Math.Abs(sa[i].Item3 - sb[i].Item3) > 2) off++;
        return off < sa.Count / 200;
    }
}

/// <summary>Facts read straight out of the file's JSON, independently of
/// CarAssetReader, to check it against.</summary>
static class Raw
{
    public static Dictionary<string, object> Json(byte[] glb)
    {
        int len = BitConverter.ToInt32(glb, 12);
        return (Dictionary<string, object>)MiniJson.Parse(System.Text.Encoding.UTF8.GetString(glb, 20, len));
    }

    public static int Triangles(Dictionary<string, object> j)
    {
        var acc = MiniJson.A(j, "accessors");
        var meshes = MiniJson.A(j, "meshes");
        int t = 0;
        foreach (var n in MiniJson.A(j, "nodes"))
        {
            int m = MiniJson.I(n, "mesh", -1);
            if (m < 0) continue;
            foreach (var p in MiniJson.A(meshes[m], "primitives"))
            {
                if (MiniJson.I(p, "mode", 4) != 4) continue;
                int idx = MiniJson.I(p, "indices", -1);
                int pos = MiniJson.I(MiniJson.O(p, "attributes"), "POSITION", -1);
                t += (idx >= 0 ? MiniJson.I(acc[idx], "count", 0) : MiniJson.I(acc[pos], "count", 0)) / 3;
            }
        }
        return t;
    }

    public static bool HasNode(Dictionary<string, object> j, string name)
    {
        foreach (var n in MiniJson.A(j, "nodes")) if (MiniJson.S(n, "name", "") == name) return true;
        return false;
    }

    public static int TyreNodes(Dictionary<string, object> j)
    {
        var mats = MiniJson.A(j, "materials");
        var meshes = MiniJson.A(j, "meshes");
        var nodes = MiniJson.A(j, "nodes");
        int c = 0;
        foreach (var n in nodes)
        {
            var kids = MiniJson.A(n, "children");
            if (kids == null) continue;
            bool tyre = false;
            foreach (var k in kids)
            {
                int m = MiniJson.I(nodes[(int)(double)k], "mesh", -1);
                if (m < 0) continue;
                int mi = MiniJson.I(MiniJson.A(meshes[m], "primitives")[0], "material", -1);
                if (mi >= 0 && MiniJson.S(mats[mi], "name", "") == "tire") tyre = true;
            }
            if (tyre) c++;
        }
        return c;
    }

    static Dictionary<string, (float len, string finish)> cards;
    static void LoadCards(string repo)
    {
        if (cards != null) return;
        cards = new Dictionary<string, (float, string)>();
        var p = Path.Combine(repo, "press/renders/cars.json");
        if (!File.Exists(p)) return;
        var j = MiniJson.Parse(File.ReadAllText(p));
        var list = j as List<object> ?? MiniJson.A(j, "cars");
        foreach (var c in list)
            cards[MiniJson.S(c, "id", "")] = ((float)MiniJson.N(c, "lengthM", 0), MiniJson.S(c, "finish", null));
    }

    public static Dictionary<string, float> Cars(string repo)
    {
        LoadCards(repo);
        return cards.ToDictionary(kv => kv.Key, kv => kv.Value.len);
    }

    /// <summary>The catalogue colour as an sRGB hex.</summary>
    public static int? Hex(string repo, string id)
    {
        var p = Path.Combine(repo, "press/renders/cars.json");
        if (!File.Exists(p)) return null;
        var j = MiniJson.Parse(File.ReadAllText(p));
        var list = j as List<object> ?? MiniJson.A(j, "cars");
        foreach (var c in list)
        {
            if (MiniJson.S(c, "id", "") != id) continue;
            if (c is Dictionary<string, object> d && d.TryGetValue("color", out var v))
            {
                if (v is double x) return (int)x;
                if (v is string s) return Convert.ToInt32(s.TrimStart('#').Replace("0x", ""), 16);
            }
        }
        return null;
    }

    public static string Finish(string repo, string id)
    {
        LoadCards(repo);
        return cards.TryGetValue(id, out var c) ? c.finish : null;
    }
}
