# The hub, containerised.
#
# The hub is one plain-Node process with one npm dependency (ws) and one
# file of state. The image mirrors that: install the single dependency
# it needs, copy the server files, run it. No build step exists
# because none is needed — shipping a bundler for a few files of .mjs
# would be ceremony.
#
#   docker build -t grn-hub -f server/Dockerfile .
#   docker run -d --name grn-hub -p 8787:8787 -v grn-ledger:/data \
#     -e HUB_LEDGER=/data/referrals.json \
#     -e HUB_PART_PROPOSALS=/data/part-proposals.json \
#     -e HUB_ADMINS=/data/admins.json -e HUB_ADMIN_AUDIT=/data/admin-audit.json \
#     grn-hub
#   docker exec -it grn-hub node server/admin-cli.mjs add <name> --role owner
#
# The volume is not optional in any deployment that matters: the ledger
# holds referrals and crews — the two things the server promises survive
# a restart — the admin accounts are who can sign in to /admin, and a
# container's own filesystem dies with it.
FROM node:22-alpine
WORKDIR /app
# Only ws. Installing from the game's package.json would pull Next,
# three and playwright into a server that imports none of them.
RUN npm install ws@8
COPY server/hub-server.mjs server/admin-auth.mjs server/admin-panel.mjs server/admin-cli.mjs server/
ENV HUB_PORT=8787
EXPOSE 8787
# node directly, not npm: npm swallows SIGTERM on some platforms, and
# the server's shutdown handler is what flushes the ledger.
CMD ["node", "server/hub-server.mjs"]
