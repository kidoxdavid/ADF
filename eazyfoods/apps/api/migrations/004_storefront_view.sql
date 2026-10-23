-- A store is orderable only when published AND its vendor is approved.
-- is_open is computed in the store's own timezone from its weekly hours.
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
