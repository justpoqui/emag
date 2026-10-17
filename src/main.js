import { Game } from './game.js';

// Let the boot screen paint before the (synchronous) world build.
requestAnimationFrame(() => {
  setTimeout(() => {
    const game = new Game(document.getElementById('app'));
    window.game = game; // handy for debugging from the console
    document.getElementById('boot').classList.add('done');
  }, 30);
});
