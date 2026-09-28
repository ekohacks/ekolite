// Decides whether a document belongs in a publication on the live path. The
// initial find asks Mongo. Live changes arrive on one change stream shared by
// every subscriber to the collection, so each subscription filters here
// against the document the change carries.
//
// It follows the part of Mongo's query language publications are written in:
// equality, dotted paths, values held in arrays, the comparison operators and
// the three logical ones. It is not Mongo, and does not pretend to be: a query
// that uses anything else is named by unsupportedOperators, and Publications
// refuses the subscription rather than guess.
//
// A change does not always carry the whole document, so the answer has three
// values. `unknown` means the change says nothing about a field the query
// reads.

export type Verdict = 'match' | 'no-match' | 'unknown';

interface MatchOptions {
  // The document is only what an update wrote, keyed as the update keyed it.
  partial?: boolean;
}

const COMPARISONS = new Set(['$eq', '$ne', '$in', '$nin', '$gt', '$gte', '$lt', '$lte', '$exists']);
const LOGICAL = new Set(['$and', '$or', '$nor']);

export const SUPPORTED_OPERATORS = [...COMPARISONS, ...LOGICAL];

type Doc = Record<string, unknown>;

// What a path leads to. A path can reach several values, since it fans out over
// arrays, none when the field is missing, or nothing we can say when the change
// does not carry it.
type Reached = { known: true; values: unknown[] } | { known: false };

export function matchesQuery(doc: Doc, query: object): boolean {
  return verdictFor(doc, query) === 'match';
}

export function verdictFor(doc: Doc, query: object, options: MatchOptions = {}): Verdict {
  return all(
    Object.entries(query).map(([key, condition]) => {
      if (key === '$and') {
        return all(subqueries(condition).map((q) => verdictFor(doc, q, options)));
      }
      if (key === '$or') {
        return any(subqueries(condition).map((q) => verdictFor(doc, q, options)));
      }
      if (key === '$nor') {
        return not(any(subqueries(condition).map((q) => verdictFor(doc, q, options))));
      }
      if (key.startsWith('$')) {
        return 'unknown';
      }
      return fieldVerdict(reach(doc, key, options.partial === true), condition);
    }),
  );
}

// The operators in a query that the matcher cannot follow, each named once, in the
// order they are met.
export function unsupportedOperators(query: object): string[] {
  const found: string[] = [];
  const note = (operator: string) => {
    if (!found.includes(operator)) {
      found.push(operator);
    }
  };

  const visitValue = (value: unknown) => {
    if (value instanceof RegExp) {
      note('$regex');
    }
  };

  const visit = (q: object) => {
    for (const [key, condition] of Object.entries(q)) {
      if (LOGICAL.has(key)) {
        subqueries(condition).forEach(visit);
      } else if (key.startsWith('$')) {
        note(key);
      } else if (isOperators(condition)) {
        for (const [operator, operand] of Object.entries(condition)) {
          if (!COMPARISONS.has(operator)) {
            note(operator);
          }
          if (Array.isArray(operand)) {
            operand.forEach(visitValue);
          } else {
            visitValue(operand);
          }
        }
      } else {
        visitValue(condition);
      }
    }
  };

  visit(query);
  return found;
}

// ── Three valued logic ──────────────────────────────────────────────────────

function all(verdicts: Verdict[]): Verdict {
  if (verdicts.includes('no-match')) {
    return 'no-match';
  }
  return verdicts.includes('unknown') ? 'unknown' : 'match';
}

function any(verdicts: Verdict[]): Verdict {
  if (verdicts.includes('match')) {
    return 'match';
  }
  return verdicts.includes('unknown') ? 'unknown' : 'no-match';
}

function not(verdict: Verdict): Verdict {
  if (verdict === 'unknown') {
    return 'unknown';
  }
  return verdict === 'match' ? 'no-match' : 'match';
}

const of = (held: boolean): Verdict => (held ? 'match' : 'no-match');

// ── Reaching a field ────────────────────────────────────────────────────────

