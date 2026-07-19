import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import { prisma } from "@/lib/db";
import { createOrder } from "@/modules/orders";
import { createPostPickupFeedback } from "@/lib/post-pickup-feedback";
import { MAX_COMPLAINT_ATTACHMENT_BYTES, readComplaintAttachment, removeComplaintAttachment, saveComplaintAttachment } from "@/lib/complaint-attachments";
import { createFixtures, resetDb } from "./helpers";

beforeEach(() => resetDb());

describe("приватный post-pickup feedback", () => {
  it("принимает пять структурированных оценок только после выдачи и один раз", async () => {
    const { customer, bag } = await createFixtures();
    const order = await createOrder(customer.id, bag.id, 1);
    const input = { quality: 5, freshness: 4, match: 3, value: 5, pickup: 4, comment: "Удобная выдача" };
    await expect(createPostPickupFeedback(customer.id, order.id, input)).rejects.toThrow("после выдачи");
    await prisma.order.update({ where: { id: order.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    await expect(createPostPickupFeedback(customer.id, order.id, input)).resolves.toMatchObject(input);
    await expect(createPostPickupFeedback(customer.id, order.id, input)).rejects.toThrow("уже оценили");
    await expect(prisma.review.count()).resolves.toBe(0);
  });
});

describe("безопасные вложения обращений", () => {
  let directory = "";
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); delete process.env.COMPLAINT_UPLOAD_DIR; });

  it("проверяет реальный MIME, заявленный MIME и размер", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "foodgood-attachments-"));
    process.env.COMPLAINT_UPLOAD_DIR = directory;
    await expect(saveComplaintAttachment(new File(["not an image"], "fake.jpg", { type: "image/jpeg" }))).rejects.toThrow("ATTACHMENT_TYPE");
    await expect(saveComplaintAttachment(new File([new Uint8Array(MAX_COMPLAINT_ATTACHMENT_BYTES + 1)], "large.pdf", { type: "application/pdf" }))).rejects.toThrow("ATTACHMENT_SIZE");
    await expect(saveComplaintAttachment(new File(["%PDF-1.7\n%%EOF"], "proof.jpg", { type: "image/jpeg" }))).rejects.toThrow("ATTACHMENT_TYPE");

    const saved = await saveComplaintAttachment(new File(["%PDF-1.7\n%%EOF"], "proof.pdf", { type: "application/pdf" }));
    await expect(readComplaintAttachment(saved.storageKey)).resolves.toBeInstanceOf(Uint8Array);
    await removeComplaintAttachment(saved.storageKey);
    await expect(readComplaintAttachment(saved.storageKey)).resolves.toBeNull();
  });
});
