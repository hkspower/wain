"""A small GLB reader: enough for the car shells (positions, indices, node translation)."""
import json
import struct


def read_glb(path):
    """{lowercased node name: (pos, tri)}, world transforms applied (translation/rotation/scale)."""
    buf = open(path, "rb").read()
    jlen = struct.unpack_from("<I", buf, 12)[0]
    js = json.loads(buf[20:20 + jlen])
    bin_ = buf[20 + jlen + 8:]

    def acc(i):
        a = js["accessors"][i]
        bv = js["bufferViews"][a["bufferView"]]
        off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        comps = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
        fmt = {5126: "f", 5125: "I", 5123: "H", 5121: "B"}[a["componentType"]]
        size = struct.calcsize(fmt)
        stride = bv.get("byteStride", comps * size)
        out = []
        for k in range(a["count"]):
            out.extend(struct.unpack_from("<" + fmt * comps, bin_, off + k * stride))
        return out

    meshes = {}
    for node in js.get("nodes", []):
        if "mesh" not in node:
            continue
        if any(k in node for k in ("rotation", "scale", "matrix")):
            raise SystemExit(f"{path}: node {node.get('name')} has a non-trivial transform; the reader does not handle it")
        t = node.get("translation", [0, 0, 0])
        pos, tri = [], []
        for prim in js["meshes"][node["mesh"]]["primitives"]:
            p = acc(prim["attributes"]["POSITION"])
            base = len(pos) // 3
            idx = acc(prim["indices"]) if "indices" in prim else list(range(len(p) // 3))
            pos.extend(p[i] + t[i % 3] for i in range(len(p)))
            tri.extend(base + i for i in idx)
        meshes[node.get("name", "").lower()] = (pos, tri)
    return meshes