function reach(doc: Doc, path: string, partial: boolean): Reached {
  if (!partial) {
    return { known: true, values: follow(doc, path.split('.')) };
  }

  // An update keys what it wrote as it wrote it: 'meta.kind', or 'meta' whole.
  if (Object.hasOwn(doc, path)) {
    return { known: true, values: spread(doc[path]) };
  }

  const segments = path.split('.');
  for (let cut = segments.length - 1; cut > 0; cut -= 1) {
    const prefix = segments.slice(0, cut).join('.');
    if (Object.hasOwn(doc, prefix)) {
      return {
        known: true,
        values: follow({ root: doc[prefix] }, ['root', ...segments.slice(cut)]),
      };
    }
  }

  // Nothing the change carries reaches this field. Either it did not change, or the
  // update wrote beneath it; both leave what it now holds unsaid.
  return { known: false };
}

function follow(value: unknown, segments: string[]): unknown[] {
  if (segments.length === 0) {
    return spread(value);
  }
  const head = segments[0];
  const rest = segments.slice(1);

  if (Array.isArray(value)) {
    const items = value as unknown[];
    const at = /^\d+$/.test(head) ? items[Number(head)] : undefined;
    const viaIndex = at === undefined ? [] : follow(at, rest);
    const viaElements = items.flatMap((element) =>
      isPlainObject(element) ? follow(element, segments) : [],
    );
    return [...viaIndex, ...viaElements];
  }

  if (!isPlainObject(value) || !Object.hasOwn(value, head)) {
    return [];
  }
  return follow(value[head], rest);
}

// A field holding an array offers the array itself and each thing in it.
function spread(value: unknown): unknown[] {
  return Array.isArray(value) ? [value, ...(value as unknown[])] : [value];
}

// ── One field against its condition ─────────────────────────────────────────

function fieldVerdict(reached: Reached, condition: unknown): Verdict {
  if (!reached.known) {
    return 'unknown';
  }

  if (!isOperators(condition)) {
    return of(equalsAny(reached.values, condition));
  }

  return all(
    Object.entries(condition).map(([operator, operand]): Verdict => {
      switch (operator) {
        case '$eq':
          return of(equalsAny(reached.values, operand));
        case '$ne':
          return of(!equalsAny(reached.values, operand));
        case '$in':
          return of(list(operand).some((one) => equalsAny(reached.values, one)));
        case '$nin':
          return of(!list(operand).some((one) => equalsAny(reached.values, one)));
        case '$gt':
          return of(reached.values.some((v) => ordered(v, operand, (c) => c > 0)));
        case '$gte':
          return of(reached.values.some((v) => ordered(v, operand, (c) => c >= 0)));
        case '$lt':
          return of(reached.values.some((v) => ordered(v, operand, (c) => c < 0)));
        case '$lte':
          return of(reached.values.some((v) => ordered(v, operand, (c) => c <= 0)));
        case '$exists':
          return of(reached.values.length > 0 === Boolean(operand));
        default:
          return 'unknown';
      }
    }),
  );
}

function equalsAny(values: unknown[], wanted: unknown): boolean {
  // Mongo reads null as "null or not there at all".
  if (wanted === null || wanted === undefined) {
    return values.length === 0 || values.some((v) => v === null || v === undefined);
  }
  return values.some((v) => same(v, wanted));
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  // A change carries an id as a string; a query may hold the ObjectId it came from.
  if (isObjectId(a) || isObjectId(b)) {
    return idText(a) !== undefined && idText(a) === idText(b);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => same(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const left = Object.entries(a);
    const right = Object.entries(b);
    return (
      left.length === right.length &&
      left.every(([key, value], i) => key === right[i]?.[0] && same(value, right[i]?.[1]))
    );
  }
  return false;
}

// Mongo orders only like with like: a number never sits above a string.
function ordered(a: unknown, b: unknown, holds: (comparison: number) => boolean): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return holds(a - b);
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return holds(a < b ? -1 : a > b ? 1 : 0);
  }
  if (a instanceof Date && b instanceof Date) {
    return holds(a.getTime() - b.getTime());
  }
  return false;
}

// ── Telling shapes apart ────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Doc {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  if (value instanceof Date || value instanceof RegExp || isObjectId(value)) {
    return false;
  }
  return true;
}

function isOperators(value: unknown): value is Doc {
  if (!isPlainObject(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => key.startsWith('$'));
}

function isObjectId(value: unknown): value is { toHexString: () => string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toHexString?: unknown }).toHexString === 'function'
  );
}

function idText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  return isObjectId(value) ? value.toHexString() : undefined;
}

function subqueries(value: unknown): object[] {
  return Array.isArray(value) ? value.filter((q): q is object => isPlainObject(q)) : [];
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}
