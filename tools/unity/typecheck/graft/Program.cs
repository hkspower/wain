// Turns the Unity reference assemblies from NuGet into the Unity 6000.0
// API the project is written against, for the type check in
// ../typecheck.csproj. It works on copies in obj/ and does three things:
//
// 1. Access. UnityEngine.Modules 2021.3.33 ships "publicized" assemblies
//    (made with BepInEx.AssemblyPublicizer): Unity's internal, private and
//    protected members are public in them, so code calling
//    RenderSettings.GetRenderSettings or a *_Injected binding would pass
//    the check and fail in Unity. The publicizer kept each original
//    modifier in an [OriginalAttributes] attribute; every one is put back.
//
// 2. Facade. Unity3D.SDK's UnityEditor.dll (2021.1.14) was built against
//    the single UnityEngine.dll of its day, while the engine references are
//    the per-module assemblies. The package's UnityEngine.dll is rewritten
//    to forward every public engine type to the module that defines it,
//    as Unity's own UnityEngine.dll facade does, so both resolve to the
//    same types.
//
// 3. Grafts. A type in the stubs assembly marked [GraftOnto("T")] is not a
//    type of its own: its members are copied onto the real type T (which
//    must exist in the references), because C# cannot add a static
//    property to RenderSettings or a nested class to RenderPipeline from
//    outside. A member marked [Existing] is not copied: it must already be
//    on T, and its access, attributes (say, Unity 6's [Obsolete]) and, for
//    a property, its type are set from the declaration. A graft that the
//    references already have, or a target that doesn't exist, is an error.
//
//   graft --unity <dir of UnityEngine*.dll> --editor <UnityEditor.dll>
//         [--stubs <UnityStubs.dll>] --out <dir>
//
// Writes <out>/engine/*.dll and <out>/editor/UnityEditor.dll. It runs
// twice: without --stubs (1 and 2 only) for the references the stubs are
// compiled against, so they see Unity's real modifiers too, then with the
// stubs over that output. Errors print in MSBuild's canonical format, so
// they surface as build errors.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Mono.Cecil;
using Mono.Cecil.Cil;

static class Program
{
    const string Origin = "tools/unity/typecheck/stubs";
    static int errors;

    internal static void Error(string message)
    {
        Console.WriteLine($"{Origin} : error GRAFT: {message}");
        errors++;
    }

    static int Main(string[] args)
    {
        var opt = new Dictionary<string, string>();
        for (int i = 0; i + 1 < args.Length; i += 2) opt[args[i]] = args[i + 1];
        if (!opt.TryGetValue("--unity", out var unityDir) || !opt.TryGetValue("--editor", out var editorPath) ||
            !opt.TryGetValue("--out", out var outDir))
        {
            Console.Error.WriteLine("usage: graft --unity <dir> --editor <UnityEditor.dll> [--stubs <UnityStubs.dll>] --out <dir>");
            return 2;
        }
        opt.TryGetValue("--stubs", out var stubsPath);

        var resolver = new DefaultAssemblyResolver();
        resolver.AddSearchDirectory(unityDir);
        resolver.AddSearchDirectory(Path.GetDirectoryName(Path.GetFullPath(editorPath)));
        if (stubsPath != null) resolver.AddSearchDirectory(Path.GetDirectoryName(Path.GetFullPath(stubsPath)));
        var read = new ReaderParameters { AssemblyResolver = resolver, InMemory = true, ReadingMode = ReadingMode.Immediate };

        var engine = Directory.GetFiles(unityDir, "*.dll")
            .OrderBy(f => f, StringComparer.Ordinal)
            .Select(f => ModuleDefinition.ReadModule(f, read))
            .ToList();
        var facade = engine.FirstOrDefault(m => m.Assembly.Name.Name == "UnityEngine");
        if (engine.Count == 0 || facade == null)
        {
            Error($"no UnityEngine.dll / UnityEngine.*Module.dll in {unityDir}");
            return 1;
        }
        var editor = ModuleDefinition.ReadModule(editorPath, read);

        var types = new Dictionary<string, TypeDefinition>(StringComparer.Ordinal);
        foreach (var m in engine.Where(m => m != facade).Append(editor))
            foreach (var t in m.GetTypes())
                types.TryAdd(t.FullName, t);

        var changed = new HashSet<ModuleDefinition>();
        int restored = engine.Sum(m => Access.Restore(m, changed));
        int forwarded = Facade.Forward(facade, engine.Where(m => m != facade));
        if (forwarded > 0) changed.Add(facade);
        int grafted = 0;
        if (stubsPath != null)
        {
            using var stubs = ModuleDefinition.ReadModule(stubsPath, read);
            grafted = Grafter.Apply(stubs, types, changed);
        }

        if (errors > 0) return 1;

        var engineOut = Path.Combine(outDir, "engine");
        var editorOut = Path.Combine(outDir, "editor");
        Directory.CreateDirectory(engineOut);
        Directory.CreateDirectory(editorOut);
        foreach (var m in engine.Append(editor))
        {
            var to = Path.Combine(m == editor ? editorOut : engineOut, Path.GetFileName(m.FileName));
            if (changed.Contains(m)) m.Write(to);
            else File.Copy(m.FileName, to, overwrite: true);
        }
        Console.WriteLine($"graft: {restored} access modifiers restored, {forwarded} types forwarded by UnityEngine.dll, " +
                          $"{grafted} members grafted -> {outDir}");
        return 0;
    }
}

