import { db, initDatabase } from "./db.mjs";
import { bootstrapAdminFromEnv } from "./bootstrap-admin.mjs";

initDatabase();

if (!bootstrapAdminFromEnv(db)) {
  console.error("Defina ADMIN_EMAIL e ADMIN_PASSWORD para criar/atualizar o admin.");
  process.exit(1);
}
