import { createApp } from '../server/src/app.js';

/**
 * Vercel serverless entrypoint. Mounts the Express app at /api.
 * vercel.json routes /api/* here.
 */
export default createApp();
