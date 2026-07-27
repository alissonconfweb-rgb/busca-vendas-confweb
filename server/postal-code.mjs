export function normalizeBrazilianPostalCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

export async function lookupBrazilianPostalCode(value) {
  const postalCode = normalizeBrazilianPostalCode(value);
  if (postalCode.length !== 8) {
    throw new Error("Informe um CEP com 8 números.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(`https://viacep.com.br/ws/${postalCode}/json/`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "BuscaVendasConfweb/1.0",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error("Não foi possível validar o CEP agora. Tente novamente.");
    }

    const data = await response.json();
    if (data?.erro) {
      throw new Error("CEP não encontrado. Confira os números informados.");
    }

    return {
      cep: normalizeBrazilianPostalCode(data.cep || postalCode),
      street: String(data.logradouro || "").trim(),
      neighborhood: String(data.bairro || "").trim(),
      city: String(data.localidade || "").trim(),
      state: String(data.uf || "").trim(),
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("A validação do CEP demorou demais. Tente novamente.");
    }
    throw error instanceof Error
      ? error
      : new Error("Não foi possível validar o CEP agora. Tente novamente.");
  } finally {
    clearTimeout(timeout);
  }
}
