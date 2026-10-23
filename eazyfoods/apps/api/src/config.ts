import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  SESSION_DAYS: z.coerce.number().default(30),
});

export const config = schema.parse(process.env);
export const isProd = config.NODE_ENV === 'production';
