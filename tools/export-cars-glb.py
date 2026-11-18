"""Convert the supplied cars to small, normalized browser-ready GLB models."""
import bpy
from pathlib import Path
from mathutils import Matrix, Vector

root = Path(__file__).resolve().parents[1]
source = root / 'art-source' / 'cars'
output = root / 'apps' / 'web' / 'public' / 'assets' / 'cars'
body_basis = Matrix(((0,-1,0,0),(0,0,1,0),(-1,0,0,0),(0,0,0,1)))
up_basis = Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)))

for name in ['cicada', 'cruiser', 'carrier']:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.fbx(filepath=str(source / (name + '.fbx')))
    bpy.context.view_layer.update()
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for obj in meshes:
        if obj.name == 'BODY':
            obj.matrix_world = body_basis @ obj.matrix_world
        obj.animation_data_clear()
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.data.transform(world)
        obj.matrix_world = Matrix.Identity(4)
    vertices = [v.co for o in meshes for v in o.data.vertices]
    center = Vector(((min(v.x for v in vertices) + max(v.x for v in vertices)) / 2,
                     min(v.y for v in vertices),
                     (min(v.z for v in vertices) + max(v.z for v in vertices)) / 2))
    scale = 1.42 / (max(v.z for v in vertices) - min(v.z for v in vertices))
    image = bpy.data.images.load(str(source / 'textures' / (name + '.png')))
    image.scale(1024, 1024)
    image.pack()
    material = bpy.data.materials.new(name + '-paint')
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    texture = material.node_tree.nodes.new('ShaderNodeTexImage')
    texture.image = image
    material.node_tree.links.new(texture.outputs['Color'], shader.inputs['Base Color'])
    shader.inputs['Roughness'].default_value = 0.48
    shader.inputs['Metallic'].default_value = 0.12
    for obj in meshes:
        for vertex in obj.data.vertices:
            vertex.co = up_basis.to_3x3() @ ((vertex.co - center) * scale)
        obj.data.materials.clear()
        obj.data.materials.append(material)
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(output / (name + '.glb')),
                              export_format='GLB', use_selection=True,
                              export_animations=False, export_yup=True)
