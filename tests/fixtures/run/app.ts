import { type AppEntry } from '../../../server/run.ts';

// A fixture app entry, the shape a developer's app module default-exports.
const entry: AppEntry = (eko) => {
  eko.methods.define('ping', () => Promise.resolve('pong'));
};

export default entry;
