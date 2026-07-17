import { defineConfig } from '../../../server/config.ts';

// A fixture ekolite.config.ts, the shape a developer's project root carries.
export default defineConfig({ app: './app.ts', clientDir: './dist/client' });
