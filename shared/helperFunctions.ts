export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
}

// Run shutdown steps in order, best-effort: every step runs even if an earlier one
// rejects, so a failing socket close can't skip the database close. The first error
// is rethrown once all steps have run, so the caller still knows the shutdown was
// not clean (and can exit non-zero).
export async function closeAll(steps: (() => Promise<void>)[]): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (err) {
      errors.push(err);
    }
  }
  if (errors.length > 0) {
    throw errors[0];
  }
}

export function hasMongoOperator(obj: unknown): boolean {
  if (obj === null || obj === undefined) {
    return false;
  }
  if (Array.isArray(obj)) {
    return obj.some((item) => hasMongoOperator(item));
  }
  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (key.startsWith('$')) {
        return true;
      }
      if (hasMongoOperator(value)) {
        return true;
      }
    }
  }
  return false;
}
