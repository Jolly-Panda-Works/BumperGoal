"""Render supplied FBX cars as transparent top-down sprites (Blender 3+)."""
import bpy, math
from pathlib import Path
from mathutils import Matrix, Vector
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'art-source'/'cars'
OUTPUT=ROOT/'apps'/'web'/'public'/'assets'/'cars'
for name in ['cicada','cruiser','carrier']:
 bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
 bpy.ops.import_scene.fbx(filepath=str(SOURCE/(name+'.fbx')))
 bpy.context.view_layer.update()
 meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
 # The pack's body mesh uses a different FBX geometric basis from its wheels.
 basis=Matrix(((0,-1,0,0),(0,0,1,0),(-1,0,0,0),(0,0,0,1)))
 for obj in meshes:
  if obj.name=='BODY': obj.matrix_world=basis@obj.matrix_world
 material=bpy.data.materials.new('paint-'+name); material.use_nodes=True
 nodes=material.node_tree.nodes; shader=nodes.get('Principled BSDF')
 texture=nodes.new('ShaderNodeTexImage'); texture.image=bpy.data.images.load(str(SOURCE/'textures'/(name+'.png')))
 material.node_tree.links.new(texture.outputs['Color'],shader.inputs['Base Color'])
 shader.inputs['Roughness'].default_value=0.55
 for obj in meshes:
  obj.data.materials.clear(); obj.data.materials.append(material)
 for obj in meshes:
  obj.animation_data_clear()
  world=obj.matrix_world.copy(); obj.parent=None; obj.data.transform(world); obj.matrix_world=Matrix.Identity(4)
 bpy.context.view_layer.update()
 points=[o.matrix_world@v.co for o in meshes for v in o.data.vertices]
 center=Vector(((min(p.x for p in points)+max(p.x for p in points))/2,0,(min(p.z for p in points)+max(p.z for p in points))/2))
 bpy.ops.object.camera_add(location=center+Vector((0,12,0)))
 camera=bpy.context.object; camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler()
 # Front (+Z) points up the sprite; camera's local up is world +Z.
 camera.rotation_euler=(math.pi/2,0,math.pi)
 camera.data.type='ORTHO'; camera.data.ortho_scale=max(max(p.z for p in points)-min(p.z for p in points),max(p.x for p in points)-min(p.x for p in points))*1.12
 scene=bpy.context.scene; scene.camera=camera
 scene.render.engine='CYCLES'; scene.cycles.samples=24
 scene.world.color=(0.65,0.65,0.65)
 for location,energy,size in [(( -3,7,4),650,5),((4,5,-3),350,4)]:
  bpy.ops.object.light_add(type='AREA',location=location)
  lamp=bpy.context.object; lamp.data.energy=energy; lamp.data.size=size
  lamp.rotation_euler=(center-lamp.location).to_track_quat('-Z','Y').to_euler()
 scene.render.resolution_x=512;scene.render.resolution_y=512;scene.render.resolution_percentage=100
 scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
 scene.view_settings.view_transform='Standard';scene.view_settings.look='Medium High Contrast';scene.view_settings.exposure=0;scene.view_settings.gamma=1
 scene.render.filepath=str(OUTPUT/(name+'.png'));bpy.ops.render.render(write_still=True)



