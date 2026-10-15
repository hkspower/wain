// Markers read by ../graft (see graft/Program.cs). Internal: the game's
// code never sees them.
using System;

/// <summary>This type is not a type: its members belong on the Unity type
/// named here (full metadata name, nested types as Outer/Inner) and are
/// copied onto it in the reference assemblies.</summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Struct, Inherited = false)]
sealed class GraftOntoAttribute : Attribute
{
    public GraftOntoAttribute(string type) { }
}

/// <summary>On a member of a [GraftOnto] type: the member is already on
/// the Unity type; take only its access and attributes from here (Unity 6's
/// [Obsolete] on a 2021.3 member, say).</summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Property | AttributeTargets.Field | AttributeTargets.Event, Inherited = false)]
sealed class ExistingAttribute : Attribute
{
}
