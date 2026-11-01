using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.EventSystems;
using UnityEngine.UI;

// Quiz Clash Arena. Add nothing to a scene: this bootstraps itself and builds
// its whole UI in code, so any scene (even an empty one) runs the game.
public class QuizClashArena : MonoBehaviour
{
    const int Rounds = 10, MaxHp = 100;
    const float TimeLimit = 15f;

    static readonly Color Bg = new Color32(0x0b, 0x10, 0x20, 255), Card = new Color32(0x1d, 0x25, 0x47, 255),
        You = new Color32(0x22, 0xd3, 0xa0, 255), Foe = new Color32(0xff, 0x5d, 0x73, 255),
        Gold = new Color32(0xff, 0xc8, 0x3d, 255), Blue = new Color32(0x4c, 0x8d, 0xff, 255);

    class Opt { public string ar, en; public bool ok, gone, picked; }

    // ---- state ----
    bool arabic;                       // English by default, see Shape() below
    string[][] qs; int qi; Opt[] opts;
    int you, foe, score, streak, bestStreak, correct;
    bool used5050, usedTime, locked;
    float start, limit;

    // ---- ui ----
    GameObject home, game, end;
    Text roundT, scoreT, streakT, youT, foeT, qT, toastT, endIcon, endTitle, endRank, endStats, bestT;
    RectTransform youBar, foeBar, timerBar;
    Button[] ansBtn = new Button[4]; Text[] ansTxt = new Text[4];
    Button b5050, bTime; Font font;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    static void Boot() { new GameObject("QuizClashArena").AddComponent<QuizClashArena>(); }

    void Start()
    {
        font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        if (FindFirstObjectByType<EventSystem>() == null)
        {
            var es = new GameObject("EventSystem").AddComponent<EventSystem>();
            // Works with either input backend (new Input System package or legacy).
            var ui = Type.GetType("UnityEngine.InputSystem.UI.InputSystemUIInputModule, Unity.InputSystem");
            es.gameObject.AddComponent(ui ?? typeof(StandaloneInputModule));
        }
        BuildUi(); ShowHome();
    }

    // Unity's Text/TextMeshPro do not join Arabic letters. Plug an Arabic shaping
    // library in here (see SETUP.md) before switching arabic = true in a build.
    string Shape(string s) => s;

    string L(string en, string ar) => Shape(arabic ? ar : en);

    // ---------------------------------------------------------------- UI build
    void BuildUi()
    {
        var cv = new GameObject("Canvas").AddComponent<Canvas>();
        cv.renderMode = RenderMode.ScreenSpaceOverlay;
        var sc = cv.gameObject.AddComponent<CanvasScaler>();
        sc.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        sc.referenceResolution = new Vector2(1080, 1920); sc.matchWidthOrHeight = 0.5f;
        cv.gameObject.AddComponent<GraphicRaycaster>();
        var bg = Panel(cv.transform, "Bg", Bg); Stretch(bg);

        home = Page(cv.transform, "Home"); game = Page(cv.transform, "Game"); end = Page(cv.transform, "End");

        // Home
        Spacer(home.transform, 120);
        Label(home.transform, "", 20, TextAnchor.MiddleCenter, 180);
        Label(home.transform, "Quiz Clash Arena", 72, TextAnchor.MiddleCenter, 110, Color.white);
        Label(home.transform, "10 rounds. Faster answers hit harder.\nStreaks of 3 do double damage.", 38, TextAnchor.MiddleCenter, 150, new Color(.6f, .64f, .81f));
        bestT = Label(home.transform, "", 38, TextAnchor.MiddleCenter, 60, Gold);
        Button(home.transform, "Start the clash", 120, Gold, Color.black, NewGame);
        Button(home.transform, "العربية / English", 90, Card, Color.white, () => { arabic = !arabic; ShowHome(); });

        // Game
        var hp = Row(game.transform, 90);
        youT = Label(hp, "", 36, TextAnchor.MiddleLeft, 90, Color.white);
        foeT = Label(hp, "", 36, TextAnchor.MiddleRight, 90, Color.white);
        youBar = Bar(game.transform, You); foeBar = Bar(game.transform, Foe);
        var meta = Row(game.transform, 60);
        roundT = Label(meta, "", 34, TextAnchor.MiddleLeft, 60, new Color(.6f, .64f, .81f));
        scoreT = Label(meta, "", 34, TextAnchor.MiddleCenter, 60, new Color(.6f, .64f, .81f));
        streakT = Label(meta, "", 34, TextAnchor.MiddleRight, 60, new Color(.6f, .64f, .81f));
        timerBar = Bar(game.transform, Blue);
        qT = Label(game.transform, "", 50, TextAnchor.MiddleCenter, 300, Color.white);
        for (int i = 0; i < 4; i++)
        {
            int k = i; ansBtn[i] = Button(game.transform, "", 120, Card, Color.white, () => Answer(k));
            ansTxt[i] = ansBtn[i].GetComponentInChildren<Text>();
        }
        toastT = Label(game.transform, "", 44, TextAnchor.MiddleCenter, 80, Color.white);
        var life = Row(game.transform, 110);
        b5050 = Button(life, "50/50", 110, Card, Color.white, Use5050);
        bTime = Button(life, "+5 sec", 110, Card, Color.white, UseTime);

        // End
        Spacer(end.transform, 120);
        endIcon = Label(end.transform, "", 160, TextAnchor.MiddleCenter, 200);
        endTitle = Label(end.transform, "", 80, TextAnchor.MiddleCenter, 120, Color.white);
        endRank = Label(end.transform, "", 44, TextAnchor.MiddleCenter, 80, Gold);
        endStats = Label(end.transform, "", 40, TextAnchor.MiddleCenter, 200, Color.white);
        Button(end.transform, "Play again", 120, Gold, Color.black, NewGame);
        Button(end.transform, "Home", 90, Card, Color.white, ShowHome);
    }

