"""Convert the construction worker's forward walk into an in-place loop.

Run with Blender:

    /Applications/Blender.app/Contents/MacOS/Blender \
      --background --python blender/process_worker_animation.py

The source model is never overwritten. The processed model is written to:

    public/models/construction_worker_inplace.glb
"""

from __future__ import annotations

from pathlib import Path

import bpy


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
SOURCE_PATH = PROJECT_DIR / "public" / "models" / "construction_worker.glb"
OUTPUT_PATH = PROJECT_DIR / "public" / "models" / "construction_worker_inplace.glb"
BLEND_PATH = SCRIPT_DIR / "output" / "construction_worker_inplace.blend"


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)


def find_walk_actions() -> list[bpy.types.Action]:
    walk_actions = [action for action in bpy.data.actions if "walk" in action.name.lower()]
    if not walk_actions:
        available = ", ".join(action.name for action in bpy.data.actions) or "none"
        raise RuntimeError(f"No Walk action found. Available actions: {available}")
    return walk_actions


def find_hips_name() -> str:
    for armature in (obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"):
        for bone in armature.pose.bones:
            if "hips" in bone.name.lower():
                return bone.name
    raise RuntimeError("No hips bone found in imported armature")


def animation_fcurves(action: bpy.types.Action):
    """Support Blender legacy actions and Blender 4.4+ slotted actions."""
    if hasattr(action, "fcurves"):
        return list(action.fcurves)
    curves = []
    for layer in action.layers:
        for strip in layer.strips:
            for channelbag in strip.channelbags:
                curves.extend(channelbag.fcurves)
    return curves


def make_walk_in_place(action: bpy.types.Action, hips_name: str) -> int:
    hips_location_path = f'pose.bones["{hips_name}"].location'
    curves = animation_fcurves(action)
    locked_curves = 0

    # Lock the complete hips translation. Bone rotations still provide the walk
    # cycle, while world movement remains exclusively controlled by the game.
    for curve in curves:
        if curve.data_path != hips_location_path or curve.array_index not in (0, 1, 2):
            continue
        if not curve.keyframe_points:
            continue
        origin = curve.keyframe_points[0].co.y
        for point in curve.keyframe_points:
            delta = origin - point.co.y
            point.co.y = origin
            point.handle_left.y += delta
            point.handle_right.y += delta
        curve.update()
        locked_curves += 1

    # Match the final pose to the first pose so Repeat does not expose a seam.
    for curve in curves:
        points = curve.keyframe_points
        if len(points) < 2:
            continue
        first = points[0]
        last = points[-1]
        delta = first.co.y - last.co.y
        last.co.y = first.co.y
        last.handle_left.y += delta
        last.handle_right.y += delta
        curve.update()
    return locked_curves


def main() -> None:
    if not SOURCE_PATH.exists():
        raise FileNotFoundError(SOURCE_PATH)

    reset_scene()
    bpy.ops.import_scene.gltf(filepath=str(SOURCE_PATH))

    actions = find_walk_actions()
    hips_name = find_hips_name()
    processed_actions = [
        action for action in actions if make_walk_in_place(action, hips_name) > 0
    ]
    if not processed_actions:
        names = ", ".join(action.name for action in actions)
        raise RuntimeError(f"Walk actions contained no hips location curves: {names}")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    BLEND_PATH.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT_PATH),
        export_format="GLB",
        export_animations=True,
        export_animation_mode="ACTIONS",
    )
    print(f"Processed actions: {', '.join(action.name for action in processed_actions)}")
    print(f"Hips bone: {hips_name}")
    print(f"Output: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
