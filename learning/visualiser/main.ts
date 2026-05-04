import { SpliceScene } from './scenes/splice.ts';
import { DisconnectLeakScene } from './scenes/disconnectLeak.ts';
import { ClosureCaptureScene } from './scenes/closureCapture.ts';
import { renderSpliceScene } from './renderers/splice.ts';
import { renderDisconnectLeakScene } from './renderers/disconnectLeak.ts';
import { renderClosureCaptureScene } from './renderers/closureCapture.ts';

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

const closureMount = document.querySelector<HTMLElement>('[data-mount="closure"]');
if (closureMount) {
  const scene = new ClosureCaptureScene();
  renderClosureCaptureScene(scene, closureMount);
}
