ALTER TABLE "Order"
  ADD COLUMN "offerSnapshotJson" TEXT NOT NULL DEFAULT '{}';

UPDATE "Order" orders
SET "offerSnapshotJson" = json_build_object(
  'title', bag.title,
  'description', bag.description,
  'composition', bag.composition,
  'allergens', bag.allergens,
  'storage', bag.storage,
  'examplePhoto', bag."examplePhoto",
  'price', bag.price,
  'originalPrice', bag."originalPrice",
  'pickupStart', bag."pickupStart",
  'pickupEnd', bag."pickupEnd",
  'venueName', venue.name,
  'venueAddress', venue.address,
  'sellerLegalName', COALESCE(partner."legalName", venue.name),
  'sellerLegalType', COALESCE(partner."legalType", '')
)::text
FROM "Bag" bag
JOIN "Venue" venue ON venue.id = bag."venueId"
LEFT JOIN "PartnerBusiness" partner ON partner."ownerId" = venue."ownerId"
WHERE bag.id = orders."bagId";

CREATE OR REPLACE FUNCTION prevent_order_offer_snapshot_mutation()
RETURNS trigger AS $$
BEGIN
  IF NEW."offerSnapshotJson" IS DISTINCT FROM OLD."offerSnapshotJson" THEN
    RAISE EXCEPTION 'Order offer snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Order_offer_snapshot_immutable"
BEFORE UPDATE OF "offerSnapshotJson" ON "Order"
FOR EACH ROW EXECUTE FUNCTION prevent_order_offer_snapshot_mutation();
