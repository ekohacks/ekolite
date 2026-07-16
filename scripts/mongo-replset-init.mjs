// Bring a just-started mongod to a usable single-node replica set, without mongosh.
//
// On Linux, docker-compose.yml does this with a mongo-init container. Windows and
// macOS CI runners cannot run Linux containers, so they start mongod from the official
// archive instead, and nothing there initiates the replica set. This script is that
// missing step, done with the mongodb driver the repo already depends on rather than
// a mongosh install per platform.
//
// It waits for mongod to accept connections, sends replSetInitiate with the exact
// config docker-compose.yml uses (rs0, one member on localhost:27017), then waits for
// the node to report itself writable primary. Change streams, and therefore the
// integration suite, only work from that moment.
//
// Exits non-zero if the whole dance exceeds BOOT_BUDGET_MS. AGENTS.md records that
// tests against a missing Mongo hang for 15 seconds each and then fail; failing loudly
// here keeps that pathology out of the suite and out of the timing data.
import { MongoClient } from 'mongodb';

const BOOT_BUDGET_MS = 60_000;
const RETRY_DELAY_MS = 500;
const deadline = Date.now() + BOOT_BUDGET_MS;

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

// directConnection: the node is not a replica set member yet, so the driver must not
// go looking for one. A short selection timeout keeps each failed attempt cheap while
// mongod is still booting.
const client = new MongoClient('mongodb://localhost:27017', {
  directConnection: true,
  serverSelectionTimeoutMS: 2_000,
});

for (;;) {
  try {
    await client.connect();
    break;
  } catch (error) {
    if (Date.now() > deadline) {
      throw error;
    }
    await sleep(RETRY_DELAY_MS);
  }
}

const admin = client.db('admin');

try {
  await admin.command({
    replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] },
  });
} catch (error) {
  // Same tolerance as the compose init: a second run against an already-initiated
  // node is a no-op, not a failure.
  if (error.codeName !== 'AlreadyInitialized') {
    await client.close();
    throw error;
  }
}

for (;;) {
  const hello = await admin.command({ hello: 1 });
  if (hello.isWritablePrimary) {
    break;
  }
  if (Date.now() > deadline) {
    await client.close();
    throw new Error(`mongod did not become primary within ${String(BOOT_BUDGET_MS)} ms`);
  }
  await sleep(RETRY_DELAY_MS);
}

await client.close();
process.stdout.write('replica set rs0 ready\n');