    GameObject Page(Transform p, string n)
    {
        var g = new GameObject(n, typeof(RectTransform)); g.transform.SetParent(p, false);
        Stretch(g.GetComponent<RectTransform>());
        var v = g.AddComponent<VerticalLayoutGroup>();
        v.padding = new RectOffset(60, 60, 60, 60); v.spacing = 20;
        v.childControlWidth = v.childControlHeight = true; v.childForceExpandWidth = true; v.childForceExpandHeight = false;
        return g;
    }
    RectTransform Row(Transform p, float h)
    {
        var g = new GameObject("Row", typeof(RectTransform)); g.transform.SetParent(p, false);
        var hl = g.AddComponent<HorizontalLayoutGroup>(); hl.spacing = 20;
        hl.childControlWidth = hl.childControlHeight = true; hl.childForceExpandWidth = true; hl.childForceExpandHeight = true;
        g.AddComponent<LayoutElement>().preferredHeight = h;
        return g.GetComponent<RectTransform>();
    }
    void Spacer(Transform p, float h) { var g = new GameObject("Spacer", typeof(RectTransform)); g.transform.SetParent(p, false); g.AddComponent<LayoutElement>().preferredHeight = h; }
    Image Panel(Transform p, string n, Color c) { var g = new GameObject(n, typeof(RectTransform), typeof(Image)); g.transform.SetParent(p, false); var i = g.GetComponent<Image>(); i.color = c; return i; }
    void Stretch(Graphic g) => Stretch(g.rectTransform);
    void Stretch(RectTransform r) { r.anchorMin = Vector2.zero; r.anchorMax = Vector2.one; r.offsetMin = r.offsetMax = Vector2.zero; }

    Text Label(Transform p, string s, int size, TextAnchor a, float h, Color? c = null)
    {
        var g = new GameObject("Text", typeof(RectTransform)); g.transform.SetParent(p, false);
        var t = g.AddComponent<Text>(); t.font = font; t.text = s; t.fontSize = size; t.alignment = a;
        t.color = c ?? Color.white; t.horizontalOverflow = HorizontalWrapMode.Wrap; t.verticalOverflow = VerticalWrapMode.Overflow;
        g.AddComponent<LayoutElement>().preferredHeight = h;
        return t;
    }
    Button Button(Transform p, string label, float h, Color bg, Color fg, UnityAction click)
    {
        var img = Panel(p, "Button", bg); var b = img.gameObject.AddComponent<Button>(); b.targetGraphic = img;
        b.onClick.AddListener(click); img.gameObject.AddComponent<LayoutElement>().preferredHeight = h;
        var t = Label(img.transform, label, 44, TextAnchor.MiddleCenter, h, fg);
        Stretch(t.rectTransform); Destroy(t.GetComponent<LayoutElement>());
        return b;
    }
    RectTransform Bar(Transform p, Color fill)
    {
        var back = Panel(p, "Bar", Card); back.gameObject.AddComponent<LayoutElement>().preferredHeight = 24;
        var f = Panel(back.transform, "Fill", fill); var r = f.rectTransform;
        r.anchorMin = Vector2.zero; r.anchorMax = Vector2.one; r.offsetMin = r.offsetMax = Vector2.zero;
        return r;
    }
    static void SetBar(RectTransform r, float v) => r.anchorMax = new Vector2(Mathf.Clamp01(v), 1);

    // ------------------------------------------------------------------ flow
    void ShowHome()
    {
        game.SetActive(false); end.SetActive(false); home.SetActive(true);
        int best = PlayerPrefs.GetInt("qcaBest", 0);
        bestT.text = best > 0 ? L("Best score: " + best, "أفضل نتيجة: " + best) : "";
    }

    void NewGame()
    {
        var all = new List<string[]>(QuizData.Questions); Shuffle(all);
        qs = all.GetRange(0, Rounds).ToArray(); qi = -1;
        you = foe = MaxHp; score = streak = bestStreak = correct = 0; used5050 = usedTime = false;
        home.SetActive(false); end.SetActive(false); game.SetActive(true);
        Next();
    }

