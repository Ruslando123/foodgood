"use client";

import { useEffect } from "react";
import { setBusinessOwnerContext } from "@/lib/client/api";

export default function BusinessOwnerContext({ ownerId }: { ownerId: string }) {
  useEffect(() => {
    setBusinessOwnerContext(ownerId);
  }, [ownerId]);

  return null;
}
