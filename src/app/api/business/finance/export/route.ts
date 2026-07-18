import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { csvCell, parseFinanceDateRange } from "@/lib/csv";
import { requireMerchant } from "@/modules/auth/server";
import { apiRoute } from "@/shared/server/api";

const HEADER = ["order_id", "date", "venue", "package", "quantity", "venue_till_kzt"];

export async function GET(request: Request) {
  return apiRoute(request, async () => {
    const user = await requireMerchant();
    const range = parseFinanceDateRange(request.url);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(`\uFEFF${HEADER.map(csvCell).join(",")}\n`));
          let cursor: string | undefined;
          while (true) {
            const orders = await prisma.order.findMany({
              where: {
                bag: { venue: { ownerId: user.id } },
                status: "COMPLETED",
                completedAt: { gte: range.from, lt: range.toExclusive },
              },
              include: { bag: { include: { venue: true } } },
              orderBy: [{ completedAt: "desc" }, { id: "desc" }],
              take: 500,
              ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            });
            if (!orders.length) break;
            const rows = orders.map((order) => [order.id, order.completedAt, order.bag.venue.name, order.bag.title, order.quantity, order.totalPrice]);
            controller.enqueue(encoder.encode(`${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`));
            if (orders.length < 500) break;
            cursor = orders.at(-1)?.id;
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });
    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="foodgood-finance-${range.label}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}