static class Access
{
    // BepInEx.AssemblyPublicizer's record of what it changed: one int
    // argument, the original TypeAttributes / MethodAttributes /
    // FieldAttributes access bits.
    static int? Original(ICustomAttributeProvider p)
    {
        var a = p.CustomAttributes.FirstOrDefault(x => x.AttributeType.Name == "OriginalAttributesAttribute");
        return a == null ? (int?)null : Convert.ToInt32(a.ConstructorArguments[0].Value);
    }

    internal static int Restore(ModuleDefinition m, HashSet<ModuleDefinition> changed)
    {
        int n = 0;
        foreach (var t in m.GetTypes())
        {
            if (Original(t) is int ta)
            {
                var a = (t.Attributes & ~TypeAttributes.VisibilityMask) | ((TypeAttributes)ta & TypeAttributes.VisibilityMask);
                if (a != t.Attributes) { t.Attributes = a; n++; }
            }
            foreach (var x in t.Methods)
                if (Original(x) is int ma)
                {
                    var a = (x.Attributes & ~MethodAttributes.MemberAccessMask) | ((MethodAttributes)ma & MethodAttributes.MemberAccessMask);
                    if (a != x.Attributes) { x.Attributes = a; n++; }
                }
            foreach (var x in t.Fields)
                if (Original(x) is int fa)
                {
                    var a = (x.Attributes & ~FieldAttributes.FieldAccessMask) | ((FieldAttributes)fa & FieldAttributes.FieldAccessMask);
                    if (a != x.Attributes) { x.Attributes = a; n++; }
                }
        }
        if (n > 0) changed.Add(m);
        return n;
    }
}

static class Facade
{
    internal static int Forward(ModuleDefinition facade, IEnumerable<ModuleDefinition> modules)
    {
        var own = new HashSet<string>(facade.Types.Select(t => t.FullName), StringComparer.Ordinal);
        own.UnionWith(facade.ExportedTypes.Select(t => t.FullName));
        int n = 0;
        foreach (var m in modules)
        {
            var scope = facade.AssemblyReferences.FirstOrDefault(r => r.Name == m.Assembly.Name.Name);
            if (scope == null)
            {
                scope = new AssemblyNameReference(m.Assembly.Name.Name, m.Assembly.Name.Version);
                facade.AssemblyReferences.Add(scope);
            }
            foreach (var t in m.Types)
            {
                if (!t.IsPublic || !own.Add(t.FullName)) continue;
                facade.ExportedTypes.Add(new ExportedType(t.Namespace, t.Name, facade, scope) { IsForwarder = true });
                n++;
            }
        }
        return n;
    }
}

sealed class Grafter
{
    readonly ModuleDefinition stubs;
    readonly Dictionary<string, TypeDefinition> types;
    // Holder types, and the nested types declared inside them -> the real
    // type they now stand for.
    readonly Dictionary<TypeDefinition, TypeDefinition> map = new Dictionary<TypeDefinition, TypeDefinition>();
    int count;

    Grafter(ModuleDefinition stubs, Dictionary<string, TypeDefinition> types)
    {
        this.stubs = stubs;
        this.types = types;
    }

    static CustomAttribute Marker(ICustomAttributeProvider p, string name) =>
        p?.CustomAttributes.FirstOrDefault(a => a.AttributeType.Name == name);

