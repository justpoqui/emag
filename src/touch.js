// On-screen controls for phones and tablets: a floating move stick on the
// left, drag anywhere else to look, and action buttons on the right. Buttons
// feed the same key codes the keyboard uses, so the game code doesn't care
// where input comes from.

const LOOK_SPEED = 2.2; // touch pixels -> mouse pixels

export class TouchControls {
  constructor(input, game) {
    this.input = input;
    this.game = game;
    this.stick = null; // { id, x, y }
    this.look = null; // { id, x, y }
    this.visible = false;

    const root = document.createElement('div');
    root.id = 'touch';
    root.className = 'hidden';
    root.innerHTML = `
      <div class="t-look"></div>
      <div class="t-stick-zone"></div>
      <div class="t-stick hidden"><div class="t-knob"></div></div>
      <div class="t-top">
        <button class="t-btn small" data-act="pause">❚❚</button>
        <button class="t-btn small" data-act="map">MAP</button>
        <button class="t-btn small" data-act="bag">BAG</button>
      </div>
      <div class="t-right">
        <button class="t-btn fire" data-act="fire">FIRE</button>
        <button class="t-btn aim" data-act="aim">AIM</button>
        <button class="t-btn" data-key="KeyR">RELOAD</button>
        <button class="t-btn" data-key="Space">JUMP</button>
        <button class="t-btn" data-key="KeyC">CROUCH</button>
        <button class="t-btn" data-key="KeyV">ROLL</button>
        <button class="t-btn interact hidden" data-key="KeyE">USE</button>
      </div>
      <div class="t-items">
        <button class="t-btn small" data-act="swap">⇄ SWAP</button>
        <button class="t-btn small" data-key="Digit3">✚ HEAL</button>
        <button class="t-btn small" data-key="Digit4">⚡ SHIELD</button>
        <button class="t-btn small" data-key="KeyG">● NADE</button>
      </div>`;
    document.body.appendChild(root);
    this.root = root;
    this.stickEl = root.querySelector('.t-stick');
    this.knob = root.querySelector('.t-knob');
    this.aimBtn = root.querySelector('.aim');
    this.interactBtn = root.querySelector('.interact');

    // move stick
    const zone = root.querySelector('.t-stick-zone');
    zone.addEventListener('pointerdown', (e) => {
      if (this.stick) return;
      try { zone.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
      this.stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.stickEl.classList.remove('hidden');
      this.stickEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.knob.style.transform = 'translate(0px, 0px)';
      input.stick = { x: 0, y: 0 };
    });
    zone.addEventListener('pointermove', (e) => {
      if (!this.stick || e.pointerId !== this.stick.id) return;
      const R = 55;
      let dx = e.clientX - this.stick.x;
      let dy = e.clientY - this.stick.y;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        dx = (dx / d) * R;
        dy = (dy / d) * R;
      }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      input.stick = { x: dx / R, y: -dy / R };
      // push the stick all the way forward to sprint
      if (d > R * 1.15 && -dy / R > 0.6) input.keys.add('ShiftLeft');
      else input.keys.delete('ShiftLeft');
    });
    const endStick = (e) => {
      if (!this.stick || e.pointerId !== this.stick.id) return;
      this.stick = null;
      input.stick = null;
      input.keys.delete('ShiftLeft');
      this.stickEl.classList.add('hidden');
    };
    zone.addEventListener('pointerup', endStick);
    zone.addEventListener('pointercancel', endStick);

    // look: drag anywhere that isn't the stick or a button
    const lookZone = root.querySelector('.t-look');
    this.bindLook(lookZone);

    // buttons
    for (const btn of root.querySelectorAll('.t-btn')) {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
        btn.classList.add('down');
        this.press(btn, e);
      });
      const up = (e) => {
        btn.classList.remove('down');
        this.release(btn, e);
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      // the fire button doubles as a look pad so you can aim while shooting
      if (btn.dataset.act === 'fire') {
        btn.addEventListener('pointermove', (e) => this.moveLook(e));
      }
    }
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  bindLook(el) {
    el.addEventListener('pointerdown', (e) => {
      if (this.look) return;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
      this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointermove', (e) => this.moveLook(e));
    const end = (e) => {
      if (this.look && e.pointerId === this.look.id) this.look = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  moveLook(e) {
    if (!this.look || e.pointerId !== this.look.id) return;
    this.input.mouse.dx += (e.clientX - this.look.x) * LOOK_SPEED;
    this.input.mouse.dy += (e.clientY - this.look.y) * LOOK_SPEED;
    this.look.x = e.clientX;
    this.look.y = e.clientY;
  }

  press(btn, e) {
    const input = this.input;
    const key = btn.dataset.key;
    if (key) {
      input.keys.add(key);
      input.pressed.add(key);
      return;
    }
    switch (btn.dataset.act) {
      case 'fire':
        input.mouse.left = true;
        input.mouse.leftPressed = true;
        if (!this.look) this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
        break;
      case 'aim':
        input.mouse.right = !input.mouse.right;
        btn.classList.toggle('on', input.mouse.right);
        break;
      case 'swap':
        input.pressed.add('Digit' + (this.game.weapons.active === 0 ? 2 : 1));
        break;
      case 'bag':
        input.pressed.add('Tab');
        break;
      case 'map':
        input.pressed.add('KeyM');
        break;
      case 'pause':
        this.game.setPaused(true);
        break;
      default:
        break;
    }
  }

  release(btn, e) {
    const key = btn.dataset.key;
    if (key) {
      this.input.keys.delete(key);
      return;
    }
    if (btn.dataset.act === 'fire') {
      this.input.mouse.left = false;
      if (this.look && this.look.id === e.pointerId) this.look = null;
    }
  }

  // Called every frame by the game.
  update(showControls, showInteract) {
    if (showControls !== this.visible) {
      this.visible = showControls;
      this.root.classList.toggle('hidden', !showControls);
      if (!showControls) this.reset();
    }
    this.interactBtn.classList.toggle('hidden', !showInteract);
    this.aimBtn.classList.toggle('on', this.input.mouse.right);
  }

  reset() {
    const input = this.input;
    this.stick = null;
    this.look = null;
    input.stick = null;
    input.mouse.left = false;
    input.mouse.right = false;
    for (const k of ['ShiftLeft', 'KeyE', 'Space', 'KeyR', 'KeyC', 'KeyV', 'Digit3', 'Digit4', 'KeyG']) input.keys.delete(k);
    this.stickEl.classList.add('hidden');
    for (const b of this.root.querySelectorAll('.t-btn.down')) b.classList.remove('down');
  }
}
