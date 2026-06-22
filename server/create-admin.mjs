import { db, initDatabase } from "./db.mjs";
import { hashPassword } from "./security.mjs";

initDatabase();

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME || "Alisson Confweb";

if (!email || !password) {
  console.error("Defina ADMIN_EMAIL e ADMIN_PASSWORD para criar/atualizar o admin.");
  process.exit(1);
}

db.prepare(`
  INSERT INTO users (name, email, password_hash, role, status, plan, search_limit)
  VALUES (?, ?, ?, 'admin', 'active', 'scale', NULL)
  ON CONFLICT(email) DO UPDATE SET
    name = excluded.name,
    password_hash = excluded.password_hash,
    role = 'admin',
    status = 'active',
    plan = 'scale',
    search_limit = NULL,
    updated_at = CURRENT_TIMESTAMP
`).run(name, email, hashPassword(password));

console.log(`Admin pronto: ${email}`);
