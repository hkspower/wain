index($0, "# ---- Old-site URLs Google still requests") { inblk = 1 }
inblk { blk = blk $0 "\n"; if (index($0, "RewriteRule ^image/(cache|catalog)/")) inblk = 0; next }
{ L[++n] = $0 }
END {
  for (i = 1; i <= n; i++) {
    print L[i]
    if (index(L[i], "# ---- Canonicalise host")) seen = 1
    if (seen && !done && L[i] == "  RewriteEngine On") {
      print ""
      print "  # Aliases sit ABOVE the host rule so sporta.com.kw/x also lands in ONE hop."
      printf "%s", blk
      done = 1
    }
  }
}
