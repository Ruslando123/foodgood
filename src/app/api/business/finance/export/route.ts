import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { requireMerchant } from "@/modules/auth/server";
import { apiRoute } from "@/shared/server/api";
function cell(value: string | number | Date | null) { const text = value instanceof Date ? value.toISOString() : String(value ?? ""); return `"${text.replaceAll('"', '""')}"`; }
export async function GET() { return apiRoute(async () => { const user = await requireMerchant(); const orders = await prisma.order.findMany({ where: { bag: { venue: { ownerId: user.id } }, status: "COMPLETED" }, include: { bag: { include: { venue: true } } }, orderBy: { completedAt: "desc" } }); const rows = [["order_id", "date", "venue", "package", "quantity", "gross_kzt", "fee_kzt", "net_kzt"], ...orders.map((order) => [order.id, order.completedAt, order.bag.venue.name, order.bag.title, order.quantity, order.totalPrice, order.platformFee, order.totalPrice - order.platformFee])]; const csv = `\uFEFF${rows.map((row) => row.map(cell).join(",")).join("\n")}`; return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="foodgood-finance.csv"' } }); }); }
