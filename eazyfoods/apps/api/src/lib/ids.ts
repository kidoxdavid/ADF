import { randomBytes, randomInt } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function orderNumber() {
  const b = randomBytes(6);
  return 'EZ-' + [...b].map((x) => ALPHABET[x % 32]).join('');
}
export const handoverCode = () => String(randomInt(0, 10000)).padStart(4, '0');
