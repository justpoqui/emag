import { Game } from './game.js';

// Let the boot screen paint before the (synchronous) world build.
requestAnimationFrame(() => {
  setTimeout(() => {
    const game = new Game(document.getElementById('app'));
    // only dev and test builds expose the game object (it would make cheating trivial)
    if (import.meta.env.DEV || import.meta.env.MODE === 'test') window.game = game;
    document.getElementById('boot').classList.add('done');
  }, 30);
});