    internal static int Apply(ModuleDefinition stubs, Dictionary<string, TypeDefinition> types, HashSet<ModuleDefinition> changed)
    {
        var g = new Grafter(stubs, types);
        var holders = new List<(TypeDefinition holder, TypeDefinition target)>();
        foreach (var h in stubs.Types)
        {
            var mark = Marker(h, "GraftOntoAttribute");
            if (mark == null) continue;
            var name = (string)mark.ConstructorArguments[0].Value;
            if (!types.TryGetValue(name, out var target))
            {
                Program.Error($"[GraftOnto(\"{name}\")] on {h.FullName}: no such type in the Unity references");
                continue;
            }
            g.map[h] = target;
            holders.Add((h, target));
            changed.Add(target.Module);
        }
        // Shells for nested types first, so members can refer to them.
        foreach (var (h, t) in holders) g.DeclareNested(h, t);
        foreach (var (h, t) in holders) g.CopyMembers(h, t, isHolder: true);
        return g.count;
    }

    void DeclareNested(TypeDefinition from, TypeDefinition into)
    {
        foreach (var n in from.NestedTypes)
        {
            if (n.HasGenericParameters)
            {
                Program.Error($"{n.FullName}: generic nested types are not supported by the grafter");
                continue;
            }
            if (into.NestedTypes.Any(x => x.Name == n.Name))
            {
                Program.Error($"{into.FullName} already has a nested type {n.Name}; delete it from {from.FullName}");
                continue;
            }
            var t = new TypeDefinition("", n.Name, n.Attributes);
            into.NestedTypes.Add(t);
            map[n] = t;
            count++;
            DeclareNested(n, t);
        }
    }

    // ---- type mapping -----------------------------------------------------

    MethodDefinition generic; // the method whose generic parameters !!0.. refer to

    TypeReference Map(TypeReference r, ModuleDefinition into)
    {
        switch (r)
        {
            case null: return null;
            case GenericParameter gp when gp.Type == GenericParameterType.Method && generic != null:
                return generic.GenericParameters[gp.Position];
            case GenericParameter gp:
                throw new NotSupportedException($"type-level generic parameter {gp.Name}");
            case ArrayType a:
                return a.IsVector ? new ArrayType(Map(a.ElementType, into)) : new ArrayType(Map(a.ElementType, into), a.Rank);
            case ByReferenceType b: return new ByReferenceType(Map(b.ElementType, into));
            case PointerType p: return new PointerType(Map(p.ElementType, into));
            case RequiredModifierType q: return new RequiredModifierType(Map(q.ModifierType, into), Map(q.ElementType, into));
            case OptionalModifierType o: return new OptionalModifierType(Map(o.ModifierType, into), Map(o.ElementType, into));
            case GenericInstanceType gi:
            {
                var x = new GenericInstanceType(Map(gi.ElementType, into));
                foreach (var a in gi.GenericArguments) x.GenericArguments.Add(Map(a, into));
                return x;
            }
            case TypeDefinition d when d.Module == stubs:
                if (map.TryGetValue(d, out var real)) return real.Module == into ? real : into.ImportReference(real);
                return into.ImportReference(d); // a new public type of the stubs assembly
        }
        // A reference into some assembly. Into its own assembly it must be the
        // definition, not a reference to itself.
        if (r.Scope is AssemblyNameReference an && an.Name == into.Assembly.Name.Name)
        {
            if (types.TryGetValue(r.FullName, out var own) && own.Module == into) return own;
            throw new InvalidOperationException($"{r.FullName} not found in {into.Name}");
        }
        return into.ImportReference(r);
    }

    MethodReference MapMethod(MethodReference m, ModuleDefinition into)
    {
        var x = new MethodReference(m.Name, into.TypeSystem.Void, Map(m.DeclaringType, into))
        {
            HasThis = m.HasThis, ExplicitThis = m.ExplicitThis, CallingConvention = m.CallingConvention,
        };
        x.ReturnType = Map(m.ReturnType, into);
        foreach (var p in m.Parameters) x.Parameters.Add(new ParameterDefinition(Map(p.ParameterType, into)));
        return x;
    }

    CustomAttributeArgument MapArg(CustomAttributeArgument a, ModuleDefinition into) =>
        new CustomAttributeArgument(Map(a.Type, into), a.Value switch
        {
            TypeReference t => Map(t, into),
            CustomAttributeArgument[] arr => arr.Select(e => MapArg(e, into)).ToArray(),
            CustomAttributeArgument inner => MapArg(inner, into),
            var v => v,
        });

