import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
  AuthorizedCommandKeyStore,
  fingerprintCommandPublicKey,
} from "../src/main/authorized-command-key-store.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AuthorizedCommandKeyStore writes ~/.closedloop authorized_keys.json schema", () => {
  const cwd = makeTempDir();
  const publicKeyBase64 = createRawPublicKeyBase64();
  const fingerprint = fingerprintCommandPublicKey(
    Buffer.from(publicKeyBase64, "base64"),
  );
  const store = new AuthorizedCommandKeyStore({ cwd });

  const authorized = store.authorize({
    publicKeyBase64,
    fingerprint,
    ownerName: "Ada Lovelace",
  });

  assert.equal(authorized.fingerprint, fingerprint);
  assert.deepEqual(store.list().map((key) => key.fingerprint), [fingerprint]);
  const persisted = JSON.parse(
    readFileSync(path.join(cwd, "authorized_keys.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(persisted.version, 1);
  assert.equal(Array.isArray(persisted.keys), true);
});

test("AuthorizedCommandKeyStore rejects malformed, duplicate, and mismatched keys", () => {
  const store = new AuthorizedCommandKeyStore({ cwd: makeTempDir() });
  const publicKeyBase64 = createRawPublicKeyBase64();

  assert.throws(
    () => store.authorize({ publicKeyBase64: "not base64", ownerName: "Bad" }),
    /invalid base64 public key/,
  );
  assert.throws(
    () =>
      store.authorize({
        publicKeyBase64,
        fingerprint: "cl:wrongfingerprint",
      }),
    /fingerprint mismatch/,
  );

  store.authorize({ publicKeyBase64, ownerName: "Ada" });
  assert.throws(
    () => store.authorize({ publicKeyBase64, ownerName: "Ada" }),
    /duplicate key/,
  );
});

test("AuthorizedCommandKeyStore tolerates missing malformed and future files", () => {
  const cwd = makeTempDir();
  const store = new AuthorizedCommandKeyStore({ cwd });
  assert.deepEqual(store.list(), []);

  writeFileSync(path.join(cwd, "authorized_keys.json"), "{not-json");
  assert.deepEqual(store.list(), []);

  writeFileSync(
    path.join(cwd, "authorized_keys.json"),
    JSON.stringify({ version: 999, keys: [] }),
  );
  assert.deepEqual(store.list(), []);
});

test("AuthorizedCommandKeyStore removes authorized keys and records rejected org keys", () => {
  const store = new AuthorizedCommandKeyStore({ cwd: makeTempDir() });
  const publicKeyBase64 = createRawPublicKeyBase64();
  const fingerprint = store.authorize({ publicKeyBase64 }).fingerprint;

  store.reject("cl:abcdefghijklmnopqrstuv");
  assert.deepEqual(store.listRejectedFingerprints(), [
    "cl:abcdefghijklmnopqrstuv",
  ]);

  store.remove(fingerprint);
  assert.deepEqual(store.list(), []);
});

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "authorized-keys-"));
  tempDirs.push(dir);
  return dir;
}

function createRawPublicKeyBase64(): string {
  const { publicKey } = crypto.generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  return spki.subarray(spki.length - 32).toString("base64");
}
