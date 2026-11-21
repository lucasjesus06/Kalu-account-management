import type { FormState } from "./actions";

export function FormFeedback({ state }: { state: FormState }) {
  if (!state) {
    return null;
  }

  if (!state.ok) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.error}
      </p>
    );
  }

  return (
    <p role="status" className="text-sm">
      {state.message}
    </p>
  );
}
