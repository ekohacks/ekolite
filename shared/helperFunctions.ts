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
