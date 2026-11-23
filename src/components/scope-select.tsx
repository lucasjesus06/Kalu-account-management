"use client";

import { useRef } from "react";

export function ScopeSelect({
  action,
  value,
  options,
}: {
  action: (formData: FormData) => void | Promise<void>;
  value: string;
  options: { value: string; label: string }[];
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={action}>
      <select
        key={value}
        name="scope"
        aria-label="Espaço financeiro"
        defaultValue={value}
        onChange={() => formRef.current?.requestSubmit()}
        className="h-9 max-w-40 rounded-md border border-input bg-input/30 px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </form>
  );
}
