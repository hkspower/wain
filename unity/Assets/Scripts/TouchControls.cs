using UnityEngine;

// On-screen controls for phones and tablets.
//
// Reads Input.touches directly rather than using GUI buttons, because a
// racer needs genuine multi-touch: steering with the left thumb while
// the right thumb holds the gas. Each touch is tested against the pads
// every frame, so any number of them register at once.
//
// Falls back to the mouse in the editor so the layout can be checked
// without deploying to a device.
public class TouchControls : MonoBehaviour
{
    public bool Enabled { get; private set; }

    // Merged into GameController's input each frame
    public float Steer { get; private set; }
    public float Throttle { get; private set; }
    public float Brake { get; private set; }
    public bool FlashPressed { get; private set; }
    public bool NosHeld { get; private set; }
    public bool HornHeld { get; private set; }

    Rect steerL, steerR, gas, brake, flash, nos, horn;
    bool flashWasDown;
    Texture2D pad, padActive;
    GUIStyle label;

    void Awake()
    {
        // Touch-capable and not a desktop with a stray touchscreen
        Enabled = Application.isMobilePlatform || Input.touchSupported;
        pad = Solid(new Color(0.05f, 0.07f, 0.12f, 0.55f));
        padActive = Solid(new Color(0.24f, 0.62f, 0.78f, 0.72f));
    }

    static Texture2D Solid(Color c)
    {
        var t = new Texture2D(1, 1);
        t.SetPixel(0, 0, c);
        t.Apply();
        return t;
    }

    void Layout()
    {
        float w = Screen.width, h = Screen.height;
        float s = Mathf.Min(w, h) * 0.19f;      // pad size scales with the screen
        float m = s * 0.35f;                     // margin

        steerL = new Rect(m, h - s - m, s, s);
        steerR = new Rect(m + s + m * 0.6f, h - s - m, s, s);
        gas = new Rect(w - s - m, h - s - m, s, s);
        brake = new Rect(w - s * 2f - m * 1.6f, h - s - m, s, s);

        float bw = s * 1.05f, bh = s * 0.46f;
        float cx = w / 2f;
        flash = new Rect(cx - bw * 1.6f, h - bh - m, bw, bh);
        nos = new Rect(cx - bw * 0.5f, h - bh - m, bw, bh);
        horn = new Rect(cx + bw * 0.6f, h - bh - m, bw, bh);
    }

    void Update()
    {
        if (!Enabled) return;
        Layout();

        float steer = 0f, throttle = 0f, brakeAmt = 0f;
        bool flashDown = false, nosDown = false, hornDown = false;

        // GUI rects are top-left origin; touch positions are bottom-left
        bool Hit(Rect r, Vector2 p) =>
            r.Contains(new Vector2(p.x, Screen.height - p.y));

        for (int i = 0; i < Input.touchCount; i++)
        {
            var t = Input.GetTouch(i);
            if (t.phase == TouchPhase.Ended || t.phase == TouchPhase.Canceled) continue;
            var p = t.position;
            if (Hit(steerL, p)) steer -= 1f;
            if (Hit(steerR, p)) steer += 1f;
            if (Hit(gas, p)) throttle = 1f;
            if (Hit(brake, p)) brakeAmt = 1f;
            if (Hit(flash, p)) flashDown = true;
            if (Hit(nos, p)) nosDown = true;
            if (Hit(horn, p)) hornDown = true;
        }

        // Editor/mouse fallback (single pointer, still useful for layout)
        if (Input.touchCount == 0 && Input.GetMouseButton(0))
        {
            var p = (Vector2)Input.mousePosition;
            if (Hit(steerL, p)) steer -= 1f;
            if (Hit(steerR, p)) steer += 1f;
            if (Hit(gas, p)) throttle = 1f;
            if (Hit(brake, p)) brakeAmt = 1f;
            if (Hit(flash, p)) flashDown = true;
            if (Hit(nos, p)) nosDown = true;
            if (Hit(horn, p)) hornDown = true;
        }

        Steer = Mathf.Clamp(steer, -1f, 1f);
        Throttle = throttle;
        Brake = brakeAmt;
        NosHeld = nosDown;
        HornHeld = hornDown;
        // Edge-triggered: three separate presses issue a challenge
        FlashPressed = flashDown && !flashWasDown;
        flashWasDown = flashDown;
    }

    void OnGUI()
    {
        if (!Enabled) return;
        if (label == null)
        {
            label = new GUIStyle(GUI.skin.label)
            {
                alignment = TextAnchor.MiddleCenter,
                fontStyle = FontStyle.Bold,
            };
        }
        label.fontSize = Mathf.RoundToInt(Mathf.Min(Screen.width, Screen.height) * 0.028f);

        Pad(steerL, "◀", Steer < -0.5f);
        Pad(steerR, "▶", Steer > 0.5f);
        Pad(brake, "BRAKE", Brake > 0.5f);
        Pad(gas, "GAS", Throttle > 0.5f);
        Pad(flash, "FLASH", false);
        Pad(nos, "NOS", NosHeld);
        Pad(horn, "HORN", HornHeld);
    }

    void Pad(Rect r, string text, bool active)
    {
        GUI.DrawTexture(r, active ? padActive : pad);
        GUI.Label(r, text, label);
    }
}
