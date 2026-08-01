import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('__filename:', __filename);
console.log('__dirname:', __dirname);

const envPath = path.resolve(__dirname, '../../../.env');
console.log('envPath:', envPath);
console.log('exists:', (await import('node:fs')).existsSync(envPath));

const result = dotenv.config({ path: envPath });
console.log('parsed keys:', Object.keys(result.parsed ?? {}));
console.log('DATABASE_URL loaded?:', Boolean(result.parsed?.DATABASE_URL));
console.log('process.env.DATABASE_URL?:', Boolean(process.env.DATABASE_URL));
