import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { readComplaintAttachment } from "@/lib/complaint-attachments";
import { requireUser } from "@/modules/auth/server";
import { apiRoute, ApiError } from "@/shared/server/api";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(req, async () => {
    const user = await requireUser();
    const { id } = await params;
    const attachment = await prisma.complaintAttachment.findUnique({
      where: { id },
      include: { complaint: { select: { customerId: true } } },
    });
    if (!attachment || (user.role !== "ADMIN" && attachment.complaint.customerId !== user.id)) {
      throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "Вложение не найдено");
    }
    const bytes = await readComplaintAttachment(attachment.storageKey);
    if (!bytes) throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "Вложение не найдено");
    const filename = attachment.originalName.replace(/["\\\r\n]/g, "_");
    return new Response(new Uint8Array(bytes).buffer, {
      headers: {
        "Content-Type": attachment.contentType,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
