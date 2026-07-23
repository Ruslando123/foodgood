import BottomNav from "@/components/BottomNav";

function Skeleton({ className }: { className: string }) {
  return <div aria-hidden="true" className={`animate-pulse bg-black/[0.06] ${className}`} />;
}

function CustomerFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mx-auto min-h-dvh w-screen max-w-md overflow-x-hidden bg-white pb-20"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Загружаем страницу…</span>
      {children}
      <BottomNav />
    </div>
  );
}

export function CustomerCatalogLoading() {
  return (
    <CustomerFrame>
      <header className="space-y-3 px-4 pb-3 pt-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1.5">
            <Skeleton className="h-7 w-32 rounded-lg" />
            <Skeleton className="h-3 w-24 rounded-full" />
          </div>
          <Skeleton className="h-10 w-10 rounded-full" />
        </div>
        <Skeleton className="h-11 w-full rounded-[13px]" />
        <div className="flex gap-1.5">
          {["w-[72px]", "w-[76px]", "w-[82px]", "w-[94px]"].map((widthClass) => (
            <Skeleton key={widthClass} className={`h-9 shrink-0 rounded-xl ${widthClass}`} />
          ))}
        </div>
        <Skeleton className="h-10 w-full rounded-[12px]" />
      </header>
      <main className="space-y-2.5 px-4">
        {[1, 2, 3].map((item) => (
          <Skeleton key={item} className="h-[154px] rounded-[17px]" />
        ))}
      </main>
    </CustomerFrame>
  );
}

export function CustomerListLoading() {
  return (
    <CustomerFrame>
      <header className="flex items-start justify-between px-4 pb-4 pt-5">
        <div className="space-y-2">
          <Skeleton className="h-7 w-36 rounded-lg" />
          <Skeleton className="h-3 w-48 rounded-full" />
        </div>
        <Skeleton className="h-10 w-10 rounded-full" />
      </header>
      <main className="space-y-3 px-4">
        <Skeleton className="h-11 w-full rounded-[12px]" />
        {[1, 2, 3].map((item) => (
          <Skeleton key={item} className="h-48 rounded-[17px]" />
        ))}
      </main>
    </CustomerFrame>
  );
}

export function CustomerDetailLoading() {
  return (
    <CustomerFrame>
      <Skeleton className="h-[245px] w-full rounded-b-[24px]" />
      <main className="space-y-5 px-4 py-5">
        <section className="space-y-3">
          <Skeleton className="h-7 w-4/5 rounded-lg" />
          <Skeleton className="h-4 w-1/2 rounded-full" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24 rounded-full" />
            <Skeleton className="h-8 w-28 rounded-full" />
          </div>
        </section>
        <Skeleton className="h-32 w-full rounded-[17px]" />
        <Skeleton className="h-44 w-full rounded-[17px]" />
      </main>
    </CustomerFrame>
  );
}

export function WorkspaceLoading({ width = "max-w-6xl" }: { width?: "max-w-5xl" | "max-w-6xl" }) {
  return (
    <main
      className={`mx-auto ${width} space-y-5 p-4 sm:p-6`}
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Загружаем раздел…</span>
      <header className="space-y-2">
        <Skeleton className="h-8 w-48 rounded-lg" />
        <Skeleton className="h-4 w-72 max-w-full rounded-full" />
      </header>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <Skeleton key={item} className="h-24 rounded-2xl" />
        ))}
      </section>
      <Skeleton className="h-11 w-full rounded-xl" />
      <section className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white">
        {[1, 2, 3, 4].map((item) => (
          <div key={item} className="space-y-2 border-b border-black/[0.06] p-4 last:border-b-0">
            <Skeleton className="h-4 w-2/3 rounded-full" />
            <Skeleton className="h-3 w-2/5 rounded-full" />
          </div>
        ))}
      </section>
    </main>
  );
}
