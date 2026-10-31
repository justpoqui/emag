## Sets up a level built from an exported .glb: gives every mesh trimesh
## collision, draws the instanced meshes listed in the matching
## *_instances.json with MultiMeshes, and places the raider at the spawn.
extends Node3D

## The node holding the imported level model.
@export var model_path: NodePath = ^"Model"
## Further imported models that also get collision (e.g. rooms rebuilt in Blender).
@export var extra_models: Array[NodePath] = []
## res:// path of the *_instances.json written by tools/export-glb.
@export_file("*.json") var instances_json := ""
## Where the raider starts, and which way they face (radians, 0 = +Z).
@export var spawn := Vector3.ZERO
@export var spawn_yaw := 0.0
## Sun direction (towards the sun), as in config.js MAPS.sunDir.
@export var sun_dir := Vector3(-0.55, 0.42, 0.72)
## The scene F2 switches to.
@export_file("*.tscn") var other_scene := ""


func _ready() -> void:
	var model := get_node_or_null(model_path)
	if model:
		_add_collision(model)
	for path in extra_models:
		var extra := get_node_or_null(path)
		if extra:
			_add_collision(extra)
	if instances_json != "":
		_add_instances(instances_json)
	var sun := get_node_or_null(^"Sun") as DirectionalLight3D
	if sun:
		sun.look_at_from_position(Vector3.ZERO, -sun_dir.normalized(), Vector3.UP)
	var raider := get_node_or_null(^"Raider")
	if raider and raider.has_method("place"):
		raider.place(spawn, spawn_yaw)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.physical_keycode == KEY_F2 and other_scene != "":
		get_tree().change_scene_to_file(other_scene)


## Static trimesh collision for every mesh in the level. Rough but matches the
## look exactly; replace with authored collision once the art is reworked.
func _add_collision(node: Node) -> void:
	if node is MeshInstance3D and node.mesh:
		node.create_trimesh_collision()
	for child in node.get_children():
		_add_collision(child)


## Rebuilds the web game's InstancedMeshes (bushes, rail sleepers, bulbs).
func _add_instances(path: String) -> void:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_warning("No instances file at %s" % path)
		return
	var list: Array = JSON.parse_string(file.get_as_text())
	for entry in list:
		var packed := load("res://models/" + entry["file"]) as PackedScene
		if packed == null:
			continue
		var source := packed.instantiate()
		var mesh_node := _first_mesh(source)
		if mesh_node:
			var t: Array = entry["transforms"]
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.mesh = mesh_node.mesh
			mm.instance_count = t.size() / 16
			for i in mm.instance_count:
				var e := t.slice(i * 16, i * 16 + 16)
				# Three.js matrices are column-major: columns 0-2 are the basis, 3 the origin.
				var basis := Basis(Vector3(e[0], e[1], e[2]), Vector3(e[4], e[5], e[6]), Vector3(e[8], e[9], e[10]))
				mm.set_instance_transform(i, Transform3D(basis, Vector3(e[12], e[13], e[14])))
			var mmi := MultiMeshInstance3D.new()
			mmi.multimesh = mm
			mmi.name = String(entry["file"]).get_file().get_basename()
			add_child(mmi)
		source.queue_free()


func _first_mesh(node: Node) -> MeshInstance3D:
	if node is MeshInstance3D:
		return node
	for child in node.get_children():
		var found := _first_mesh(child)
		if found:
			return found
	return null
