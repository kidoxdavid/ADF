import { mkdirSync, writeFileSync, createReadStream, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { bad } from './errors.js';

/**
 * Local-disk storage behind a tiny interface so S3-compatible storage can replace it without touching callers.
 * "public" files are images served at /uploads/*. "private" files (business documents) are never served statically.
 */
const root = resolve(config.UPLOAD_DIR);
export const publicDir = join(root, 'public');
const privateDir = join(root, 'private');
mkdirSync(publicDir, { recursive: true });
mkdirSync(privateDir, { recursive: true });

const SIGS: { ext: string; mime: string; test: (b: Buffer) => boolean }[] = [
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  { ext: 'pdf', mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString() === '%PDF-' },
];

/** Identify the real file type from its bytes (the client-supplied name and content-type are never trusted). */
export function sniff(buf: Buffer, allow: ('jpg' | 'png' | 'webp' | 'pdf')[]) {
  const t = SIGS.find((s) => s.test(buf));
  if (!t || !allow.includes(t.ext as any)) throw bad('unsupported_file', `Unsupported file type. Allowed: ${allow.join(', ')}.`);
  return t;
}

export function save(buf: Buffer, ext: string, visibility: 'public' | 'private'): { key: string; url: string } {
  const key = randomBytes(16).toString('hex') + '.' + ext;
  writeFileSync(join(visibility === 'public' ? publicDir : privateDir, key), buf);
  return { key, url: visibility === 'public' ? `/uploads/${key}` : `private:${key}` };
}

export function openPrivate(key: string) {
  if (!/^[a-f0-9]{32}\.(jpg|png|webp|pdf)$/.test(key)) throw bad('bad_key', 'Invalid file.');
  const p = join(privateDir, key);
  if (!existsSync(p)) return null;
  return createReadStream(p);
}

/** Only accept image URLs that we issued, so a vendor cannot hotlink arbitrary third-party URLs into the catalogue. */
export const isOurImageUrl = (u: string) => /^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(u);
