using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Networking;

namespace NightRacer.Cars
{
    /// <summary>
    /// The game's own cars, each its own asset.
    ///
    /// Where it looks, in order:
    ///   Resources/Cars/&lt;id&gt;/&lt;id&gt;.prefab  the car baked into Unity assets (Night Racer ▸
    ///                                   Bake Cars to Assets): its prefab, meshes, materials and
    ///                                   textures, with the hood, rear window, rear wing and tyres
    ///                                   as prefabs of their own. Loads instantly, ships in a build.
    ///   StreamingAssets/Cars/&lt;id&gt;.glb   the web build's export, read at runtime
    ///                                   (npm run sync:unity-cars copies them)
    ///   &lt;repo&gt;/press/renders/glb/&lt;id&gt;.glb the export itself, in the Editor only
    ///
    /// A car whose file is missing is not an error: CarFactory falls back to
    /// the procedural silhouette and says so once in the log.
    ///
    /// Reading and parsing run on a worker thread (CarAssetReader has no
    /// Unity dependency); building meshes, textures and materials happens on
    /// the main thread, one car per frame so boot does not hitch.
    /// </summary>
    public sealed class CarLibrary : MonoBehaviour
    {
        static CarLibrary instance;

        public static CarLibrary Instance
        {
            get
            {
                if (instance == null)
                {
                    var go = new GameObject("CarLibrary");
                    if (Application.isPlaying) DontDestroyOnLoad(go);
                    instance = go.AddComponent<CarLibrary>();
                }
                return instance;
            }
        }

        readonly Dictionary<string, CarModel> models = new Dictionary<string, CarModel>();
        readonly Dictionary<string, Task<CarAsset>> reading = new Dictionary<string, Task<CarAsset>>();
        readonly HashSet<string> missing = new HashSet<string>();
        Transform holder;

        /// <summary>Lamp level the materials are built for: 1 = night, the
        /// only time the game is set.</summary>
        public float Night = 1f;

        Transform Holder
        {
            get
            {
                if (holder == null)
                {
                    var h = new GameObject("CarTemplates");
                    h.transform.SetParent(transform, false);
                    h.SetActive(false); // templates never render
                    holder = h.transform;
                }
                return holder;
            }
        }

        /// <summary>The Resources path of a car's baked prefab.</summary>
        public static string ResourcePath(string id) => "Cars/" + id + "/" + id;

        /// <summary>The car's baked prefab, if it has been baked.</summary>
        public static GameObject BakedPrefab(string id) =>
            string.IsNullOrEmpty(id) ? null : Resources.Load<GameObject>(ResourcePath(id));

