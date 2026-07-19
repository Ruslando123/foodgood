import { NextRequest } from "next/server";
import { requireUser } from "@/modules/auth/server";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { optionalString } from "@/shared/validation";
import { createOrderComplaint } from "@/lib/order-support";
import { isComplaintCategory } from "@/shared/support";
import { removeComplaintAttachment, saveComplaintAttachment } from "@/lib/complaint-attachments";
import type { StoredComplaintAttachment } from "@/lib/complaint-attachments";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(req, async () => {
    const user = await requireUser();
    const { id } = await params;
    const multipart = req.headers.get("content-type")?.includes("multipart/form-data") ?? false;
    const form = multipart ? await req.formData() : null;
    const body = form ? { category: form.get("category"), note: form.get("note") } : await readJsonObject(req);
    if (!isComplaintCategory(body.category)) {
      throw new ApiError(400, "INVALID_COMPLAINT_CATEGORY", "Выберите категорию проблемы");
    }
    const note = optionalString(body.note, "note", 1000);
    if (body.category === "OTHER" && note.length < 5) {
      throw new ApiError(400, "COMPLAINT_NOTE_REQUIRED", "Опишите проблему подробнее");
    }
    const files = form ? form.getAll("attachments").filter((value): value is File => value instanceof File && value.size > 0) : [];
    if (files.length > 3) throw new ApiError(400, "TOO_MANY_ATTACHMENTS", "Можно добавить не больше трёх файлов");
    const attachments: StoredComplaintAttachment[] = [];
    try {
      for (const file of files) {
        try { attachments.push(await saveComplaintAttachment(file)); }
        catch (error) {
          if (error instanceof Error && error.message === "ATTACHMENT_SIZE") throw new ApiError(400, "ATTACHMENT_TOO_LARGE", "Каждый файл должен быть не больше 5 МБ");
          if (error instanceof Error && error.message === "ATTACHMENT_STORAGE_CONFIG") throw new ApiError(503, "ATTACHMENT_STORAGE_UNAVAILABLE", "Хранилище вложений временно недоступно");
          throw new ApiError(400, "ATTACHMENT_TYPE", "Поддерживаются JPG, PNG, WebP и PDF с корректным содержимым");
        }
      }
      const complaint = await createOrderComplaint({ userId: user.id, orderId: id, category: body.category, note, attachments });
      return json({ complaint }, { status: 201 });
    } catch (error) {
      await Promise.all(attachments.map((attachment) => removeComplaintAttachment(attachment.storageKey)));
      throw error;
    }
  });
}
