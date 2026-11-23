"""
Render the active animation of a rigged character from 8 directions,
as transparent PNGs, for use as 2D game sprites (Ragnarok-style).

HOW TO USE (Blender 3.6 / 4.x)
1. Import your rigged model + one animation (e.g. a Mixamo FBX, "In Place").
2. Scripting tab -> Open this file -> edit the SETTINGS below -> Run Script.
3. Run it once per animation (walk, attack, sit...), changing PREFIX each time.
4. Send/zip the OUT_DIR folder; frames are named  <PREFIX>_d<0-7>_f<NN>.png

Direction numbers match the game:
  0 front (facing the camera)   1 front-right   2 right   3 back-right
  4 back                        5 back-left     6 left    7 front-left
If left/right look swapped in the renders, set DIR_SIGN = -1.
"""
import math
import os

import bpy
from mathutils import Vector

# ----------------------------- SETTINGS -----------------------------
OUT_DIR = "//sprites"        # "//" = next to the .blend file
PREFIX = "walk"              # walk / attack / sit ...
SIZE = 256                   # output size of each frame (square), pixels
CAM_ELEVATION_DEG = 35       # camera tilt; game camera is ~38 deg
FRAME_STEP = 2               # 1 = every frame, 2 = every other (smaller sheets)
MAX_FRAMES = 8               # cap frames per direction
DIR_SIGN = 1                 # set to -1 if left/right are mirrored
MARGIN = 1.15                # extra room around the character
# --------------------------------------------------------------------

scene = bpy.context.scene


def mesh_objects():
    return [o for o in scene.objects if o.type == "MESH" and o.visible_get()]


def world_bounds(objs):
    pts = []
    for o in objs:
        for c in o.bound_box:
            pts.append(o.matrix_world @ Vector(c))
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def setup_render():
    scene.render.resolution_x = SIZE
    scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue


def ensure_light():
    if any(o.type == "LIGHT" for o in scene.objects):
        return
    data = bpy.data.lights.new("SpriteSun", type="SUN")
    data.energy = 3.0
    obj = bpy.data.objects.new("SpriteSun", data)
    obj.rotation_euler = (math.radians(50), 0, math.radians(-30))
    scene.collection.objects.link(obj)


def main():
    objs = mesh_objects()
    if not objs:
        raise RuntimeError("No visible mesh found - import the character first.")

    scene.frame_set(scene.frame_start)
    lo, hi = world_bounds(objs)
    center = (lo + hi) / 2
    height = hi.z - lo.z
    width = max(hi.x - lo.x, hi.y - lo.y)
    span = max(height, width) * MARGIN

    setup_render()
    ensure_light()

    pivot = bpy.data.objects.new("SpritePivot", None)
    pivot.location = center
    scene.collection.objects.link(pivot)

    cam_data = bpy.data.cameras.new("SpriteCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = span
    cam = bpy.data.objects.new("SpriteCam", cam_data)
    cam.parent = pivot
    cam.location = (0, -span * 3, 0)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.collection.objects.link(cam)
    scene.camera = cam

    out = bpy.path.abspath(OUT_DIR)
    os.makedirs(out, exist_ok=True)

    frames = list(range(scene.frame_start, scene.frame_end + 1, FRAME_STEP))[:MAX_FRAMES]
    elev = -math.radians(CAM_ELEVATION_DEG)

    for d in range(8):
        pivot.rotation_euler = (elev, 0, DIR_SIGN * math.radians(45 * d))
        for i, f in enumerate(frames):
            scene.frame_set(f)
            scene.render.filepath = os.path.join(out, f"{PREFIX}_d{d}_f{i:02d}.png")
            bpy.ops.render.render(write_still=True)

    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.objects.remove(pivot, do_unlink=True)
    print(f"Done: {8 * len(frames)} frames -> {out}")


main()
