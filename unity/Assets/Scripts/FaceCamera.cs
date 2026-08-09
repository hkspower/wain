using UnityEngine;

// Billboard: keeps a quad square-on to the camera. Used for lamp coronas
// and headlight glows so they read as light rather than as geometry.
// LateUpdate so it runs after the chase camera has moved.
[DisallowMultipleComponent]
public class FaceCamera : MonoBehaviour
{
    Transform cam;

    void LateUpdate()
    {
        if (cam == null)
        {
            var c = Camera.main;
            if (c == null) return;
            cam = c.transform;
        }
        transform.rotation = cam.rotation;
    }
}
