import nodemailer from "nodemailer";
import { getSetting } from "./db.mjs";

const DEFAULT_SUPPORT_EMAIL = "suportebuscavendas@confweb.com.br";
const DEFAULT_SMTP_HOST = "mail.confweb.com.br";
const DEFAULT_SMTP_PORT = 465;

export function supportEmailAddress() {
  return supportEmailConfig().address;
}

export function supportEmailConfig({ readSetting = getSetting, env = process.env } = {}) {
  const setting = (key) => String(readSetting(key) || "").trim();
  const port = normalizePort(setting("support_smtp_port") || env.SUPPORT_SMTP_PORT || DEFAULT_SMTP_PORT);
  const secureSetting = setting("support_smtp_secure") || env.SUPPORT_SMTP_SECURE;
  const address = normalizeEmail(
    setting("support_email_address") || env.SUPPORT_EMAIL_ADDRESS || DEFAULT_SUPPORT_EMAIL,
  );
  const user = normalizeEmail(
    setting("support_smtp_user") || env.SUPPORT_SMTP_USER || address,
  );
  const password = setting("support_smtp_password") || String(env.SUPPORT_SMTP_PASSWORD || "");

  return {
    address,
    host: normalizeHost(setting("support_smtp_host") || env.SUPPORT_SMTP_HOST || DEFAULT_SMTP_HOST),
    port,
    secure: secureSetting ? parseBoolean(secureSetting) : port === 465,
    user,
    password,
    configured: Boolean(address && user && password),
  };
}

export function publicSupportEmailConfig(options = {}) {
  const config = supportEmailConfig(options);
  return {
    address: config.address,
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
    configured: config.configured,
  };
}

export async function verifySupportEmailConnection(options = {}) {
  const config = supportEmailConfig(options);
  ensureConfigured(config);
  const transporter = createTransport(config, options.createTransport);
  try {
    await transporter.verify();
    return publicSupportEmailConfig(options);
  } finally {
    transporter.close?.();
  }
}

export async function notifySupportTicketOpened({ ticket, user }, options = {}) {
  const supportAddress = supportEmailConfig(options).address;
  const subject = `[Chamado #${ticket.id}] ${ticket.subject}`;
  const panelUrl = publicAppUrl(options);
  const text = [
    `Novo chamado #${ticket.id} no Busca Vendas`,
    "",
    `Cliente: ${user.name}`,
    `E-mail: ${user.email}`,
    `Prioridade: ${priorityLabel(ticket.priority)}`,
    `Assunto: ${ticket.subject}`,
    "",
    ticket.message,
    "",
    `Acompanhe e responda pelo painel administrativo: ${panelUrl}`,
  ].join("\n");
  const html = `
    <h2>Novo chamado #${ticket.id}</h2>
    <p><strong>Cliente:</strong> ${escapeHtml(user.name)}<br>
    <strong>E-mail:</strong> ${escapeHtml(user.email)}<br>
    <strong>Prioridade:</strong> ${escapeHtml(priorityLabel(ticket.priority))}</p>
    <p><strong>Assunto:</strong> ${escapeHtml(ticket.subject)}</p>
    <div style="white-space:pre-wrap">${escapeHtml(ticket.message)}</div>
    <p><a href="${escapeHtml(panelUrl)}">Abrir painel administrativo</a></p>
  `;

  return trySendSupportEmail({
    to: supportAddress,
    replyTo: user.email,
    subject,
    text,
    html,
  }, options);
}

export async function notifySupportTicketResponded({ ticket, user }, options = {}) {
  const subject = `Resposta do suporte — chamado #${ticket.id}`;
  const panelUrl = publicAppUrl(options);
  const text = [
    `Olá, ${user.name}.`,
    "",
    `A equipe do Busca Vendas respondeu ao chamado #${ticket.id}: ${ticket.subject}`,
    "",
    ticket.response,
    "",
    `Acompanhe o chamado pelo Busca Vendas: ${panelUrl}`,
  ].join("\n");
  const html = `
    <p>Olá, ${escapeHtml(user.name)}.</p>
    <p>A equipe do Busca Vendas respondeu ao chamado <strong>#${ticket.id}</strong>: ${escapeHtml(ticket.subject)}</p>
    <div style="white-space:pre-wrap;padding:14px;border-radius:8px;background:#f4f7fb">${escapeHtml(ticket.response)}</div>
    <p><a href="${escapeHtml(panelUrl)}">Acompanhar chamado no Busca Vendas</a></p>
  `;

  return trySendSupportEmail({
    to: user.email,
    replyTo: supportEmailConfig(options).address,
    subject,
    text,
    html,
  }, options);
}

