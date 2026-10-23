-- The original default stored a literal backslash-n instead of a newline.
UPDATE content_blocks SET value = jsonb_set(value, '{title}', to_jsonb(E'African groceries,\nfrom the stores you trust.'::text))
 WHERE key = 'home_hero' AND value->>'title' LIKE '%\n%';
