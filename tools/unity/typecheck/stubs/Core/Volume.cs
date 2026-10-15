// com.unity.render-pipelines.core 17.0 (runtime), the part of the volume
// framework the project touches. Signatures from the package source,
// github.com/Unity-Technologies/Graphics, branch 6000.0/staging (Core RP
// 17.0.4; the project pins 17.0.3 through URP), Runtime/Volume/: Volume.cs,
// VolumeProfile.cs, VolumeComponent.cs, VolumeParameter.cs, IVolume.cs.
// Only public members; internals the real assembly hides stay hidden.
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;

namespace UnityEngine.Rendering
{
    // IVolume.cs:8-19
    public interface IVolume
    {
        bool isGlobal { get; set; }
        List<Collider> colliders { get; }
    }

    // Volume.cs:13-109
    [ExecuteAlways]
    [AddComponentMenu("Miscellaneous/Volume")]
    public class Volume : MonoBehaviour, IVolume
    {
        public bool isGlobal { get => throw null; set => throw null; }
        public float priority = 0f;
        public float blendDistance = 0f;
        [Range(0f, 1f)]
        public float weight = 1f;
        public VolumeProfile sharedProfile = null;
        public VolumeProfile profile { get => throw null; set => throw null; }
        public List<Collider> colliders => throw null;
        public bool HasInstantiatedProfile() => throw null;
    }

    // VolumeProfile.cs:13-327
    public sealed class VolumeProfile : ScriptableObject
    {
        public List<VolumeComponent> components = new List<VolumeComponent>();
        [Obsolete("This field was only public for editor access. #from(6000.0)")]
        public bool isDirty { get => throw null; set => throw null; }
        public void Reset() => throw null;
        public T Add<T>(bool overrides = false) where T : VolumeComponent => throw null;
        public VolumeComponent Add(Type type, bool overrides = false) => throw null;
        public void Remove<T>() where T : VolumeComponent => throw null;
        public void Remove(Type type) => throw null;
        public bool Has<T>() where T : VolumeComponent => throw null;
        public bool Has(Type type) => throw null;
        public bool HasSubclassOf(Type type) => throw null;
        public bool TryGet<T>(out T component) where T : VolumeComponent => throw null;
        public bool TryGet<T>(Type type, out T component) where T : VolumeComponent => throw null;
        public bool TryGetSubclassOf<T>(Type type, out T component) where T : VolumeComponent => throw null;
        public bool TryGetAllSubclassOf<T>(Type type, List<T> result) where T : VolumeComponent => throw null;
    }

    // VolumeComponent.cs:97-338
    public partial class VolumeComponent : ScriptableObject
    {
        public bool active = true;
        public string displayName { get => throw null; protected set => throw null; }
        public ReadOnlyCollection<VolumeParameter> parameters => throw null;
        protected virtual void OnEnable() => throw null;
        protected virtual void OnDisable() => throw null;
        public virtual void Override(VolumeComponent state, float interpFactor) => throw null;
        public void SetAllOverridesTo(bool state) => throw null;
        public override int GetHashCode() => throw null;
        public bool AnyPropertiesIsOverridden() => throw null;
        protected virtual void OnDestroy() => throw null;
        public void Release() => throw null;
    }

    // VolumeParameter.cs:19-123
    public abstract class VolumeParameter : ICloneable
    {
        public const string k_DebuggerDisplay = "{m_Value} ({m_OverrideState})";
        [SerializeField]
        protected bool m_OverrideState;
        public virtual bool overrideState { get => throw null; set => throw null; }
        public abstract void SetValue(VolumeParameter parameter);
        public static bool IsObjectParameter(Type type) => throw null;
        public virtual void Release() { }
        public abstract object Clone();
    }

    // VolumeParameter.cs:158-270
    [Serializable]
    public class VolumeParameter<T> : VolumeParameter, IEquatable<VolumeParameter<T>>
    {
        [SerializeField]
        protected T m_Value;
        public virtual T value { get => throw null; set => throw null; }
        public VolumeParameter() => throw null;
        protected VolumeParameter(T value, bool overrideState = false) => throw null;
        public virtual void Interp(T from, T to, float t) => throw null;
        public void Override(T x) => throw null;
        public override void SetValue(VolumeParameter parameter) => throw null;
        public override object Clone() => throw null;
        public override string ToString() => throw null;
        public bool Equals(VolumeParameter<T> other) => throw null;
        public static bool operator ==(VolumeParameter<T> lhs, T rhs) => throw null;
        public static bool operator !=(VolumeParameter<T> lhs, T rhs) => throw null;
        public static explicit operator T(VolumeParameter<T> prop) => throw null;
        public override bool Equals(object obj) => throw null;
        public override int GetHashCode() => throw null;
    }

    // VolumeParameter.cs:350-371
    [Serializable]
    public class BoolParameter : VolumeParameter<bool>
    {
        public BoolParameter(bool value, bool overrideState = false) => throw null;
    }

    // VolumeParameter.cs:433-440
    [Serializable]
    public class IntParameter : VolumeParameter<int>
    {
        public IntParameter(int value, bool overrideState = false) => throw null;
    }

    // VolumeParameter.cs:671-704
    [Serializable]
    public class ClampedIntParameter : IntParameter
    {
        [NonSerialized] public int min;
        [NonSerialized] public int max;
        public ClampedIntParameter(int value, int min, int max, bool overrideState = false) : base(value, overrideState) => throw null;
    }

    // VolumeParameter.cs:778-785
    [Serializable]
    public class FloatParameter : VolumeParameter<float>
    {
        public FloatParameter(float value, bool overrideState = false) => throw null;
    }

    // VolumeParameter.cs:837-863
    [Serializable]
    public class MinFloatParameter : FloatParameter
    {
        [NonSerialized] public float min;
        public MinFloatParameter(float value, float min, bool overrideState = false) : base(value, overrideState) => throw null;
    }

    // VolumeParameter.cs:1024-1057
    [Serializable]
    public class ClampedFloatParameter : FloatParameter
    {
        [NonSerialized] public float min;
        [NonSerialized] public float max;
        public ClampedFloatParameter(float value, float min, float max, bool overrideState = false) : base(value, overrideState) => throw null;
    }

    // VolumeParameter.cs:1255-1291
    [Serializable]
    public class ColorParameter : VolumeParameter<Color>
    {
        [NonSerialized] public bool hdr = false;
        [NonSerialized] public bool showAlpha = true;
        [NonSerialized] public bool showEyeDropper = true;
        public ColorParameter(Color value, bool overrideState = false) => throw null;
        public ColorParameter(Color value, bool hdr, bool showAlpha, bool showEyeDropper, bool overrideState = false) => throw null;
    }

    // VolumeParameter.cs:1377-1384
    [Serializable]
    public class Vector2Parameter : VolumeParameter<Vector2>
    {
        public Vector2Parameter(Vector2 value, bool overrideState = false) => throw null;
    }

    // VolumeParameter.cs:1511-1532
    [Serializable]
    public class TextureParameter : VolumeParameter<Texture>
    {
        public TextureDimension dimension;
        public TextureParameter(Texture value, bool overrideState = false) => throw null;
        public TextureParameter(Texture value, TextureDimension dimension, bool overrideState = false) => throw null;
    }

    // VolumeParameter.cs:1562-1569
    [Serializable]
    public class NoInterpTextureParameter : VolumeParameter<Texture>
    {
        public NoInterpTextureParameter(Texture value, bool overrideState = false) => throw null;
    }
}
