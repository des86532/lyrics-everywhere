import { describe, expect, it } from "vitest";
import { MixCache } from "../extension-ui/src/mix-cache.js";

function fakeFactory(outcomes: Array<"error" | "success">) {
  const databases: Array<{ closed: boolean; onversionchange: (() => void) | null; objectStoreNames: { contains: () => boolean } }> = [];
  let opens = 0;
  const factory = {
    open: () => {
      const outcome = outcomes[opens++] ?? "success";
      const request: Record<string, unknown> = {};
      const database = { closed: false, onversionchange: null as (() => void) | null, objectStoreNames: { contains: () => true }, close() { this.closed = true; } };
      databases.push(database);
      queueMicrotask(() => {
        if (outcome === "error") {
          request.error = new Error("open failed");
          (request.onerror as () => void)();
        } else {
          request.result = database;
          (request.onsuccess as () => void)();
        }
      });
      return request;
    },
  };
  return { factory: factory as unknown as IDBFactory, databases, opens: () => opens };
}

describe("MixCache connection", () => {
  it("retries opening the database after a failure instead of caching the rejection", async () => {
    const fake = fakeFactory(["error", "success"]);
    const cache = new MixCache(fake.factory);
    await expect(cache.initialize(false)).rejects.toThrow("open failed");
    await expect(cache.initialize(false)).resolves.toBeUndefined();
    expect(fake.opens()).toBe(2);
  });

  it("closes the connection on versionchange and reopens on the next use", async () => {
    const fake = fakeFactory(["success", "success"]);
    const cache = new MixCache(fake.factory);
    await cache.initialize(false);
    fake.databases[0]!.onversionchange?.();
    expect(fake.databases[0]!.closed).toBe(true);
    await cache.initialize(false);
    expect(fake.opens()).toBe(2);
  });
});

function fakeStoreFactory(initial: Record<string, string[]>) {
  const stores = new Map(Object.entries(initial).map(([name, keys]) => [name, new Set(keys)]));
  const transactions: string[][] = [];
  const database = {
    objectStoreNames: { contains: () => true },
    onversionchange: null,
    transaction: (names: string | string[]) => {
      const list = Array.isArray(names) ? names : [names];
      transactions.push(list);
      const transaction: Record<string, unknown> = {
        objectStore: (name: string) => ({ clear: () => { stores.get(name)!.clear(); } }),
      };
      queueMicrotask(() => (transaction.oncomplete as () => void)());
      return transaction;
    },
  };
  const factory = {
    open: () => {
      const request: Record<string, unknown> = {};
      queueMicrotask(() => { request.result = database; (request.onsuccess as () => void)(); });
      return request;
    },
  };
  return { factory: factory as unknown as IDBFactory, stores, transactions };
}

describe("MixCache data hygiene", () => {
  it("clearAll empties complete mixes and drafts in one readwrite transaction", async () => {
    const fake = fakeStoreFactory({ mixes: ["a"], drafts: ["b", "c"] });
    await new MixCache(fake.factory).clearAll();
    expect(fake.stores.get("mixes")!.size).toBe(0);
    expect(fake.stores.get("drafts")!.size).toBe(0);
    expect(fake.transactions).toEqual([["mixes", "drafts"]]);
  });

  it("initialize removes stale drafts but keeps complete mixes", async () => {
    const fake = fakeStoreFactory({ mixes: ["a"], drafts: ["b"] });
    await new MixCache(fake.factory).initialize();
    expect(fake.stores.get("mixes")!.size).toBe(1);
    expect(fake.stores.get("drafts")!.size).toBe(0);
  });

  it("initialize keeps drafts while a capture is active", async () => {
    const fake = fakeStoreFactory({ mixes: [], drafts: ["b"] });
    await new MixCache(fake.factory).initialize(false);
    expect(fake.stores.get("drafts")!.size).toBe(1);
  });
});
