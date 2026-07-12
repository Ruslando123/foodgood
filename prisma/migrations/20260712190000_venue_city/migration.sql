ALTER TABLE "Venue" ADD COLUMN "cityId" TEXT;

UPDATE "Venue" AS venue
SET "cityId" = (
  SELECT city.id
  FROM (VALUES
    ('astana', 51.1694, 71.4491), ('almaty', 43.2389, 76.8897),
    ('shymkent', 42.3417, 69.5901), ('aktobe', 50.2839, 57.1670),
    ('karaganda', 49.8064, 73.0855), ('taraz', 42.9000, 71.3667),
    ('pavlodar', 52.2873, 76.9674), ('oskemen', 49.9483, 82.6275),
    ('semey', 50.4111, 80.2275), ('atyrau', 47.0945, 51.9238),
    ('kostanay', 53.2144, 63.6246), ('kyzylorda', 44.8488, 65.4823),
    ('oral', 51.2333, 51.3667), ('petropavl', 54.8753, 69.1628),
    ('aktau', 43.6532, 51.1975), ('turkistan', 43.2973, 68.2518),
    ('taldykorgan', 45.0156, 78.3739), ('kokshetau', 53.2833, 69.3833),
    ('zhezkazgan', 47.7833, 67.7000), ('konaev', 43.8833, 77.0833)
  ) AS city(id, lat, lng)
  ORDER BY
    power(venue.lat - city.lat, 2) +
    power((venue.lng - city.lng) * cos(radians(venue.lat)), 2)
  LIMIT 1
);

ALTER TABLE "Venue" ALTER COLUMN "cityId" SET NOT NULL;
ALTER TABLE "Venue" ALTER COLUMN "cityId" SET DEFAULT 'almaty';
CREATE INDEX "Venue_cityId_status_idx" ON "Venue"("cityId", "status");
