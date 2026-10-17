// The raider: model, third-person movement, stamina, dodge roll, health and shield.

import * as THREE from 'three';
import { PLAYER, ITEMS } from './config.js';
import * as Audio from './audio.js';
import { buildRaiderModel, poseRig } from './rig.js';

export { buildRaiderModel };

const RADIUS = 0.38;
const STAND_H = 1.8;
const CROUCH_H = 1.2;
const GRAVITY = 22;

// Simple blocky weapon models
export function buildGunModel(id) {
  const item = ITEMS[id];
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: item.color, roughness: 0.6, metalness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.7 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.8 });
  const add = (geo, m, x, y, z) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  let muzzle = 0.7;
  switch (item.shape) {
    case 'smg':
      add(new THREE.BoxGeometry(0.09, 0.14, 0.42), body, 0, 0, 0.1);
      add(new THREE.BoxGeometry(0.05, 0.05, 0.2), dark, 0, 0.02, 0.4);
      add(new THREE.BoxGeometry(0.06, 0.2, 0.08), dark, 0, -0.14, 0.12);
      add(new THREE.BoxGeometry(0.06, 0.08, 0.2), dark, 0, -0.02, -0.18);
      muzzle = 0.5;
      break;
    case 'pistol':
      add(new THREE.BoxGeometry(0.08, 0.13, 0.32), body, 0, 0, 0.12);
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8), dark, 0, 0, 0.08).rotation.x = Math.PI / 2;
      add(new THREE.BoxGeometry(0.07, 0.17, 0.08), wood, 0, -0.12, -0.02);
      muzzle = 0.3;
      break;
    case 'shotgun':
      add(new THREE.BoxGeometry(0.1, 0.13, 0.5), body, 0, 0, 0.1);
      add(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 8), dark, 0, 0.03, 0.55).rotation.x = Math.PI / 2;
      add(new THREE.BoxGeometry(0.09, 0.08, 0.2), wood, 0, -0.04, 0.45);
      add(new THREE.BoxGeometry(0.08, 0.14, 0.32), wood, 0, -0.05, -0.28);
      muzzle = 0.85;
      break;
    case 'long':
      add(new THREE.BoxGeometry(0.08, 0.12, 0.5), body, 0, 0, 0.05);
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 8), dark, 0, 0.02, 0.65).rotation.x = Math.PI / 2;
      add(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 8), dark, 0, 0.12, 0.05).rotation.x = Math.PI / 2;
      add(new THREE.BoxGeometry(0.07, 0.15, 0.36), wood, 0, -0.04, -0.34);
      muzzle = 1.05;
      break;
    default: // rifle
      add(new THREE.BoxGeometry(0.09, 0.14, 0.55), body, 0, 0, 0.1);
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 8), dark, 0, 0.02, 0.58).rotation.x = Math.PI / 2;
      add(new THREE.BoxGeometry(0.06, 0.2, 0.08), dark, 0, -0.15, 0.18);
      add(new THREE.BoxGeometry(0.07, 0.13, 0.3), wood, 0, -0.03, -0.3);
      add(new THREE.BoxGeometry(0.05, 0.06, 0.14), dark, 0, 0.1, 0.05);
      muzzle = 0.8;
  }
  g.userData.muzzle = new THREE.Vector3(0, 0.02, muzzle);
  return g;
}

export class Player {
  constructor(scene, collision) {
    this.scene = scene;
    this.col = collision;
    this.model = buildRaiderModel();
    scene.add(this.model);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.bodyYaw = 0;
    this.onGround = false;
    this.crouch = false;
    this.sprinting = false;
    this.ads = false;
    this.roll = 0; // seconds remaining
    this.rollDir = new THREE.Vector3();
    this.stamina = PLAYER.stamina;
    this.staminaLock = 0;
    this.health = PLAYER.health;
    this.alive = true;
    this.walkPhase = 0;
    this.stepTimer = 0;
    this.gunModel = null;
    this.gunId = null;
    this.recoilKick = 0;
    this.slow = 0; // movement penalty while using items
    this.holstered = false;
    this.melee = -1; // 0..1 through a stick swing, -1 when not swinging
    this.speedMul = 1; // from carried weight and holstering
    this.canSprint = true;
    this.idle = 0;
    this.crouchBlend = 0;
    this.lastDamage = 0;
  }

