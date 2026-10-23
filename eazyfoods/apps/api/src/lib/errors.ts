export class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export const notFound = (what = 'Not found') => new HttpError(404, 'not_found', what);
export const forbidden = (msg = 'You do not have access to this.') => new HttpError(403, 'forbidden', msg);
export const conflict = (code: string, msg: string, details?: unknown) => new HttpError(409, code, msg, details);
export const bad = (code: string, msg: string, details?: unknown) => new HttpError(400, code, msg, details);
