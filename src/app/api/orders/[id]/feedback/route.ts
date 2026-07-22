import { NextRequest } from "next/server";
import { requireUser } from "@/modules/auth/server";
import { apiRoute, json, readJsonObject } from "@/shared/server/api";
import { integer, optionalString } from "@/shared/validation";
import { createPostPickupFeedback } from "@/lib/post-pickup-feedback";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(req, async () => {
    const user = await requireUser();
    const { id } = await params;
    const body = await readJsonObject(req);
    const feedback = await createPostPickupFeedback(user.id, id, {
          quality: integer(body.quality, "quality", { min: 1, max: 5 }),
          freshness: integer(body.freshness, "freshness", { min: 1, max: 5 }),
          match: integer(body.match, "match", { min: 1, max: 5 }),
          value: integer(body.value, "value", { min: 1, max: 5 }),
          pickup: integer(body.pickup, "pickup", { min: 1, max: 5 }),
          comment: optionalString(body.comment, "comment", 800),
    });
    return json({ feedback }, { status: 201 });
  });
}
