using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

// Entry points for `unity build ... --execute-method Builder.BuildLinux|BuildWebGL`.
public static class Builder
{
    static void Run(BuildTarget target, BuildTargetGroup group, string outPath)
    {
        // Quiz Clash Arena builds its whole UI in code, so one empty scene is enough.
        const string scene = "Assets/Scenes/Main.unity";
        if (!File.Exists(scene))
        {
            Directory.CreateDirectory("Assets/Scenes");
            UnityEditor.SceneManagement.EditorSceneManager.SaveScene(
                UnityEditor.SceneManagement.EditorSceneManager.NewScene(
                    UnityEditor.SceneManagement.NewSceneSetup.EmptyScene), scene);
        }
        Directory.CreateDirectory(Path.GetDirectoryName(outPath));
        var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
        {
            scenes = new[] { scene }, target = target, locationPathName = outPath,
        });
        if (report.summary.result != BuildResult.Succeeded)
            EditorApplication.Exit(1);
    }

    public static void BuildLinux()  => Run(BuildTarget.StandaloneLinux64, BuildTargetGroup.Standalone, "Builds/Linux/QuizClashArena.x86_64");
    public static void BuildWebGL()  => Run(BuildTarget.WebGL, BuildTargetGroup.WebGL, "Builds/WebGL/index.html");
}
