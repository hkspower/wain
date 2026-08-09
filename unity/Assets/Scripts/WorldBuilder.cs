using System.Collections.Generic;
using UnityEngine;

// Night-time Gulf Road: road ribbon, guardrails, sodium lamps, corniche
// palms, the Kuwait Towers and friends — all procedural, no assets.
public static class WorldBuilder
{
    public static void Build(TrackSpline track)
    {
        var root = new GameObject("World");

        // Night atmosphere
        RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
        RenderSettings.ambientLight = new Color(0.10f, 0.12f, 0.18f);
        RenderSettings.fog = true;
        RenderSettings.fogMode = FogMode.ExponentialSquared;
        RenderSettings.fogDensity = 0.0016f;
        RenderSettings.fogColor = new Color(0.02f, 0.03f, 0.06f);

        var moon = new GameObject("Moon").AddComponent<Light>();
        moon.type = LightType.Directional;
        moon.color = new Color(0.75f, 0.82f, 1f);
        moon.intensity = 0.6f;
        moon.shadows = LightShadows.Soft;
        moon.transform.rotation = Quaternion.LookRotation(new Vector3(0.5f, -0.8f, -0.33f));
        moon.transform.SetParent(root.transform);

        // Ground + sea
        Plane(root, "Ground", new Vector3(2700, -0.08f, -1400), new Vector2(8000, 8000),
            CarFactory.Standard(new Color(0.14f, 0.11f, 0.07f), 0f, 0.1f));
        Plane(root, "Sea", new Vector3(-880, -0.04f, -1400), new Vector2(3300, 5800),
            CarFactory.Standard(new Color(0.04f, 0.13f, 0.21f), 0.4f, 0.9f));

        // Road ribbon + edge lines (single combined meshes)
        Ribbon(root, "Road", track, -TrackSpline.RoadHalfWidth, TrackSpline.RoadHalfWidth, 0.02f,
            CarFactory.Standard(new Color(0.11f, 0.11f, 0.13f), 0.2f, 0.55f));
        var lineMat = CarFactory.Emissive(Color.white, 0.35f);
        Ribbon(root, "EdgeL", track, -(TrackSpline.RoadHalfWidth - 0.35f), -(TrackSpline.RoadHalfWidth - 0.15f), 0.03f, lineMat);
        Ribbon(root, "EdgeR", track, TrackSpline.RoadHalfWidth - 0.35f, TrackSpline.RoadHalfWidth - 0.15f, 0.03f, lineMat);

        // Guardrails
        var railMat = CarFactory.Standard(new Color(0.6f, 0.63f, 0.67f), 0.8f, 0.7f);
        Wall(root, "RailL", track, -(TrackSpline.RoadHalfWidth + 0.6f), 0.3f, 0.95f, railMat);
        Wall(root, "RailR", track, TrackSpline.RoadHalfWidth + 0.6f, 0.3f, 0.95f, railMat);

        // Street lamps: emissive heads every 42 m (combined mesh) + real
        // point lights every 5th lamp to keep the light count sane
        var lampMat = CarFactory.Emissive(new Color(1f, 0.72f, 0.4f), 3f);
        var poleMat = CarFactory.Standard(new Color(0.22f, 0.24f, 0.27f), 0.5f, 0.4f);
        var poles = new List<CombineInstance>();
        var heads = new List<CombineInstance>();
        var cube = CubeMesh();
        int lampIndex = 0;
        for (float s = 0; s < track.Length; s += 42f, lampIndex++)
        {
            float side = lampIndex % 2 == 0 ? 1f : -1f;
            Vector3 basePos = track.Pose(s, side * (TrackSpline.RoadHalfWidth + 1.6f));
            poles.Add(Ci(cube, basePos + new Vector3(0, 4.2f, 0), new Vector3(0.25f, 8.4f, 0.25f)));
            Vector3 headPos = track.Pose(s, side * (TrackSpline.RoadHalfWidth + 0.6f)) + new Vector3(0, 8.3f, 0);
            heads.Add(Ci(cube, headPos, new Vector3(0.7f, 0.5f, 0.7f)));
            if (lampIndex % 5 == 0)
            {
                var l = new GameObject("LampLight").AddComponent<Light>();
                l.type = LightType.Point;
                l.color = new Color(1f, 0.7f, 0.38f);
                l.intensity = 1.6f;
                l.range = 26f;
                l.transform.position = headPos - new Vector3(0, 1.5f, 0);
                l.transform.SetParent(root.transform);
            }
        }
        Combined(root, "LampPoles", poles, poleMat);
        Combined(root, "LampHeads", heads, lampMat);

        // Corniche palms (coastal 46% of the lap)
        var trunkMat = CarFactory.Standard(new Color(0.35f, 0.26f, 0.15f), 0f, 0.2f);
        var frondMat = CarFactory.Standard(new Color(0.18f, 0.37f, 0.19f), 0f, 0.2f);
        var trunks = new List<CombineInstance>();
        var fronds = new List<CombineInstance>();
        for (float s = 0; s < track.Length * 0.46f; s += 26f)
        {
            Vector3 p = track.Pose(s, -(TrackSpline.RoadHalfWidth + 2.6f));
            trunks.Add(Ci(cube, p + new Vector3(0, 3, 0), new Vector3(0.35f, 6f, 0.35f)));
            for (int f = 0; f < 6; f++)
            {
                var rot = Quaternion.Euler(55f, f * 60f + (s % 40f), 0);
                fronds.Add(Ci(cube, p + new Vector3(0, 6.1f, 0) + rot * new Vector3(0, 0, 1f),
                    new Vector3(0.2f, 0.05f, 2f), rot));
            }
        }
        Combined(root, "PalmTrunks", trunks, trunkMat);
        Combined(root, "PalmFronds", fronds, frondMat);

        // Landmarks
        KuwaitTowers(root, track.Pose(track.Length * 0.016f, -52f));
        WaterTowers(root, track.Pose(track.Length * 0.62f, 65f));
        Mosque(root, track.Pose(track.Length * 0.02f, 55f));

        // City blocks
        var blockMat = CarFactory.Standard(new Color(0.16f, 0.17f, 0.2f), 0.1f, 0.3f);
        var blocks = new List<CombineInstance>();
        var rng = new System.Random(7);
        for (int i = 0; i < 160; i++)
        {
            float s = (float)rng.NextDouble() * track.Length;
            float u = s / track.Length;
            float side = u < 0.46f ? 1f : (rng.NextDouble() < 0.5 ? 1f : -1f); // never in the sea
            float dist = 32f + (float)rng.NextDouble() * 110f;
            float h = 10f + (float)(rng.NextDouble() * rng.NextDouble()) * 55f;
            Vector3 p = track.Pose(s, side * dist);
            blocks.Add(Ci(cube, p + new Vector3(0, h / 2f, 0),
                new Vector3(14f + (float)rng.NextDouble() * 18f, h, 14f + (float)rng.NextDouble() * 18f)));
        }
        Combined(root, "Blocks", blocks, blockMat);
    }

