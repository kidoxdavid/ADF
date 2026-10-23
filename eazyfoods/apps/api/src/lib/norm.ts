/** Normalise text for matching: lowercase, strip accents/punctuation, collapse spaces. */
export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(s: string): string {
  return norm(s).replace(/\s/g, '-');
}