    void Next()
    {
        if (you <= 0 || foe <= 0 || qi + 1 >= Rounds) { Finish(); return; }
        qi++;
        var q = qs[qi]; var ar = q[2].Split('|'); var en = q[3].Split('|');
        var order = new List<int> { 0, 1, 2, 3 }; Shuffle(order);
        opts = new Opt[4];
        for (int i = 0; i < 4; i++) opts[i] = new Opt { ar = ar[order[i]], en = en[order[i]], ok = order[i] == 0 };
        start = Time.time; limit = TimeLimit; locked = false; toastT.text = "";
        Render();
    }

    void Render()
    {
        var q = qs[qi];
        qT.text = Shape(arabic ? q[0] : q[1]);
        roundT.text = L($"Round {qi + 1}/{Rounds}", $"الجولة {qi + 1}/{Rounds}");
        scoreT.text = "Score " + score; streakT.text = "Streak " + streak;
        youT.text = L("You", "أنت") + "  " + Mathf.Max(0, you);
        foeT.text = L("Rival", "الخصم") + "  " + Mathf.Max(0, foe);
        SetBar(youBar, you / (float)MaxHp); SetBar(foeBar, foe / (float)MaxHp);
        for (int i = 0; i < 4; i++)
        {
            var o = opts[i]; ansTxt[i].text = Shape(arabic ? o.ar : o.en);
            ansBtn[i].interactable = !locked && !o.gone;
            var img = ansBtn[i].GetComponent<Image>();
            img.color = locked && o.ok ? new Color32(0x0f, 0x3b, 0x31, 255)
                      : locked && o.picked ? new Color32(0x47, 0x1b, 0x26, 255) : Card;
            ansTxt[i].color = o.gone ? new Color(1, 1, 1, .25f) : Color.white;
        }
        b5050.interactable = !used5050 && !locked; bTime.interactable = !usedTime && !locked;
    }

    void Update()
    {
        if (!game || !game.activeSelf || locked || opts == null) return;
        float left = Mathf.Max(0, limit - (Time.time - start));
        SetBar(timerBar, left / TimeLimit);
        if (left <= 0) Answer(-1);
    }

    void Answer(int idx)
    {
        if (locked) return; locked = true;
        float left = Mathf.Max(0, limit - (Time.time - start));
        string msg;
        if (idx >= 0 && opts[idx].ok)
        {
            opts[idx].picked = true; correct++; streak++; bestStreak = Mathf.Max(bestStreak, streak);
            float speed = left / TimeLimit;
            int dmg = Mathf.RoundToInt((14 + speed * 16) * (streak >= 3 ? 2 : 1));
            score += Mathf.RoundToInt(100 + speed * 100) + (streak >= 3 ? 50 : 0);
            foe -= dmg; toastT.color = You;
            msg = L("Correct! ", "صح! ") + "-" + dmg + (streak >= 3 ? " x2" : "");
        }
        else
        {
            if (idx >= 0) opts[idx].picked = true;
            streak = 0; int dmg = idx < 0 ? 15 : 20; you -= dmg; toastT.color = Foe;
            msg = (idx < 0 ? L("Time's up ", "انتهى الوقت ") : L("Wrong ", "خطأ ")) + "-" + dmg;
        }
        toastT.text = msg; Render(); StartCoroutine(Pause());
    }
    IEnumerator Pause() { yield return new WaitForSeconds(1.4f); Next(); }

    void Use5050()
    {
        if (used5050 || locked) return; used5050 = true;
        var wrong = new List<int>(); for (int i = 0; i < 4; i++) if (!opts[i].ok) wrong.Add(i);
        Shuffle(wrong); opts[wrong[0]].gone = opts[wrong[1]].gone = true; Render();
    }
    void UseTime() { if (usedTime || locked) return; usedTime = true; limit += 5f; Render(); }

    void Finish()
    {
        bool won = foe < you, lost = you < foe;
        int total = score + (won ? Mathf.Max(0, you) * 3 : 0);
        if (total > PlayerPrefs.GetInt("qcaBest", 0)) PlayerPrefs.SetInt("qcaBest", total);
        string[] ranks = { "Rookie", "Substitute", "Starter", "Star Player", "Legend" };
        endIcon.text = won ? "WIN" : lost ? "LOSS" : "DRAW";
        endTitle.text = won ? L("Victory!", "فزت!") : lost ? L("Defeated", "خسرت") : L("Draw", "تعادل");
        endRank.text = ranks[Mathf.Min(4, total / 450)] + " · " + total + " pts";
        endStats.text = $"{correct}/{Rounds} correct\nBest streak {bestStreak}";
        game.SetActive(false); end.SetActive(true);
    }

    static void Shuffle<T>(IList<T> a)
    {
        for (int i = a.Count - 1; i > 0; i--) { int j = UnityEngine.Random.Range(0, i + 1); (a[i], a[j]) = (a[j], a[i]); }
    }
}
