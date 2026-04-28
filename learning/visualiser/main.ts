import { SpliceScene } from './scenes/splice.ts';
import { DisconnectLeakScene } from './scenes/disconnectLeak.ts';
import { renderSpliceScene } from './renderers/splice.ts';
import { renderDisconnectLeakScene } from './renderers/disconnectLeak.ts';

const spliceMount = document.querySelector<HTMLElement>('[data-mount="splice"]');
if (spliceMount) {
  const scene = new SpliceScene();
  scene.addHandler('first', { removes: 'second' });
  scene.addHandler('second');
  scene.addHandler('third');
  renderSpliceScene(scene, spliceMount);
}

const disconnectMount = document.querySelector<HTMLElement>('[data-mount="disconnect"]');
if (disconnectMount) {
  const scene = new DisconnectLeakScene();
  renderDisconnectLeakScene(scene, disconnectMount);
}
