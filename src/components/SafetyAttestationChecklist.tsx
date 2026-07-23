export type SafetyChecklistState = {
  suitableForSaleAttested: boolean;
  storageCompliantAttested: boolean;
  allergensCurrentAttested: boolean;
  categoryAllowedAttested: boolean;
};

export const EMPTY_SAFETY_CHECKLIST: SafetyChecklistState = {
  suitableForSaleAttested: false,
  storageCompliantAttested: false,
  allergensCurrentAttested: false,
  categoryAllowedAttested: false,
};

export function allSafetyConfirmed(value: SafetyChecklistState): boolean {
  return Object.values(value).every(Boolean);
}

const labels: Array<[keyof SafetyChecklistState, string]> = [
  ["suitableForSaleAttested", "Еда пригодна к реализации в указанное окно выдачи"],
  ["storageCompliantAttested", "Условия и сроки хранения соблюдены"],
  ["allergensCurrentAttested", "Информация о возможных аллергенах актуальна"],
  ["categoryAllowedAttested", "Содержимое соответствует выбранной категории заведения"],
];

export default function SafetyAttestationChecklist({ value, onChange, compact = false }: { value: SafetyChecklistState; onChange: (value: SafetyChecklistState) => void; compact?: boolean }) {
  return <fieldset className={`rounded-xl border border-amber-200 bg-amber-50 ${compact ? "p-2.5" : "p-3"}`}><legend className="px-1 text-xs font-bold text-amber-950">Обязательные подтверждения безопасности</legend><div className={compact ? "space-y-1.5" : "mt-1 space-y-2"}>{labels.map(([key, label]) => <label key={key} className="flex items-start gap-2 text-xs leading-5 text-amber-950"><input type="checkbox" checked={value[key]} onChange={(event) => onChange({ ...value, [key]: event.target.checked })} className="mt-1" /><span>{label}</span></label>)}</div></fieldset>;
}
