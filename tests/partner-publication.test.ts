import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { queryCatalog } from "@/modules/catalog/db";
import { parseCatalogQuery } from "@/modules/catalog/query";
import { createFixtures, resetDb } from "./helpers";

beforeEach(() => resetDb());

describe("публичная публикация пакетов", () => {
  const query = parseCatalogQuery(new URLSearchParams());

  it("показывает пакет без профиля, договора и проверки партнёра", async () => {
    const { bag } = await createFixtures();
    await expect(prisma.partnerBusiness.count()).resolves.toBe(0);
    await expect(queryCatalog({ query, cityId: "almaty", limit: 10 })).resolves.toMatchObject({ bags: [{ id: bag.id }] });
  });

  it("скрывает пакет без любого из обязательных attestations", async () => {
    const { bag } = await createFixtures();
    await prisma.bag.update({ where: { id: bag.id }, data: { storageCompliantAttested: false } });

    await expect(queryCatalog({ query, cityId: "almaty", limit: 10 })).resolves.toMatchObject({ bags: [] });
  });
});
