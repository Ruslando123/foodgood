import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "./helpers";

const cookieState = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieState.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => cookieState.set(name, value),
    delete: (name: string) => cookieState.delete(name),
  }),
}));

import {
  getSelectedAdminBusinessOwner,
  selectAdminBusinessOwner,
} from "@/lib/admin-business-context";
import { assertBusinessOwnerContext } from "@/modules/auth/business";

beforeEach(async () => {
  cookieState.clear();
  await resetDb();
});

describe("admin business context", () => {
  it("rejects a mutation submitted from a tab opened for another owner", () => {
    const current = new Request("http://localhost/api/business/venues", {
      method: "POST",
      headers: { "X-FoodGood-Owner-Context": "owner-b" },
    });
    expect(() => assertBusinessOwnerContext(current, "owner-b")).not.toThrow();
    expect(() => assertBusinessOwnerContext(current, "owner-a")).toThrowError(
      expect.objectContaining({ code: "BUSINESS_OWNER_CONTEXT_CHANGED", status: 409 })
    );
  });

  it("binds the selected active merchant to the admin and exact primary session", async () => {
    const owner = await prisma.user.create({
      data: { phone: "+77010001111", role: "MERCHANT", status: "ACTIVE" },
    });
    cookieState.set("foodgood_session", "primary-session-a");

    await expect(selectAdminBusinessOwner("admin-a", owner.id)).resolves.toMatchObject({ id: owner.id });
    await expect(getSelectedAdminBusinessOwner("admin-a")).resolves.toMatchObject({ id: owner.id });
    await expect(getSelectedAdminBusinessOwner("admin-b")).resolves.toBeNull();

    cookieState.set("foodgood_session", "primary-session-b");
    await expect(getSelectedAdminBusinessOwner("admin-a")).resolves.toBeNull();
  });

  it("rejects a non-active merchant and invalidates a stale selection", async () => {
    const owner = await prisma.user.create({
      data: { phone: "+77010002222", role: "MERCHANT", status: "ACTIVE" },
    });
    const blocked = await prisma.user.create({
      data: { phone: "+77010003333", role: "MERCHANT", status: "BLOCKED" },
    });
    cookieState.set("foodgood_session", "primary-session");

    await expect(selectAdminBusinessOwner("admin-a", blocked.id)).rejects.toMatchObject({
      code: "ACTIVE_OWNER_NOT_FOUND",
    });
    await selectAdminBusinessOwner("admin-a", owner.id);
    await prisma.user.update({ where: { id: owner.id }, data: { status: "BLOCKED" } });
    await expect(getSelectedAdminBusinessOwner("admin-a")).resolves.toBeNull();
  });
});
