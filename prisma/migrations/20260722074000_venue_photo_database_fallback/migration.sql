CREATE TABLE "VenuePhotoAsset" (
  "filename" TEXT NOT NULL,
  "bytes" BYTEA NOT NULL,
  "contentType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VenuePhotoAsset_pkey" PRIMARY KEY ("filename"),
  CONSTRAINT "VenuePhotoAsset_content_type_check" CHECK ("contentType" = 'image/webp'),
  CONSTRAINT "VenuePhotoAsset_size_check" CHECK (
    "sizeBytes" > 0
    AND "sizeBytes" <= 5242880
    AND octet_length("bytes") = "sizeBytes"
  )
);

CREATE INDEX "VenuePhotoAsset_createdAt_idx" ON "VenuePhotoAsset"("createdAt");
