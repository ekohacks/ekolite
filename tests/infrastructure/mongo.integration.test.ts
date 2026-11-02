import { afterAll, describe } from 'vitest';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';
import { mongoContract } from './mongoContract.ts';

// Narrow integration test: the wrapper against a real replica set (change streams
// demand one). The behaviour is the contract list the unit file runs on the null.
describe('MongoWrapper (real)', () => {
  const mongo = MongoWrapper.create('mongodb://localhost:27017/ekolite-test?replicaSet=rs0');

  // Close the driver client once, cleanly. close() drains any open change stream
  // first, so this no longer races a live stream into "Topology is closed".
  afterAll(async () => {
    await mongo.close();
  });

  mongoContract(() => mongo);
});