export async function sendSupportEmailTest(options = {}) {
  const config = supportEmailConfig(options);
  return trySendSupportEmail({
    to: config.address,
    replyTo: config.address,
    subject: "Teste de e-mail — Busca Vendas",
    text: "A integração SMTP do suporte do Busca Vendas está funcionando.",
    html: "<p>A integração SMTP do suporte do <strong>Busca Vendas</strong> está funcionando.</p>",
  }, options);
}

export async function trySendSupportEmail(message, options = {}) {
  const config = supportEmailConfig(options);
  if (!config.configured) {
    return {
      status: "not_configured",
      messageId: null,
      error: "Configure a senha SMTP no painel administrativo.",
    };
  }

  let transporter;
  try {
    transporter = createTransport(config, options.createTransport);
    const info = await transporter.sendMail({
      from: { name: "Busca Vendas — Suporte", address: config.address },
      to: message.to,
      replyTo: message.replyTo || config.address,
      subject: String(message.subject || "").slice(0, 180),
      text: String(message.text || ""),
      html: String(message.html || ""),
    });
    const hasAcceptedList = Array.isArray(info?.accepted);
    const accepted = hasAcceptedList ? info.accepted.map(normalizeEmail) : [];
    const recipient = normalizeEmail(message.to);
    const acceptedByServer = hasAcceptedList ? accepted.includes(recipient) : true;
    return {
      status: acceptedByServer ? "sent" : "failed",
      messageId: String(info?.messageId || "") || null,
      error: acceptedByServer
        ? null
        : "O servidor SMTP não aceitou o destinatário.",
    };
  } catch (error) {
    return {
      status: "failed",
      messageId: null,
      error: publicSupportEmailError(error),
    };
  } finally {
    transporter?.close?.();
  }
}

export function publicSupportEmailError(error) {
  const code = String(error?.code || "").toUpperCase();
  const responseCode = Number(error?.responseCode || 0);
  if (code === "SUPPORT_EMAIL_NOT_CONFIGURED") {
    return "Configure o endereço, o usuário e a senha SMTP do suporte.";
  }
  if (code === "EAUTH" || responseCode === 535) {
    return "O servidor recusou o usuário ou a senha da conta de e-mail.";
  }
  if (["ECONNECTION", "ETIMEDOUT", "ECONNREFUSED"].includes(code)) {
    return "Não foi possível conectar ao servidor SMTP.";
  }
  if (code === "ESOCKET") {
    return "Não foi possível estabelecer a conexão segura com o servidor SMTP.";
  }
  return "O servidor de e-mail não aceitou o envio.";
}

function createTransport(config, createTransportOverride) {
  const factory = createTransportOverride || nodemailer.createTransport.bind(nodemailer);
  return factory({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

function ensureConfigured(config) {
  if (!config.address || !config.user || !config.password) {
    const error = new Error("Informe o endereço, o usuário e a senha SMTP do suporte.");
    error.code = "SUPPORT_EMAIL_NOT_CONFIGURED";
    throw error;
  }
}

function publicAppUrl(options) {
  const env = options.env || process.env;
  return String(env.PUBLIC_URL || env.FRONTEND_ORIGIN || "https://buscavendas.confweb.com.br").replace(/\/$/, "");
}

function normalizePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : DEFAULT_SMTP_PORT;
}

function normalizeHost(value) {
  return String(value || "").trim().toLowerCase().slice(0, 253);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 254);
}

function parseBoolean(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function priorityLabel(priority) {
  return {
    low: "Baixa",
    normal: "Normal",
    high: "Alta",
  }[priority] || "Normal";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
