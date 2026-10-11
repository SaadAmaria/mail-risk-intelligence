import { describe, expect, it } from "vitest";
import { QueueFullError, WorkQueue } from "../analysis/queue";

/** A worker whose jobs finish only when the test releases them. */
function controlled() {
  const releases = new Map<string, () => void>();
  const started: string[] = [];
  let running = 0;
  let maxRunning = 0;
  const worker = (id: string) =>
    new Promise<void>((resolve) => {
      started.push(id);
      running++;
      maxRunning = Math.max(maxRunning, running);
      releases.set(id, () => {
        running--;
        resolve();
      });
    });
  return { worker, releases, started, max: () => maxRunning };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("WorkQueue", () => {
  it("never runs more than `concurrency` jobs at once and preserves FIFO order", async () => {
    const c = controlled();
    const q = new WorkQueue(c.worker, { concurrency: 2, capacity: 10 });
    ["a", "b", "c", "d"].forEach((id) => q.enqueue(id));
    await tick();
    expect(c.started).toEqual(["a", "b"]);
    expect(q.active).toBe(2);
    expect(q.pending).toBe(2);

    c.releases.get("a")!();
    await tick();
    expect(c.started).toEqual(["a", "b", "c"]);
    c.releases.get("b")!();
    c.releases.get("c")!();
    await tick();
    c.releases.get("d")!();
    await q.idle();
    expect(c.max()).toBe(2);
    expect(c.started).toEqual(["a", "b", "c", "d"]);
  });

  it("de-duplicates ids that are waiting or running", async () => {
    const c = controlled();
    const q = new WorkQueue(c.worker, { concurrency: 1, capacity: 10 });
    expect(q.enqueue("a")).toBe("queued");
    expect(q.enqueue("a")).toBe("duplicate"); // running
    expect(q.enqueue("b")).toBe("queued");
    expect(q.enqueue("b")).toBe("duplicate"); // waiting
    c.releases.get("a")!();
    await tick();
    c.releases.get("b")!();
    await q.idle();
    expect(c.started).toEqual(["a", "b"]);
    expect(q.enqueue("a")).toBe("queued"); // can be queued again after finishing
    await tick();
    c.releases.get("a")!();
    await q.idle();
  });

  it("is bounded: rejects work beyond capacity", async () => {
    const c = controlled();
    const q = new WorkQueue(c.worker, { concurrency: 1, capacity: 2 });
    q.enqueue("run"); // starts immediately, not counted as waiting
    q.enqueue("w1");
    q.enqueue("w2");
    expect(() => q.enqueue("w3")).toThrow(QueueFullError);
    for (const id of ["run", "w1", "w2"]) {
      await tick();
      c.releases.get(id)!();
    }
    await q.idle();
  });

  it("keeps going when a job throws, and reports the error", async () => {
    const errors: string[] = [];
    const done: string[] = [];
    const q = new WorkQueue(
      async (id) => {
        if (id === "bad") throw new Error("boom");
        done.push(id);
      },
      { concurrency: 1, capacity: 10, onError: (id) => errors.push(id) },
    );
    ["a", "bad", "b"].forEach((id) => q.enqueue(id));
    await q.idle();
    expect(done).toEqual(["a", "b"]);
    expect(errors).toEqual(["bad"]);
  });

  it("stop() drops waiting work, lets running jobs finish, and refuses new work", async () => {
    const c = controlled();
    const q = new WorkQueue(c.worker, { concurrency: 1, capacity: 10 });
    q.enqueue("a");
    q.enqueue("b");
    await tick();
    const stopped = q.stop(1000);
    c.releases.get("a")!();
    await stopped;
    expect(c.started).toEqual(["a"]); // b never started
    expect(() => q.enqueue("c")).toThrow(/stopped/);
  });

  it("idle() resolves immediately when empty", async () => {
    await new WorkQueue(async () => undefined, { concurrency: 1, capacity: 1 }).idle();
  });
});
