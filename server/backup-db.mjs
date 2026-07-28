import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { loadLocalEnv } from "./env.mjs";

loadLocalEnv();

const source = resolve(process.env.DB_PATH || "data/busca-vendas.sqlite");
const destination = resolve(process.argv[2] || "");

if (!process.argv[2]) {
  throw new Error("Informe o caminho de destino do backup.");
}

mkdirSync(dirname(destination), { recursive: true });
const database = new Database(source, { readonly: true });

try {
  await database.backup(destination);
  const backup = new Database(destination, { readonly: true, fileMustExist: true });
  try {
    const result = backup.pragma("integrity_check", { simple: true });
    if (result !== "ok") {
      throw new Error(`Falha na verificação do backup: ${result}`);
    }
  } finally {
    backup.close();
  }
  rmSync(`${destination}-wal`, { force: true });
  rmSync(`${destination}-shm`, { force: true });
  process.stdout.write(`Backup SQLite validado: ${destination}\n`);
} finally {
  database.close();
}
