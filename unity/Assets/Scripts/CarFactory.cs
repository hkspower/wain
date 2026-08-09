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

        var bodyMat = Mats.CarPaint(body);
        var glassMat = Mats.Lit(new Color(0.05f, 0.07f, 0.1f), 0.9f, 0.97f);

        Box(root, "Body", new Vector3(0, 0.62f, 0), new Vector3(1.9f, 0.55f, 4.4f), bodyMat);
        Box(root, "Hood", new Vector3(0, 0.93f, 1.55f), new Vector3(1.84f, 0.28f, 1.0f), bodyMat);
        Box(root, "Trunk", new Vector3(0, 0.94f, -1.7f), new Vector3(1.84f, 0.26f, 0.8f), bodyMat);
        Box(root, "Cabin", new Vector3(0, 1.1f, -0.25f), new Vector3(1.65f, 0.5f, 2.1f), glassMat);

        if (accent.HasValue)
            Box(root, "Stripe", new Vector3(0, 0.92f, 0), new Vector3(0.5f, 0.04f, 4.42f),
                Mats.Lit(accent.Value, 0.2f, 0.6f));

        // HDR intensities so the bloom pass actually blooms them
        var headMat = Mats.Emissive(new Color(1f, 0.96f, 0.81f), 6f);
        foreach (float sx in new[] { -0.62f, 0.62f })
            Box(root, "Headlight", new Vector3(sx, 0.7f, 2.22f), new Vector3(0.5f, 0.13f, 0.06f), headMat);

        car.TailMat = Mats.Emissive(new Color(1f, 0.13f, 0.13f), 3.5f);
        Box(root, "Taillight", new Vector3(0, 0.78f, -2.24f), new Vector3(1.7f, 0.1f, 0.06f), car.TailMat);

        Box(root, "Grille", new Vector3(0, 0.5f, 2.23f), new Vector3(1.05f, 0.17f, 0.06f),
            Mats.Lit(new Color(0.05f, 0.05f, 0.06f), 0.3f, 0.4f));

        var wheelMat = Mats.Lit(new Color(0.05f, 0.05f, 0.06f), 0.2f, 0.25f);
        var rimMat = Mats.Lit(new Color(0.78f, 0.8f, 0.84f), 0.95f, 0.85f);
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

            // Rim face so the wheel reads as an alloy, not a black puck
            var rim = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            rim.name = "Rim";
            Object.Destroy(rim.GetComponent<Collider>());
            rim.transform.SetParent(w.transform, false);
            rim.transform.localScale = new Vector3(0.62f, 1.04f, 0.62f);
            rim.GetComponent<MeshRenderer>().sharedMaterial = rimMat;
        }
        car.Wheels = wheels;

        // Every mesh casts; the contact blob below must not
        foreach (var r in root.GetComponentsInChildren<MeshRenderer>())
        {
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
            r.receiveShadows = true;
        }

        // Contact shadow — grounds the car even where the moon shadow is soft
        var blob = GameObject.CreatePrimitive(PrimitiveType.Quad);
        blob.name = "ContactShadow";
        Object.Destroy(blob.GetComponent<Collider>());
        blob.transform.SetParent(root.transform, false);
        blob.transform.localPosition = new Vector3(0, 0.035f, 0);
        blob.transform.localRotation = Quaternion.Euler(90, 0, 0);
        blob.transform.localScale = new Vector3(2.6f, 5.2f, 1f);
        var br = blob.GetComponent<MeshRenderer>();
        br.sharedMaterial = Mats.AlphaBlend(Color.white, Mats.Blob());
        br.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        br.receiveShadows = false;

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

}
