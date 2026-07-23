import Link from "next/link";
import BottomNav from "@/components/BottomNav";

export default function LegalDocument({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="mx-auto min-h-dvh w-screen max-w-md overflow-x-hidden bg-white pb-24">
    <header className="sticky top-0 z-10 w-screen max-w-md border-b border-black/[0.06] bg-white/95 px-4 pb-3 pt-5 backdrop-blur-xl"><Link href="/about" className="text-sm font-semibold text-primary">← Документы</Link><h1 className="mt-2 break-words text-2xl font-bold leading-8 tracking-tight">{title}</h1><p className="mt-1 text-xs text-muted">Редакция от 12 июля 2026 года</p></header>
    <main className="legal-content w-screen max-w-md space-y-5 break-words px-4 py-5 text-sm leading-6 text-[#39443e]">{children}<section className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><b>До публичного запуска:</b> необходимо указать зарегистрированное наименование, БИН, юридический адрес и действующий адрес поддержки оператора, а также провести проверку документов юристом Республики Казахстан.</section></main>
    <BottomNav />
  </div>;
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h2 className="mb-1.5 text-base font-bold text-foreground">{title}</h2><div className="space-y-2">{children}</div></section>;
}
