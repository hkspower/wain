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
        /// <summary>Built dimensions in metres. Callers hang lights and
        /// effects off these rather than hardcoding a nose position — the
        /// silhouettes are 4.30 m to 4.70 m long, so a fixed offset lands
        /// inside the bodywork on the short ones.</summary>
        public float Length, Width, LampHeight;
    }

    /// <summary>
    /// Per-silhouette massing, in metres, matching the machine each shape
    /// evokes in the web build: a saloon (4.70 x 1.80), a Z32 300ZX
    /// (4.31 x 1.80), an R34 Skyline (4.60 x 1.79) and an FD RX-7
    /// (4.30 x 1.76). The web build reached these by scaling oversized
    /// profiles; here the boxes are simply authored at the right size.
    /// </summary>
    struct Shape
    {
        public float Length, Width, BodyH, CabinLen, CabinH, CabinZ, CabinRake;
        public float WheelFront, WheelRear;
    }

    static Shape ShapeFor(BodyStyle style)
    {
        switch (style)
        {
            case BodyStyle.ZX: // long cab-back wedge, low roof
                return new Shape {
                    Length = 4.31f, Width = 1.80f, BodyH = 0.52f,
                    CabinLen = 2.05f, CabinH = 0.40f, CabinZ = -0.62f, CabinRake = -6f,
                    WheelFront = 1.45f, WheelRear = -1.42f };
            case BodyStyle.GTR: // boxy, high-decked, upright glass
                return new Shape {
                    Length = 4.60f, Width = 1.79f, BodyH = 0.62f,
                    CabinLen = 1.85f, CabinH = 0.52f, CabinZ = -0.18f, CabinRake = 0f,
                    WheelFront = 1.48f, WheelRear = -1.46f };
            case BodyStyle.RX7: // compact, low, bubble canopy
                return new Shape {
                    Length = 4.30f, Width = 1.76f, BodyH = 0.50f,
                    CabinLen = 1.75f, CabinH = 0.40f, CabinZ = -0.42f, CabinRake = -5f,
                    WheelFront = 1.40f, WheelRear = -1.38f };
            default: // saloon
                return new Shape {
                    Length = 4.70f, Width = 1.80f, BodyH = 0.58f,
                    CabinLen = 2.10f, CabinH = 0.50f, CabinZ = -0.25f, CabinRake = 0f,
                    WheelFront = 1.46f, WheelRear = -1.44f };
        }
    }

    /// <summary>Tyre radius in metres. GameController rolls the wheels at
    /// this rate — a mismatch here makes every car look like it is
    /// slipping its tyres.</summary>
    public const float WheelRadius = 0.33f;

    public static Car Create(Color body, Color? accent = null,
        BodyStyle style = BodyStyle.Sedan, bool attackKit = false)
    {
        var root = new GameObject("Car");
        var s = ShapeFor(style);
        var car = new Car { Root = root, Length = s.Length, Width = s.Width };

        var bodyMat = Mats.CarPaint(body);
        var glassMat = Mats.Lit(new Color(0.05f, 0.07f, 0.1f), 0.9f, 0.97f);

        float halfL = s.Length * 0.5f;
        float bodyY = 0.30f + s.BodyH * 0.5f;
        Box(root, "Body", new Vector3(0, bodyY, 0), new Vector3(s.Width, s.BodyH, s.Length), bodyMat);
        Box(root, "Hood", new Vector3(0, bodyY + s.BodyH * 0.5f, halfL * 0.68f),
            new Vector3(s.Width * 0.97f, 0.26f, s.Length * 0.24f), bodyMat);
        Box(root, "Trunk", new Vector3(0, bodyY + s.BodyH * 0.5f, -halfL * 0.74f),
            new Vector3(s.Width * 0.97f, 0.24f, s.Length * 0.19f), bodyMat);
        // Raking the box rotates it about its own centre, which lifts the
        // leading edge clear of the deck and leaves a gap you can see
        // through. Dropping it by the sagitta the rotation introduces
        // keeps the glasshouse sitting on the body.
        float rakeRad = Mathf.Abs(s.CabinRake) * Mathf.Deg2Rad;
        float rakeLift = Mathf.Sin(rakeRad) * s.CabinLen * 0.5f;
        var cabin = Box(root, "Cabin",
            new Vector3(0, bodyY + s.BodyH * 0.5f + s.CabinH * 0.5f - rakeLift * 0.5f, s.CabinZ),
            new Vector3(s.Width * 0.88f, s.CabinH, s.CabinLen), glassMat);
        cabin.transform.localRotation = Quaternion.Euler(s.CabinRake, 0, 0);

        // Factory time-attack aero — the Efreet RX Kai's swan wing and
        // splitter. Geometry only; the kit is part of the car, not a mod.
        if (attackKit)
        {
            Box(root, "Splitter", new Vector3(0, 0.16f, halfL + 0.12f),
                new Vector3(s.Width * 1.05f, 0.04f, 0.5f),
                Mats.Lit(new Color(0.06f, 0.07f, 0.08f), 0.35f, 0.5f));
            var dark = Mats.Lit(new Color(0.06f, 0.07f, 0.08f), 0.35f, 0.5f);
            foreach (float sx in new[] { -0.5f, 0.5f })
                Box(root, "WingStay", new Vector3(sx, 1.15f, -halfL + 0.25f),
                    new Vector3(0.05f, 0.55f, 0.2f), dark);
            Box(root, "Wing", new Vector3(0, 1.46f, -halfL + 0.1f),
                new Vector3(s.Width * 1.08f, 0.05f, 0.5f), bodyMat);
            foreach (float sx in new[] { -1f, 1f })
                Box(root, "Endplate", new Vector3(sx * s.Width * 0.54f, 1.46f, -halfL + 0.1f),
                    new Vector3(0.03f, 0.3f, 0.54f), dark);
        }

        // The stripe only reads on the upright saloon deck; on the
        // fastbacks it would run straight through the glass.
        if (accent.HasValue && style == BodyStyle.Sedan)
            Box(root, "Stripe", new Vector3(0, bodyY + s.BodyH * 0.5f + 0.01f, 0),
                new Vector3(0.5f, 0.04f, s.Length * 1.005f),
                Mats.Lit(accent.Value, 0.2f, 0.6f));

        // HDR intensities so the bloom pass actually blooms them
        var headMat = Mats.Emissive(new Color(1f, 0.96f, 0.81f), 6f);
        float lampY = bodyY + s.BodyH * 0.22f;
        if (style == BodyStyle.ZX)
        {
            // Z32 signature: one flush bar across the whole nose
            Box(root, "Headlight", new Vector3(0, lampY, halfL - 0.02f),
                new Vector3(s.Width * 0.84f, 0.10f, 0.06f), headMat);
        }
        else
        {
            foreach (float sx in new[] { -0.62f, 0.62f })
                Box(root, "Headlight", new Vector3(sx, lampY, halfL - 0.02f),
                    new Vector3(0.46f, 0.13f, 0.06f), headMat);
        }

        car.LampHeight = lampY;
        car.TailMat = Mats.Emissive(new Color(1f, 0.13f, 0.13f), 3.5f);
        Box(root, "Taillight", new Vector3(0, lampY + 0.08f, -halfL + 0.02f),
            new Vector3(s.Width * 0.92f, 0.1f, 0.06f), car.TailMat);

        // The Z32 nose is famously grille-less; so is the FD's
        if (style != BodyStyle.ZX && style != BodyStyle.RX7)
            Box(root, "Grille", new Vector3(0, bodyY - s.BodyH * 0.15f, halfL - 0.01f),
                new Vector3(1.05f, 0.17f, 0.06f),
                Mats.Lit(new Color(0.05f, 0.05f, 0.06f), 0.3f, 0.4f));

        var wheelMat = Mats.Lit(new Color(0.05f, 0.05f, 0.06f), 0.2f, 0.25f);
        var rimMat = Mats.Lit(new Color(0.78f, 0.8f, 0.84f), 0.95f, 0.85f);
        var wheels = new Transform[4];
        // 0.66 m tyres, the real diameter for this class of car
        float wx = s.Width * 0.47f, wr = WheelRadius;
        var slots = new[]
        {
            new Vector3(-wx, wr, s.WheelFront), new Vector3(wx, wr, s.WheelFront),
            new Vector3(-wx, wr, s.WheelRear),  new Vector3(wx, wr, s.WheelRear),
        };
        for (int i = 0; i < 4; i++)
        {
            var w = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            w.name = "Wheel";
            Object.Destroy(w.GetComponent<Collider>());
            w.transform.SetParent(root.transform, false);
            w.transform.localPosition = slots[i];
            w.transform.localRotation = Quaternion.Euler(0, 0, 90);
            w.transform.localScale = new Vector3(wr * 2f, 0.13f, wr * 2f);
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
        blob.transform.localScale = new Vector3(s.Width * 1.45f, s.Length * 1.18f, 1f);
        var br = blob.GetComponent<MeshRenderer>();
        br.sharedMaterial = Mats.AlphaBlend(Color.white, Mats.Blob());
        br.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        br.receiveShadows = false;

        return car;
    }

    static GameObject Box(GameObject parent, string name, Vector3 pos, Vector3 size, Material mat)
    {
        var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
        go.name = name;
        Object.Destroy(go.GetComponent<Collider>());
        go.transform.SetParent(parent.transform, false);
        go.transform.localPosition = pos;
        go.transform.localScale = size;
        go.GetComponent<MeshRenderer>().sharedMaterial = mat;
        return go;
    }

}
