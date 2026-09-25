// Decides whether a document belongs in a publication on the live path. The
// initial find asks Mongo. Live changes arrive on one change stream shared by
// every subscriber to the collection, so each subscription filters here
// against the full document instead. Supports plain equality on top level
// fields, which is what publications use today.
export function matchesQuery(doc: Record<string, unknown>, query: object): boolean {
  return Object.entries(query).every(([key, value]) => doc[key] === value);
}
