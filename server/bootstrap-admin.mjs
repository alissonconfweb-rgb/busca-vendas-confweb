import { hashPassword } from "./security.mjs";

export function bootstrapAdminFromEnv(db) {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || "Alisson Confweb";

  if (!email || !password) {
    return false;
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

  console.log(`Admin sincronizado: ${email}`);
  return true;
}
