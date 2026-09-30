import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function load(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("lone store pack does not repeat its preview card in the detail section", async () => {
  const source = await load("../src/views/StoreView.jsx");
  assert.match(source, /const solePack = isSoleStorePack\(packs\);/);
  assert.match(source, /\{!solePack && \(<div className="store-detail-head">/);
  assert.match(source, /\{!solePack && selected\.description && <p className="store-detail-description">/);
  assert.match(source, /storeRarityLabel\(selected\.rarity\)\} · \{selectedMetadata\.line\}/);
  assert.doesNotMatch(source, /\{selected\.rarity\}<\/small><small/);
  assert.match(source, /data-pack-id=\{pack\.id\}/);
});

test("store preview copy wraps instead of clipping mid-word", async () => {
  const css = await load("../src/App.css");
  assert.match(css, /\.store-pack-copy b \{[^}]*-webkit-line-clamp: 2;/);
  assert.match(css, /\.store-pack-copy small \{[^}]*-webkit-line-clamp: 2;/);
  assert.match(css, /\.store-pack-art em \{[^}]*-webkit-line-clamp: 2;/);
  assert.doesNotMatch(css, /\.store-pack-copy small \{[^}]*white-space: nowrap;/);
});
