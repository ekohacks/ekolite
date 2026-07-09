// The line start.ts prints on stdout once it is listening. The smoke test spawns the
// real entry point and waits for this exact prefix before it fetches or shuts down, so
// the string lives in one place and both the server and the test import it rather than
// duplicating a literal that could drift.
export const READY_MESSAGE = 'ekolite: ready on';
