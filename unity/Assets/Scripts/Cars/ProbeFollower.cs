using UnityEngine;

namespace NightRacer.Cars
{
    /// <summary>Keeps a probe over its car, upright (position only), the way
    /// the web's probe sits 1.2 m above the player.</summary>
    public sealed class ProbeFollower : MonoBehaviour
    {
        public Transform Target;
        public float Lift = 1.2f;

        void LateUpdate()
        {
            if (Target == null) return;
            transform.position = Target.position + Vector3.up * Lift;
            transform.rotation = Quaternion.identity;
        }
    }
}
