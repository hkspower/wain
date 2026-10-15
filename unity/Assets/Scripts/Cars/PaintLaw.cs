namespace NightRacer.Cars
{
    /// <summary>
    /// How metallic a car paint is, from its colour — the web's law
    /// (src/game/cars.ts paintMetalness), the one the Unreal port also
    /// carries (unreal/Source/GulfRoadNights/GRNPaintLaw.h). The GLBs already
    /// hold each factory paint's metalness; this is for a car repainted at
    /// runtime (traffic, a rival's colour), so it lands where the web would
    /// have put it instead of inheriting the factory paint's number.
    /// </summary>
    public static class PaintLaw
    {
        /// <summary>The top of the mid-tone metal ramp (cars.ts PAINT_METAL_TOP).</summary>
        public const float MetalTop = 0.75f;
        const float DarkKnee = 0.16f;

        /// <summary>The palette's declared solids (src/game/paints.ts,
        /// `solid: true`): pigment under lacquer, metalness 0.</summary>
        static readonly int[] Solids =
        {
            0x1a1b1f, // paint-black
            0xf2f4f7, // paint-white
            0x6d6a2f, // paint-olive
            0x81565e, // paint-molasses
            0xa7917b, // paint-mudbrick
            0x07362d, // paint-diver
            0x7f9376, // paint-sage
            0xffab95, // paint-coral
            0xf7e21c, // paint-yellow
        };

        /// <summary>Metalness for an sRGB hex. Luminance is Rec.709 on the
        /// sRGB bytes, as the web computes it.</summary>
        public static float Metalness(int hex)
        {
            foreach (var s in Solids) if (s == hex) return 0f;
            float r = ((hex >> 16) & 255) / 255f, g = ((hex >> 8) & 255) / 255f, b = (hex & 255) / 255f;
            float lum = 0.2126f * r + 0.7152f * g + 0.0722f * b;
            if (lum >= 0.5f) return System.Math.Max(0.18f, System.Math.Min(MetalTop, 0.95f - (lum - 0.5f) * 1.9f));
            if (lum >= DarkKnee) return MetalTop;
            return 0.18f + (MetalTop - 0.18f) * lum / DarkKnee;
        }

        /// <summary>The finishes' scale on that metalness (src/game/mods.ts
        /// FINISHES metalScale): gloss 1, satin 0.8, matte 0.25.</summary>
        public static float FinishMetalScale(string finish) =>
            finish == "matte" ? 0.25f : finish == "satin" ? 0.8f : 1f;
    }
}
