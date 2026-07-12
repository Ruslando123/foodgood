"use client";

import { IconArrowLeft } from "@tabler/icons-react";
import { useRouter } from "next/navigation";

export default function NotificationsBackButton() {
  const router = useRouter();

  function goBack() {
    if (window.history.length > 1) {
      router.back();
      return;
    }

    router.push("/orders");
  }

  return <button type="button" onClick={goBack} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/[0.07] bg-white text-foreground shadow-[0_2px_10px_rgba(20,40,28,0.06)] transition active:scale-95" aria-label="Назад">
    <IconArrowLeft size={21} stroke={2} />
  </button>;
}
