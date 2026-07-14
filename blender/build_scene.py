"""Build the SafeOps lubrication-room low-poly scene in Blender.

Run with Blender, not the system Python:

    blender --background --python blender/build_scene.py

The script reads ``blender/layout.json`` and writes:

    blender/output/safeops-lube-room.blend
    public/models/safeops-lube-room.glb
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Sequence

import bpy


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
LAYOUT_PATH = SCRIPT_DIR / "layout.json"
BLEND_PATH = SCRIPT_DIR / "output" / "safeops-lube-room.blend"
GLB_PATH = PROJECT_DIR / "public" / "models" / "safeops-lube-room.glb"


def load_layout() -> dict:
    with LAYOUT_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def configure_scene() -> None:
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    scene.world.color = (0.018, 0.026, 0.03)


def rgba(hex_color: str, alpha: float = 1.0) -> tuple[float, float, float, float]:
    value = hex_color.removeprefix("#")
    return tuple(int(value[index : index + 2], 16) / 255 for index in (0, 2, 4)) + (alpha,)


def make_material(
    name: str,
    color: str,
    *,
    metallic: float = 0.0,
    roughness: float = 0.6,
    alpha: float = 1.0,
    emission: str | None = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.diffuse_color = rgba(color, alpha)
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = rgba(color, alpha)
    principled.inputs["Metallic"].default_value = metallic
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Alpha"].default_value = alpha
    if emission:
        emission_input = principled.inputs.get("Emission Color") or principled.inputs.get("Emission")
        emission_input.default_value = rgba(emission)
        principled.inputs["Emission Strength"].default_value = emission_strength
    if alpha < 1:
        if hasattr(material, "surface_render_method"):
            material.surface_render_method = "DITHERED"
        else:
            material.blend_method = "BLEND"
    return material


def build_materials() -> dict[str, bpy.types.Material]:
    return {
        "graphite": make_material("MAT_GraphiteMetal", "#252b2e", metallic=0.72, roughness=0.5),
        "steel": make_material("MAT_DarkSteel", "#3b4549", metallic=0.82, roughness=0.4),
        "orange": make_material("MAT_SafetyOrange", "#d96b1d", metallic=0.28, roughness=0.42),
        "screen": make_material(
            "MAT_ScreenDark",
            "#071419",
            metallic=0.08,
            roughness=0.24,
            emission="#174653",
            emission_strength=0.35,
        ),
        "oil": make_material("MAT_HazardOil", "#6f241d", roughness=0.3, alpha=0.58),
        "concrete": make_material("MAT_Concrete", "#343a3c", roughness=0.92),
        "wall": make_material("MAT_Wall", "#202a2e", metallic=0.12, roughness=0.82),
        "dial": make_material("MAT_Dial", "#d2d4ce", roughness=0.74),
        "needle": make_material("MAT_Needle", "#c84432", metallic=0.15, roughness=0.48),
        "collider": make_material("MAT_Collider", "#ffffff", alpha=0.0),
    }


def assign_material(obj: bpy.types.Object, material: bpy.types.Material) -> None:
    if obj.data and hasattr(obj.data, "materials"):
        obj.data.materials.append(material)


def apply_bevel(obj: bpy.types.Object, width: float = 0.04, segments: int = 2) -> None:
    modifier = obj.modifiers.new("Soft industrial edges", "BEVEL")
    modifier.width = width
    modifier.segments = segments


def attach_to_parent(obj: bpy.types.Object, parent: bpy.types.Object | None) -> None:
    if not parent:
        return
    world_transform = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world_transform


def cube(
    name: str,
    size: Sequence[float],
    location: Sequence[float],
    material: bpy.types.Material,
    *,
    parent: bpy.types.Object | None = None,
    bevel: float = 0.03,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        apply_bevel(obj, min(bevel, min(size) * 0.2))
    assign_material(obj, material)
    attach_to_parent(obj, parent)
    return obj


def cylinder(
    name: str,
    radius: float,
    depth: float,
    location: Sequence[float],
    material: bpy.types.Material,
    *,
    parent: bpy.types.Object | None = None,
    rotation: Sequence[float] = (0, 0, 0),
    vertices: int = 20,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    assign_material(obj, material)
    attach_to_parent(obj, parent)
    apply_bevel(obj, min(radius * 0.08, 0.025), 1)
    return obj


def torus(
    name: str,
    major_radius: float,
    minor_radius: float,
    location: Sequence[float],
    material: bpy.types.Material,
    *,
    parent: bpy.types.Object | None = None,
    rotation: Sequence[float] = (0, 0, 0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=24,
        minor_segments=8,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    assign_material(obj, material)
    attach_to_parent(obj, parent)
    return obj


def empty(name: str, location: Sequence[float]) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.empty_display_type = "PLAIN_AXES"
    obj["safeopsEntityId"] = name
    return obj


def local_position(entity: dict, offset: Sequence[float]) -> tuple[float, float, float]:
    x, y, z = entity["position"]
    return x + offset[0], y + offset[1], z + offset[2]


def add_foundation(root: bpy.types.Object, entity: dict, materials: dict, height: float = 0.14) -> None:
    width, depth = entity["footprint"]
    cube(
        f"{entity['id']}__foundation",
        (width, depth, height),
        local_position(entity, (0, 0, height / 2)),
        materials["concrete"],
        parent=root,
        bevel=0.025,
    )


def add_flange(
    name: str,
    location: Sequence[float],
    axis: str,
    radius: float,
    material: bpy.types.Material,
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    rotations = {"X": (0, math.pi / 2, 0), "Y": (math.pi / 2, 0, 0), "Z": (0, 0, 0)}
    return cylinder(name, radius, 0.12, location, material, parent=parent, rotation=rotations[axis], vertices=20)


def build_pump(entity: dict, materials: dict) -> None:
    root = empty(entity["id"], entity["position"])
    add_foundation(root, entity, materials)
    x, y, _ = entity["position"]
    base_z = 0.22
    cube(f"{entity['id']}__skid", (1.38, 0.92, 0.12), (x, y, base_z), materials["steel"], parent=root)
    cylinder(
        f"{entity['id']}__motor",
        0.31,
        0.68,
        (x - 0.35, y, 0.58),
        materials["graphite"],
        parent=root,
        rotation=(0, math.pi / 2, 0),
        vertices=24,
    )
    for index in range(-3, 4):
        cylinder(
            f"{entity['id']}__motor-fin-{index + 4}",
            0.335,
            0.026,
            (x - 0.35 + index * 0.075, y, 0.58),
            materials["steel"],
            parent=root,
            rotation=(0, math.pi / 2, 0),
            vertices=20,
        )
    rotor = cylinder(
        f"{entity['id']}__rotor",
        0.1,
        0.24,
        (x + 0.1, y, 0.58),
        materials["orange"],
        parent=root,
        rotation=(0, math.pi / 2, 0),
    )
    rotor["animationAxis"] = "X"
    cylinder(
        f"{entity['id']}__pump-body",
        0.4,
        0.36,
        (x + 0.42, y, 0.58),
        materials["graphite"],
        parent=root,
        rotation=(math.pi / 2, 0, 0),
        vertices=24,
    )
    cylinder(
        f"{entity['id']}__volute",
        0.24,
        0.5,
        (x + 0.55, y, 0.58),
        materials["graphite"],
        parent=root,
        rotation=(0, math.pi / 2, 0),
        vertices=24,
    )
    add_flange(f"{entity['id']}__inlet-flange", (x + 0.82, y, 0.58), "X", 0.25, materials["steel"], root)
    add_flange(f"{entity['id']}__outlet-flange", (x + 0.42, y, 0.94), "Z", 0.22, materials["steel"], root)


def build_filter(entity: dict, materials: dict) -> None:
    root = empty(entity["id"], entity["position"])
    add_foundation(root, entity, materials)
    x, y, _ = entity["position"]
    cylinder(f"{entity['id']}__shell", 0.35, 1.15, (x, y, 0.74), materials["graphite"], parent=root, vertices=24)
    cylinder(f"{entity['id']}__top", 0.43, 0.14, (x, y, 1.34), materials["steel"], parent=root, vertices=24)
    torus(f"{entity['id']}__top-seal", 0.36, 0.035, (x, y, 1.28), materials["orange"], parent=root)
    for side, offset in (("inlet", -0.42), ("outlet", 0.42)):
        cylinder(
            f"{entity['id']}__{side}",
            0.13,
            0.32,
            (x + offset, y, 0.72),
            materials["steel"],
            parent=root,
            rotation=(0, math.pi / 2, 0),
        )
        add_flange(f"{entity['id']}__{side}-flange", (x + offset * 1.3, y, 0.72), "X", 0.2, materials["steel"], root)


def build_valve(entity: dict, materials: dict) -> None:
    root = empty(entity["id"], entity["position"])
    add_foundation(root, entity, materials, 0.1)
    x, y, _ = entity["position"]
    cylinder(
        f"{entity['id']}__body",
        0.32,
        0.56,
        (x, y, 0.48),
        materials["graphite"],
        parent=root,
        rotation=(math.pi / 2, 0, 0),
        vertices=20,
    )
    cylinder(f"{entity['id']}__stem", 0.065, 0.48, (x, y, 0.92), materials["steel"], parent=root, vertices=16)
    handwheel = torus(
        f"{entity['id']}__handwheel",
        0.31,
        0.045,
        (x, y, 1.17),
        materials["orange"],
        parent=root,
    )
    for angle in (0, math.pi / 2):
        spoke = cube(
            f"{entity['id']}__handwheel-spoke-{int(angle * 10)}",
            (0.56, 0.045, 0.045),
            (x, y, 1.17),
            materials["orange"],
            parent=handwheel,
            bevel=0.012,
        )
        spoke.rotation_euler.z = angle
    for side, offset in (("north", -0.36), ("south", 0.36)):
        cylinder(
            f"{entity['id']}__port-{side}",
            0.13,
            0.42,
            (x, y + offset, 0.48),
            materials["steel"],
            parent=root,
            rotation=(math.pi / 2, 0, 0),
        )
        add_flange(f"{entity['id']}__flange-{side}", (x, y + offset * 1.35, 0.48), "Y", 0.21, materials["steel"], root)


def build_pressure_gauge(entity: dict, materials: dict, remote: bool) -> None:
    root = empty(entity["id"], entity["position"])
    add_foundation(root, entity, materials, 0.08)
    x, y, _ = entity["position"]
    cylinder(f"{entity['id']}__stem", 0.07, 0.68, (x, y, 0.44), materials["steel"], parent=root, vertices=14)
    add_flange(f"{entity['id']}__base-flange", (x, y, 0.1), "Z", 0.18, materials["steel"], root)
    if remote:
        cube(f"{entity['id']}__housing", (0.52, 0.36, 0.46), (x, y, 0.93), materials["graphite"], parent=root, bevel=0.08)
        cube(f"{entity['id']}__display", (0.34, 0.02, 0.18), (x, y - 0.19, 0.94), materials["screen"], parent=root, bevel=0.015)
        return
    cylinder(
        f"{entity['id']}__case",
        0.32,
        0.16,
        (x, y, 1.05),
        materials["graphite"],
        parent=root,
        rotation=(math.pi / 2, 0, 0),
        vertices=32,
    )
    cylinder(
        f"{entity['id']}__dial",
        0.265,
        0.014,
        (x, y - 0.088, 1.05),
        materials["dial"],
        parent=root,
        rotation=(math.pi / 2, 0, 0),
        vertices=32,
    )
    needle = cube(
        f"{entity['id']}__needle",
        (0.2, 0.018, 0.018),
        (x - 0.035, y - 0.103, 1.07),
        materials["needle"],
        parent=root,
        bevel=0.006,
    )
    needle.rotation_euler.y = -0.55


def build_terminal(entity: dict, materials: dict) -> None:
    root = empty(entity["id"], entity["position"])
    add_foundation(root, entity, materials, 0.1)
    x, y, _ = entity["position"]
    cube(f"{entity['id']}__cabinet", (1.12, 0.62, 0.72), (x, y, 0.46), materials["graphite"], parent=root)
    console = cube(f"{entity['id']}__console", (1.12, 0.7, 0.18), (x, y - 0.08, 0.88), materials["steel"], parent=root)
    console.rotation_euler.x = -0.28
    for index, offset in enumerate((-0.28, 0.28), start=1):
        cube(
            f"{entity['id']}__screen-{index}",
            (0.48, 0.06, 0.34),
            (x + offset, y + 0.19, 1.14),
            materials["screen"],
            parent=root,
            bevel=0.035,
        )


def build_cabinet(entity: dict, materials: dict) -> None:
    root = empty(entity["id"], entity["position"])
    add_foundation(root, entity, materials, 0.08)
    x, y, _ = entity["position"]
    cube(f"{entity['id']}__body", (1.12, 0.62, 1.74), (x, y, 0.95), materials["graphite"], parent=root)
    for side, offset in (("left", -0.285), ("right", 0.285)):
        door = cube(
            f"{entity['id']}__door-{side}",
            (0.54, 0.035, 1.62),
            (x + offset, y - 0.33, 0.96),
            materials["steel"],
            parent=root,
            bevel=0.015,
        )
        door["hingeSide"] = side
        cube(
            f"{entity['id']}__handle-{side}",
            (0.035, 0.055, 0.3),
            (x + (-0.055 if side == "left" else 0.055), y - 0.39, 0.98),
            materials["orange"],
            parent=door,
            bevel=0.012,
        )


def build_hazard(entity: dict, materials: dict) -> None:
    root = empty(entity["id"], entity["position"])
    width, depth = entity["footprint"]
    hazard = cube(
        f"{entity['id']}__surface",
        (width, depth, 0.025),
        local_position(entity, (0, 0, 0.018)),
        materials["oil"],
        parent=root,
        bevel=0.16,
    )
    hazard["hazardType"] = "hot-oil-leak"


def build_room(layout: dict, materials: dict) -> None:
    room = layout["room"]
    width, depth, _ = room["size"]
    floor_thickness = room["floorThickness"]
    cube("room-floor", (width, depth, floor_thickness), (0, 0, -floor_thickness / 2), materials["concrete"], bevel=0)
    for wall in layout["walls"]:
        cube(wall["id"], wall["size"], wall["center"], materials["wall"], bevel=0.025)
    for area in layout["areas"]:
        width, depth = area["size"]
        marker = cube(
            f"{area['id']}__floor-marker",
            (width, depth, 0.018),
            (area["center"][0], area["center"][1], 0.009),
            materials["steel"],
            bevel=0.08,
        )
        marker["safeopsAreaId"] = area["id"]


def build_pipe(pipe: dict, materials: dict) -> None:
    points = [(point[0], point[1], pipe["elevation"]) for point in pipe["points"]]
    curve_data = bpy.data.curves.new(pipe["id"], type="CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = 2
    curve_data.bevel_depth = pipe["diameter"] / 2
    curve_data.bevel_resolution = 2
    curve_data.resolution_u = 4
    spline = curve_data.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, coordinates in zip(spline.bezier_points, points):
        point.co = coordinates
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    pipe_obj = bpy.data.objects.new(pipe["id"], curve_data)
    bpy.context.collection.objects.link(pipe_obj)
    assign_material(pipe_obj, materials["steel"])
    pipe_obj["connects"] = ",".join(pipe["connects"])
    for index, point in enumerate(points):
        torus(
            f"{pipe['id']}__joint-{index + 1}",
            pipe["diameter"] * 0.58,
            max(pipe["diameter"] * 0.08, 0.016),
            point,
            materials["orange"],
            rotation=(math.pi / 2, 0, 0),
        )


def build_signal_link(link: dict, entities: dict[str, dict], materials: dict) -> None:
    source = entities[link["from"]]["position"]
    target = entities[link["to"]]["position"]
    curve_data = bpy.data.curves.new(link["id"], type="CURVE")
    curve_data.dimensions = "3D"
    curve_data.bevel_depth = 0.018
    curve_data.bevel_resolution = 1
    spline = curve_data.splines.new("POLY")
    spline.points.add(2)
    middle_x = (source[0] + target[0]) / 2
    points = ((source[0], source[1], 1.25), (middle_x, source[1], 1.25), (target[0], target[1], 1.25))
    for point, coordinates in zip(spline.points, points):
        point.co = (*coordinates, 1)
    obj = bpy.data.objects.new(link["id"], curve_data)
    bpy.context.collection.objects.link(obj)
    assign_material(obj, materials["orange"])
    obj["visualOnly"] = True


def build_collision_proxy(entity: dict, materials: dict) -> None:
    width, depth = entity["footprint"]
    height = entity["modelSize"][2]
    proxy = cube(
        f"{entity['id']}__COLLIDER",
        (width, depth, height),
        local_position(entity, (0, 0, height / 2)),
        materials["collider"],
        bevel=0,
    )
    proxy["safeopsCollider"] = True
    proxy.display_type = "WIRE"


def entity_builders():
    return {
        "remote-pressure-transmitter": lambda entity, mats: build_pressure_gauge(entity, mats, True),
        "local-pressure-gauge": lambda entity, mats: build_pressure_gauge(entity, mats, False),
        "centrifugal-pump-set": build_pump,
        "vertical-oil-filter": build_filter,
        "handwheel-branch-valve": build_valve,
        "operator-terminal": build_terminal,
        "safety-tool-cabinet": build_cabinet,
        "floor-hazard-zone": build_hazard,
    }


def set_custom_metadata(layout: dict) -> None:
    scene = bpy.context.scene
    scene["safeopsSchemaVersion"] = layout["schemaVersion"]
    scene["safeopsSceneId"] = "lube-oil-room"
    scene["safeopsSource"] = "blender/layout.json"


def export_scene() -> None:
    BLEND_PATH.parent.mkdir(parents=True, exist_ok=True)
    GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    bpy.ops.export_scene.gltf(
        filepath=str(GLB_PATH),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
    )


def main() -> None:
    layout = load_layout()
    reset_scene()
    configure_scene()
    materials = build_materials()
    build_room(layout, materials)

    builders = entity_builders()
    entities_by_id = {entity["id"]: entity for entity in layout["entities"]}
    for entity in layout["entities"]:
        builders[entity["type"]](entity, materials)

    for pipe in layout["pipes"]:
        build_pipe(pipe, materials)
    for link in layout.get("signalLinks", []):
        build_signal_link(link, entities_by_id, materials)

    proxy_ids = set(layout["collisionPolicy"]["createProxyFor"])
    for entity in layout["entities"]:
        if entity["id"] in proxy_ids:
            build_collision_proxy(entity, materials)

    set_custom_metadata(layout)
    export_scene()
    print(f"SafeOps scene written to {GLB_PATH}")


if __name__ == "__main__":
    main()
