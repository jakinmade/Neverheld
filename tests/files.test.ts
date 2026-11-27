// R14: openedAfterSeal reflects when the file was opened, not when the fingerprint arrived.
import assert from "node:assert/strict";
import test from "node:test";
import { recordFile, recordFingerprint, recordedFiles, getSealStatus, subscribeToSeal } from "../lib/seal-kit";

test("R14 a fingerprint submitted after sealing for a file opened before sealing is marked opened before seal", async () => {
  // Simulate the seal taking effect at t=1000 (performance.now() time).
  const status = getSealStatus() as { sealedAt?: number; state: string };
  status.sealedAt = 1000; status.state = "sealed";
  recordFingerprint("early.pdf", "a".repeat(64), { openedAt: 400 });   // opened before, reported after
  recordFingerprint("late.pdf", "b".repeat(64), { openedAt: 1500 });
  recordFile(new Blob(["x"]) as Blob & { name?: string }, { openedAt: 900 }); // delayed recordFile
  const files = await recordedFiles();
  assert.deepEqual(files.map((file) => [file.name, file.openedAfterSeal]), [["early.pdf", false], ["late.pdf", true], ["unnamed file", false]]);
  assert.throws(() => recordFingerprint("x", "c".repeat(64), {} as { openedAt: number }), /openedAt/);
  void subscribeToSeal;
});
