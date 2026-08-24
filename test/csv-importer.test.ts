/**
 * The importer exhibit's user-visible behavior: chunked upload, a
 * self-chaining work loop that finishes a batch bigger than one chunk,
 * per-row errors counted instead of failing the run, and the
 * receiving→running door closing typed once Start is called.
 */
import { afterAll, expect, test } from "bun:test";
import { CsvImporter } from "../examples/csv-importer.ts";
import { engine, release, retain } from "./test-harness.ts";

retain();
afterAll(() => release());

const TIMEOUT = 120_000;
const fresh = (label: string) => `${label}-${crypto.randomUUID()}`;

test(
  "imports a multi-chunk batch and counts bad rows without dying",
  async () => {
    const importer = engine.client(CsvImporter).getOrCreate(fresh("import-basic"));

    // 60 rows (> 2 chunks of 25), three of them malformed.
    const good = Array.from({ length: 57 }, (_, i) => `sku-${i},${i + 1}`);
    const bad = ["sku-x,not-a-number", ",5", "sku-y,-2"];
    await importer.Append({ lines: good.slice(0, 30) });
    const { total } = await importer.Append({ lines: [...good.slice(30), ...bad] });
    expect(total).toBe(60);

    await importer.Start();

    // The loop runs as scheduled self-messages — poll for completion.
    let status = await importer.GetStatus();
    for (let i = 0; i < 40 && status.status !== "done"; i++) {
      await new Promise((r) => setTimeout(r, 500));
      status = await importer.GetStatus();
    }
    expect(status.status).toBe("done");
    expect(status.processed).toBe(60);
    expect(status.imported).toBe(57);
    expect(status.errors.map((e) => e.reason)).toEqual([
      'bad qty "not-a-number"',
      "missing sku",
      'bad qty "-2"',
    ]);
  },
  TIMEOUT,
);

test(
  "the door closes typed: no appends after Start, no Start on empty",
  async () => {
    const empty = engine.client(CsvImporter).getOrCreate(fresh("import-empty"));
    try {
      await empty.Start();
      throw new Error("should have thrown");
    } catch (e) {
      if (!CsvImporter.is.NothingToImport(e)) throw e;
    }

    const importer = engine.client(CsvImporter).getOrCreate(fresh("import-closed"));
    await importer.Append({ lines: ["sku-1,1"] });
    await importer.Start();
    try {
      await importer.Append({ lines: ["sku-2,2"] });
      throw new Error("should have thrown");
    } catch (e) {
      if (!CsvImporter.is.AlreadyStarted(e)) throw e;
    }
  },
  TIMEOUT,
);
