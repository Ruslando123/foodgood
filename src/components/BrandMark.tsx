import { IconSeedlingFilled } from "@tabler/icons-react";

export default function BrandMark() {
  return (
    <div className="inline-flex items-center gap-1 text-[21px] font-extrabold tracking-[-0.04em]">
      <span><span className="text-primary">Food</span>Good</span>
      <IconSeedlingFilled size={20} className="-rotate-12 text-primary" aria-hidden="true" />
    </div>
  );
}
