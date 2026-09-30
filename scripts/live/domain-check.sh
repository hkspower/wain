#!/bin/bash
# Why sporta.com.kw does not resolve — asked of the .com.kw registry itself.
#
#   bash /home/<user>/domain-check.sh
#
# READ-ONLY. It makes DNS queries and prints one line. It changes nothing, on
# the server or anywhere else, which matters because it is fetched over plain
# HTTP from a public repository by a cron job.
#
# WHY THE REGISTRY AND NOT A RESOLVER. A public resolver answering NXDOMAIN
# tells you the name did not resolve; it does not tell you WHERE that answer
# came from, and a cached negative can outlive the fault that caused it. The
# .com.kw nameservers are the authority on whether a delegation exists at all,
# so this asks them directly. If they return no NS records for the domain, the
# registration is the problem and nothing in DNS hosting can fix it.
#
# ONE LINE, because cron returns only the last one.

D=sporta.com.kw

# The registry's own nameservers. Everything below is asked of the first one.
TLD=$(dig +short NS com.kw @8.8.8.8 2>/dev/null | head -1)
TLDN=$(dig +short NS com.kw @8.8.8.8 2>/dev/null | wc -l)

# What a normal resolver says, and what the registry says. They should agree;
# where they differ, the registry is right and the resolver is holding a cache.
PUB=$(dig $D @8.8.8.8 2>/dev/null | grep -oE 'status: [A-Z]+' | head -1 | cut -d' ' -f2)
CF=$(dig $D @1.1.1.1 2>/dev/null | grep -oE 'status: [A-Z]+' | head -1 | cut -d' ' -f2)

# THE DECISIVE QUERY. Asked of the registry, for the delegation itself. A
# delegated domain answers with its nameservers in the AUTHORITY section even
# when the domain's own servers are down — that is the difference between "the
# registration is gone" and "the nameservers are unreachable".
REGNS=$(dig +noall +authority +answer $D NS @"$TLD" 2>/dev/null | grep -c 'NS')
REGST=$(dig $D NS @"$TLD" 2>/dev/null | grep -oE 'status: [A-Z]+' | head -1 | cut -d' ' -f2)

# A domain that IS delegated but broken still has a SOA somewhere.
SOA=$(dig +short SOA $D @8.8.8.8 2>/dev/null | head -1 | cut -d' ' -f1)

# The CNAME target, which has been healthy throughout — proof the hosting side
# is not the fault.
CDN=$(getent hosts www.$D.cdn.hstgr.net 2>/dev/null | wc -l)

# A control: if this fails too, the diagnosis is about this server's network.
CTL=$(getent hosts example.com 2>/dev/null | wc -l)

echo "DOMAIN tldNS=$TLDN via=${TLD:-none} google=${PUB:-?} cloudflare=${CF:-?} registryStatus=${REGST:-?} registryNSrecords=$REGNS soa=${SOA:-none} cdnTarget=$CDN control=$CTL"
