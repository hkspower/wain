using System.Collections.Generic;
using UnityEngine;

namespace NightRacer.Cars
{
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
        /// <summary>LastWriteTimeUtc ticks of the GLB a baked prefab was made
        /// from (CarAssetBaker stamps it; 0 on a car built at runtime, or
        /// baked before the stamp existed). In the Editor CarLibrary reads the
        /// GLB instead of a prefab older than it.</summary>
        public long SourceTicks;
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
