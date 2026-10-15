using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace NightRacer.Cars
{
    /// <summary>
    /// A small, strict JSON reader: objects become Dictionary&lt;string,object&gt;,
    /// arrays List&lt;object&gt;, numbers double, plus string, bool and null.
    ///
    /// JsonUtility cannot read glTF: it has no dictionaries, no way to tell
    /// an absent index from index 0, and no extension objects whose keys it
    /// was not told about at compile time. This has none of those limits and
    /// no Unity dependency, so the car reader built on it is compiled and
    /// tested outside Unity against the real GLBs (tools/unity/carcheck).
    /// </summary>
    public static class MiniJson
    {
        public static object Parse(string text)
        {
            int i = 0;
            var v = Value(text, ref i);
            Skip(text, ref i);
            if (i != text.Length) throw new FormatException($"JSON: trailing data at {i}");
            return v;
        }

        static void Skip(string s, ref int i)
        {
            while (i < s.Length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++;
        }

        static object Value(string s, ref int i)
        {
            Skip(s, ref i);
            if (i >= s.Length) throw new FormatException("JSON: unexpected end");
            char c = s[i];
            if (c == '{') return Obj(s, ref i);
            if (c == '[') return Arr(s, ref i);
            if (c == '"') return Str(s, ref i);
            if (c == 't' && Lit(s, ref i, "true")) return true;
            if (c == 'f' && Lit(s, ref i, "false")) return false;
            if (c == 'n' && Lit(s, ref i, "null")) return null;
            return Num(s, ref i);
        }

        static bool Lit(string s, ref int i, string word)
        {
            if (string.CompareOrdinal(s, i, word, 0, word.Length) != 0)
                throw new FormatException($"JSON: bad literal at {i}");
            i += word.Length;
            return true;
        }

        static Dictionary<string, object> Obj(string s, ref int i)
        {
            var d = new Dictionary<string, object>();
            i++; // {
            Skip(s, ref i);
            if (s[i] == '}') { i++; return d; }
            while (true)
            {
                Skip(s, ref i);
                string key = Str(s, ref i);
                Skip(s, ref i);
                if (s[i] != ':') throw new FormatException($"JSON: expected ':' at {i}");
                i++;
                d[key] = Value(s, ref i);
                Skip(s, ref i);
                if (s[i] == ',') { i++; continue; }
                if (s[i] == '}') { i++; return d; }
                throw new FormatException($"JSON: expected ',' or '}}' at {i}");
            }
        }

        static List<object> Arr(string s, ref int i)
        {
            var a = new List<object>();
            i++; // [
            Skip(s, ref i);
            if (s[i] == ']') { i++; return a; }
            while (true)
            {
                a.Add(Value(s, ref i));
                Skip(s, ref i);
                if (s[i] == ',') { i++; continue; }
                if (s[i] == ']') { i++; return a; }
                throw new FormatException($"JSON: expected ',' or ']' at {i}");
            }
        }

        static string Str(string s, ref int i)
        {
            if (s[i] != '"') throw new FormatException($"JSON: expected string at {i}");
            i++;
            var sb = new StringBuilder();
            while (i < s.Length)
            {
                char c = s[i++];
                if (c == '"') return sb.ToString();
                if (c != '\\') { sb.Append(c); continue; }
                char e = s[i++];
                switch (e)
                {
                    case '"': sb.Append('"'); break;
                    case '\\': sb.Append('\\'); break;
                    case '/': sb.Append('/'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'u':
                        sb.Append((char)int.Parse(s.Substring(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                        i += 4;
                        break;
                    default: throw new FormatException($"JSON: bad escape at {i}");
                }
            }
            throw new FormatException("JSON: unterminated string");
        }

        static double Num(string s, ref int i)
        {
            int start = i;
            if (s[i] == '-') i++;
            while (i < s.Length && "0123456789+-.eE".IndexOf(s[i]) >= 0) i++;
            if (i == start) throw new FormatException($"JSON: unexpected '{s[i]}' at {i}");
            return double.Parse(s.Substring(start, i - start), NumberStyles.Float, CultureInfo.InvariantCulture);
        }

        // --- Typed access, with an explicit fallback for an absent key. ---

        public static Dictionary<string, object> O(object o, string key) =>
            o is Dictionary<string, object> d && d.TryGetValue(key, out var v) ? v as Dictionary<string, object> : null;

        public static List<object> A(object o, string key) =>
            o is Dictionary<string, object> d && d.TryGetValue(key, out var v) ? v as List<object> : null;

        public static bool Has(object o, string key) =>
            o is Dictionary<string, object> d && d.ContainsKey(key);

        public static double N(object o, string key, double fallback) =>
            o is Dictionary<string, object> d && d.TryGetValue(key, out var v) && v is double x ? x : fallback;

        public static int I(object o, string key, int fallback) =>
            o is Dictionary<string, object> d && d.TryGetValue(key, out var v) && v is double x ? (int)x : fallback;

        public static string S(object o, string key, string fallback) =>
            o is Dictionary<string, object> d && d.TryGetValue(key, out var v) && v is string x ? x : fallback;

        public static float[] F(object o, string key)
        {
            var a = A(o, key);
            if (a == null) return null;
            var r = new float[a.Count];
            for (int k = 0; k < a.Count; k++) r[k] = a[k] is double x ? (float)x : 0f;
            return r;
        }
    }
}
