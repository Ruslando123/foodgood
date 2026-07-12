-- Run against a production-like snapshot after ANALYZE. Keep BUFFERS enabled:
-- index usefulness cannot be judged from execution time alone.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT bag.id,
       ST_Distance(
         venue.location,
         ST_SetSRID(ST_MakePoint(76.8897, 43.2389), 4326)::geography
       ) AS distance_m
FROM "Bag" bag
JOIN "Venue" venue ON venue.id = bag."venueId"
WHERE bag.status = 'ACTIVE'
  AND bag."quantityLeft" > 0
  AND bag."pickupEnd" > now()
  AND venue.status = 'ACTIVE'
  AND venue."cityId" = 'almaty'
  AND ST_DWithin(
    venue.location,
    ST_SetSRID(ST_MakePoint(76.8897, 43.2389), 4326)::geography,
    10000
  )
ORDER BY distance_m, bag.id
LIMIT 25;

EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, "nextAttemptAt"
FROM "PaymentOperation"
WHERE status IN ('PENDING', 'RETRY', 'PROCESSING')
  AND "nextAttemptAt" <= now()
ORDER BY "nextAttemptAt", id
LIMIT 100;
