export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
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

interface SuppressedErrorLike {
  error: unknown;
  suppressed: unknown;
}

// Follow a SuppressedError chain (non-enumerable `.error` and `.suppressed`) and
// return a flat list of errors oldest-first. If the value is not a
// SuppressedError-like object, return it as a single-element array.
export function flattenSuppressed(err: unknown): unknown[] {
  if (err && typeof err === 'object' && 'suppressed' in err && 'error' in err) {
    const suppressed = (err as SuppressedErrorLike).suppressed;
    const error = (err as SuppressedErrorLike).error;
    return [...flattenSuppressed(suppressed), error];
  }

  return [err];
}
