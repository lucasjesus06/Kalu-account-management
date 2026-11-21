export type FieldValue = string | number | boolean | Date | null;

export type Changes<T> = { created: T[]; updated: T[]; unchanged: number };

function sameValue(a: FieldValue, b: FieldValue) {
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  return a === b;
}

export function hasChanged<T extends Record<string, FieldValue>>(incoming: T, stored: NoInfer<T>) {
  return (Object.keys(incoming) as (keyof T)[]).some((field) => !sameValue(incoming[field], stored[field]));
}

export function detectChanges<T extends Record<string, FieldValue>>(
  incoming: T[],
  stored: Map<string, NoInfer<T>>,
  keyOf: (record: T) => string,
): Changes<T> {
  const changes: Changes<T> = { created: [], updated: [], unchanged: 0 };
  for (const record of incoming) {
    const current = stored.get(keyOf(record));
    if (!current) {
      changes.created.push(record);
    } else if (hasChanged(record, current)) {
      changes.updated.push(record);
    } else {
      changes.unchanged += 1;
    }
  }
  return changes;
}
