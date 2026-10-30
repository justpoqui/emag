## The raider: third-person walking, sprinting, crouching and jumping with the
## web game's over-the-shoulder camera (game.js updateCamera). Speeds come
## from config.js PLAYER.
extends CharacterBody3D

@export var walk_speed := 4.6
@export var sprint_speed := 7.4
@export var crouch_speed := 2.4
@export var jump_speed := 6.2
@export var gravity := 22.0
## Radians of turn per pixel of mouse movement (input.js sensitivity).
@export var sensitivity := 0.0022
@export var fov := 72.0

var yaw := 0.0
var pitch := 0.0
var crouching := false

@onready var model: Node3D = $Model
@onready var camera: Camera3D = $Camera


func _ready() -> void:
	camera.top_level = true
	camera.fov = fov
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


## Puts the raider at `pos`, facing `facing` (radians, 0 = +Z).
func place(pos: Vector3, facing: float) -> void:
	global_position = pos
	velocity = Vector3.ZERO
	yaw = facing
	pitch = -0.1
	model.rotation.y = facing


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		yaw -= event.relative.x * sensitivity
		pitch = clampf(pitch - event.relative.y * sensitivity, -1.3, 1.2)
	elif event is InputEventMouseButton and event.pressed:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif event is InputEventKey and event.pressed and event.physical_keycode == KEY_ESCAPE:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


func _physics_process(delta: float) -> void:
	crouching = Input.is_physical_key_pressed(KEY_C)
	var input := Vector2(
		float(Input.is_physical_key_pressed(KEY_D)) - float(Input.is_physical_key_pressed(KEY_A)),
		float(Input.is_physical_key_pressed(KEY_W)) - float(Input.is_physical_key_pressed(KEY_S)))
	# forward is (sin yaw, cos yaw), right is (-cos yaw, sin yaw), as in the web game
	var forward := Vector3(sin(yaw), 0, cos(yaw))
	var right := Vector3(-cos(yaw), 0, sin(yaw))
	var dir := (forward * input.y + right * input.x).normalized()
	var sprinting := Input.is_physical_key_pressed(KEY_SHIFT) and input.y > 0 and not crouching
	var speed := crouch_speed if crouching else (sprint_speed if sprinting else walk_speed)
	velocity.x = dir.x * speed
	velocity.z = dir.z * speed
	if is_on_floor():
		if Input.is_physical_key_pressed(KEY_SPACE):
			velocity.y = jump_speed
	else:
		velocity.y -= gravity * delta
	move_and_slide()
	if dir.length() > 0.01:
		model.rotation.y = lerp_angle(model.rotation.y, atan2(dir.x, dir.z), minf(1.0, delta * 12.0))


func _process(_delta: float) -> void:
	_update_camera()


## Over-the-shoulder camera: pivot 0.95 m right of and 0.3 m above the eye,
## 3.6 m back along the look direction, pulled in when a wall is in the way.
func _update_camera() -> void:
	var eye := global_position + Vector3(0, 1.05 if crouching else 1.6, 0)
	var look := Vector3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch))
	var right := Vector3(-cos(yaw), 0, sin(yaw))
	var pivot := eye + right * 0.95 + Vector3(0, 0.3, 0)
	var space := get_world_3d().direct_space_state
	var side := space.intersect_ray(PhysicsRayQueryParameters3D.create(eye, pivot + (pivot - eye).normalized() * 0.2, 0xFFFFFFFF, [get_rid()]))
	if side:
		pivot = eye + (pivot - eye).normalized() * maxf(0.0, eye.distance_to(side.position) - 0.2)
	var back := 3.6
	var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(pivot, pivot - look * (back + 0.3), 0xFFFFFFFF, [get_rid()]))
	var dist := maxf(0.4, pivot.distance_to(hit.position) - 0.3) if hit else back
	camera.global_position = pivot - look * dist
	camera.look_at(camera.global_position + look, Vector3.UP)
	model.visible = dist > 0.8
