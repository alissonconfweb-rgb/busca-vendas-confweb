import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const tempDir = mkdtempSync(join(tmpdir(), "busca-vendas-parser-"));
process.env.DB_PATH = join(tempDir, "parser.sqlite");

const { db } = await import("../server/db.mjs");
const { mercadoLivreHtmlParser: parser } = await import("../server/zyte.mjs");

after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("usa somente a URL canonica para links de catalogo que geravam 404 cobrado", () => {
  assert.deepEqual(
    parser.productDetailUrls({
      id: "MLB123456789",
      href: "https://www.mercadolivre.com.br/produto-exemplo/p/MLB123456789",
    }),
    ["https://produto.mercadolivre.com.br/MLB-123456789-_JM"],
  );
});

test("prioriza a URL canonica quando o link de busca informa o wid do anuncio", () => {
  assert.deepEqual(
    parser.productDetailUrls({
      href: "https://www.mercadolivre.com.br/produto/p/MLB111?wid=MLB987654321&source=search",
    }),
    ["https://produto.mercadolivre.com.br/MLB-987654321-_JM"],
  );
});

test("preserva uma URL direta de anuncio sem criar chamadas duplicadas", () => {
  assert.deepEqual(
    parser.productDetailUrls({
      href: "https://produto.mercadolivre.com.br/MLB-987654321-_JM?tracking_id=abc",
    }),
    ["https://produto.mercadolivre.com.br/MLB-987654321-_JM"],
  );
});
