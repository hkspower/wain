"""The Blender this repo's tools are written for, and a check for it.

    pip install -r requirements-blender.txt

The tools lean on 5.0: the ACES 1.3 view transform, OpenImageDenoise with
albedo and normal passes, Cycles' light tree, and the video media type in
the image settings. On an older Blender they used to skip those settings
silently and render something different; require() stops that at start-up.
"""

MIN = (5, 0, 0)
INSTALL = "pip install -r requirements-blender.txt"


def require(version=None, minimum=MIN):
    """Raise unless Blender is at least `minimum`. `version` defaults to the
    installed bpy's; returns it as a tuple."""
    if version is None:
        import bpy

        version = tuple(bpy.app.version)
    version = tuple(version)
    if version < tuple(minimum):
        have = ".".join(map(str, version))
        need = ".".join(map(str, minimum))
        raise RuntimeError(f"Blender {have} is too old: these tools need {need} or newer ({INSTALL})")
    return version
