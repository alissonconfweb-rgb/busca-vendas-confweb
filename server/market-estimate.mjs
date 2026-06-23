const PLACEHOLDER_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='20' fill='%23f4f8fc'/%3E%3Cpath d='M27 38h42v30H27z' fill='%23fff' stroke='%232f6fab' stroke-width='4'/%3E%3Cpath d='M35 38c0-9 5-15 13-15s13 6 13 15' fill='none' stroke='%23ff7e21' stroke-width='4' stroke-linecap='round'/%3E%3Ccircle cx='64' cy='64' r='10' fill='%23ff7e21'/%3E%3Cpath d='M60 64h8M64 60v8' stroke='%23fff' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E";

const GENERIC_PROFILE = {
  family: "Produto pesquisado",
  note: "Estimativa criada por faixa de ticket e comportamento comum de marketplace.",
  scenarios: [
    { label: "Faixa de entrada", price: 69.9, units: 180 },
    { label: "Faixa intermediaria", price: 119.9, units: 120 },
    { label: "Faixa premium", price: 199.9, units: 55 },
  ],
};

const PROFILES = [
  {
    match: ["mochila", "bolsa"],
    family: "Mochila masculina",
    note: "Boa categoria para entrada: compra recorrente, volta as aulas, rotina corporativa e viagem.",
    scenarios: [
      { label: "Mochila escolar/resistente", price: 79.9, units: 260 },
      { label: "Mochila notebook/impermeavel", price: 119.9, units: 200 },
      { label: "Mochila premium/couro sintetico", price: 219.9, units: 70 },
    ],
  },
  {
    match: ["fone", "headphone", "earbud", "bluetooth"],
    family: "Fone Bluetooth",
    note: "Categoria de alto giro, mas com concorrencia forte e sensibilidade a preco.",
    scenarios: [
      { label: "Fone Bluetooth entrada", price: 39.9, units: 800 },
      { label: "Fone TWS intermediario", price: 69.9, units: 500 },
      { label: "Headphone/Fone premium", price: 119.9, units: 180 },
    ],
  },
  {
    match: ["caixa", "som", "speaker"],
    family: "Caixa de som Bluetooth",
    note: "Produto com apelo visual e bom ticket medio; venda depende muito de prova social e entrega rapida.",
    scenarios: [
      { label: "Caixa portatil compacta", price: 89.9, units: 300 },
      { label: "Caixa media bluetooth", price: 149.9, units: 180 },
      { label: "Caixa potente/premium", price: 249.9, units: 90 },
    ],
  },
  {
    match: ["creatina", "whey", "suplemento"],
    family: "Suplemento fitness",
    note: "Demanda recorrente e reposicao mensal, mas exige fornecedor confiavel e regularidade fiscal.",
    scenarios: [
      { label: "Produto entrada", price: 59.9, units: 650 },
      { label: "Produto 1kg/intermediario", price: 89.9, units: 420 },
      { label: "Marca premium", price: 129.9, units: 220 },
    ],
  },
  {
    match: ["cafeteira", "cafe"],
    family: "Cafeteira",
    note: "Ticket interessante e boa busca em datas sazonais; margem depende de frete e garantia.",
    scenarios: [
      { label: "Cafeteira eletrica simples", price: 89.9, units: 180 },
      { label: "Cafeteira programavel", price: 159.9, units: 95 },
      { label: "Cafeteira espresso/capsula", price: 319.9, units: 45 },
    ],
  },
];

export function buildMarketEstimate(query, reason = "") {
  const profile = profileFor(query);
  const items = profile.scenarios.map((scenario, index) => {
    const revenue = Number((scenario.price * scenario.units).toFixed(2));
    return {
      id: `estimate-${index + 1}-${slugify(query)}-${slugify(scenario.label)}`,
      title: `${profile.family} - ${scenario.label}`,
      subtitle: "Raio-x estrategico Confweb - estimativa sem API",
      image: PLACEHOLDER_IMAGE,
      price: scenario.price,
      soldQuantity: scenario.units,
      estimatedSoldQuantity: scenario.units,
      salesMetricLabel: "Estimativa mensal",
      revenue,
      estimatedRevenue: revenue,
      revenueMetricLabel: "Receita projetada",
      permalink: mercadoLivreSearchUrl(query),
    };
  });
  const demand = items.reduce((sum, item) => sum + item.soldQuantity, 0);
  const revenue = Number(items.reduce((sum, item) => sum + item.revenue, 0).toFixed(2));

  return {
    ok: true,
    source: "market_estimate",
    metricsMode: "market_signal",
    salesAvailable: false,
    message: reason
      ? `A leitura real demorou ou falhou agora. Entregamos um raio-x estrategico para triagem: ${profile.note}`
      : `Raio-x estrategico para triagem: ${profile.note}`,
    sourceFailureReason: reason,
    items,
    exactMatches: 0,
    totalAvailable: items.length,
    totals: {
      demand,
      revenue,
      averageTicket: demand ? revenue / demand : 0,
      isEstimated: true,
      actualDemand: 0,
    },
  };
}

export function shouldUseMarketEstimate(result) {
  return Boolean(
    !result?.ok ||
    result?.source === "not_configured" ||
    result?.source === "market_data_pending" ||
    result?.source === "meli_forbidden" ||
    result?.source?.endsWith("_blocked") ||
    result?.source?.endsWith("_no_exact_match") ||
    result?.items?.length === 0
  );
}

function profileFor(query) {
  const normalized = normalize(query);
  return PROFILES.find((profile) => profile.match.some((word) => normalized.includes(word))) || {
    ...GENERIC_PROFILE,
    family: cleanQueryName(query),
  };
}

function cleanQueryName(query) {
  const cleaned = String(query || "").trim().replace(/\s+/g, " ");
  return cleaned ? titleCase(cleaned) : GENERIC_PROFILE.family;
}

function mercadoLivreSearchUrl(query) {
  const slug = String(query || "").trim().replace(/\s+/g, "-").replace(/-+/g, "-");
  return `https://lista.mercadolivre.com.br/${encodeURIComponent(slug).replace(/%2D/g, "-")}`;
}

function slugify(text) {
  return normalize(text).replace(/\s+/g, "-").replace(/^-|-$/g, "") || "produto";
}

function titleCase(text) {
  return text
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normalize(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
