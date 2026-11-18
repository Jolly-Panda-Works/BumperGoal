"""Export the nine supplied Unity racing cars to normalized, textured GLBs.
Run with Blender 3.x: blender -b --python tools/export-tiny-racing-cars.py
"""
import bpy
from pathlib import Path
from mathutils import Matrix, Vector
root=Path(__file__).resolve().parents[1]
source=root/'art-source/tiny-racing'
output=root/'apps/web/public/assets/cars'
for number in range(1,10):
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 bpy.ops.import_scene.fbx(filepath=str(source/'FBX'/f'Car-{number}.fbx'))
 bpy.context.view_layer.update()
 meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
 matrices={o:o.matrix_world.copy() for o in meshes}
 for o in meshes:
  o.animation_data_clear();o.parent=None;o.data.transform(matrices[o]);o.matrix_world=Matrix.Identity(4)
 # Some FBXs mirror two wheels into one axle mesh. Split those disconnected tires.
 for o in list(meshes):
  coords=[v.co for v in o.data.vertices]
  size=Vector(tuple(max(v[a] for v in coords)-min(v[a] for v in coords) for a in range(3)))
  if 'cylinder' in o.name.lower() and .7 < size.y/max(.001,size.z) < 1.3 and size.x > size.y*1.5:
   bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
   bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.separate(type='LOOSE');bpy.ops.object.mode_set(mode='OBJECT')
 meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
 vertices=[v.co for o in meshes for v in o.data.vertices]
 lo=Vector(tuple(min(v[a] for v in vertices) for a in range(3)))
 hi=Vector(tuple(max(v[a] for v in vertices) for a in range(3)))
 centre=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z));scale=1.42/(hi.y-lo.y)
 wheel_count=0
 for o in meshes:
  coords=[v.co for v in o.data.vertices]
  lower=Vector(tuple(min(v[a] for v in coords) for a in range(3)))
  upper=Vector(tuple(max(v[a] for v in coords) for a in range(3)))
  size=upper-lower;mid=(upper+lower)/2
  if 'cylinder' in o.name.lower() and .7 < size.y/max(.001,size.z) < 1.3 and lower.z <= lo.z+(hi.z-lo.z)*.12 and mid.z < lo.z+(hi.z-lo.z)*.48 and (abs(mid.x-centre.x)>(hi.x-lo.x)*.16 or size.x>size.y*1.5):
   o.name=f'wheel_{wheel_count}';wheel_count+=1
  for v in o.data.vertices:v.co=(v.co-centre)*scale
 texture=next((source/'Textures').glob(f'Car-{number}*BaseColor.png'))
 image=bpy.data.images.load(str(texture));
 if max(image.size)>1024:image.scale(1024,1024)
 image.pack()
 material=bpy.data.materials.new(f'tiny-racer-{number}-paint');material.use_nodes=True
 shader=material.node_tree.nodes.get('Principled BSDF');tex=material.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
 material.node_tree.links.new(tex.outputs['Color'],shader.inputs['Base Color']);shader.inputs['Roughness'].default_value=.65
 for o in meshes:
  o.data.materials.clear();o.data.materials.append(material);o.select_set(True)
 assert wheel_count>=2, f'Car-{number}: only {wheel_count} wheel meshes detected'
 bpy.ops.export_scene.gltf(filepath=str(output/f'tiny-racer-{number}.glb'),export_format='GLB',use_selection=True,export_animations=False,export_yup=True)
 print('TINY_EXPORTED',number,'wheels',wheel_count,'length',hi.y-lo.y,'height',hi.z-lo.z)