    static readonly HashSet<string> Skip = new HashSet<string>
    {
        "GraftOntoAttribute", "ExistingAttribute", "CompilerGeneratedAttribute",
        "NullableAttribute", "NullableContextAttribute",
    };

    void CopyAttributes(ICustomAttributeProvider from, ICustomAttributeProvider to, ModuleDefinition into)
    {
        foreach (var a in from.CustomAttributes)
        {
            if (Skip.Contains(a.AttributeType.Name)) continue;
            var x = new CustomAttribute(MapMethod(a.Constructor, into));
            foreach (var arg in a.ConstructorArguments) x.ConstructorArguments.Add(MapArg(arg, into));
            foreach (var f in a.Fields) x.Fields.Add(new CustomAttributeNamedArgument(f.Name, MapArg(f.Argument, into)));
            foreach (var p in a.Properties) x.Properties.Add(new CustomAttributeNamedArgument(p.Name, MapArg(p.Argument, into)));
            to.CustomAttributes.Add(x);
        }
    }

    // ---- members ----------------------------------------------------------

    // Name, generic arity and parameter types, with holder-declared types
    // under the names they will have on the target.
    string Sig(MethodReference m) =>
        $"{m.Name}`{m.GenericParameters.Count}({string.Join(",", m.Parameters.Select(p => SigType(p.ParameterType)))})";

    string SigType(TypeReference t)
    {
        if (t is TypeDefinition d && d.Module == stubs && map.TryGetValue(d, out var real)) return real.FullName;
        return t is GenericParameter gp ? "!!" + gp.Position : t.FullName;
    }

    void CopyMembers(TypeDefinition from, TypeDefinition into, bool isHolder)
    {
        var module = into.Module;
        var methods = new Dictionary<MethodDefinition, MethodDefinition>();

        foreach (var m in from.Methods)
        {
            // The C# compiler's default constructor of a holder class is not
            // part of the graft; constructors with parameters are.
            if (isHolder && m.IsConstructor && (m.IsStatic || !m.HasParameters)) continue;
            bool accessor = m.IsGetter || m.IsSetter || m.IsAddOn || m.IsRemoveOn;
            ICustomAttributeProvider owner = m;
            if (accessor)
                owner = (ICustomAttributeProvider)from.Properties.FirstOrDefault(p => p.GetMethod == m || p.SetMethod == m)
                        ?? from.Events.FirstOrDefault(e => e.AddMethod == m || e.RemoveMethod == m);
            var existing = into.Methods.FirstOrDefault(x => Sig(x) == Sig(m));
            if (Marker(owner, "ExistingAttribute") != null)
            {
                // An accessor is matched by name: the property's type may be
                // the thing that changed (handled with the property below).
                if (accessor) existing = into.Methods.FirstOrDefault(x => x.Name == m.Name);
                if (existing == null)
                {
                    Program.Error($"[Existing] {into.FullName}.{m.Name}: not in the Unity references");
                    continue;
                }
                existing.Attributes = (existing.Attributes & ~MethodAttributes.MemberAccessMask) |
                                      (m.Attributes & MethodAttributes.MemberAccessMask);
                if (!accessor) CopyAttributes(m, existing, module);
                count++;
                continue;
            }
            if (existing != null)
            {
                Program.Error($"{into.FullName}.{m.Name}: already in the Unity references; delete the graft in {from.FullName}");
                continue;
            }
            methods[m] = CopyMethod(m, into);
        }

        foreach (var p in from.Properties)
        {
            var existing = into.Properties.FirstOrDefault(x => x.Name == p.Name);
            if (Marker(p, "ExistingAttribute") != null)
            {
                if (existing == null)
                {
                    Program.Error($"[Existing] {into.FullName}.{p.Name}: not in the Unity references");
                    continue;
                }
                // Unity 6 may have changed the type (customReflection:
                // Texture in 2021.3, Cubemap in 6000.0); the declaration wins.
                var type = Map(p.PropertyType, module);
                if (type.FullName != existing.PropertyType.FullName)
                {
                    existing.PropertyType = type;
                    if (existing.GetMethod != null) existing.GetMethod.ReturnType = type;
                    if (existing.SetMethod != null) existing.SetMethod.Parameters[existing.SetMethod.Parameters.Count - 1].ParameterType = type;
                }
                CopyAttributes(p, existing, module);
                continue;
            }
            if (existing != null)
            {
                Program.Error($"{into.FullName}.{p.Name}: already in the Unity references; delete the graft in {from.FullName}");
                continue;
            }
            var np = new PropertyDefinition(p.Name, p.Attributes, Map(p.PropertyType, module)) { HasThis = p.HasThis };
            if (p.GetMethod != null && methods.TryGetValue(p.GetMethod, out var g)) np.GetMethod = g;
            if (p.SetMethod != null && methods.TryGetValue(p.SetMethod, out var s)) np.SetMethod = s;
            foreach (var x in p.Parameters) np.Parameters.Add(new ParameterDefinition(x.Name, x.Attributes, Map(x.ParameterType, module)));
            CopyAttributes(p, np, module);
            into.Properties.Add(np);
            count++;
        }

        foreach (var e in from.Events)
        {
            if (Marker(e, "ExistingAttribute") != null) continue;
            if (into.Events.Any(x => x.Name == e.Name))
            {
                Program.Error($"{into.FullName}.{e.Name}: already in the Unity references; delete the graft in {from.FullName}");
                continue;
            }
            var ne = new EventDefinition(e.Name, e.Attributes, Map(e.EventType, module));
            if (e.AddMethod != null && methods.TryGetValue(e.AddMethod, out var a)) ne.AddMethod = a;
            if (e.RemoveMethod != null && methods.TryGetValue(e.RemoveMethod, out var r)) ne.RemoveMethod = r;
            CopyAttributes(e, ne, module);
            into.Events.Add(ne);
            count++;
        }

        foreach (var f in from.Fields)
        {
            if (f.Name.StartsWith("<", StringComparison.Ordinal)) continue; // auto-property backing field
            if (Marker(f, "ExistingAttribute") != null) continue;
            if (into.Fields.Any(x => x.Name == f.Name))
            {
                Program.Error($"{into.FullName}.{f.Name}: already in the Unity references; delete the graft in {from.FullName}");
                continue;
            }
            var nf = new FieldDefinition(f.Name, f.Attributes, Map(f.FieldType, module));
            if (f.HasConstant) nf.Constant = f.Constant;
            CopyAttributes(f, nf, module);
            into.Fields.Add(nf);
            count++;
        }

        foreach (var n in from.NestedTypes)
        {
            if (!map.TryGetValue(n, out var t)) continue; // reported in DeclareNested
            t.BaseType = Map(n.BaseType, module);
            foreach (var i in n.Interfaces) t.Interfaces.Add(new InterfaceImplementation(Map(i.InterfaceType, module)));
            CopyAttributes(n, t, module);
            CopyMembers(n, t, isHolder: false);
        }
    }

