export function startLeaseHeartbeat(renew: () => Promise<boolean>, intervalMs: number) {
  let stopped = false;
  let lost = false;
  let pending: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (stopped || pending) return;
    pending = renew()
      .then((ok) => { if (!ok) lost = true; })
      .catch(() => { lost = true; })
      .finally(() => { pending = null; });
  }, intervalMs);
  timer.unref?.();
  return {
    lost: () => lost,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await pending;
    },
  };
}