        /// <summary>Where a car's GLB is, or null.</summary>
        public static string PathFor(string id)
        {
            if (string.IsNullOrEmpty(id)) return null;
            var streaming = Path.Combine(Application.streamingAssetsPath, "Cars", id + ".glb");
            if (streaming.Contains("://")) return streaming; // Android/WebGL: read through UnityWebRequest
            if (File.Exists(streaming)) return streaming;
#if UNITY_EDITOR
            var repo = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "press", "renders", "glb", id + ".glb"));
            if (File.Exists(repo)) return repo;
#endif
            return null;
        }

        public bool TryGet(string id, out CarModel model)
        {
            model = null;
            return !string.IsNullOrEmpty(id) && models.TryGetValue(id, out model) && model != null;
        }

        public bool IsMissing(string id) => missing.Contains(id);

        /// <summary>Start reading a car in the background if it is not
        /// loaded, loading or known missing.</summary>
        public void Request(string id)
        {
            if (string.IsNullOrEmpty(id) || models.ContainsKey(id) || reading.ContainsKey(id) || missing.Contains(id)) return;
            var baked = BakedPrefab(id);
            if (baked != null)
            {
                models[id] = CarModel.FromPrefab(id, baked);
                return;
            }
            var path = PathFor(id);
            if (path == null)
            {
                missing.Add(id);
                Debug.Log($"[cars] no GLB for {id} — it drives the procedural body. Run `npm run cars:export` then `npm run sync:unity-cars`.");
                return;
            }
            if (path.Contains("://"))
            {
                var tcs = new TaskCompletionSource<CarAsset>();
                reading[id] = tcs.Task;
                StartCoroutine(Fetch(id, path, tcs));
                return;
            }
            reading[id] = Task.Run(() => CarAssetReader.Read(File.ReadAllBytes(path), id));
        }

        IEnumerator Fetch(string id, string url, TaskCompletionSource<CarAsset> tcs)
        {
            using (var req = UnityWebRequest.Get(url))
            {
                yield return req.SendWebRequest();
                if (req.result != UnityWebRequest.Result.Success)
                {
                    tcs.SetException(new IOException(req.error));
                    yield break;
                }
                var bytes = req.downloadHandler.data;
                var t = Task.Run(() => CarAssetReader.Read(bytes, id));
                while (!t.IsCompleted) yield return null;
                if (t.IsFaulted) tcs.SetException(t.Exception.InnerException ?? t.Exception);
                else tcs.SetResult(t.Result);
            }
        }

        /// <summary>Request these cars and wait (as a coroutine) until every
        /// one is built, missing or failed — or until <paramref name="timeout"/>
        /// seconds have passed, after which the stragglers keep loading in
        /// the background and the game starts with what it has.</summary>
        public IEnumerator Preload(IEnumerable<string> ids, float timeout = 30f)
        {
            var want = new List<string>();
            foreach (var id in ids)
                if (!string.IsNullOrEmpty(id) && !want.Contains(id)) { want.Add(id); Request(id); }
            float until = Time.realtimeSinceStartup + timeout;
            while (Time.realtimeSinceStartup < until)
            {
                Pump(1);
                bool done = true;
                foreach (var id in want)
                    if (reading.ContainsKey(id)) { done = false; break; }
                if (done) yield break;
                yield return null;
            }
        }

        /// <summary>Load a car right now, on this thread (the Editor studio
        /// and batch renders, where nothing else is waiting).</summary>
        public CarModel LoadNow(string id)
        {
            if (TryGet(id, out var m)) return m;
            var baked = BakedPrefab(id);
            if (baked != null) return models[id] = CarModel.FromPrefab(id, baked);
            if (reading.TryGetValue(id, out var task))
            {
                task.Wait();
                Pump(int.MaxValue);
                return TryGet(id, out m) ? m : null;
            }
            var path = PathFor(id);
            if (path == null || path.Contains("://")) { missing.Add(id); return null; }
            var asset = CarAssetReader.Read(File.ReadAllBytes(path), id);
            return Add(asset);
        }

        void Update() => Pump(1);

        /// <summary>Build up to <paramref name="budget"/> finished reads.</summary>
        void Pump(int budget)
        {
            if (reading.Count == 0) return;
            List<string> finished = null;
            foreach (var kv in reading)
                if (kv.Value.IsCompleted) (finished ?? (finished = new List<string>())).Add(kv.Key);
            if (finished == null) return;
            foreach (var id in finished)
            {
                if (budget-- <= 0) break;
                var task = reading[id];
                reading.Remove(id);
                if (task.IsFaulted || task.IsCanceled)
                {
                    missing.Add(id);
                    var e = task.Exception?.InnerException ?? task.Exception;
                    Debug.LogWarning($"[cars] {id} did not load: {e?.Message}");
                    continue;
                }
                try { Add(task.Result); }
                catch (Exception e)
                {
                    missing.Add(id);
                    Debug.LogWarning($"[cars] {id} did not build: {e}");
                }
            }
        }

        /// <summary>Read a car from its GLB, ignoring any baked prefab (the
        /// baker's source). Null when there is no GLB.</summary>
        public static CarAsset ReadGlb(string id)
        {
            var path = PathFor(id);
            if (path == null || path.Contains("://")) return null;
            return CarAssetReader.Read(File.ReadAllBytes(path), id);
        }

        CarModel Add(CarAsset asset)
        {
            var t0 = Time.realtimeSinceStartup;
            var model = CarModel.Build(asset, Holder, Night);
            models[asset.Id] = model;
            Debug.Log($"[cars] {asset.Id}: {asset.Triangles:N0} triangles, {asset.Wheels.Length} wheels, " +
                      $"{asset.Finish} — built in {(Time.realtimeSinceStartup - t0) * 1000f:F0} ms");
            return model;
        }
    }
}
