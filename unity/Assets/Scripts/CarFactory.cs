using UnityEngine;

// Procedural cars from primitives — body, glass cabin, wheels the game
// spins, emissive light strips. Forward is +Z (local).
public static class CarFactory
{
    public class Car
    {
        public GameObject Root;
        public Transform[] Wheels;   // fl, fr, rl, rr
        public Material TailMat;     // brake flare
    }

    public static Car Create(Color body, Color? accent = null)
    {
        var root = new GameObject("Car");
        var car = new Car { Root = root };

        var bodyMat = Standard(body, metallic: 0.7f, smooth: 0.8f);
        var glassMat = Standard(new Color(0.05f, 0.07f, 0.1f), metallic: 0.8f, smooth: 0.95f);

        Box(root, "Body", new Vector3(0, 0.62f, 0), new Vector3(1.9f, 0.55f, 4.4f), bodyMat);
        Box(root, "Hood", new Vector3(0, 0.93f, 1.55f), new Vector3(1.84f, 0.28f, 1.0f), bodyMat);
        Box(root, "Trunk", new Vector3(0, 0.94f, -1.7f), new Vector3(1.84f, 0.26f, 0.8f), bodyMat);
        Box(root, "Cabin", new Vector3(0, 1.1f, -0.25f), new Vector3(1.65f, 0.5f, 2.1f), glassMat);

        if (accent.HasValue)
            Box(root, "Stripe", new Vector3(0, 0.92f, 0), new Vector3(0.5f, 0.04f, 4.42f),
                Standard(accent.Value, 0.2f, 0.6f));

        var headMat = Emissive(new Color(1f, 0.96f, 0.81f), 2.2f);
        foreach (float sx in new[] { -0.62f, 0.62f })
            Box(root, "Headlight", new Vector3(sx, 0.7f, 2.22f), new Vector3(0.5f, 0.13f, 0.06f), headMat);

        car.TailMat = Emissive(new Color(1f, 0.13f, 0.13f), 1.6f);
        Box(root, "Taillight", new Vector3(0, 0.78f, -2.24f), new Vector3(1.7f, 0.1f, 0.06f), car.TailMat);

        Box(root, "Grille", new Vector3(0, 0.5f, 2.23f), new Vector3(1.05f, 0.17f, 0.06f),
            Standard(new Color(0.05f, 0.05f, 0.06f), 0.3f, 0.4f));

        var wheelMat = Standard(new Color(0.05f, 0.05f, 0.06f), 0.2f, 0.3f);
        var wheels = new Transform[4];
        var slots = new[]
        {
            new Vector3(-0.84f, 0.36f, 1.42f), new Vector3(0.84f, 0.36f, 1.42f),
            new Vector3(-0.84f, 0.36f, -1.42f), new Vector3(0.84f, 0.36f, -1.42f),
        };
        for (int i = 0; i < 4; i++)
        {
            var w = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            w.name = "Wheel";
            Object.Destroy(w.GetComponent<Collider>());
            w.transform.SetParent(root.transform, false);
            w.transform.localPosition = slots[i];
            w.transform.localRotation = Quaternion.Euler(0, 0, 90);
            w.transform.localScale = new Vector3(0.72f, 0.13f, 0.72f);
            w.GetComponent<MeshRenderer>().sharedMaterial = wheelMat;
            wheels[i] = w.transform;
        }
        car.Wheels = wheels;
        return car;
    }

    static void Box(GameObject parent, string name, Vector3 pos, Vector3 size, Material mat)
    {
        var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
        go.name = name;
        Object.Destroy(go.GetComponent<Collider>());
        go.transform.SetParent(parent.transform, false);
        go.transform.localPosition = pos;
        go.transform.localScale = size;
        go.GetComponent<MeshRenderer>().sharedMaterial = mat;
    }

    public static Material Standard(Color c, float metallic, float smooth)
    {
        var m = new Material(Shader.Find("Standard"));
        m.color = c;
        m.SetFloat("_Metallic", metallic);
        m.SetFloat("_Glossiness", smooth);
        return m;
    }

    public static Material Emissive(Color c, float intensity)
    {
        var m = Standard(c, 0.1f, 0.5f);
        m.EnableKeyword("_EMISSION");
        m.SetColor("_EmissionColor", c * intensity);
        return m;
    }
}
