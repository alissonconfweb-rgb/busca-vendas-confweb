import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const tempDir = mkdtempSync(join(tmpdir(), "busca-vendas-champion-"));
process.env.DB_PATH = join(tempDir, "champion.sqlite");

const { db, initDatabase, setSetting } = await import("../server/db.mjs");
const { isChampionItem, minimumChampionSales } = await import("../server/champion-policy.mjs");

initDatabase();

after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("exige o mínimo configurado para todos os anúncios campeões", () => {
  setSetting("min_champion_sales", "1000");

  assert.equal(minimumChampionSales(), 1000);
  assert.equal(isChampionItem({ price: 49.9, soldQuantity: 999, revenue: 49_850.1 }), false);
  assert.equal(isChampionItem({ price: 49.9, soldQuantity: 1000, revenue: 49_900 }), true);
});