    // ---- landmark builders -------------------------------------------

    static void KuwaitTowers(GameObject root, Vector3 at)
    {
        var g = new GameObject("KuwaitTowers");
        g.transform.SetParent(root.transform);
        g.transform.position = at;
        var spireMat = CarFactory.Standard(new Color(0.81f, 0.84f, 0.87f), 0.3f, 0.5f);
        var ballMat = CarFactory.Emissive(new Color(0.18f, 0.56f, 0.59f), 0.6f);
        Prim(g, PrimitiveType.Cylinder, new Vector3(0, 56.5f, 0), new Vector3(4f, 56.5f, 4f), spireMat);
        Prim(g, PrimitiveType.Sphere, new Vector3(0, 58, 0), Vector3.one * 22f, ballMat);
        Prim(g, PrimitiveType.Sphere, new Vector3(0, 88, 0), Vector3.one * 13f, ballMat);
        Prim(g, PrimitiveType.Cylinder, new Vector3(-34, 46, 14), new Vector3(3.4f, 46f, 3.4f), spireMat);
        Prim(g, PrimitiveType.Sphere, new Vector3(-34, 62, 14), Vector3.one * 17f, ballMat);
    }

    static void WaterTowers(GameObject root, Vector3 at)
    {
        var g = new GameObject("WaterTowers");
        g.transform.SetParent(root.transform);
        g.transform.position = at;
        var stemMat = CarFactory.Standard(new Color(0.85f, 0.87f, 0.89f), 0.2f, 0.5f);
        var capMat = CarFactory.Standard(new Color(0.49f, 0.78f, 0.89f), 0.2f, 0.6f);
        for (int i = 0; i < 5; i++)
        {
            Vector3 o = new Vector3(i % 3 * 22f - 22f, 0, i / 3 * 20f - 10f);
            Prim(g, PrimitiveType.Cylinder, o + new Vector3(0, 9.5f, 0), new Vector3(2.8f, 9.5f, 2.8f), stemMat);
            Prim(g, PrimitiveType.Sphere, o + new Vector3(0, 20, 0), new Vector3(12f, 9.6f, 12f), capMat);
        }
    }