    MethodDefinition CopyMethod(MethodDefinition m, TypeDefinition into)
    {
        var module = into.Module;
        var x = new MethodDefinition(m.Name, m.Attributes, module.TypeSystem.Void)
        {
            ImplAttributes = m.ImplAttributes,
            HasThis = m.HasThis,
            ExplicitThis = m.ExplicitThis,
            CallingConvention = m.CallingConvention,
        };
        into.Methods.Add(x);
        foreach (var gp in m.GenericParameters)
            x.GenericParameters.Add(new GenericParameter(gp.Name, x) { Attributes = gp.Attributes });
        generic = x;
        try
        {
            for (int i = 0; i < m.GenericParameters.Count; i++)
                foreach (var c in m.GenericParameters[i].Constraints)
                    x.GenericParameters[i].Constraints.Add(new GenericParameterConstraint(Map(c.ConstraintType, module)));
            x.ReturnType = Map(m.ReturnType, module);
            CopyAttributes(m.MethodReturnType, x.MethodReturnType, module);
            foreach (var p in m.Parameters)
            {
                var np = new ParameterDefinition(p.Name, p.Attributes, Map(p.ParameterType, module));
                if (p.HasConstant) np.Constant = p.Constant;
                CopyAttributes(p, np, module);
                x.Parameters.Add(np);
            }
            CopyAttributes(m, x, module);
        }
        finally { generic = null; }

        // Reference assemblies are never run; Roslyn reads only metadata.
        // A body keeps the image valid for any other reader.
        if (m.HasBody)
        {
            var il = x.Body.GetILProcessor();
            il.Emit(OpCodes.Ldnull);
            il.Emit(OpCodes.Throw);
        }
        count++;
        return x;
    }
}
