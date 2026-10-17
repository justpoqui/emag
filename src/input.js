// Keyboard, mouse and pointer-lock state. On touch devices there is no
// pointer lock; TouchControls writes into the same state instead.

import { IS_TOUCH } from './settings.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set(); // keys pressed this frame
    this.mouse = { left: false, right: false, leftPressed: false, dx: 0, dy: 0, wheel: 0 };
    this.locked = false;
    this.sensitivity = 0.0022;
    this.enabled = true;
    this.touch = IS_TOUCH;
    this.stick = null; // analog { x, y } from the touch stick

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'AltLeft' || (e.code === 'Space' && this.locked)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.left = this.mouse.right = false;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) {
        this.mouse.left = true;
        this.mouse.leftPressed = true;
      }
      if (e.button === 2) this.mouse.right = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    window.addEventListener('wheel', (e) => {
      if (this.locked) this.mouse.wheel += Math.sign(e.deltaY);
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.mouse.left = false;
        this.mouse.right = false;
      }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  lock() {
    if (this.touch) return;
    if (!this.locked) {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) {
    return this.keys.has(code);
  }

  hit(code) {
    return this.pressed.has(code);
  }

  axis() {
    if (this.stick) return { x: this.stick.x, y: this.stick.y };
    let x = 0;
    let y = 0;
    if (this.down('KeyW')) y += 1;
    if (this.down('KeyS')) y -= 1;
    if (this.down('KeyD')) x += 1;
    if (this.down('KeyA')) x -= 1;
    return { x, y };
  }

  endFrame() {
    this.pressed.clear();
    this.mouse.leftPressed = false;
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
  }
}
