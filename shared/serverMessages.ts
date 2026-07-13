// The line start.ts prints on stdout once it is listening. The smoke test spawns the
// real entry point and waits for this exact prefix before it fetches or shuts down, so
// the string lives in one place and both the server and the test import it rather than
// duplicating a literal that could drift.
export const READY_MESSAGE = 'ekolite: ready on';

// What a supervisor sends over the IPC channel to ask the server to stop.
//
// On Windows no parent process can deliver a signal to a child. child.kill('SIGTERM')
// there calls TerminateProcess, so nothing in the child ever runs. A message over the
// IPC channel is the only door a supervisor has, and it works on POSIX too. PM2 uses
// this exact word for this exact reason, in its shutdown_with_message option.
export const SHUTDOWN_MESSAGE = 'shutdown';
