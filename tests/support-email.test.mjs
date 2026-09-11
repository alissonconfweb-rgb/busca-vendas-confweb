import assert from "node:assert/strict";
import test from "node:test";

import {
  publicSupportEmailError,
  supportEmailConfig,
  trySendSupportEmail,
  verifySupportEmailConnection,
} from "../server/support-email.mjs";

function settingsReader(values) {
  return (key) => values[key] || "";
}

const configuredSettings = {
  support_email_address: "suportebuscavendas@confweb.com.br",
  support_smtp_host: "mail.confweb.com.br",
  support_smtp_port: "465",
  support_smtp_secure: "true",
  support_smtp_user: "suportebuscavendas@confweb.com.br",
  support_smtp_password: "senha-forte-de-teste",
};

test("usa a configuracao SMTP segura informada pelo cPanel", () => {
  const config = supportEmailConfig({
    readSetting: settingsReader(configuredSettings),
    env: {},
  });

  assert.equal(config.host, "mail.confweb.com.br");
  assert.equal(config.port, 465);
  assert.equal(config.secure, true);
  assert.equal(config.user, "suportebuscavendas@confweb.com.br");
  assert.equal(config.configured, true);
});

test("nao tenta enviar enquanto a senha SMTP nao foi cadastrada", async () => {
  let transportCreated = false;
  const result = await trySendSupportEmail({
    to: "cliente@teste.local",
    subject: "Teste",
    text: "Mensagem",
  }, {
    readSetting: settingsReader({
      ...configuredSettings,
      support_smtp_password: "",
    }),
    env: {},
    createTransport: () => {
      transportCreated = true;
      return {};
    },
  });

  assert.equal(transportCreated, false);
  assert.equal(result.status, "not_configured");
});

test("registra como enviado somente depois de o SMTP aceitar o destinatario", async () => {
  let transportOptions;
  let sentMessage;
  const result = await trySendSupportEmail({
    to: "cliente@teste.local",
    replyTo: "suportebuscavendas@confweb.com.br",
    subject: "Resposta do suporte",
    text: "Resposta",
    html: "<p>Resposta</p>",
  }, {
    readSetting: settingsReader(configuredSettings),
    env: {},
    createTransport: (options) => {
      transportOptions = options;
      return {
        sendMail: async (message) => {
          sentMessage = message;
          return { accepted: ["cliente@teste.local"], messageId: "message-123" };
        },
        close() {},
      };
    },
  });

  assert.equal(transportOptions.secure, true);
  assert.equal(transportOptions.port, 465);
  assert.equal(transportOptions.disableFileAccess, true);
  assert.equal(sentMessage.from.address, "suportebuscavendas@confweb.com.br");
  assert.equal(result.status, "sent");
  assert.equal(result.messageId, "message-123");
});

test("registra falha quando o SMTP rejeita o destinatario", async () => {
  const result = await trySendSupportEmail({
    to: "cliente@teste.local",
    subject: "Resposta do suporte",
    text: "Resposta",
  }, {
    readSetting: settingsReader(configuredSettings),
    env: {},
    createTransport: () => ({
      sendMail: async () => ({ accepted: [], rejected: ["cliente@teste.local"] }),
      close() {},
    }),
  });

  assert.equal(result.status, "failed");
  assert.equal(result.error, "O servidor SMTP não aceitou o destinatário.");
});

test("o teste de conexao autentica sem enviar mensagem", async () => {
  let verified = false;
  let sent = false;
  await verifySupportEmailConnection({
    readSetting: settingsReader(configuredSettings),
    env: {},
    createTransport: () => ({
      verify: async () => {
        verified = true;
      },
      sendMail: async () => {
        sent = true;
      },
      close() {},
    }),
  });

  assert.equal(verified, true);
  assert.equal(sent, false);
});

test("traduz falha de autenticacao sem expor o erro bruto", () => {
  assert.equal(
    publicSupportEmailError({ code: "EAUTH", message: "535 password=segredo" }),
    "O servidor recusou o usuário ou a senha da conta de e-mail.",
  );
});
