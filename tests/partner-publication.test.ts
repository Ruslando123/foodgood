import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { queryCatalog } from "@/modules/catalog/db";
import { parseCatalogQuery } from "@/modules/catalog/query";
import { createFixtures, resetDb } from "./helpers";

beforeEach(() => resetDb());

describe("публичная граница закрытого пилота", () => {
  const query = parseCatalogQuery(new URLSearchParams());

  it("скрывает пакет при потере верификации партнёра", async () => {
    const { partner, bag } = await createFixtures();
    await expect(queryCatalog({ query, cityId: "almaty", limit: 10 })).resolves.toMatchObject({ bags: [{ id: bag.id }] });

    await prisma.partnerBusiness.update({ where: { id: partner.id }, data: { verificationStatus: "SUSPENDED" } });
    await expect(queryCatalog({ query, cityId: "almaty", limit: 10 })).resolves.toMatchObject({ bags: [] });
  });

  it("скрывает пакет без любого из обязательных attestations", async () => {
    const { bag } = await createFixtures();
    await prisma.bag.update({ where: { id: bag.id }, data: { storageCompliantAttested: false } });

    await expect(queryCatalog({ query, cityId: "almaty", limit: 10 })).resolves.toMatchObject({ bags: [] });
  });
});
