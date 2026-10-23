import { buildApp } from '../src/app.js';

export const app = await buildApp();

export async function login(email: string, password = 'dev-password-123') {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  const cookie = String(r.headers['set-cookie']).split(';')[0];
  return { status: r.statusCode, cookie };
}
export const as = (cookie: string) => ({ cookie });
