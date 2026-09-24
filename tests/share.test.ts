import assert from "node:assert/strict";
import test from "node:test";
import { createShareToken, verifyShareToken, createShareSession, verifyShareSession, newShareKeyId, isShareKeyActive, type ShareKeyRow } from "../worker/share";

const secret = "test-only-share-secret";
const now = 1_788_585_600_000;
const row: ShareKeyRow = { id: newShareKeyId(), name: "Test", permission: "read", created_at: now, expires_at: null, disabled_at: null, last_used_at: null };

test("independent Keys have stable recoverable links", async () => {
  const other = newShareKeyId();
  assert.notEqual(row.id, other);
  const token = await createShareToken(secret, row.id);
  assert.equal(await createShareToken(secret, row.id), token);
  assert.equal(await verifyShareToken(secret, token), row.id);
  assert.notEqual(await createShareToken(secret, other), token);
});

test("tampering and incorrect secrets cannot authenticate", async () => {
  const token = await createShareToken(secret, row.id);
  for (const invalid of [null, {}, 123, "", "invalid", `${token}.extra`, token.replace('key.', 'share.'), token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')]) {
    assert.equal(await verifyShareToken(secret, invalid), null);
  }
  assert.equal(await verifyShareToken("another-secret", token), null);
});

test("permanent, expiry boundary, disabled, and missing Keys", () => {
  assert.equal(isShareKeyActive(row, now + 1000 * 86400000), true);
  assert.equal(isShareKeyActive({ ...row, expires_at: now + 1 }, now), true);
  assert.equal(isShareKeyActive({ ...row, expires_at: now }, now), false);
  assert.equal(isShareKeyActive({ ...row, disabled_at: now }, now), false);
  assert.equal(isShareKeyActive(null, now), false);
});

test("share sessions retain Key identity and cannot substitute for share links", async () => {
  const session = await createShareSession(secret, row.id, now);
  assert.equal(await verifyShareSession(secret, session, now), row.id);
  assert.equal(await verifyShareSession(secret, session, now + 400 * 86400000), null);
  assert.equal(await verifyShareSession("another-secret", session, now), null);
  assert.equal(await verifyShareSession(secret, session + '.extra', now), null);
  assert.equal(await verifyShareToken(secret, session), null);
  assert.equal(await verifyShareSession(secret, await createShareToken(secret, row.id), now), null);
});
