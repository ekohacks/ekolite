import { describe, it, expect } from 'vitest';
import { Methods } from '../../server/logic/methods.ts';
import { ScriptRunnerWrapper } from '../../server/infrastructure/scriptRunner.ts';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';
import { FileStorageWrapper } from '../../server/infrastructure/fileStorage.ts';
import { Files } from '../../server/logic/files.ts';
import { defineRunCountC } from '../../server/logic/analysis.ts';

// runCountC joins the pieces: resolve an uploaded file by id, run the count script
// against that file, parse the number the script printed, and write it back onto the
// file's document so it streams to subscribers. Sociable tests: real Files and real
// analysis logic over nulled infrastructure, no shelling out and no database.
const storedFile = {
  _id: 'f1',
  name: 'reads.bam',
  path: '/data/reads.bam',
  size: 9,
  extension: 'bam',
  uploadedAt: new Date(),
};

describe('runCountC', () => {
  it('runs the script against the located file and records the parsed count', async () => {
    const mongo = MongoWrapper.createNull({ find: [[storedFile]] });
    const files = new Files(mongo, FileStorageWrapper.createNull());
    const runner = ScriptRunnerWrapper.createNull({ python3: '42\n' });
    const runs = runner.trackChanges();
    const writes = await mongo.trackChanges('files');
    const methods = new Methods();

    defineRunCountC(methods, runner, files, 'scripts/countC.py');
    const result = await methods.call('runCountC', ['f1']);

    // Ran python3 against the script and the located file's path.
    expect(runs.data).toHaveLength(1);
    const { command, args } = runs.data[0] as { command: string; args: string[] };
    expect(command).toBe('python3');
    expect(args[0]).toMatch(/scripts\/countC\.py$/);
    expect(args[1]).toBe('/data/reads.bam');

    // Parsed the stdout to a number and wrote only that onto the file document.
    const write = writes.data.find((event) => (event as { type?: unknown }).type === 'update');
    expect(write).toMatchObject({ type: 'update', collection: 'files', id: 'f1' });
    expect((write as { fields: unknown }).fields).toEqual({ countC: 42 });

    // Handed the count back to the caller as a number, not the raw stdout string.
    expect(result).toBe(42);
  });

  it('takes its script path from config rather than a baked-in string', async () => {
    const mongo = MongoWrapper.createNull({ find: [[storedFile]] });
    const files = new Files(mongo, FileStorageWrapper.createNull());
    const runner = ScriptRunnerWrapper.createNull({ python3: '0\n' });
    const runs = runner.trackChanges();
    const methods = new Methods();

    defineRunCountC(methods, runner, files, 'scripts/someOtherAnalysis.py');
    await methods.call('runCountC', ['f1']);

    const { args } = runs.data[0] as { args: string[] };
    expect(args[0]).toMatch(/scripts\/someOtherAnalysis\.py$/);
  });

  it('records a count of zero rather than dropping it', async () => {
    const mongo = MongoWrapper.createNull({ find: [[storedFile]] });
    const files = new Files(mongo, FileStorageWrapper.createNull());
    const runner = ScriptRunnerWrapper.createNull({ python3: '0\n' });
    const writes = await mongo.trackChanges('files');
    const methods = new Methods();

    defineRunCountC(methods, runner, files, 'scripts/countC.py');
    const result = await methods.call('runCountC', ['f1']);

    const write = writes.data.find((event) => (event as { type?: unknown }).type === 'update');
    expect((write as { fields: unknown }).fields).toEqual({ countC: 0 });
    expect(result).toBe(0);
  });

  it('rejects an unknown file id without running the script or writing a count', async () => {
    const mongo = MongoWrapper.createNull();
    const files = new Files(mongo, FileStorageWrapper.createNull());
    const runner = ScriptRunnerWrapper.createNull({ python3: '42\n' });
    const runs = runner.trackChanges();
    const writes = await mongo.trackChanges('files');
    const methods = new Methods();

    defineRunCountC(methods, runner, files, 'scripts/countC.py');

    // A not-found file is a 404, the same shape methodNotFound uses, not whatever
    // error happens to escape. Pinning the code keeps this from passing on an
    // unrelated throw.
    await expect(methods.call('runCountC', ['missing'])).rejects.toMatchObject({ code: 404 });
    expect(runs.data).toHaveLength(0);
    expect(writes.data.some((event) => (event as { type?: unknown }).type === 'update')).toBe(
      false,
    );
  });

  it('surfaces a failed write to the caller', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[storedFile]],
      update: [new Error('write conflict')],
    });
    const files = new Files(mongo, FileStorageWrapper.createNull());
    const runner = ScriptRunnerWrapper.createNull({ python3: '42\n' });
    const methods = new Methods();

    defineRunCountC(methods, runner, files, 'scripts/countC.py');

    await expect(methods.call('runCountC', ['f1'])).rejects.toThrow('write conflict');
  });
});
