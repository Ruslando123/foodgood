"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { IconBell } from "@tabler/icons-react";
import { api } from "@/lib/client/api";

export default function NotificationBell() {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    api<{ unreadCount: number }>("/api/notifications").then((result) => setUnread(result.unreadCount)).catch(() => setUnread(0));
  }, []);
  return <Link href="/notifications" className="relative flex h-10 w-10 items-center justify-center rounded-full" aria-label={unread ? `Уведомления: ${unread} непрочитанных` : "Уведомления"}>
    <IconBell size={25} stroke={1.8} />
    {unread > 0 && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-red-500" />}
  </Link>;
}
