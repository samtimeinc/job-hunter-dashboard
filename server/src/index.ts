import { config } from './config.js';
import { createApp } from './app.js';

/** Dev entry point — only used by `npm run dev:server`. Vercel uses api/index.ts */
const app = createApp();
app.listen(config.port, () => {
  console.info(`[server] listening on http://localhost:${config.port}`);
});