  get height() {
    return this.crouch ? CROUCH_H : STAND_H;
  }

  eye() {
    return new THREE.Vector3(this.pos.x, this.pos.y + (this.crouch ? 1.05 : 1.6), this.pos.z);
  }

  chest() {
    return new THREE.Vector3(this.pos.x, this.pos.y + (this.crouch ? 0.8 : 1.25), this.pos.z);
  }

  spawn(x, z, yaw = 0) {
    this.pos.set(x, this.col.groundHeight(x, z, 500, RADIUS, 1000) + 0.05, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.bodyYaw = yaw;
    this.pitch = 0;
    this.health = PLAYER.health;
    this.stamina = PLAYER.stamina;
    this.alive = true;
    this.roll = 0;
    this.crouch = false;
    this.model.visible = true;
    this.model.rotation.set(0, 0, 0);
  }

  // id: the drawn weapon (or null). holstered: show it on the back instead.
  setGun(id, holstered = false) {
    if (this.gunId === id && this.gunHolstered === holstered) return;
    const u = this.model.userData;
    if (this.gunModel) this.gunModel.parent.remove(this.gunModel);
    this.gunModel = id ? buildGunModel(id) : null;
    this.gunId = id;
    this.gunHolstered = holstered;
    if (this.gunModel) (holstered ? u.backSocket : u.gunSocket).add(this.gunModel);
  }

  get armed() {
    return !!this.gunId && !this.gunHolstered && this.melee < 0;
  }

  muzzleWorld() {
    if (!this.gunModel || this.gunHolstered) return this.chest();
    this.model.updateMatrixWorld(true);
    return this.gunModel.localToWorld(this.gunModel.userData.muzzle.clone());
  }

  tryRoll(input) {
    if (this.roll > 0 || !this.onGround || this.stamina < PLAYER.rollCost * 0.5) return false;
    const dir = new THREE.Vector3();
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    dir.addScaledVector(fwd, input.y).addScaledVector(right, input.x);
    if (dir.lengthSq() < 0.01) dir.copy(fwd).multiplyScalar(-1);
    dir.normalize();
    this.rollDir.copy(dir);
    this.roll = 0.55;
    this.stamina = Math.max(0, this.stamina - PLAYER.rollCost);
    this.staminaLock = 0.8;
    this.crouch = false;
    Audio.playRoll();
    return true;
  }

  // input: { x, y (move axes), sprint, jump }
  update(dt, input) {
    if (!this.alive) return;
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const move = new THREE.Vector3().addScaledVector(fwd, input.y).addScaledVector(right, input.x);
    const moving = move.lengthSq() > 0.01;
    const amount = Math.min(1, move.length());
    if (moving) move.normalize().multiplyScalar(amount < 0.35 ? 0.35 : amount);

    this.sprinting = input.sprint && moving && input.y > 0.1 && !this.ads && this.stamina > 1 && this.slow <= 0 && this.staminaLock <= 0 && this.canSprint;
    if (this.sprinting) this.crouch = false;

    let speed = PLAYER.walkSpeed;
    if (this.crouch) speed = PLAYER.crouchSpeed;
    if (this.ads) speed = PLAYER.adsSpeed;
    if (this.sprinting) speed = PLAYER.sprintSpeed;
    if (this.slow > 0) speed = Math.min(speed, PLAYER.crouchSpeed);
    speed *= this.speedMul;

    // stamina
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - PLAYER.sprintDrain * dt);
    else if (this.staminaLock <= 0) this.stamina = Math.min(PLAYER.stamina, this.stamina + PLAYER.staminaRegen * dt);
    if (this.stamina <= 0.5 && this.sprinting) this.staminaLock = 1.2;
    this.staminaLock -= dt;

    let targetX = move.x * speed;
    let targetZ = move.z * speed;
    if (this.roll > 0) {
      const rollSpeed = 9.5 * Math.min(1, this.roll / 0.25 + 0.3);
      targetX = this.rollDir.x * rollSpeed;
      targetZ = this.rollDir.z * rollSpeed;
      this.roll -= dt;
    }
    const accel = this.onGround ? 14 : 3;
    this.vel.x += (targetX - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (targetZ - this.vel.z) * Math.min(1, accel * dt);

    if (input.jump && this.onGround && this.roll <= 0 && this.slow <= 0) {
      if (this.crouch) {
        this.crouch = false;
      } else {
        this.vel.y = PLAYER.jump;
        this.onGround = false;
      }
    }
    this.vel.y -= GRAVITY * dt;

    // integrate in substeps for stable collisions
    const steps = Math.ceil((Math.hypot(this.vel.x, this.vel.z) * dt) / 0.25) || 1;
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.pos.x += this.vel.x * sdt;
      this.pos.z += this.vel.z * sdt;
      this.col.resolveCylinder(this.pos, RADIUS, this.height);
      this.pos.y += this.vel.y * sdt;
      const ground = this.col.groundHeight(this.pos.x, this.pos.z, this.pos.y, RADIUS);
      if (this.pos.y <= ground) {
        if (this.vel.y < -14) this.health -= (Math.abs(this.vel.y) - 14) * 4; // fall damage
        this.pos.y = ground;
        this.vel.y = 0;
        this.onGround = true;
      } else if (this.pos.y > ground + 0.08) {
        this.onGround = false;
      } else if (this.vel.y <= 0) {
        // stick to slopes/stairs going down
        this.pos.y = ground;
        this.vel.y = 0;
        this.onGround = true;
      }
      const ceil = this.col.ceiling(this.pos.x, this.pos.z, this.pos.y + 0.5, RADIUS);
      if (this.pos.y + this.height > ceil) {
        if (this.vel.y > 0) this.vel.y = 0;
        if (!this.crouch && ceil - this.pos.y < STAND_H && ceil - this.pos.y > CROUCH_H) this.crouch = true;
      }
    }
    // can't stand up under a low ceiling
    if (!this.crouch && this.col.ceiling(this.pos.x, this.pos.z, this.pos.y + 0.5, RADIUS) - this.pos.y < STAND_H) this.crouch = true;

    // body faces the aim direction when aiming/shooting, else the move direction
    const flat = Math.hypot(this.vel.x, this.vel.z);
    let targetYaw = this.bodyYaw;
    if (this.ads || input.firing || this.armed || this.melee >= 0) targetYaw = this.yaw;
    else if (flat > 0.5) targetYaw = Math.atan2(this.vel.x, this.vel.z);
    if (this.roll > 0) targetYaw = Math.atan2(this.rollDir.x, this.rollDir.z);
    let diff = targetYaw - this.bodyYaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.bodyYaw += diff * Math.min(1, dt * 14);

    // footsteps
    if (this.onGround && flat > 1) {
      this.stepTimer -= dt * flat;
      if (this.stepTimer <= 0) {
        this.stepTimer = 2.2;
        Audio.playStep(undefined, this.crouch);
      }
    }

    this.animate(dt, flat);
  }

  animate(dt, flat) {
    const u = this.model.userData;
    this.model.position.copy(this.pos);
    this.model.rotation.set(0, this.bodyYaw, 0);
    this.walkPhase += dt * flat * 1.7;
    this.idle = flat < 0.3 ? this.idle + dt : 0;
    this.crouchBlend += ((this.crouch ? 1 : 0) - this.crouchBlend) * Math.min(1, dt * 10);
    this.recoilKick *= Math.max(0, 1 - dt * 12);
    poseRig(u, {
      speed: flat,
      phase: this.walkPhase,
      crouchBlend: this.crouchBlend,
      sprint: this.sprinting,
      airborne: !this.onGround && this.roll <= 0,
      armed: this.armed,
      ads: this.ads,
      pitch: this.pitch,
      recoil: this.recoilKick,
      melee: this.melee,
      idle: this.idle,
    }, dt);
    // roll: tumble the whole model
    if (this.roll > 0) {
      const t = 1 - this.roll / 0.55;
      this.model.rotateOnAxis(new THREE.Vector3(1, 0, 0), t * Math.PI * 2);
    }
  }

  die() {
    this.alive = false;
    this.model.rotation.x = -Math.PI / 2;
    this.model.position.y += 0.3;
  }
}