    static void Mosque(GameObject root, Vector3 at)
    {
        var g = new GameObject("Mosque");
        g.transform.SetParent(root.transform);
        g.transform.position = at;
        var wallMat = CarFactory.Emissive(new Color(0.85f, 0.79f, 0.66f), 0.15f);
        var domeMat = CarFactory.Emissive(new Color(0.18f, 0.56f, 0.59f), 0.4f);
        Prim(g, PrimitiveType.Cube, new Vector3(0, 4.5f, 0), new Vector3(26f, 9f, 22f), wallMat);
        Prim(g, PrimitiveType.Sphere, new Vector3(0, 9, 0), Vector3.one * 16f, domeMat);
        Prim(g, PrimitiveType.Cylinder, new Vector3(17, 13.5f, 8), new Vector3(2.9f, 13.5f, 2.9f), wallMat);
    }

    // ---- mesh helpers ------------------------------------------------

    static Mesh cubeMesh;
    static Mesh CubeMesh()
    {
        if (cubeMesh != null) return cubeMesh;
        var tmp = GameObject.CreatePrimitive(PrimitiveType.Cube);
        cubeMesh = tmp.GetComponent<MeshFilter>().sharedMesh;
        Object.Destroy(tmp);
        return cubeMesh;
    }

    static CombineInstance Ci(Mesh mesh, Vector3 pos, Vector3 scale, Quaternion? rot = null) =>
        new CombineInstance { mesh = mesh, transform = Matrix4x4.TRS(pos, rot ?? Quaternion.identity, scale) };

    static void Combined(GameObject root, string name, List<CombineInstance> parts, Material mat)
    {
        var mesh = new Mesh { indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
        mesh.CombineMeshes(parts.ToArray(), true, true);
        var go = new GameObject(name);
        go.transform.SetParent(root.transform);
        go.AddComponent<MeshFilter>().sharedMesh = mesh;
        go.AddComponent<MeshRenderer>().sharedMaterial = mat;
    }

    static void Prim(GameObject parent, PrimitiveType type, Vector3 pos, Vector3 scale, Material mat)
    {
        var go = GameObject.CreatePrimitive(type);
        Object.Destroy(go.GetComponent<Collider>());
        go.transform.SetParent(parent.transform, false);
        go.transform.localPosition = pos;
        go.transform.localScale = scale;
        go.GetComponent<MeshRenderer>().sharedMaterial = mat;
    }

    static void Plane(GameObject root, string name, Vector3 pos, Vector2 size, Material mat)
    {
        var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
        Object.Destroy(go.GetComponent<Collider>());
        go.name = name;
        go.transform.SetParent(root.transform);
        go.transform.position = pos;
        go.transform.rotation = Quaternion.Euler(90, 0, 0);
        go.transform.localScale = new Vector3(size.x, size.y, 1);
        go.GetComponent<MeshRenderer>().sharedMaterial = mat;
    }

    static void Ribbon(GameObject root, string name, TrackSpline track, float a, float b, float y, Material mat)
    {
        BuildStrip(root, name, track, s => track.Pose(s, a) + Vector3.up * y,
            s => track.Pose(s, b) + Vector3.up * y, mat);
    }

    static void Wall(GameObject root, string name, TrackSpline track, float lat, float y0, float y1, Material mat)
    {
        BuildStrip(root, name, track, s => track.Pose(s, lat) + Vector3.up * y0,
            s => track.Pose(s, lat) + Vector3.up * y1, mat);
    }

    static void BuildStrip(GameObject root, string name, TrackSpline track,
        System.Func<float, Vector3> edgeA, System.Func<float, Vector3> edgeB, Material mat)
    {
        const float step = 8f;
        int n = Mathf.CeilToInt(track.Length / step);
        var verts = new Vector3[(n + 1) * 2];
        var tris = new int[n * 6];
        for (int i = 0; i <= n; i++)
        {
            float s = (float)i / n * track.Length;
            verts[i * 2] = edgeA(s);
            verts[i * 2 + 1] = edgeB(s);
        }
        for (int i = 0; i < n; i++)
        {
            int v = i * 2, t = i * 6;
            tris[t] = v; tris[t + 1] = v + 2; tris[t + 2] = v + 1;
            tris[t + 3] = v + 1; tris[t + 4] = v + 2; tris[t + 5] = v + 3;
        }
        var mesh = new Mesh { indexFormat = UnityEngine.Rendering.IndexFormat.UInt32, vertices = verts, triangles = tris };
        mesh.RecalculateNormals();
        var go = new GameObject(name);
        go.transform.SetParent(root.transform);
        go.AddComponent<MeshFilter>().sharedMesh = mesh;
        go.AddComponent<MeshRenderer>().sharedMaterial = mat;
    }
}
