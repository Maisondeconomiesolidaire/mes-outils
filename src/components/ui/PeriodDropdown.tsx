import { useId } from "react";
import { Select } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";

type Props = {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onValueChange: (value: string) => void;
};

export function PeriodDropdown({ label, value, options, onValueChange }: Props) {
  const id = useId();
  return (
    <div className="min-w-40 flex-1 sm:flex-none">
      <label id={`${id}-label`} htmlFor={id} className="mb-2 block text-sm font-medium">{label}</label>
      <Select.Root value={value} onValueChange={onValueChange}>
        <Select.Trigger id={id} aria-labelledby={`${id}-label`} className="flex h-11 w-full min-w-44 items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
          <Select.Value />
          <Select.Icon><ChevronDown className="h-4 w-4" /></Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content position="popper" sideOffset={6} collisionPadding={12} className="z-[80] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)] p-1 text-[var(--foreground)] shadow-lg">
            <Select.Viewport className="max-h-72 overflow-y-auto">
              {options.map(option => (
                <Select.Item key={option.value} value={option.value} className="relative cursor-pointer rounded-lg py-2.5 pl-3 pr-9 text-sm outline-none data-[highlighted]:bg-[var(--accent)]">
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator className="absolute right-3 top-3"><Check className="h-4 w-4" /></Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
