// Short-lived visual effects: tracers, impact sparks, muzzle flashes,
// explosions and floating damage numbers.

import * as THREE from 'three';

export class Effects {
  constructor(scene, camera, overlay) {
    this.scene = scene;
    this.camera = camera;
    this.overlay = overlay; // DOM element for damage numbers
    this.items = [];
    this.numbers = [];
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.9 });
    this.huskTracerMat = new THREE.LineBasicMaterial({ color: 0xff5530, transparent: true, opacity: 0.9 });
    this.sparkGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
    this.sparkMat = new THREE.MeshBasicMaterial({ color: 0xffc070 });
    this.dustMat = new THREE.MeshBasicMaterial({ color: 0x9a8a6a, transparent: true, opacity: 0.7 });
    this.flash = new THREE.PointLight(0xffc070, 0, 8, 2);
    scene.add(this.flash);
    this.flashTime = 0;
  }

  tracer(from, to, husk = false) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const line = new THREE.Line(geo, (husk ? this.huskTracerMat : this.tracerMat).clone());
    this.scene.add(line);
    this.items.push({ obj: line, life: 0.06, max: 0.06, fade: true });
  }

  muzzle(pos) {
    this.flash.position.copy(pos);
    this.flash.intensity = 6;
    this.flashTime = 0.05;
  }

  impact(pos, normal, kind = 'dust') {
    const count = kind === 'metal' ? 6 : 4;
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.sparkGeo, kind === 'metal' ? this.sparkMat : this.dustMat);
      m.position.copy(pos);
      const v = new THREE.Vector3(normal[0] + (Math.random() - 0.5) * 1.4, normal[1] + Math.random() * 0.8, normal[2] + (Math.random() - 0.5) * 1.4).multiplyScalar(kind === 'metal' ? 6 : 2.5);
      this.scene.add(m);
      this.items.push({ obj: m, life: 0.35, max: 0.35, vel: v, gravity: true });
    }
  }

  explosion(pos, radius) {
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    sphere.position.copy(pos);
    this.scene.add(sphere);
    this.items.push({ obj: sphere, life: 0.45, max: 0.45, grow: radius, fade: true });
    const smoke = new THREE.Mesh(
      new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x4a4440, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    smoke.position.copy(pos);
    this.scene.add(smoke);
    this.items.push({ obj: smoke, life: 1.6, max: 1.6, grow: radius * 1.3, fade: true, rise: 2 });
    const light = new THREE.PointLight(0xff8030, 60, radius * 5, 2);
    light.position.copy(pos);
    this.scene.add(light);
    this.items.push({ obj: light, life: 0.3, max: 0.3, light: 60 });
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(this.sparkGeo, this.sparkMat);
      m.position.copy(pos);
      m.scale.setScalar(2);
      this.scene.add(m);
      this.items.push({ obj: m, life: 0.8, max: 0.8, vel: new THREE.Vector3((Math.random() - 0.5) * 18, Math.random() * 12, (Math.random() - 0.5) * 18), gravity: true });
    }
  }

  // A brief glowing ring, e.g. a Pouncer slam.
  shockwave(pos, radius, color = 0xff6a20) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(pos);
    ring.position.y += 0.2;
    this.scene.add(ring);
    this.items.push({ obj: ring, life: 0.5, max: 0.5, grow: radius, fade: true });
  }

  damageNumber(pos, amount, color = '#ffffff', big = false) {
    const el = document.createElement('div');
    el.className = 'dmg-number' + (big ? ' big' : '');
    el.textContent = Math.round(amount);
    el.style.color = color;
    this.overlay.appendChild(el);
    this.numbers.push({ el, pos: pos.clone(), life: 0.8, drift: (Math.random() - 0.5) * 30 });
  }

  update(dt) {
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      if (this.flashTime <= 0) this.flash.intensity = 0;
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      const t = 1 - it.life / it.max;
      if (it.vel) {
        if (it.gravity) it.vel.y -= 20 * dt;
        it.obj.position.addScaledVector(it.vel, dt);
      }
      if (it.grow) it.obj.scale.setScalar(0.3 + it.grow * Math.min(1, t * 1.6));
      if (it.rise) it.obj.position.y += it.rise * dt;
      if (it.fade && it.obj.material) it.obj.material.opacity = Math.max(0, 1 - t) * 0.9;
      if (it.light) it.obj.intensity = it.light * (1 - t);
      if (it.life <= 0) {
        this.scene.remove(it.obj);
        if (it.obj.geometry && it.obj.geometry !== this.sparkGeo) it.obj.geometry.dispose();
        if (it.obj.material && it.obj.material !== this.sparkMat && it.obj.material !== this.dustMat) it.obj.material.dispose();
        this.items.splice(i, 1);
      }
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    const v = new THREE.Vector3();
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.life -= dt;
      n.pos.y += dt * 1.2;
      v.copy(n.pos).project(this.camera);
      if (v.z > 1 || n.life <= 0) {
        n.el.style.display = 'none';
      } else {
        n.el.style.display = 'block';
        n.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w + n.drift * (1 - n.life)}px, ${(-v.y * 0.5 + 0.5) * h}px)`;
        n.el.style.opacity = Math.min(1, n.life * 3);
      }
      if (n.life <= 0) {
        n.el.remove();
        this.numbers.splice(i, 1);
      }
    }
  }

  clear() {
    for (const it of this.items) this.scene.remove(it.obj);
    this.items.length = 0;
    for (const n of this.numbers) n.el.remove();
    this.numbers.length = 0;
  }
}
