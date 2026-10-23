-- Views freeze `s.*` at creation time. Recreate after stores gained columns in 005.
-- (Any future migration that adds columns to `stores` must recreate this view too.)
DROP VIEW storefronts;
CREATE VIEW storefronts AS
SELECT s.*,
       (s.status = 'published' AND v.status = 'approved') AS orderable,
       EXISTS (
         SELECT 1 FROM store_hours h
          WHERE h.store_id = s.id
            AND h.dow = EXTRACT(DOW FROM (now() AT TIME ZONE s.timezone))
            AND (now() AT TIME ZONE s.timezone)::time >= h.opens
            AND (now() AT TIME ZONE s.timezone)::time <  h.closes
       ) AS is_open
  FROM stores s JOIN vendors v ON v.id = s.vendor_id;
