import {
  BarChart3,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleX,
  ClipboardCopy,
  CreditCard,
  Crown,
  Database,
  Eye,
  EyeOff,
  Headphones,
  HelpCircle,
  LayoutDashboard,
  LineChart,
  Lock,
  LogIn,
  LogOut,
  MessageCircle,
  PackageSearch,
  ReceiptText,
  RefreshCw,
  Rocket,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  TrendingUp,
  UnlockKeyhole,
  UserRound,
  UsersRound,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import confwebLogoUrl from "./assets/confweb-logo.webp";

type Role = "admin" | "user";
type Plan = "free" | "starter" | "scale";
type PaidPlan = "starter" | "scale";
type PlanCycle = "monthly" | "yearly";
type BillingType = "PIX" | "CREDIT_CARD";
type ChargeMode = "subscription" | "single";
type BusinessModel = "importer" | "manufacturer" | "distributor" | "physical_retail" | "online_retail_cnpj" | "online_retail_no_cnpj";
type MarketplaceExperience = "selling" | "starting";
type Mode = "search" | "history" | "plans" | "checkout" | "learn" | "commercial" | "support" | "profile" | "admin" | "terms" | "privacy";

const BUSINESS_MODEL_LABELS: Record<BusinessModel, string> = {
  importer: "Importador",
  manufacturer: "Fabricante",
  distributor: "Distribuidor",
  physical_retail: "Varejo com loja física",
  online_retail_cnpj: "Varejo sem loja física (com CNPJ)",
  online_retail_no_cnpj: "Varejo sem loja física (sem CNPJ)",
};

const MARKETPLACE_EXPERIENCE_LABELS: Record<MarketplaceExperience, string> = {
  selling: "Sim, já vendo",
  starting: "Não, mas quero começar",
};

type User = {
  id: number;
  name: string;
  email: string;
  phone?: string | null;
  business_model?: BusinessModel | null;
  marketplace_experience?: MarketplaceExperience | null;
  role: Role;
  status: string;
  plan: Plan;
  search_limit: number | null;
  searches_used: number;
  billing_status?: "none" | "active" | "past_due" | "canceling" | "canceled" | string;
  billing_cycle?: PlanCycle | null;
  billing_payment_url?: string | null;
  billing_access_until?: string | null;
  can_admin?: boolean;
  is_creator?: boolean;
};

type SettingsMap = Record<string, string>;

type MeliDiagnostic = {
  ok: boolean;
  readyForBuscaVendas: boolean;
  oauthConnected: boolean;
  searchAuthorized: boolean;
  salesDataAvailable: boolean;
  query: string;
  testedAt: string;
  summary: string;
  checks: Array<{
    key: string;
    label: string;
    ok: boolean;
    status: number | null;
    detail: string;
  }>;
};

type MercadoLivreListingType = "classic" | "premium";

type MarketplaceFeeQuote = {
  listingTypeId: string;
  listingTypeName: string;
  saleFeeAmount: number;
  percentageFee: number;
  fixedFee: number;
  financingFee: number;
};

type MarketplaceItem = {
  id: string;
  title: string;
  subtitle: string;
  image: string;
  price: number;
  soldQuantity: number | null;
  estimatedSoldQuantity?: number | null;
  salesMetricLabel?: string;
  revenue: number | null;
  estimatedRevenue?: number | null;
  revenueMetricLabel?: string;
  permalink: string;
  categoryId?: string;
  categoryName?: string;
  weightKg?: number | null;
  shippingDimensions?: string;
  marketplaceFees?: {
    source: "mercado_livre_official";
    calculatedAt: string;
    classic?: MarketplaceFeeQuote;
    premium?: MarketplaceFeeQuote;
  };
  shippingQuote?: {
    amount: number;
    billableWeightKg?: number | null;
    currencyId: string;
    source: "mercado_livre_official";
    approximate: true;
    calculationMode?: "sale_simulation" | "item_quote";
    inputWeightKg?: number | null;
    calculatedAt: string;
  };
};

type MarginEstimate = {
  category: string;
  shippingLabel: string;
  estimatedWeightKg: number;
  marketplaceRate: number;
  commission: number;
  fixedFee: number;
  shippingFee: number;
  totalMarketplaceFees: number;
  marginBeforeCost: number;
  marginAfterCost: number;
  percentBeforeCost: number;
  percentAfterCost: number;
  officialFee: boolean;
  officialShipping: boolean;
};

type SearchResult = {
  ok: boolean;
  source: string;
  metricsMode?: "sales" | "market_signal";
  salesAvailable?: boolean;
  opportunityMode?: "emerging" | "developing";
  marketThreshold?: number;
  message: string;
  items: MarketplaceItem[];
  exactMatches?: number;
  totalAvailable: number;
  totals: {
    demand: number;
    revenue: number;
    averageTicket: number;
    isEstimated?: boolean;
    actualDemand?: number;
  };
};

type PendingSearch = {
  pending: true;
  requestId: string;
  query: string;
  pollAfterMs: number;
};

type SearchStatusResponse = PendingSearch | {
  pending: false;
  result: SearchResult;
};

function isPendingSearch(value: SearchResult | PendingSearch): value is PendingSearch {
  return "pending" in value && value.pending === true;
}

type Tip = {
  id: number;
  title: string;
  body: string;
  cta: string;
  status: string;
};

type Ticket = {
  id: number;
  subject: string;
  message: string;
  status: string;
  priority: string;
  response?: string | null;
  user_email?: string;
  created_at: string;
  updated_at?: string;
};

type Contact = {
  id: number;
  name: string;
  channel: string;
  value: string;
  is_primary: number;
  status: string;
};

type FinanceRecord = {
  id: number;
  user_id?: number | null;
  user_email?: string | null;
  type: string;
  description: string;
  amount: number;
  status: string;
  due_date?: string | null;
  paid_at?: string | null;
};

type CheckoutSelection = {
  plan: PaidPlan;
  cycle: PlanCycle;
};

type CheckoutResult = {
  ok: boolean;
  financeId: number;
  plan: PaidPlan;
  cycle: PlanCycle;
  chargeMode: ChargeMode;
  billingType: BillingType;
  value: number;
  status: string;
  invoiceUrl?: string;
  pixQrCode?: {
    encodedImage?: string;
    payload?: string;
    expirationDate?: string;
  } | null;
  message: string;
  user?: User;
};

type CheckoutStatus = {
  ok: boolean;
  financeId: number;
  status: string;
  paid: boolean;
  invoiceUrl?: string;
  pixQrCode?: {
    encodedImage?: string;
    payload?: string;
    expirationDate?: string;
  } | null;
  message: string;
  user?: User;
};

type PostalCodeAddress = {
  cep: string;
  street: string;
  neighborhood: string;
  city: string;
  state: string;
};

type HistoryRecord = {
  id: number;
  query: string;
  source: string;
  total_demand: number;
  total_revenue: number;
  created_at: string;
  result?: SearchResult | null;
};

type AdminSearchCacheRecord = {
  key: string;
  query: string;
  source: string;
  total_demand: number;
  total_revenue: number;
  items_count: number;
  usage_count: number;
  users_count: number;
  provider_credits_used: number;
  created_at: string;
  updated_at: string;
  age_days: number;
  status: "fresh" | "stale" | "expired";
  items: MarketplaceItem[];
};

type AdminSearchCacheData = {
  summary: {
    total: number;
    fresh: number;
    stale: number;
    expired: number;
    itemCache: number;
    historyUses: number;
    estimatedCreditsSaved: number;
  };
  ttlDays: number;
  staleDays: number;
  records: AdminSearchCacheRecord[];
};

type RestoredSearch = {
  id: number;
  query: string;
  result: SearchResult;
  nonce: number;
};

type AdminData = {
  summary: { users: number; searches: number; revenue: number; tickets: number };
  users: User[];
  settings: SettingsMap;
  tips: Tip[];
  tickets: Ticket[];
  finance: FinanceRecord[];
  contacts: Contact[];
};

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const money = new Intl.NumberFormat("pt-BR", {
  currency: "BRL",
  style: "currency",
});

const number = new Intl.NumberFormat("pt-BR");

const defaultSettings: SettingsMap = {
  starter_monthly: "19.90",
  starter_yearly: "179.10",
  scale_monthly: "39.90",
  scale_yearly: "359.10",
  commercial_cta: "Fale com um Especialista Certificado da Confweb",
  commercial_training_eyebrow: "Treinamento Confweb",
  commercial_training_title: "Agora, aprenda a aplicar e a vender muito com esses produtos, com o treinamento da Confweb.",
  commercial_training_body: "Hoje, a Confweb gerencia mais de 60 empresas no modelo de administração, gestão e escala. Você também pode ser um case de sucesso.",
  commercial_training_button: "Conhecer o treinamento",
  commercial_training_url: "https://www.confweb.com.br",
  commercial_support_text: "Precisa de ajuda? Fale com um especialista da Confweb.",
  commercial_support_button: "Conversar",
};

const defaultTips: Tip[] = [
  {
    id: 1,
    title: "Vender no Mercado Livre: primeiros passos",
    body: "Escolha um produto com demanda, calcule margem antes de comprar estoque e comece com poucos SKUs para validar giro.",
    cta: "Começar",
    status: "published",
  },
  {
    id: 2,
    title: "Precificação que garante lucro",
    body: "Some custo do produto, taxa do marketplace, embalagem, frete e uma reserva operacional antes de decidir o preço mínimo.",
    cta: "Ver fórmula",
    status: "published",
  },
  {
    id: 3,
    title: "Como encontrar produtos campeões",
    body: "Produtos com procura recorrente, ticket acessível e concorrência organizada costumam ser melhores para iniciantes.",
    cta: "Ler guia",
    status: "published",
  },
];

const defaultContacts: Contact[] = [
  {
    id: 1,
    name: "Comercial Confweb",
    channel: "WhatsApp",
    value: "+55 11 99999-9999",
    is_primary: 1,
    status: "active",
  },
  {
    id: 2,
    name: "Site Confweb",
    channel: "Site",
    value: "https://www.confweb.com.br",
    is_primary: 0,
    status: "active",
  },
];

const searchSteps = [
  "Buscando anúncios",
  "Filtrando produto exato",
  "Conferindo vendas públicas",
  "Ampliando a varredura",
  "Montando seu Top 3",
];

const clientEstimateProfiles = [
  {
    match: ["mochila", "bolsa"],
    family: "Mochila masculina",
    note: "Boa categoria para entrada: compra recorrente, volta às aulas, rotina corporativa e viagem.",
    scenarios: [
      { label: "Mochila escolar/resistente", price: 79.9, units: 260 },
      { label: "Mochila notebook/impermeável", price: 119.9, units: 200 },
      { label: "Mochila premium/couro sintético", price: 219.9, units: 70 },
    ],
  },
  {
    match: ["fone", "headphone", "earbud", "bluetooth"],
    family: "Fone Bluetooth",
    note: "Categoria de alto giro, mas com concorrência forte e sensibilidade a preço.",
    scenarios: [
      { label: "Fone Bluetooth entrada", price: 39.9, units: 800 },
      { label: "Fone TWS intermediário", price: 69.9, units: 500 },
      { label: "Headphone/Fone premium", price: 119.9, units: 180 },
    ],
  },
  {
    match: ["caixa", "som", "speaker"],
    family: "Caixa de som Bluetooth",
    note: "Produto com bom ticket médio; venda depende de prova social, preço e entrega rápida.",
    scenarios: [
      { label: "Caixa portátil compacta", price: 89.9, units: 300 },
      { label: "Caixa média Bluetooth", price: 149.9, units: 180 },
      { label: "Caixa potente/premium", price: 249.9, units: 90 },
    ],
  },
];

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      cache: "no-store",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("O servidor demorou para responder. Tente novamente em instantes.", 408);
    }
    throw new ApiError("Não consegui conectar à API do Busca Vendas agora.", 0);
  }

  const raw = response.status === 204 ? "" : await response.text();
  let data: any = null;

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      const looksLikeHtml = raw.trim().startsWith("<!DOCTYPE") || raw.trim().startsWith("<html");
      throw new ApiError(
        looksLikeHtml
          ? "A API do Busca Vendas não está ativa no servidor. Reinicie o app Node no cPanel."
          : "A API respondeu em um formato inválido. Tente novamente em instantes.",
        response.status || 503,
      );
    }
  }

  if (!response.ok) {
    throw new ApiError(data?.error || data?.message || "Erro na requisição.", response.status);
  }

  return data as T;
}

function buildClientMarketEstimate(query: string, reason = ""): SearchResult {
  const normalized = normalizeSearchText(query);
  const profile = clientEstimateProfiles.find((item) => item.match.some((word) => normalized.includes(word))) || {
    family: titleCase(query.trim() || "Produto pesquisado"),
    note: "Estimativa criada por faixa de ticket e comportamento comum de marketplace.",
    scenarios: [
      { label: "Faixa de entrada", price: 69.9, units: 180 },
      { label: "Faixa intermediaria", price: 119.9, units: 120 },
      { label: "Faixa premium", price: 199.9, units: 55 },
    ],
  };
  const image = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='20' fill='%23f4f8fc'/%3E%3Cpath d='M27 38h42v30H27z' fill='%23fff' stroke='%232f6fab' stroke-width='4'/%3E%3Cpath d='M35 38c0-9 5-15 13-15s13 6 13 15' fill='none' stroke='%23ff7e21' stroke-width='4' stroke-linecap='round'/%3E%3Ccircle cx='64' cy='64' r='10' fill='%23ff7e21'/%3E%3Cpath d='M60 64h8M64 60v8' stroke='%23fff' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E";
  const items = profile.scenarios.map((scenario, index) => {
    const revenue = Number((scenario.price * scenario.units).toFixed(2));
    return {
      id: `client-estimate-${index}-${normalized.replace(/\s+/g, "-") || "produto"}`,
      title: `${profile.family} - ${scenario.label}`,
      subtitle: "Raio-x estratégico Confweb - estimativa sem API",
      image,
      price: scenario.price,
      soldQuantity: scenario.units,
      estimatedSoldQuantity: scenario.units,
      salesMetricLabel: "Estimativa mensal",
      revenue,
      estimatedRevenue: revenue,
      revenueMetricLabel: "Receita projetada",
      permalink: `https://lista.mercadolivre.com.br/${encodeURIComponent(query.trim().replace(/\s+/g, "-"))}`,
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
      ? `A leitura real não respondeu agora. Entregamos um raio-x estratégico para triagem: ${profile.note}`
      : `Raio-x estratégico para triagem: ${profile.note}`,
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

function sanitizeClientSearchResult(result: SearchResult, query: string, settings: SettingsMap): SearchResult {
  if (result.source === "market_estimate") {
    return buildUnavailableSearchResult(
      query,
      "Ainda não consegui validar esse produto com dados reais. Ajuste a API no painel admin e tente novamente.",
    );
  }

  if (result.salesAvailable === false || result.metricsMode === "market_signal") {
    return result;
  }

  if (!result.ok || isClientCompleteChampionResult(result, settings)) {
    return result;
  }

  const productLabel = query ? ` para "${query}"` : "";
  return {
    ok: false,
    source: "invalid_champion_result",
    metricsMode: "sales",
    salesAvailable: false,
    message: `Resultado descartado${productLabel}: não encontrei 3 anúncios com vendas públicas reais. Faça uma nova busca para atualizar.`,
    items: [],
    exactMatches: 0,
    totalAvailable: 0,
    totals: {
      demand: 0,
      revenue: 0,
      averageTicket: 0,
      actualDemand: 0,
    },
  };
}

function buildUnavailableSearchResult(query: string, message: string): SearchResult {
  return {
    ok: false,
    source: "market_data_pending",
    metricsMode: "sales",
    salesAvailable: false,
    message,
    items: [],
    exactMatches: 0,
    totalAvailable: 0,
    totals: {
      demand: 0,
      revenue: 0,
      averageTicket: 0,
      actualDemand: 0,
    },
  };
}

function isClientCompleteChampionResult(result: SearchResult, settings: SettingsMap) {
  const hasVerifiedItems = result.items.length >= 3 && result.items.slice(0, 3).every((item) => (
    Number(item.soldQuantity) > 0 &&
    Number(item.price) > 0 &&
    Number(item.revenue) > 0
  ));
  const hasDeliverableShape = result.items.length >= 3;

  return Boolean(
    result.ok &&
    result.salesAvailable === true &&
    hasVerifiedItems &&
    hasDeliverableShape &&
    Number(result.totals.demand) > 0 &&
    Number(result.totals.revenue) > 0,
  );
}

function normalizeSearchText(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(text: string) {
  return text
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function businessModelLabel(value?: BusinessModel | null) {
  return value ? BUSINESS_MODEL_LABELS[value] || "Não informado" : "Modelo de negócio não informado";
}

function marketplaceExperienceLabel(value?: MarketplaceExperience | null) {
  return value ? MARKETPLACE_EXPERIENCE_LABELS[value] || "Não informado" : "Experiência em marketplace não informada";
}

function formJson(form: HTMLFormElement) {
  return Object.fromEntries(new FormData(form).entries());
}

function digitsOnly(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function formatCardNumber(value: string) {
  const digits = digitsOnly(value).slice(0, 19);
  return digits.match(/.{1,4}/g)?.join(" ") || "";
}

function isValidCardNumber(value: string) {
  const number = digitsOnly(value);
  if (number.length < 13 || number.length > 19 || /^(\d)\1+$/.test(number)) {
    return false;
  }

  let sum = 0;
  let doubleDigit = false;
  for (let index = number.length - 1; index >= 0; index -= 1) {
    let digit = Number(number[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

function formatCpfCnpj(value: string) {
  const digits = digitsOnly(value).slice(0, 14);
  if (digits.length <= 11) {
    return digits
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

function formatPhone(value: string) {
  const digits = digitsOnly(value).slice(0, 11);
  if (digits.length <= 2) {
    return digits ? `(${digits}` : "";
  }
  if (digits.length <= 6) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  }
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function formatPostalCode(value: string) {
  const digits = digitsOnly(value).slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

function limitDigits(value: string, limit: number) {
  return digitsOnly(value).slice(0, limit);
}

function canUseAdmin(user: User | null) {
  return Boolean(user?.can_admin || user?.role === "admin");
}

function isCreator(user: User | null) {
  return Boolean(user?.is_creator);
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2500);

    api<{ user: User | null }>("/api/auth/me", { signal: controller.signal })
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => {
        window.clearTimeout(timer);
        setCheckingSession(false);
      });

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  if (checkingSession) {
    return <LoadingScreen />;
  }

  return <ProductApp user={user} onUserChange={setUser} />;
}

function ProductApp({ user, onUserChange }: { user: User | null; onUserChange: (user: User | null) => void }) {
  const [mode, setMode] = useState<Mode>("search");
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginMode, setLoginMode] = useState<"login" | "register">("login");
  const [settings, setSettings] = useState<SettingsMap>(defaultSettings);
  const [tips, setTips] = useState<Tip[]>(defaultTips);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [contacts, setContacts] = useState<Contact[]>(defaultContacts);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [checkoutSelection, setCheckoutSelection] = useState<CheckoutSelection>({ plan: "starter", cycle: "monthly" });
  const [restoredSearch, setRestoredSearch] = useState<RestoredSearch | null>(null);
  const [selectedTip, setSelectedTip] = useState<Tip | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("bv_sidebar_collapsed") !== "false");

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [mode]);

  const loadPrivateData = async () => {
    if (!user) {
      try {
        const bootstrap = await api<{
          settings: SettingsMap;
          tips: Tip[];
          contacts: Contact[];
        }>("/api/public/bootstrap");
        setSettings({ ...defaultSettings, ...bootstrap.settings });
        setTips(bootstrap.tips.length ? bootstrap.tips : defaultTips);
        setContacts(bootstrap.contacts.length ? bootstrap.contacts : defaultContacts);
      } catch {
        setSettings(defaultSettings);
        setTips(defaultTips);
        setContacts(defaultContacts);
      }
      setTickets([]);
      setHistory([]);
      return;
    }

    const [bootstrap, searches] = await Promise.all([
      api<{
        settings: SettingsMap;
        tips: Tip[];
        tickets: Ticket[];
        contacts: Contact[];
        user: User;
      }>("/api/bootstrap"),
      api<HistoryRecord[]>("/api/search-history"),
    ]);

    setSettings({ ...defaultSettings, ...bootstrap.settings });
    setTips(bootstrap.tips.length ? bootstrap.tips : defaultTips);
    setTickets(bootstrap.tickets);
    setContacts(bootstrap.contacts.length ? bootstrap.contacts : defaultContacts);
    setHistory(searches);
    onUserChange(bootstrap.user);
  };

  useEffect(() => {
    loadPrivateData();
  }, [user?.id, refreshKey]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get("meli") || !user || !canUseAdmin(user)) {
      return;
    }
    setMode("admin");
  }, [user]);

  const openAuth = (authMode: "login" | "register" = "login") => {
    setLoginMode(authMode);
    setLoginOpen(true);
  };

  const requireLogin = () => {
    if (user) {
      return true;
    }
    openAuth("register");
    return false;
  };

  const openCheckout = (selection: CheckoutSelection) => {
    setCheckoutSelection(selection);
    setMode("checkout");
    if (!user) {
      openAuth("register");
      return;
    }
  };

  const openSavedSearch = async (record: HistoryRecord) => {
    if (!user) {
      openAuth("login");
      return;
    }

    const savedResult = (await api<{ result: SearchResult }>(`/api/search-history/${record.id}`)).result;
    setRestoredSearch({
      id: record.id,
      query: record.query,
      result: savedResult,
      nonce: Date.now(),
    });
    setMode("search");
  };

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    onUserChange(null);
    setMode("search");
  };

  useEffect(() => {
    localStorage.setItem("bv_sidebar_collapsed", sidebarCollapsed ? "true" : "false");
  }, [sidebarCollapsed]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [mode]);

  return (
    <div className={sidebarCollapsed ? "bv-shell sidebar-collapsed" : "bv-shell sidebar-expanded"}>
      <Sidebar
        mode={mode}
        user={user}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
        onMode={setMode}
        onLogin={() => openAuth("login")}
        onRegister={() => openAuth("register")}
        onProfile={() => setMode("profile")}
        onLogout={logout}
      />
      <main className="bv-main">
        <TopBar
          user={user}
          onMode={setMode}
          onLogin={() => openAuth("login")}
          onLogout={logout}
        />
        {mode === "search" && (
          <SearchPage
            user={user}
            settings={settings}
            tips={tips}
            contacts={contacts}
            restoredSearch={restoredSearch}
            onLoginRequired={requireLogin}
            onHistoryRefresh={() => setRefreshKey((key) => key + 1)}
            onPlans={() => setMode("plans")}
            onCheckout={openCheckout}
            onTip={setSelectedTip}
          />
        )}
        {mode === "history" && <HistoryPage user={user} history={history} onLoginRequired={requireLogin} onViewSearch={openSavedSearch} />}
        {mode === "plans" && <PlansPage user={user} settings={settings} onSelectPlan={openCheckout} onLoginRequired={requireLogin} />}
        {mode === "checkout" && (
          <CheckoutPage
            user={user}
            settings={settings}
            selection={checkoutSelection}
            onSelection={setCheckoutSelection}
            onLoginRequired={requireLogin}
            onUserChange={onUserChange}
            onDone={() => setRefreshKey((key) => key + 1)}
          />
        )}
        {mode === "learn" && <LearnPage tips={tips} onTip={setSelectedTip} />}
        {mode === "commercial" && <CommercialPage contacts={contacts} cta={settings.commercial_cta} />}
        {mode === "profile" && (
          <ProfilePage
            user={user}
            settings={settings}
            contacts={contacts}
            onLoginRequired={requireLogin}
            onPlans={() => setMode("plans")}
          />
        )}
        {mode === "support" && (
          <SupportPage
            user={user}
            tickets={tickets}
            onTicketsChange={setTickets}
            onLoginRequired={requireLogin}
          />
        )}
        {mode === "terms" && <LegalPage kind="terms" onBack={() => setMode("search")} />}
        {mode === "privacy" && <LegalPage kind="privacy" onBack={() => setMode("search")} />}
        {mode === "admin" && user && canUseAdmin(user) && (
          <AdminPanel user={user} onSettingsChange={() => setRefreshKey((key) => key + 1)} />
        )}
        <LegalFooter onMode={setMode} />
      </main>
      {loginOpen && (
        <LoginModal
          initialMode={loginMode}
          onClose={() => setLoginOpen(false)}
          onLogin={(loggedUser) => {
            onUserChange(loggedUser);
            setLoginOpen(false);
          }}
          onLegal={(legalMode) => {
            setLoginOpen(false);
            setMode(legalMode);
          }}
        />
      )}
      {selectedTip && <TipArticleModal tip={selectedTip} onClose={() => setSelectedTip(null)} />}
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="center-screen">
      <BrandMark />
      <p>Carregando Busca Vendas...</p>
    </main>
  );
}

function BrandMark() {
  return (
    <div className="brand-mark">
      <strong aria-label="Busca Vendas">
        <span className="brand-busca">Busca</span>
        <span className="brand-vendas">Vendas</span>
      </strong>
      <span className="brand-by">BY</span>
      <img src={confwebLogoUrl} alt="Confweb" />
    </div>
  );
}

function Sidebar({
  mode,
  user,
  collapsed,
  onToggleCollapsed,
  onMode,
  onLogin,
  onRegister,
  onProfile,
  onLogout,
}: {
  mode: Mode;
  user: User | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onMode: (mode: Mode) => void;
  onLogin: () => void;
  onRegister: () => void;
  onProfile: () => void;
  onLogout: () => void;
}) {
  const navItems: { mode: Mode; label: string; Icon: LucideIcon }[] = [
    { mode: "search", label: "Nova pesquisa", Icon: Search },
    { mode: "history", label: "Minhas pesquisas", Icon: BarChart3 },
    { mode: "plans", label: "Planos", Icon: CreditCard },
    { mode: "learn", label: "Dicas", Icon: BookOpen },
    { mode: "commercial", label: "Especialista", Icon: UserRound },
  ];

  if (canUseAdmin(user)) {
    navItems.push({ mode: "admin", label: "Painel admin", Icon: LayoutDashboard });
  }

  return (
    <aside className={collapsed ? "bv-sidebar collapsed" : "bv-sidebar expanded"}>
      <div className="sidebar-brand-row">
        <BrandMark />
        <button
          className="sidebar-toggle"
          type="button"
          onClick={onToggleCollapsed}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          aria-expanded={!collapsed}
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <MobileProfileMenu
        user={user}
        mode={mode}
        onLogin={onLogin}
        onRegister={onRegister}
        onLogout={onLogout}
        onProfile={onProfile}
      />
      <AccountSummary user={user} onProfile={onProfile} onLogout={onLogout} />
      <nav className="sidebar-nav" aria-label="Navegação principal">
        {navItems.map(({ mode: itemMode, label, Icon }) => (
          <button
            className={mode === itemMode ? "active" : ""}
            key={itemMode}
            type="button"
            onClick={() => onMode(itemMode)}
            title={label}
            aria-label={label}
            data-label={label}
          >
            <Icon size={22} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <PlanStatus user={user} onRegister={onRegister} onPlans={() => onMode("plans")} />
      <button className="help-card" type="button" onClick={() => onMode("support")}>
        <HelpCircle size={24} />
        <span>
          <strong>Precisa de ajuda?</strong>
          Veja como funciona
        </span>
        <ChevronRight size={18} />
      </button>
    </aside>
  );
}

function userInitials(user: User | null) {
  return user?.name
    ? user.name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase()
    : "BV";
}

function userPlanInfo(user: User | null) {
  if (!user) {
    return {
      planLabel: "Pesquisa grátis",
      remaining: "1 busca",
      usage: 100,
    };
  }

  const planLabel = user.plan === "scale" ? "Ilimitado" : user.plan === "starter" ? "10 pesquisas" : "Grátis";
  const limit = user.search_limit ?? 1;
  const used = user.searches_used ?? 0;
  const remaining = billingNeedsAttention(user)
    ? "Bloqueadas até regularizar"
    : user.search_limit === null
      ? "Sem limite"
      : `${Math.max(0, limit - used)} de ${limit}`;
  const usage =
    user.search_limit === null
      ? 100
      : Math.max(0, Math.min(100, ((limit - used) / Math.max(1, limit)) * 100));

  return { planLabel, remaining, usage };
}

function billingNeedsAttention(user: User | null) {
  if (!user || canUseAdmin(user)) {
    return false;
  }
  if (["past_due", "canceled"].includes(user.billing_status || "")) {
    return true;
  }
  if (user.billing_status === "canceling" && user.billing_access_until) {
    const accessUntil = Date.parse(user.billing_access_until);
    return Number.isFinite(accessUntil) && accessUntil <= Date.now();
  }
  return false;
}

function MobileProfileMenu({
  user,
  mode,
  onLogin,
  onRegister,
  onLogout,
  onProfile,
}: {
  user: User | null;
  mode: Mode;
  onLogin: () => void;
  onRegister: () => void;
  onLogout: () => void;
  onProfile: () => void;
}) {
  const { planLabel, remaining, usage } = userPlanInfo(user);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [mode]);

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (menuRef.current && event.target instanceof Node && !menuRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("click", closeOnOutsideClick, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("click", closeOnOutsideClick, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const closeAndRun = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <details
      ref={menuRef}
      className="mobile-profile-menu"
      open={open}
    >
      <summary
        aria-label={user ? "Abrir perfil" : "Entrar ou criar conta"}
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
      >
        <span className="account-avatar">{user ? userInitials(user) : <UserRound size={18} />}</span>
      </summary>
      <button
        type="button"
        className="mobile-profile-backdrop"
        aria-label="Fechar perfil"
        onClick={() => setOpen(false)}
      />
      <div className={`mobile-profile-panel${user ? " mobile-profile-panel-compact" : ""}`}>
        {user ? (
          <>
            <button
              className="profile-close-button"
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fechar perfil"
              title="Fechar perfil"
            >
              <X size={19} />
            </button>
            <button className="mobile-profile-action" type="button" onClick={() => closeAndRun(onProfile)}>
              <UserRound size={18} />
              Ver perfil
            </button>
            <button className="ghost-action mobile-profile-action" type="button" onClick={() => closeAndRun(onLogout)}>
              <LogOut size={18} />
              Sair
            </button>
          </>
        ) : (
          <>
            <div className="mobile-profile-panel-head">
              <div>
                <span>Acesso</span>
                <strong>Criar conta grátis</strong>
                <small>Cadastre-se para liberar sua primeira busca.</small>
              </div>
              <button
                className="profile-close-button"
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar perfil"
                title="Fechar perfil"
              >
                <X size={19} />
              </button>
            </div>
            <div className="mobile-plan-summary">
              <span>Plano atual</span>
              <strong>{planLabel}</strong>
              <small>Pesquisas restantes: {remaining}</small>
              <div className="usage-track">
                <i style={{ width: `${usage}%` }} />
              </div>
            </div>
            <button type="button" onClick={() => closeAndRun(onRegister)}>
              Criar conta grátis
            </button>
            <button className="ghost-action" type="button" onClick={() => closeAndRun(onLogin)}>
              Entrar
            </button>
          </>
        )}
      </div>
    </details>
  );
}

function AccountSummary({
  user,
  onProfile,
  onLogout,
}: {
  user: User | null;
  onProfile: () => void;
  onLogout: () => void;
}) {
  if (!user) {
    return null;
  }

  const initials = userInitials(user);
  const { planLabel } = userPlanInfo(user);

  return (
    <section className="account-card" aria-label="Perfil do usuário">
      <button className="account-open" type="button" onClick={onProfile} aria-label="Abrir perfil">
        <span className="account-avatar">{initials}</span>
      </button>
      <button className="account-details" type="button" onClick={onProfile}>
        <span>Perfil</span>
        <strong>{user.name}</strong>
        <small>{`${planLabel} - ${user.email}`}</small>
      </button>
      <button type="button" onClick={onLogout} aria-label="Sair da conta">
        <LogOut size={18} />
      </button>
    </section>
  );
}

function TopBar({
  user,
  onMode,
  onLogin,
  onLogout,
}: {
  user: User | null;
  onMode: (mode: Mode) => void;
  onLogin: () => void;
  onLogout: () => void;
}) {
  return (
    <header className="bv-topbar">
      <span />
      <nav aria-label="Atalhos">
        {canUseAdmin(user) && (
          <button type="button" onClick={() => onMode("admin")}>
            <LayoutDashboard size={19} />
            Admin
          </button>
        )}
        <button type="button" onClick={() => onMode("support")}>
          <Headphones size={20} />
          Suporte
        </button>
        {user ? (
          <>
            <button type="button" onClick={() => onMode("profile")}>
              <UserRound size={20} />
              Perfil
            </button>
            <button type="button" onClick={onLogout}>
              <LogOut size={20} />
              Sair
            </button>
          </>
        ) : (
          <button type="button" onClick={onLogin}>
            <LogIn size={20} />
            Entrar
          </button>
        )}
      </nav>
    </header>
  );
}

function PlanStatus({
  user,
  onRegister,
  onPlans,
}: {
  user: User | null;
  onRegister: () => void;
  onPlans: () => void;
}) {
  if (!user) {
    return null;
  }

  const { planLabel, remaining, usage } = userPlanInfo(user);

  if (user.plan === "free") {
    return null;
  }

  return (
    <section className="plan-card">
      <span>Plano atual</span>
      <strong>{planLabel}</strong>
      {billingNeedsAttention(user) && <small className="billing-status-label">Pagamento pendente</small>}
      <small>Pesquisas completas restantes</small>
      <b>{remaining}</b>
      <div className="usage-track">
        <i style={{ width: `${usage}%` }} />
      </div>
      <button type="button" onClick={onPlans}>
        Ver planos
      </button>
    </section>
  );
}
function SearchPage({
  user,
  settings,
  tips,
  contacts,
  restoredSearch,
  onLoginRequired,
  onHistoryRefresh,
  onPlans,
  onCheckout,
  onTip,
}: {
  user: User | null;
  settings: SettingsMap;
  tips: Tip[];
  contacts: Contact[];
  restoredSearch: RestoredSearch | null;
  onLoginRequired: () => boolean;
  onHistoryRefresh: () => void;
  onPlans: () => void;
  onCheckout: (selection: CheckoutSelection) => void;
  onTip: (tip: Tip) => void;
}) {
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get("q")?.trim().slice(0, 160) || "");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeQuery, setActiveQuery] = useState(query);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState("");
  const resultsRef = useRef<HTMLDivElement>(null);
  const searchRunRef = useRef(0);

  const canSeeMargin = canUseAdmin(user) || (user?.plan && user.plan !== "free");

  useEffect(() => {
    if (!restoredSearch) {
      return;
    }

    setQuery(restoredSearch.query);
    setActiveQuery(restoredSearch.query);
    setResult(sanitizeClientSearchResult(restoredSearch.result, restoredSearch.query, settings));
    setError("");
    setLoading(false);
    window.setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }, [restoredSearch?.nonce, settings]);

  useEffect(() => {
    if (!loading) {
      setElapsedMs(0);
      return;
    }

    const startedAt = Date.now();
    setElapsedMs(0);
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 500);

    return () => window.clearInterval(timer);
  }, [loading]);

  const pendingStorageKey = user ? `bv_pending_search_v2_${user.id}` : "";

  const finishSearch = (data: SearchResult, cleanQuery: string) => {
    setResult(sanitizeClientSearchResult(data, cleanQuery, settings));
    setError("");
    if (pendingStorageKey) {
      localStorage.removeItem(pendingStorageKey);
    }
    onHistoryRefresh();
  };

  const pollSearch = async (pending: PendingSearch, runId: number) => {
    let pollAfterMs = Math.max(1_000, Number(pending.pollAfterMs || 1_500));
    while (searchRunRef.current === runId) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, pollAfterMs));
      if (searchRunRef.current !== runId) {
        return null;
      }
      let status: SearchStatusResponse;
      try {
        status = await api<SearchStatusResponse>(`/api/search-status/${encodeURIComponent(pending.requestId)}`);
      } catch (pollError) {
        if (pollError instanceof ApiError && [401, 402, 404].includes(pollError.status)) {
          throw pollError;
        }
        pollAfterMs = Math.min(5_000, Math.max(2_000, pollAfterMs + 500));
        continue;
      }
      if (!status.pending) {
        return status.result;
      }
      pollAfterMs = Math.max(1_000, Number(status.pollAfterMs || pollAfterMs));
    }
    return null;
  };

  useEffect(() => {
    if (!user || !pendingStorageKey) {
      return;
    }
    let saved: (PendingSearch & { startedAt?: number }) | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(pendingStorageKey) || "null");
    } catch {
      localStorage.removeItem(pendingStorageKey);
    }
    if (!saved?.requestId || Date.now() - Number(saved.startedAt || 0) > 20 * 60_000) {
      localStorage.removeItem(pendingStorageKey);
      return;
    }

    const runId = ++searchRunRef.current;
    setQuery(saved.query);
    setActiveQuery(saved.query);
    setResult(null);
    setError("");
    setLoading(true);
    pollSearch(saved, runId)
      .then((data) => {
        if (data && searchRunRef.current === runId) {
          finishSearch(data, saved?.query || "");
        }
      })
      .catch((pollError) => {
        if (searchRunRef.current !== runId) {
          return;
        }
        const reason = pollError instanceof Error ? pollError.message : "Não foi possível acompanhar a pesquisa.";
        setResult(buildUnavailableSearchResult(saved?.query || "", reason));
      })
      .finally(() => {
        if (searchRunRef.current === runId) {
          setLoading(false);
        }
      });

    return () => {
      if (searchRunRef.current === runId) {
        searchRunRef.current += 1;
      }
    };
  }, [user?.id]);

  const submitSearch = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!onLoginRequired()) {
      return;
    }
    if (billingNeedsAttention(user)) {
      setError("Seu pagamento mensal está pendente. Regularize a cobrança para continuar pesquisando.");
      return;
    }

    const cleanQuery = query.trim();
    if (!cleanQuery) {
      setError("Digite o produto que deseja validar.");
      return;
    }

    setActiveQuery(cleanQuery);
    const runId = ++searchRunRef.current;
    setLoading(true);
    setError("");
    setResult(null);
    window.setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    const minimumFeedback = new Promise<void>((resolve) => window.setTimeout(resolve, 1800));
    try {
      const data = await api<SearchResult | PendingSearch>("/api/search", {
        method: "POST",
        body: JSON.stringify({ q: cleanQuery }),
      });
      if (isPendingSearch(data)) {
        if (pendingStorageKey) {
          localStorage.setItem(pendingStorageKey, JSON.stringify({ ...data, startedAt: Date.now() }));
        }
        const completed = await pollSearch(data, runId);
        if (completed && searchRunRef.current === runId) {
          finishSearch(completed, cleanQuery);
        }
      } else {
        await minimumFeedback;
        if (searchRunRef.current === runId) {
          finishSearch(data, cleanQuery);
        }
      }
    } catch (apiError) {
      await minimumFeedback;
      if (apiError instanceof ApiError && [401, 402].includes(apiError.status)) {
        setError(apiError.message);
        return;
      }
      const reason = apiError instanceof Error ? apiError.message : "Nao foi possivel buscar agora.";
      setResult(buildUnavailableSearchResult(cleanQuery, `${reason} Não vou exibir estimativas: o Busca Vendas só mostra dados reais dos anúncios.`));
      setError("");
    } finally {
      if (searchRunRef.current === runId) {
        setLoading(false);
      }
    }
  };

  return (
    <div className="bv-page">
      <section className="search-heading">
        <h1>Descubra o potencial de vendas do seu produto na internet</h1>
        <p>Veja quanto os anúncios campeões já venderam e encontre sua oportunidade nesse mercado.</p>
      </section>

      <form className="hero-search" onSubmit={submitSearch}>
        <Search size={23} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Digite seu produto aqui" />
        <button className={loading ? "loading" : ""} type="submit" disabled={loading}>
          {loading ? <span className="button-spinner" aria-hidden="true" /> : <Search size={20} />}
          {loading ? "Validando mercado" : "Buscar demanda"}
        </button>
      </form>

      <div className="examples-row">
        <strong>Exemplos:</strong>
        {["fone bluetooth", "cafeteira elétrica", "mochila masculina"].map((example) => (
          <button key={example} type="button" onClick={() => setQuery(example)}>
            {example}
          </button>
        ))}
      </div>

      {billingNeedsAttention(user) && (
        <section className="billing-alert" role="alert">
          <div>
            <CreditCard size={22} />
            <span>
              <strong>Pagamento mensal pendente</strong>
              Regularize a cobrança para liberar suas pesquisas novamente.
            </span>
          </div>
          {user?.billing_payment_url ? (
            <a href={user.billing_payment_url} target="_blank" rel="noreferrer">
              Regularizar pagamento
            </a>
          ) : (
            <button type="button" onClick={onPlans}>Ver planos</button>
          )}
        </section>
      )}

      <div className="results-anchor" ref={resultsRef}>
        {error && <p className="inline-error">{error}</p>}
        {Boolean(result?.ok && result.items.length) && (
          <DemandCard result={result} locked={!canSeeMargin} onPlans={onPlans} />
        )}
        <section className="search-grid">
          <div className="left-stack">
            <ResultsPanel
              query={activeQuery}
              result={result}
              loading={loading}
              elapsedMs={elapsedMs}
              contacts={contacts}
              canSeeMargin={Boolean(canSeeMargin)}
              onPlans={onPlans}
            />
            {Boolean(result?.ok && result.items.length && !canSeeMargin) && (
              <PlansPreview settings={settings} onSelectPlan={onCheckout} />
            )}
            <LearnPreview tips={tips} onTip={onTip} />
          </div>
          <aside className="right-stack">
            <CommercialMini contacts={contacts} settings={settings} />
          </aside>
        </section>
      </div>
    </div>
  );
}

function whatsappHref(contacts: Contact[], query: string, salesPotential: number, itemCount: number, emergingMode = false) {
  const contact = contacts.find((item) => /whats/i.test(item.channel)) || contacts[0];
  const digits = (contact?.value || "").replace(/\D/g, "");
  const phone = digits.startsWith("55") ? digits : digits ? `55${digits}` : "5511999999999";
  const message = [
    `Olá, Confweb! Pesquisei "${query}" no Busca Vendas.`,
    emergingMode
      ? `Encontrei um mercado ainda pouco explorado, com ${money.format(salesPotential)} movimentados pelos ${itemCount} anúncios analisados.`
      : `Vi potencial de ${money.format(salesPotential)} nos ${itemCount} anúncios líderes.`,
    "Quero ajuda para vender nos marketplaces.",
  ].join(" ");

  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function contactHref(contact: Contact) {
  const channel = contact.channel.toLowerCase();
  const value = contact.value.trim();

  if (/whats|telefone|phone|celular/.test(channel)) {
    const digits = value.replace(/\D/g, "");
    const phone = digits.startsWith("55") ? digits : digits ? `55${digits}` : "";
    return phone ? `https://wa.me/${phone}` : "";
  }

  if (/e-?mail|email/.test(channel) || value.includes("@")) {
    return `mailto:${value}`;
  }

  if (/site|web|url|link/.test(channel) || /^https?:\/\//i.test(value) || /^www\./i.test(value)) {
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  }

  return "";
}

function contactDisplayValue(contact: Contact) {
  return contact.value.replace(/^https?:\/\//i, "");
}

function externalHref(value: string, fallback = "") {
  const normalized = value.trim();
  const candidate = /^www\./i.test(normalized) ? `https://${normalized}` : normalized;

  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function ResultsPanel({
  query,
  result,
  loading = false,
  elapsedMs = 0,
  contacts,
  canSeeMargin,
  onPlans,
}: {
  query: string;
  result: SearchResult | null;
  loading?: boolean;
  elapsedMs?: number;
  contacts: Contact[];
  canSeeMargin: boolean;
  onPlans: () => void;
}) {
  const marketUrl = `https://lista.mercadolivre.com.br/${encodeURIComponent(query)}`;
  const items = result?.items ?? [];
  const hasItems = items.length > 0;
  const marketSignalMode = result?.metricsMode === "market_signal" || result?.salesAvailable === false;
  const officialCatalogModeResult = result?.source === "mercado_livre_catalog_champions";
  const scrapeDoModeResult = result?.source === "scrapedo_mercado_livre";
  const zyteModeResult = result?.source === "zyte_mercado_livre";
  const scrapeDoFailure = Boolean(result?.source?.startsWith("scrapedo_"));
  const zyteFailure = Boolean(result?.source?.startsWith("zyte_"));
  const oxylabsModeResult = result?.source === "oxylabs_mercado_livre";
  const proxyModeResult = result?.source === "mercado_livre_proxy";
  const scraperModeResult = result?.source === "mercado_livre_scraper";
  const cacheModeResult = result?.source === "confweb_cache";
  const marketplaceModeResult = result?.source === "mercado_livre";
  const estimateMode = result?.source === "market_estimate";
  const emergingMode = result?.opportunityMode === "emerging";
  const developingMode = result?.opportunityMode === "developing";
  const marketThreshold = result?.marketThreshold || 1000;
  const salesPotential = result?.totals.revenue || 0;
  const commercialHref = whatsappHref(contacts, query, salesPotential, items.length, emergingMode || developingMode);
  const sourceText = estimateMode
    ? "Fonte: raio-x estratégico Confweb - sem API"
    : result
    ? result.ok
      ? officialCatalogModeResult
        ? "Fonte: catálogo e ranking oficial do Mercado Livre"
        : scrapeDoModeResult
        ? "Fonte: Mercado Livre"
        : zyteModeResult
        ? "Fonte: Mercado Livre via Zyte"
        : oxylabsModeResult
        ? "Fonte: Mercado Livre via Oxylabs"
        : cacheModeResult
        ? "Fonte: Mercado Livre"
        : proxyModeResult
        ? "Fonte: Motor Confweb"
        : scraperModeResult
        ? "Fonte: Motor Confweb"
        : marketplaceModeResult
        ? "Fonte: Mercado Livre"
        : marketSignalMode
        ? "Fonte: Mercado Livre - página pública"
        : "Fonte: Mercado Livre - atualizado agora"
      : result.source === "meli_forbidden"
        ? "Fonte: Mercado Livre - API aguardando liberação"
        : scrapeDoFailure
          ? "Fonte: Mercado Livre"
        : zyteFailure
          ? "Fonte: Mercado Livre via Zyte - consulta indisponível"
        : result.source === "market_data_pending"
          ? "Fonte: validação em andamento"
        : "Fonte: Mercado Livre - integração pendente"
    : "Fonte: Mercado Livre - aguardando pesquisa";
  const emptyHelp = result?.source === "meli_forbidden"
    ? "A conexão OAuth está válida. Para vendas reais por anúncio, precisamos da liberação oficial da API de Search ou de um provedor autorizado."
    : scrapeDoFailure
      ? "A pesquisa não foi consumida. Tente novamente em instantes."
    : zyteFailure
      ? "A pesquisa não foi consumida. Tente novamente mais tarde enquanto a fonte de dados conclui a validação dos anúncios."
    : result?.source === "market_data_pending"
      ? "Assim que a fonte oficial retornar, você verá anúncios, demanda, ticket médio e margem com dados completos."
    : result
      ? "O Busca Vendas não mostra números simulados: use somente dados liberados pelo Mercado Livre."
      : "Entre com sua conta e busque um produto para consultar demanda, preço e concorrência.";

  return (
    <section className="market-panel">
      <div className="panel-head">
        <div>
          <h2>{estimateMode ? "Raio-x de oportunidade" : emergingMode || developingMode ? `${items.length} ${items.length === 1 ? "líder" : "líderes"} deste mercado` : "Top 3 anúncios campeões"}</h2>
          <p>{sourceText}</p>
        </div>
        <a href={marketUrl} target="_blank" rel="noreferrer">
          Ver mercado
          <ChevronRight size={18} />
        </a>
      </div>

      {loading && <SearchProgress query={query} elapsedMs={elapsedMs} />}

      {!loading && !hasItems && (
        <div className={`market-empty ${result && !result.ok ? "warning" : ""}`}>
          <PackageSearch size={34} />
          <strong>
            {result
              ? "Não foi possível concluir esta análise agora. Sua pesquisa não foi consumida."
              : "Pesquise seu produto e descubra o tamanho dessa oportunidade."}
          </strong>
          <p>{result ? "Tente novamente em instantes. Seus resultados só serão liberados quando os dados estiverem completos." : emptyHelp}</p>
        </div>
      )}

      {!loading && hasItems && (
        <div className="result-list">
          {items.map((item, index) => (
            <article className="result-row" key={item.id}>
              <div className="result-main">
              <span className="rank">{index + 1}</span>
              <img src={item.image} alt="" />
              <div className="product-copy">
                <h3>{item.title}</h3>
              <p>{item.subtitle || "Anúncio ativo no Mercado Livre"}</p>
              </div>
              <Metric
                label={estimateMode ? "Venda estimada" : "Qtd. vendas"}
                value={formatCountOrLabel(item.soldQuantity, item.salesMetricLabel)}
                variant="sales"
              />
              <Metric label="Preço" value={money.format(item.price)} variant="price" />
              <Metric
                label={estimateMode ? "Receita projetada" : "Receita gerada"}
                value={formatMoneyOrLabel(item.revenue, item.revenueMetricLabel)}
                variant="revenue"
              />
              <a className="ad-link" href={item.permalink} target="_blank" rel="noreferrer">
                Ver anúncio no Mercado Livre
              </a>
              </div>
              <ProductMarginCard item={item} locked={!canSeeMargin} onPlans={onPlans} />
            </article>
          ))}
          <div className={`market-cta ${emergingMode ? "emerging-market-cta" : ""}`}>
            <div>
              <strong>
                {emergingMode
                  ? "Você encontrou um mercado com espaço para se destacar."
                  : <>Seu produto tem potencial{estimateMode ? " estimado" : ""}: {money.format(salesPotential)} em vendas.</>}
              </strong>
              <p>
                {!canSeeMargin
                  ? emergingMode
                    ? `Existem compradores, mas nenhum líder analisado passou de ${number.format(marketThreshold)} vendas. Teste seu preço e calcule seu ganho antes de investir.`
                    : "Você já viu que existem compradores. Libere o cálculo completo e descubra quanto pode ganhar por venda."
                  : estimateMode
                    ? "Use este raio-x como triagem inicial. Quando a leitura real responder, exibimos os anúncios e vendas públicas."
                    : emergingMode
                      ? `Na amostra analisada, nenhum anúncio passou de ${number.format(marketThreshold)} vendas. Uma oferta melhor posicionada pode conquistar espaço, mas valide preço e divulgação antes de investir.`
                    : "Bora pegar uma fatia desse mercado? Venda nos maiores marketplaces do Brasil com a Confweb."}
              </p>
            </div>
            {!canSeeMargin ? (
              <button type="button" onClick={onPlans}>
                <UnlockKeyhole size={18} />
                Quero calcular meu ganho
              </button>
            ) : (
              <a href={commercialHref} target="_blank" rel="noreferrer">
                Falar com a Confweb
                <MessageCircle size={18} />
              </a>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function SearchProgress({ query, elapsedMs }: { query: string; elapsedMs: number }) {
  const seconds = Math.floor(elapsedMs / 1000);
  const currentStep = Math.min(searchSteps.length - 1, Math.floor(seconds / 8));
  const progress = Math.min(94, 10 + seconds * 2.2);
  const statusText =
    seconds < 12
      ? "Conectando com o Mercado Livre e buscando os 3 anúncios campeões."
      : seconds < 28
        ? "Comparando títulos para evitar produto parecido ou medida errada."
        : "Buscando mais fundo para completar o Top 3 somente com vendas públicas reais.";

  return (
    <div className="search-progress" role="status" aria-live="polite">
      <div className="progress-top">
        <span className="progress-orbit" aria-hidden="true">
          <Search size={24} />
        </span>
        <div>
          <strong>Validando "{query}"</strong>
          <p>{statusText}</p>
        </div>
        <b>{seconds}s</b>
      </div>
      <div className="progress-track" aria-hidden="true">
        <i style={{ width: `${progress}%` }} />
      </div>
      <ol className="progress-steps">
        {searchSteps.map((step, index) => (
          <li className={index < currentStep ? "done" : index === currentStep ? "active" : ""} key={step}>
            <span>{index + 1}</span>
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}

function ProductMarginCard({ item, locked, onPlans }: { item: MarketplaceItem; locked: boolean; onPlans: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [costInput, setCostInput] = useState("");
  const [manualCost, setManualCost] = useState(0);
  const [calculated, setCalculated] = useState(false);
  const [listingType, setListingType] = useState<MercadoLivreListingType>("classic");
  const estimate = useMemo(
    () => buildProductMarginEstimate(item, manualCost, listingType),
    [item, listingType, manualCost],
  );

  const calculate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setManualCost(parseCurrencyInput(costInput));
    setCalculated(true);
  };

  return (
    <div className={`product-margin-card ${expanded ? "expanded" : ""} ${locked ? "locked" : ""}`}>
      <button
        className="product-margin-title"
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
      >
        <LineChart size={18} />
        <strong>Quanto ganho neste produto?</strong>
        {locked && <span>Veja seu ganho</span>}
        <ChevronRight className="margin-chevron" size={18} />
      </button>

      {expanded && locked && (
        <div className="product-margin-locked">
          <Lock size={22} />
          <div>
            <strong>Descubra quanto pode sobrar para você</strong>
            <span>Veja as taxas do Mercado Livre e simule seu custo para saber quanto pode ganhar em cada venda.</span>
          </div>
          <button type="button" onClick={onPlans}>
            <CreditCard size={17} />
            Quero ver meu ganho
          </button>
        </div>
      )}

      {expanded && !locked && (
        <>
          <div className="listing-type-control">
            <span>Tipo do anúncio</span>
            <div role="group" aria-label="Tipo do anúncio no Mercado Livre">
              <button
                className={listingType === "classic" ? "active" : ""}
                type="button"
                onClick={() => setListingType("classic")}
              >
                Clássico
              </button>
              <button
                className={listingType === "premium" ? "active" : ""}
                type="button"
                onClick={() => setListingType("premium")}
              >
                Premium
              </button>
            </div>
          </div>

          <div className="margin-grid">
            <SimpleMarginStat
              label={estimate.officialFee ? "Comissão oficial" : "Comissão estimada"}
              value={money.format(estimate.commission)}
              hint={`${estimate.marketplaceRate.toFixed(1).replace(".", ",")}% sobre o preço${estimate.officialFee ? " • Mercado Livre" : ""}`}
            />
            <SimpleMarginStat
              label="Tarifa fixa"
              value={money.format(estimate.fixedFee)}
              hint={estimate.fixedFee > 0 ? "conforme a faixa de preço" : "não se aplica nesta faixa"}
            />
            <SimpleMarginStat
              label={estimate.officialShipping ? "Frete cotado" : "Frete estimado"}
              value={money.format(estimate.shippingFee)}
              hint={estimate.shippingLabel}
            />
            <SimpleMarginStat label="Total descontado" value={money.format(estimate.totalMarketplaceFees)} />
            <SimpleMarginStat
              label="Você recebe sem custo"
              value={money.format(estimate.marginBeforeCost)}
              hint={marginHint(estimate.marginBeforeCost, estimate.percentBeforeCost, "antes do custo do produto")}
              highlight
            />
          </div>

          <form className="cost-calculator" onSubmit={calculate}>
            <label>
              Preencha seu custo para ver quanto sobra nessa venda
              <input
                inputMode="decimal"
                value={costInput}
                onChange={(event) => setCostInput(event.target.value)}
                placeholder="Ex: 32,50"
              />
            </label>
            <button type="submit">Calcular</button>
          </form>

          <div className="margin-result">
            <span>{calculated ? "Depois do seu custo" : "Sem custo preenchido"}</span>
            <strong>{money.format(calculated ? estimate.marginAfterCost : estimate.marginBeforeCost)}</strong>
            <small>
              {calculated && estimate.marginAfterCost === 0
                ? "Sem sobra nesse custo"
                : estimate.category}
            </small>
          </div>
        </>
      )}
    </div>
  );
}

function SimpleMarginStat({
  label,
  value,
  hint,
  highlight = false,
}: {
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div className={highlight ? "simple-margin-stat highlight" : "simple-margin-stat"}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function Metric({
  label,
  value,
  variant = "default",
  locked = false,
  onUnlock,
}: {
  label: string;
  value: string;
  variant?: "default" | "sales" | "price" | "revenue";
  locked?: boolean;
  onUnlock?: () => void;
}) {
  if (locked) {
    return (
      <button className={`metric metric-${variant} metric-locked`} type="button" onClick={onUnlock}>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>Ver valor completo</small>
        <Lock size={14} aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className={`metric ${variant !== "default" ? `metric-${variant}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function buildProductMarginEstimate(
  item: MarketplaceItem,
  manualCost: number,
  listingType: MercadoLivreListingType,
): MarginEstimate {
  const profile = inferMarketplaceProfile(`${item.categoryName || ""} ${item.title}`);
  const category = item.categoryName || profile.category;
  const estimatedWeightKg = resolveProductWeightKg(
    item.weightKg,
    profile.weightKg,
    item.shippingDimensions,
  );
  const officialFee = item.marketplaceFees?.[listingType];
  const marketplaceRate = officialFee?.percentageFee
    ?? (listingType === "premium" ? profile.premiumRate : profile.classicRate);
  const fixedFee = officialFee?.fixedFee ?? estimateMercadoLivreFixedFee(item.price);
  const commission = officialFee
    ? Math.max(0, officialFee.saleFeeAmount - fixedFee)
    : item.price * (marketplaceRate / 100);
  const officialShipping = item.shippingQuote?.source === "mercado_livre_official";
  const shippingFee = officialShipping
    ? Number(item.shippingQuote?.amount || 0)
    : estimateMercadoLivreShippingFee(item.price, estimatedWeightKg);
  const saleFees = officialFee?.saleFeeAmount ?? commission + fixedFee;
  const totalMarketplaceFees = saleFees + shippingFee;
  const rawMarginBeforeCost = item.price - totalMarketplaceFees;
  const rawMarginAfterCost = rawMarginBeforeCost - manualCost;
  const marginBeforeCost = Math.max(0, rawMarginBeforeCost);
  const marginAfterCost = Math.max(0, rawMarginAfterCost);

  return {
    category,
    shippingLabel: officialShipping
      ? officialShippingLabel(item.shippingQuote)
      : mercadoLivreShippingLabel(item.price, estimatedWeightKg),
    estimatedWeightKg,
    marketplaceRate,
    commission,
    fixedFee,
    shippingFee,
    totalMarketplaceFees,
    marginBeforeCost,
    marginAfterCost,
    percentBeforeCost: item.price ? (marginBeforeCost / item.price) * 100 : 0,
    percentAfterCost: item.price ? (marginAfterCost / item.price) * 100 : 0,
    officialFee: Boolean(officialFee),
    officialShipping,
  };
}

function officialShippingLabel(quote: MarketplaceItem["shippingQuote"]) {
  const inputWeight = Number(quote?.inputWeightKg || 0);
  const weight = inputWeight > 0 ? inputWeight : Number(quote?.billableWeightKg || 0);
  const prefix = quote?.calculationMode === "sale_simulation"
    ? "cotação oficial para vender"
    : "cotação oficial pré-venda";
  return weight > 0
    ? `${prefix} • ${formatWeight(weight)}`
    : prefix;
}

function estimateMercadoLivreFixedFee(price: number) {
  if (price < 12.5) return price / 2;
  if (price <= 29) return 6.25;
  if (price <= 50) return 6.5;
  if (price < 79) return 6.75;
  return 0;
}

function estimateMercadoLivreShippingFee(price: number, weightKg: number) {
  if (price < 79) {
    return 0;
  }
  const priceColumn = mercadoLivreShippingPriceColumn(price);
  const row = mercadoLivreShippingTable.find((item) => weightKg <= item.maxKg)
    || mercadoLivreShippingTable[mercadoLivreShippingTable.length - 1];
  return row.values[priceColumn];
}

function mercadoLivreShippingLabel(price: number, weightKg: number) {
  if (price < 79) {
    return "sem frete grátis obrigatório";
  }
  return `Tabela Mercado Livre • faixa de ${formatWeight(weightKg)}`;
}

function mercadoLivreShippingPriceColumn(price: number) {
  if (price < 100) return 0;
  if (price < 120) return 1;
  if (price < 150) return 2;
  if (price < 200) return 3;
  return 4;
}

function resolveProductWeightKg(
  weightKg: number | null | undefined,
  fallbackWeightKg: number,
  shippingDimensions = "",
) {
  const parsedWeight = Number(weightKg);
  if (!Number.isFinite(parsedWeight) || parsedWeight < 0.05) {
    return fallbackWeightKg;
  }
  if (!shippingDimensions && fallbackWeightKg >= 5 && parsedWeight > fallbackWeightKg * 2) {
    return fallbackWeightKg;
  }
  return Math.min(parsedWeight, 30);
}

function marginHint(value: number, percent: number, suffix: string) {
  if (value <= 0) {
    return "sem sobra nessa venda";
  }
  return `${percent.toFixed(1).replace(".", ",")}% ${suffix}`;
}

function inferMarketplaceProfile(title: string) {
  const normalized = normalizeSearchText(title);
  if (hasAny(normalized, ["creatina", "whey", "suplemento", "vitamina", "maca peruana", "capsula", "proteina"])) {
    return { category: "Suplementos", classicRate: 12, premiumRate: 17, weightKg: 1.1 };
  }
  if (hasAny(normalized, ["escrivaninha", "mesa de escritorio", "mesa home office", "mesa de computador"])) {
    return { category: "Móveis", classicRate: 12, premiumRate: 17, weightKg: 8 };
  }
  if (hasAny(normalized, ["buque", "bouquet", "rosa", "flor", "arranjo floral", "flor artificial"])) {
    return { category: "Casa e decoração", classicRate: 12, premiumRate: 17, weightKg: 0.3 };
  }
  if (hasAny(normalized, ["mochila", "bolsa", "mala"])) {
    return { category: "Moda", classicRate: 14, premiumRate: 19, weightKg: 0.8 };
  }
  if (hasAny(normalized, ["fone", "headphone", "earbud", "bluetooth", "caixa de som", "speaker"])) {
    return { category: "Tecnologia", classicRate: 11, premiumRate: 16, weightKg: 0.35 };
  }
  if (hasAny(normalized, ["cafeteira", "liquidificador", "batedeira", "air fryer", "panela"])) {
    return { category: "Casa e decoração", classicRate: 12, premiumRate: 17, weightKg: 2 };
  }
  if (hasAny(normalized, ["tenis", "camiseta", "calca", "bermuda", "roupa"])) {
    return { category: "Moda", classicRate: 14, premiumRate: 19, weightKg: 0.5 };
  }
  if (hasAny(normalized, ["celular", "smartphone", "iphone", "android"])) {
    return { category: "Celulares e smartphones", classicRate: 11, premiumRate: 16, weightKg: 0.5 };
  }
  if (hasAny(normalized, ["shampoo", "perfume", "cosmetico", "maquiagem", "barbeador"])) {
    return { category: "Cuidados pessoais", classicRate: 12, premiumRate: 17, weightKg: 0.5 };
  }
  if (hasAny(normalized, ["furadeira", "parafusadeira", "serra", "ferramenta"])) {
    return { category: "Ferramentas", classicRate: 12, premiumRate: 17, weightKg: 2 };
  }
  if (hasAny(normalized, ["caderno", "caneta", "lapis", "papel", "papelaria"])) {
    return { category: "Papelaria", classicRate: 11.5, premiumRate: 16.5, weightKg: 0.5 };
  }
  if (hasAny(normalized, ["cachorro", "gato", "pet", "racao"])) {
    return { category: "Pet", classicRate: 14, premiumRate: 19, weightKg: 1 };
  }
  if (hasAny(normalized, ["brinquedo", "boneca", "carrinho", "jogo infantil"])) {
    return { category: "Brinquedos", classicRate: 11.5, premiumRate: 16.5, weightKg: 0.8 };
  }
  if (hasAny(normalized, ["bebe", "fralda", "mamadeira", "chupeta"])) {
    return { category: "Bebês", classicRate: 11.5, premiumRate: 16.5, weightKg: 0.8 };
  }
  if (hasAny(normalized, ["violao", "guitarra", "teclado musical", "instrumento musical"])) {
    return { category: "Instrumentos musicais", classicRate: 11.5, premiumRate: 16.5, weightKg: 2 };
  }
  if (hasAny(normalized, ["bicicleta", "bike", "ciclismo"])) {
    return { category: "Bicicletas", classicRate: 11.5, premiumRate: 16.5, weightKg: 15 };
  }
  if (hasAny(normalized, ["automotivo", "carro", "moto", "pneu", "capacete"])) {
    return { category: "Automotivo", classicRate: 13, premiumRate: 18, weightKg: 2 };
  }
  return { category: "Categoria estimada", classicRate: 14, premiumRate: 19, weightKg: 1 };
}

const mercadoLivreShippingTable = [
  { maxKg: 0.3, values: [12.35, 14.35, 16.45, 18.45, 20.95] },
  { maxKg: 0.5, values: [13.25, 15.45, 17.65, 19.85, 22.55] },
  { maxKg: 1, values: [13.85, 16.15, 18.45, 20.75, 23.65] },
  { maxKg: 1.5, values: [14.15, 16.45, 18.85, 21.15, 24.65] },
  { maxKg: 2, values: [14.45, 16.85, 19.25, 21.65, 24.65] },
  { maxKg: 3, values: [15.75, 18.35, 21.05, 23.65, 26.25] },
  { maxKg: 4, values: [17.05, 19.85, 22.65, 25.55, 28.35] },
  { maxKg: 5, values: [18.45, 21.55, 24.65, 27.75, 30.75] },
  { maxKg: 6, values: [25.45, 28.55, 32.65, 35.75, 39.75] },
  { maxKg: 7, values: [27.05, 31.05, 36.05, 40.05, 44.05] },
  { maxKg: 8, values: [28.85, 33.65, 38.45, 43.25, 48.05] },
  { maxKg: 9, values: [29.65, 34.55, 39.55, 44.45, 49.35] },
  { maxKg: 11, values: [41.25, 48.05, 54.95, 61.75, 68.65] },
  { maxKg: 13, values: [42.15, 49.25, 56.25, 63.25, 70.25] },
  { maxKg: 15, values: [45.05, 52.45, 59.95, 67.45, 74.95] },
  { maxKg: 17, values: [48.55, 56.05, 63.55, 70.75, 78.65] },
  { maxKg: 20, values: [54.75, 63.85, 72.95, 82.05, 91.15] },
  { maxKg: 25, values: [64.05, 75.05, 84.75, 95.35, 105.95] },
  { maxKg: Number.POSITIVE_INFINITY, values: [65.95, 75.45, 85.55, 96.25, 106.95] },
];

function formatWeight(weightKg: number) {
  if (weightKg < 1) {
    return `${Math.round(weightKg * 1000)} g`;
  }
  return `${weightKg.toFixed(1).replace(".", ",")} kg`;
}

function hasAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function parseCurrencyInput(value: string) {
  const normalized = value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatCountOrLabel(value: number | null | undefined, fallback = "Não divulgado") {
  if (typeof value === "number") {
    return number.format(value);
  }
  return fallback;
}

function formatMoneyOrLabel(value: number | null | undefined, fallback = "Aguardando API") {
  if (typeof value === "number") {
    return money.format(value);
  }
  return fallback;
}

function DemandCard({
  result,
  locked,
  onPlans,
}: {
  result: SearchResult | null;
  locked: boolean;
  onPlans: () => void;
}) {
  const championCount = result?.items?.length || 0;
  const estimateMode = result?.source === "market_estimate";
  const emergingMode = result?.opportunityMode === "emerging";
  const developingMode = result?.opportunityMode === "developing";
  const marketThreshold = result?.marketThreshold || 1000;
  const totalRevenue = result?.totals.revenue || 0;

  return (
    <section className={`demand-card opportunity-card ${emergingMode ? "emerging-opportunity" : ""} ${developingMode ? "developing-opportunity" : ""} ${locked ? "opportunity-locked" : ""}`}>
      <div className="opportunity-heading">
        <span className="opportunity-icon"><TrendingUp size={27} /></span>
        <div>
          <span className="opportunity-kicker">{emergingMode ? "Mercado ainda pouco explorado" : developingMode ? "Mercado em crescimento" : "O mercado já está acontecendo"}</span>
          <h2>{emergingMode ? "Há espaço para construir uma posição forte" : developingMode ? "Já existem compradores e espaço para crescer" : "Olha o tamanho dessa oportunidade"}</h2>
          <p>
            {emergingMode
              ? `Entre os anúncios reais analisados, nenhum passou de ${number.format(marketThreshold)} vendas. Isso pode indicar uma categoria menos consolidada e espaço para uma oferta bem posicionada.`
              : developingMode
                ? "Encontramos vendas reais em diferentes estágios. Uma oferta bem posicionada pode disputar espaço com quem já vende neste mercado."
              : `Somando apenas os ${championCount} anúncios campeões encontrados.`}
          </p>
        </div>
      </div>
      <dl className="opportunity-metrics">
        <div className="opportunity-metric sales">
          <dt>{estimateMode ? "Vendas projetadas" : emergingMode || developingMode ? "Vendas dos líderes" : "Vendas dos campeões"}</dt>
          <dd>{number.format(result?.totals.demand || 0)}</dd>
          <small>pessoas já compraram</small>
        </div>
        <div className="opportunity-metric revenue">
          <dt>{estimateMode ? "Receita projetada" : "Dinheiro movimentado"}</dt>
          <dd>{money.format(totalRevenue)}</dd>
          <small>somado nos {championCount} anúncios</small>
        </div>
        <div className="opportunity-metric ticket">
          <dt>Preço médio vendido</dt>
          <dd>{money.format(result?.totals.averageTicket || 0)}</dd>
          <small>referência para sua oferta</small>
        </div>
        <div className="opportunity-metric champions">
          <dt>{estimateMode ? "Cenários analisados" : emergingMode || developingMode ? "Líderes analisados" : "Anúncios campeões"}</dt>
          <dd>{number.format(championCount)}</dd>
          <small>{emergingMode || developingMode ? "com vendas públicas reais" : "com vendas comprovadas"}</small>
        </div>
      </dl>
      {locked && (
        <button className="opportunity-unlock" type="button" onClick={onPlans}>
          <UnlockKeyhole size={18} />
          Desbloquear cálculo de ganho por produto
          <ChevronRight size={18} />
        </button>
      )}
    </section>
  );
}
function PlansPreview({ settings, onSelectPlan }: { settings: SettingsMap; onSelectPlan: (selection: CheckoutSelection) => void }) {
  const starterPricing = planPricing(settings, "starter");
  const scalePricing = planPricing(settings, "scale");

  return (
    <section className="wide-panel plans-preview">
      <div>
        <h2>Você já encontrou compradores. Agora descubra quanto pode ganhar.</h2>
        <p>Revele o faturamento completo, as taxas e quanto sobra por venda para validar outros produtos com segurança.</p>
      </div>
      <div className="mini-plan-grid">
        <MiniPlan title="10 pesquisas" price={money.format(starterPricing.monthly)} note={`Anual ${money.format(starterPricing.yearly)} • Pix ou cartão`} onClick={() => onSelectPlan({ plan: "starter", cycle: "monthly" })} />
        <MiniPlan title="Ilimitado" price={money.format(scalePricing.monthly)} note={`Anual ${money.format(scalePricing.yearly)} • Pix ou cartão`} featured onClick={() => onSelectPlan({ plan: "scale", cycle: "monthly" })} />
      </div>
    </section>
  );
}

function MiniPlan({ title, price, note, featured = false, onClick }: { title: string; price: string; note: string; featured?: boolean; onClick: () => void }) {
  return (
    <button className={featured ? "mini-plan featured" : "mini-plan"} type="button" onClick={onClick}>
      <span>{title}</span>
      <strong>{price}<small>/mês</small></strong>
      <p>{note}</p>
    </button>
  );
}

function LearnPreview({ tips, onTip }: { tips: Tip[]; onTip: (tip: Tip) => void }) {
  return (
    <section className="wide-panel learn-preview">
      <div className="panel-head compact">
        <div>
          <h2>Aprenda a vender online com menos risco</h2>
          <p>Cards de educação e nutrição para quem está começando.</p>
        </div>
      </div>
      <div className="learn-grid">
        {tips.slice(0, 3).map((tip) => (
          <button className="learn-card" key={tip.id} type="button" onClick={() => onTip(tip)}>
            <BookOpen size={22} />
            <strong>{tip.title}</strong>
            <p>{tip.body}</p>
            <span>{tip.cta || "Ler artigo"} <ChevronRight size={16} /></span>
          </button>
        ))}
      </div>
    </section>
  );
}

function CommercialMini({ contacts, settings }: { contacts: Contact[]; settings: SettingsMap }) {
  const supportContact = contacts.find((contact) => /whats/i.test(contact.channel))
    || contacts.find((contact) => Boolean(contactHref(contact)));
  const supportHref = supportContact ? contactHref(supportContact) : "";
  const siteContact = contacts.find((contact) => /site|web|url|link/i.test(contact.channel));
  const fallbackTrainingUrl = siteContact ? contactHref(siteContact) : "https://www.confweb.com.br";
  const trainingUrl = externalHref(settings.commercial_training_url || "", fallbackTrainingUrl);

  return (
    <section className="commercial-mini commercial-training-card">
      <span className="commercial-training-kicker">
        <Rocket size={18} />
        {settings.commercial_training_eyebrow || defaultSettings.commercial_training_eyebrow}
      </span>
      <h2>{settings.commercial_training_title || defaultSettings.commercial_training_title}</h2>
      <p className="commercial-training-copy">
        {settings.commercial_training_body || defaultSettings.commercial_training_body}
      </p>
      <a className="commercial-training-link" href={trainingUrl} target="_blank" rel="noreferrer">
        {settings.commercial_training_button || defaultSettings.commercial_training_button}
        <ChevronRight size={18} />
      </a>
      <div className="commercial-support-row">
        <MessageCircle size={18} />
        <span>{settings.commercial_support_text || defaultSettings.commercial_support_text}</span>
        {supportHref && (
          <a href={supportHref} target="_blank" rel="noreferrer">
            {settings.commercial_support_button || defaultSettings.commercial_support_button}
          </a>
        )}
      </div>
    </section>
  );
}

function HistoryPage({
  user,
  history,
  onLoginRequired,
  onViewSearch,
}: {
  user: User | null;
  history: HistoryRecord[];
  onLoginRequired: () => boolean;
  onViewSearch: (record: HistoryRecord) => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  if (!user) {
    return <AccessPrompt title="Entre para ver suas pesquisas" onLoginRequired={onLoginRequired} />;
  }

  const viewSearch = async (record: HistoryRecord) => {
    setBusyId(record.id);
    setError("");
    try {
      await onViewSearch(record);
    } catch (apiError) {
      setError(apiError instanceof Error ? apiError.message : "Não foi possível abrir essa pesquisa.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="bv-page simple-page">
      <h1>Minhas pesquisas</h1>
      <p>Histórico real salvo na sua conta.</p>
      {error && <p className="inline-error">{error}</p>}
      <div className="table-list">
        {history.length ? history.map((record) => (
          <article className="history-row" key={record.id}>
            <div>
              <strong>{record.query}</strong>
              <span>{historySourceLabel(record.source)}</span>
            </div>
            <b>{number.format(record.total_demand)} vendas</b>
            <b>{money.format(record.total_revenue)}</b>
            <small>{new Date(record.created_at).toLocaleString("pt-BR")}</small>
            <button type="button" onClick={() => viewSearch(record)} disabled={busyId === record.id}>
              {busyId === record.id ? "Abrindo..." : "Ver pesquisa"}
            </button>
          </article>
        )) : <p className="muted-box">Você ainda não fez pesquisas.</p>}
      </div>
    </section>
  );
}

function historySourceLabel(source: string) {
  if (source === "confweb_cache" || source?.includes("cache")) {
    return "Mercado Livre";
  }
  if (
    source?.startsWith("mercado_livre")
    || source?.includes("scrapedo")
    || source?.includes("zyte")
    || source?.includes("oxylabs")
  ) {
    return "Mercado Livre";
  }
  return "Resultado salvo";
}

function PlansPage({
  user,
  settings,
  onSelectPlan,
  onLoginRequired,
}: {
  user: User | null;
  settings: SettingsMap;
  onSelectPlan: (selection: CheckoutSelection) => void;
  onLoginRequired: () => boolean;
}) {
  const starterPricing = planPricing(settings, "starter");
  const scalePricing = planPricing(settings, "scale");
  const currentPlan = user?.plan || null;
  const currentDetails = user ? userPlanInfo(user) : null;

  return (
    <section className="bv-page simple-page plans-page">
      <header className="plans-page-header">
        <span className="plans-kicker"><Rocket size={16} /> Escolha como você quer crescer</span>
        <h1>Planos para encontrar produtos com potencial</h1>
        <p>Veja o que já vende, quanto esse mercado movimenta e quanto pode sobrar em cada venda.</p>
      </header>

      {user && currentDetails && (
        <section className="current-plan-banner">
          <span className="current-plan-icon"><ShieldCheck size={24} /></span>
          <div>
            <span>Seu plano atual</span>
            <strong>{currentDetails.planLabel}</strong>
            <p>Pesquisas disponíveis: {currentDetails.remaining}</p>
          </div>
          <span className="current-plan-status">Ativo</span>
        </section>
      )}

      <div className="plans-grid">
        <PlanBox
          icon={Search}
          eyebrow="Comece agora"
          title="Grátis"
          description="Descubra a demanda de um produto antes de investir em estoque."
          price="R$ 0,00"
          priceSuffix="para começar"
          items={[
            "1 pesquisa completa",
            "Top 3 anúncios campeões",
            "Quantidade de vendas e preço médio",
            "Prévia do dinheiro movimentado",
          ]}
          current={currentPlan === "free"}
          actionLabel={currentPlan === "free" ? "Seu plano atual" : user ? "Incluído no seu plano" : "Criar conta grátis"}
          actionDisabled={Boolean(user)}
          onAction={() => { onLoginRequired(); }}
        />
        <PlanBox
          icon={BarChart3}
          eyebrow="Para começar a vender"
          title="10 pesquisas"
          description="Analise seus primeiros produtos e escolha onde existe a melhor oportunidade."
          price={money.format(starterPricing.monthly)}
          priceSuffix="/mês"
          annualPrice={starterPricing.yearly}
          annualEquivalent={starterPricing.monthlyEquivalent}
          annualDiscount={starterPricing.discount}
          items={[
            "10 análises completas por mês",
            "Faturamento completo dos campeões",
            "Quanto ganho neste produto, com taxas",
            "Cálculo com seu preço de custo",
            "Histórico das pesquisas na sua conta",
          ]}
          current={currentPlan === "starter"}
          actionLabel={currentPlan === "starter" ? "Seu plano atual" : currentPlan === "scale" ? "Incluído no Ilimitado" : "Escolher 10 pesquisas"}
          actionDisabled={currentPlan === "starter" || currentPlan === "scale"}
          onAction={() => onSelectPlan({ plan: "starter", cycle: "monthly" })}
        />
        <PlanBox
          icon={Crown}
          eyebrow="Mais liberdade para pesquisar"
          title="Ilimitado"
          description="Para validar vários produtos, portfólios e novas oportunidades sem contar pesquisas."
          price={money.format(scalePricing.monthly)}
          priceSuffix="/mês"
          annualPrice={scalePricing.yearly}
          annualEquivalent={scalePricing.monthlyEquivalent}
          annualDiscount={scalePricing.discount}
          items={[
            "Pesquisas completas ilimitadas",
            "Faturamento completo dos campeões",
            "Quanto ganho neste produto, com taxas",
            "Cálculo com seu preço de custo",
            "Histórico e reabertura das análises",
          ]}
          current={currentPlan === "scale"}
          actionLabel={currentPlan === "scale" ? "Seu plano atual" : currentPlan === "starter" ? "Fazer upgrade para Ilimitado" : "Escolher Ilimitado"}
          actionDisabled={currentPlan === "scale"}
          onAction={() => onSelectPlan({ plan: "scale", cycle: "monthly" })}
          featured
        />
      </div>

      <div className="plans-payment-info">
        <div>
          <RefreshCw size={20} />
          <span><strong>Plano mensal</strong>Cobrança automática no cartão, mês a mês.</span>
        </div>
        <div>
          <CreditCard size={20} />
          <span><strong>Plano anual</strong>Pix ou cartão.</span>
        </div>
      </div>
    </section>
  );
}

function PlanBox({
  icon: Icon,
  eyebrow,
  title,
  description,
  price,
  priceSuffix,
  annualPrice,
  annualEquivalent,
  annualDiscount,
  items,
  featured = false,
  current = false,
  actionLabel,
  actionDisabled = false,
  onAction,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  price: string;
  priceSuffix: string;
  annualPrice?: number;
  annualEquivalent?: number;
  annualDiscount?: number;
  items: string[];
  featured?: boolean;
  current?: boolean;
  actionLabel: string;
  actionDisabled?: boolean;
  onAction: () => void;
}) {
  return (
    <article className={`plan-box${featured ? " featured" : ""}${current ? " current" : ""}`}>
      {featured && <span className="plan-recommended">Mais escolhido</span>}
      <div className="plan-box-head">
        <span className="plan-icon"><Icon size={22} /></span>
        <div>
          <span className="plan-eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
      </div>
      <p className="plan-description">{description}</p>
      <div className="plan-price">
        <strong>{price}</strong>
        <small>{priceSuffix}</small>
      </div>
      {annualPrice !== undefined && annualEquivalent !== undefined && annualDiscount !== undefined && (
        <div className="plan-annual">
          <p>
            <strong>Anual: {money.format(annualPrice)}</strong>
            <span>Economize {money.format(annualDiscount)}</span>
          </p>
          <b>{money.format(annualEquivalent)}/mês no plano anual</b>
          <small>Pix ou cartão</small>
        </div>
      )}
      <ul className="plan-benefits">
        {items.map((item) => (
          <li key={item}><CircleCheck size={17} /> <span>{item}</span></li>
        ))}
      </ul>
      <button className={current ? "plan-current-button" : ""} type="button" onClick={onAction} disabled={actionDisabled}>
        {current && <CircleCheck size={18} />}
        {actionLabel}
        {!current && !actionDisabled && <ChevronRight size={18} />}
      </button>
    </article>
  );
}

function CheckoutPage({
  user,
  settings,
  selection,
  onSelection,
  onLoginRequired,
  onUserChange,
  onDone,
}: {
  user: User | null;
  settings: SettingsMap;
  selection: CheckoutSelection;
  onSelection: (selection: CheckoutSelection) => void;
  onLoginRequired: () => boolean;
  onUserChange: (user: User) => void;
  onDone: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [pixCopied, setPixCopied] = useState(false);
  const [annualBillingType, setAnnualBillingType] = useState<BillingType>("PIX");
  const [postalAddress, setPostalAddress] = useState<PostalCodeAddress | null>(null);
  const [postalCodeError, setPostalCodeError] = useState("");
  const [checkingPostalCode, setCheckingPostalCode] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const offer = checkoutOffer(settings, selection);
  const pricing = planPricing(settings, selection.plan);
  const billingType: BillingType = selection.cycle === "yearly" ? annualBillingType : "CREDIT_CARD";
  const chargeMode: ChargeMode = selection.cycle === "yearly" ? "single" : "subscription";
  const checkoutPaid = isPaidCheckoutStatus(result?.status);
  const checkoutFailed = isFailedCheckoutStatus(result?.status);
  const paymentLabel = selection.cycle === "monthly"
    ? "Cartão mensal"
    : billingType === "PIX"
      ? "Pix anual com desconto"
      : "Cartão anual em até 12x sem juros";
  const paymentHint = selection.cycle === "monthly"
    ? "Cobrança automática no cartão, mês a mês."
    : billingType === "PIX"
      ? `Pagamento único de ${money.format(offer.value)} no Pix.`
      : `Parcelado em até 12 vezes sem juros, total de ${money.format(offer.value)}.`;

  useEffect(() => {
    if (!result?.financeId || isPaidCheckoutStatus(result.status) || isFailedCheckoutStatus(result.status)) {
      return;
    }

    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const checkStatus = async () => {
      attempts += 1;
      let terminalStatus = false;
      setCheckingPayment(true);
      try {
        const status = await api<CheckoutStatus>(`/api/checkout/status?id=${result.financeId}`);
        if (cancelled) {
          return;
        }
        setResult((current) => current ? {
          ...current,
          status: status.paid ? "paid" : status.status,
          message: status.message,
          invoiceUrl: status.invoiceUrl || current.invoiceUrl,
          pixQrCode: status.pixQrCode || current.pixQrCode,
        } : current);
        if (status.user) {
          onUserChange(status.user);
        }
        terminalStatus = status.paid || isFailedCheckoutStatus(status.status);
        if (terminalStatus) {
          if (status.paid) {
            onDone();
          }
          return;
        }
      } catch {
        // O webhook continua sendo a fonte principal; a consulta é uma redundância.
      } finally {
        if (!cancelled) {
          setCheckingPayment(false);
        }
      }

      if (!cancelled && !terminalStatus && attempts < 45) {
        timer = setTimeout(checkStatus, 4_000);
      }
    };

    timer = setTimeout(checkStatus, 3_000);
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [result?.financeId, result?.status]);

  useEffect(() => {
    if (!result?.financeId) {
      return;
    }
    const timer = setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 80);
    return () => clearTimeout(timer);
  }, [result?.financeId]);

  const selectCycle = (cycle: PlanCycle) => {
    onSelection({ ...selection, cycle });
    setResult(null);
    setPixCopied(false);
    setError("");
  };

  const validatePostalCode = async (value: unknown) => {
    const postalCode = digitsOnly(value);
    if (postalCode.length !== 8) {
      const message = "Informe um CEP com 8 números.";
      setPostalAddress(null);
      setPostalCodeError(message);
      throw new Error(message);
    }
    if (postalAddress?.cep === postalCode) {
      return postalAddress;
    }

    setCheckingPostalCode(true);
    setPostalCodeError("");
    try {
      const address = await api<PostalCodeAddress>(`/api/postal-code?cep=${postalCode}`);
      setPostalAddress(address);
      return address;
    } catch (apiError) {
      const message = apiError instanceof Error ? apiError.message : "Não foi possível validar o CEP.";
      setPostalAddress(null);
      setPostalCodeError(message);
      throw new Error(message);
    } finally {
      setCheckingPostalCode(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onLoginRequired()) {
      return;
    }
    setSubmitting(true);
    setCheckingPayment(false);
    setError("");
    setResult(null);
    setPixCopied(false);
    try {
      const form = event.currentTarget;
      const data = formJson(form);
      const documentDigits = digitsOnly(data.cpfCnpj);
      if (![11, 14].includes(documentDigits.length)) {
        throw new Error("Informe um CPF com 11 números ou um CNPJ com 14 números.");
      }
      if (digitsOnly(data.phone).length < 10) {
        throw new Error("Informe um telefone com DDD.");
      }
      if (billingType === "CREDIT_CARD") {
        const cardDigits = digitsOnly(data.card_number);
        const expiryMonth = Number(digitsOnly(data.card_month));
        const expiryYear = Number(digitsOnly(data.card_year));
        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        const currentMonth = currentDate.getMonth() + 1;
        if (!isValidCardNumber(cardDigits)) {
          throw new Error("Confira o número do cartão. Ele parece ter sido digitado incorretamente.");
        }
        if (expiryMonth < 1 || expiryMonth > 12) {
          throw new Error("Informe um mês de validade entre 01 e 12.");
        }
        if (
          !Number.isInteger(expiryYear)
          || expiryYear < currentYear
          || (expiryYear === currentYear && expiryMonth < currentMonth)
        ) {
          throw new Error("Informe uma data de validade futura.");
        }
        if (![3, 4].includes(digitsOnly(data.card_ccv).length)) {
          throw new Error("O CVV deve ter 3 ou 4 números.");
        }
        if (digitsOnly(data.postal_code).length !== 8) {
          throw new Error("Informe um CEP com 8 números.");
        }
        if (!digitsOnly(data.address_number)) {
          throw new Error("Informe o número do endereço do titular do cartão.");
        }
        await validatePostalCode(data.postal_code);
      }
      const payload = {
        plan: selection.plan,
        cycle: selection.cycle,
        billingType,
        chargeMode,
        name: data.name,
        email: data.email,
        phone: data.phone,
        cpfCnpj: data.cpfCnpj,
        creditCard: billingType === "CREDIT_CARD" ? {
          holderName: data.card_holder,
          number: data.card_number,
          expiryMonth: data.card_month,
          expiryYear: data.card_year,
          ccv: data.card_ccv,
        } : undefined,
        creditCardHolderInfo: billingType === "CREDIT_CARD" ? {
          name: data.card_holder,
          email: data.email,
          cpfCnpj: data.cpfCnpj,
          postalCode: data.postal_code,
          addressNumber: data.address_number,
          phone: data.phone,
        } : undefined,
      };
      const checkout = await api<CheckoutResult>("/api/checkout/start", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setResult(checkout);
      if (checkout.user) {
        onUserChange(checkout.user);
      }
      onDone();
    } catch (apiError) {
      setError(apiError instanceof Error ? apiError.message : "Nao foi possivel criar o pagamento.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) {
    return <AccessPrompt title="Crie sua conta para assinar" onLoginRequired={onLoginRequired} />;
  }

  return (
    <section className="bv-page simple-page checkout-page">
      <div className="checkout-header">
        <div>
          <span>Checkout seguro</span>
          <h1>Assinar {offer.title}</h1>
          <p>Escolha mensal no cartão ou anual no Pix ou cartão em até 12x sem juros. Pagamento processado pela Asaas.</p>
        </div>
        <strong>
          {offer.displayPrice}
          <small>{selection.cycle === "yearly" ? "/mês no plano anual" : "/mês"}</small>
          {selection.cycle === "yearly" && billingType === "PIX" && <em>{`Cobrado no Pix anual: ${money.format(offer.value)}`}</em>}
          {selection.cycle === "yearly" && billingType === "CREDIT_CARD" && <em>{`Até 12x sem juros, total de ${money.format(offer.value)}`}</em>}
          {selection.cycle === "monthly" && <em>{`${money.format(offer.yearlyBase)} se mantiver por 12 meses`}</em>}
        </strong>
      </div>

      <div className="checkout-layout">
        <form className="checkout-form" onSubmit={submit}>
          <div className="checkout-options">
            <label>
              Plano
              <select value={selection.plan} onChange={(event) => onSelection({ ...selection, plan: event.target.value as PaidPlan })}>
                <option value="starter">10 pesquisas</option>
                <option value="scale">Ilimitado</option>
              </select>
            </label>
            <fieldset className="period-options">
              <legend>Período</legend>
              <label className={selection.cycle === "monthly" ? "active" : ""}>
                <input type="radio" name="cycle" checked={selection.cycle === "monthly"} onChange={() => selectCycle("monthly")} />
                <span>Mensal</span>
                <small>{money.format(offer.monthlyValue)}/mês no cartão</small>
              </label>
              <label className={selection.cycle === "yearly" ? "active" : ""}>
                <input type="radio" name="cycle" checked={selection.cycle === "yearly"} onChange={() => selectCycle("yearly")} />
                <span>{`Anual - economize ${money.format(pricing.discount)}`}</span>
                <small>{`${money.format(pricing.monthlyEquivalent)}/mês, total de ${money.format(pricing.yearly)}`}</small>
              </label>
            </fieldset>
          </div>

          {selection.cycle === "yearly" && (
            <fieldset className="annual-payment-options">
              <legend>Como prefere pagar o plano anual?</legend>
              <button
                className={billingType === "PIX" ? "active" : ""}
                type="button"
                onClick={() => {
                  setAnnualBillingType("PIX");
                  setResult(null);
                  setError("");
                }}
              >
                <ReceiptText size={21} />
                <span><strong>Pix à vista</strong><small>{money.format(offer.value)} com desconto</small></span>
                {billingType === "PIX" && <CircleCheck size={18} />}
              </button>
              <button
                className={billingType === "CREDIT_CARD" ? "active" : ""}
                type="button"
                onClick={() => {
                  setAnnualBillingType("CREDIT_CARD");
                  setResult(null);
                  setError("");
                }}
              >
                <CreditCard size={21} />
                <span><strong>Cartão em até 12x</strong><small>{`${money.format(offer.value)} no total, sem juros`}</small></span>
                {billingType === "CREDIT_CARD" && <CircleCheck size={18} />}
              </button>
            </fieldset>
          )}

          <div className="payment-method-card" aria-label="Forma de pagamento">
            <span>Forma de pagamento</span>
            <strong>{paymentLabel}</strong>
            <p>{paymentHint}</p>
          </div>

          <div className="checkout-fields">
            <label>
              Nome
              <input name="name" defaultValue={user.name} required />
            </label>
            <label>
              E-mail
              <input name="email" type="email" defaultValue={user.email} required />
            </label>
            <label>
              Telefone
              <input
                name="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                maxLength={15}
                defaultValue={formatPhone(user.phone || "")}
                placeholder="(00) 00000-0000"
                onInput={(event) => {
                  event.currentTarget.value = formatPhone(event.currentTarget.value);
                }}
                required
              />
            </label>
            <label>
              CPF/CNPJ
              <input
                name="cpfCnpj"
                inputMode="numeric"
                autoComplete="off"
                maxLength={18}
                placeholder="000.000.000-00"
                onInput={(event) => {
                  event.currentTarget.value = formatCpfCnpj(event.currentTarget.value);
                }}
                required
              />
            </label>
          </div>

          {billingType === "CREDIT_CARD" && (
            <div className="checkout-fields card-fields">
              <label className="wide">
                Nome impresso no cartão
                <input name="card_holder" autoComplete="cc-name" maxLength={80} placeholder="Como aparece no cartão" required />
              </label>
              <label className="wide">
                Número do cartão
                <input
                  name="card_number"
                  inputMode="numeric"
                  autoComplete="cc-number"
                  maxLength={23}
                  placeholder="0000 0000 0000 0000"
                  onInput={(event) => {
                    event.currentTarget.value = formatCardNumber(event.currentTarget.value);
                  }}
                  required
                />
              </label>
              <label>
                Mês
                <input
                  name="card_month"
                  inputMode="numeric"
                  autoComplete="cc-exp-month"
                  maxLength={2}
                  placeholder="MM"
                  onInput={(event) => {
                    event.currentTarget.value = limitDigits(event.currentTarget.value, 2);
                  }}
                  required
                />
              </label>
              <label>
                Ano
                <input
                  name="card_year"
                  inputMode="numeric"
                  autoComplete="cc-exp-year"
                  maxLength={4}
                  placeholder="AAAA"
                  onInput={(event) => {
                    event.currentTarget.value = limitDigits(event.currentTarget.value, 4);
                  }}
                  required
                />
              </label>
              <label>
                CVV
                <input
                  name="card_ccv"
                  inputMode="numeric"
                  autoComplete="cc-csc"
                  maxLength={4}
                  placeholder="123"
                  onInput={(event) => {
                    event.currentTarget.value = limitDigits(event.currentTarget.value, 4);
                  }}
                  required
                />
              </label>
              <label className="postal-code-field">
                CEP
                <input
                  name="postal_code"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  maxLength={9}
                  placeholder="00000-000"
                  onInput={(event) => {
                    event.currentTarget.value = formatPostalCode(event.currentTarget.value);
                    setPostalAddress(null);
                    setPostalCodeError("");
                  }}
                  onBlur={(event) => {
                    void validatePostalCode(event.currentTarget.value).catch(() => undefined);
                  }}
                  required
                />
                {checkingPostalCode && <small className="postal-code-feedback">Localizando CEP...</small>}
                {!checkingPostalCode && postalCodeError && (
                  <small className="postal-code-feedback error">{postalCodeError}</small>
                )}
                {!checkingPostalCode && postalAddress && (
                  <small className="postal-code-feedback success">
                    <CircleCheck size={14} />
                    {[
                      postalAddress.street,
                      postalAddress.neighborhood,
                      [postalAddress.city, postalAddress.state].filter(Boolean).join("/"),
                    ].filter(Boolean).join(" - ")}
                  </small>
                )}
              </label>
              <label>
                Número
                <input
                  name="address_number"
                  inputMode="numeric"
                  maxLength={10}
                  onInput={(event) => {
                    event.currentTarget.value = limitDigits(event.currentTarget.value, 10);
                  }}
                  required
                />
              </label>
            </div>
          )}

          {error && <p className="form-error">{error}</p>}
          <button className="login-submit" type="submit" disabled={submitting}>
            <CreditCard size={19} />
            {submitting
              ? "Gerando pagamento..."
              : billingType === "PIX"
                ? "Gerar Pix anual"
                : selection.cycle === "yearly"
                  ? "Pagar anual em até 12x"
                  : "Assinar plano mensal"}
          </button>
          {result && (
            <div className="checkout-result checkout-result-primary" ref={resultRef} aria-live="polite">
              <b>{result.message}</b>
              {!checkoutPaid && !checkoutFailed && (
                <small className="payment-status">
                  <RefreshCw size={15} />
                  {result.billingType === "PIX" && !result.pixQrCode?.encodedImage
                    ? "Preparando o QR Code Pix..."
                    : checkingPayment
                      ? "Conferindo a confirmação no Asaas..."
                      : "Aguardando a confirmação do pagamento..."}
                </small>
              )}
              {checkoutPaid && (
                <small className="payment-status payment-status-paid">
                  <UnlockKeyhole size={15} />
                  Pagamento confirmado. Plano liberado na sua conta.
                </small>
              )}
              {checkoutFailed && (
                <small className="payment-status payment-status-error">
                  <X size={15} />
                  A cobrança não foi aprovada. Revise os dados e tente novamente.
                </small>
              )}
              {!checkoutPaid && !checkoutFailed && result.pixQrCode?.encodedImage && (
                <div className="pix-qr-code">
                  <img src={`data:image/png;base64,${result.pixQrCode.encodedImage}`} alt="QR Code Pix" />
                  <strong>Escaneie o QR Code ou use o Pix copia e cola</strong>
                </div>
              )}
              {!checkoutPaid && !checkoutFailed && result.pixQrCode?.expirationDate && (
                <small className="pix-expiration">
                  {`Código válido até ${formatAsaasExpiration(result.pixQrCode.expirationDate)}`}
                </small>
              )}
              {!checkoutPaid && !checkoutFailed && result.pixQrCode?.payload && (
                <>
                  <textarea aria-label="Código Pix copia e cola" readOnly value={result.pixQrCode.payload} />
                  <button
                    className="secondary-action pix-copy-button"
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(result.pixQrCode?.payload || "");
                      setPixCopied(true);
                      setTimeout(() => setPixCopied(false), 2500);
                    }}
                  >
                    <ReceiptText size={18} />
                    {pixCopied ? "Código Pix copiado" : "Copiar código Pix"}
                  </button>
                </>
              )}
              {result.invoiceUrl && !checkoutFailed && (
                <a href={result.invoiceUrl} target="_blank" rel="noreferrer">
                  <ReceiptText size={18} />
                  {checkoutPaid ? "Ver comprovante" : "Abrir pagamento"}
                </a>
              )}
            </div>
          )}
        </form>

        <aside className="checkout-summary">
          <span>{selection.cycle === "monthly" ? "Mensal" : billingType === "PIX" ? "Anual no Pix" : "Anual no cartão"}</span>
          <h2>{offer.title}</h2>
          <strong>{offer.displayPrice}</strong>
          {selection.cycle === "yearly" && billingType === "PIX" && <small>{`Cobrado uma vez no Pix: ${money.format(offer.value)}`}</small>}
          {selection.cycle === "yearly" && billingType === "CREDIT_CARD" && <small>{`Até 12x sem juros, total de ${money.format(offer.value)}`}</small>}
          {selection.cycle === "monthly" && <small>{`${money.format(offer.yearlyBase)} se mantiver por 12 meses`}</small>}
          {selection.cycle === "yearly" && <small>{`Economia de ${money.format(offer.discount)} no ano`}</small>}
          <p>{offer.description}</p>
        </aside>
      </div>
    </section>
  );
}

function isPaidCheckoutStatus(status = "") {
  return ["paid", "RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(status);
}

function isFailedCheckoutStatus(status = "") {
  return [
    "canceled",
    "CANCELED",
    "DELETED",
    "OVERDUE",
    "REFUNDED",
    "REFUND_REQUESTED",
    "CHARGEBACK_REQUESTED",
    "CHARGEBACK_DISPUTE",
    "AWAITING_CHARGEBACK_REVERSAL",
    "DUNNING_REQUESTED",
    "DUNNING_RECEIVED",
  ].includes(status);
}

function formatAsaasExpiration(value: string) {
  const parsed = new Date(value.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function checkoutOffer(settings: SettingsMap, selection: CheckoutSelection) {
  const title = selection.plan === "scale" ? "Plano ilimitado" : "Plano 10 pesquisas";
  const pricing = planPricing(settings, selection.plan);
  const value = selection.cycle === "yearly" ? pricing.yearly : pricing.monthly;
  const monthlyEquivalent = selection.cycle === "yearly" ? pricing.monthlyEquivalent : pricing.monthly;
  return {
    title,
    value,
    monthlyEquivalent,
    displayPrice: money.format(monthlyEquivalent),
    yearlyBase: pricing.yearlyBase,
    monthlyValue: pricing.monthly,
    discount: pricing.discount,
    discountPercent: pricing.discountPercent,
    description: selection.plan === "scale"
      ? "Pesquisas ilimitadas, faturamento dos campeões e cálculo de ganho por produto."
      : "10 pesquisas completas, faturamento dos campeões e cálculo de ganho por produto.",
  };
}

function planPricing(settings: SettingsMap, plan: PaidPlan) {
  const monthlyKey = plan === "scale" ? "scale_monthly" : "starter_monthly";
  const yearlyKey = plan === "scale" ? "scale_yearly" : "starter_yearly";
  const monthlyFallback = plan === "scale" ? 39.9 : 19.9;
  const yearlyFallback = plan === "scale" ? 359.1 : 179.1;
  const monthly = Number(settings[monthlyKey] || monthlyFallback);
  const yearly = Number(settings[yearlyKey] || yearlyFallback);
  const yearlyBase = Number((monthly * 12).toFixed(2));
  const discount = Number(Math.max(0, yearlyBase - yearly).toFixed(2));
  const discountPercent = yearlyBase > 0 ? Math.round((discount / yearlyBase) * 100) : 0;
  const monthlyEquivalent = Math.round((yearly / 12 + Number.EPSILON) * 100) / 100;

  return {
    monthly,
    yearly,
    monthlyEquivalent,
    yearlyBase,
    discount,
    discountPercent,
  };
}

function LearnPage({ tips, onTip }: { tips: Tip[]; onTip: (tip: Tip) => void }) {
  return (
    <section className="bv-page simple-page">
      <h1>Dicas</h1>
      <p>Conteúdo editável pelo painel admin para educar e nutrir novos vendedores.</p>
      <div className="learn-grid full">
        {tips.map((tip) => (
          <button className="learn-card" key={tip.id} type="button" onClick={() => onTip(tip)}>
            <BookOpen size={24} />
            <strong>{tip.title}</strong>
            <p>{tip.body}</p>
            <span>{tip.cta || "Ler artigo"} <ChevronRight size={16} /></span>
          </button>
        ))}
      </div>
    </section>
  );
}

function TipArticleModal({ tip, onClose }: { tip: Tip; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const paragraphs = tip.body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <div
      className="modal-backdrop article-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <article className="tip-article-modal" role="dialog" aria-modal="true" aria-labelledby={`tip-title-${tip.id}`}>
        <button className="modal-close" type="button" onClick={onClose} aria-label="Fechar artigo">
          <X size={20} />
        </button>
        <div className="tip-article-icon" aria-hidden="true">
          <BookOpen size={26} />
        </div>
        <span className="tip-article-label">Dica Confweb</span>
        <h2 id={`tip-title-${tip.id}`}>{tip.title}</h2>
        <div className="tip-article-body">
          {paragraphs.map((paragraph, index) => (
            <p key={`${tip.id}-${index}`}>{paragraph}</p>
          ))}
        </div>
        <button className="tip-article-close" type="button" onClick={onClose}>
          Concluir leitura
        </button>
      </article>
    </div>
  );
}

function CommercialPage({ contacts, cta }: { contacts: Contact[]; cta?: string }) {
  return (
    <section className="bv-page simple-page">
      <h1>{cta || "Fale com um Especialista Certificado da Confweb"}</h1>
      <p>Contatos gerenciados pelo painel admin.</p>
      <div className="contact-grid">
        {contacts.map((contact) => {
          const href = contactHref(contact);

          return (
            <article className="contact-card" key={contact.id}>
              <MessageCircle size={25} />
              <strong>{contact.name}</strong>
              <span>{contact.channel}</span>
              {href ? (
                <a className="contact-link" href={href} target="_blank" rel="noreferrer">
                  {contactDisplayValue(contact)}
                </a>
              ) : (
                <p>{contact.value}</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ProfilePage({
  user,
  settings,
  contacts,
  onLoginRequired,
  onPlans,
}: {
  user: User | null;
  settings: SettingsMap;
  contacts: Contact[];
  onLoginRequired: () => boolean;
  onPlans: () => void;
}) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [cancelPlanOpen, setCancelPlanOpen] = useState(false);

  if (!user) {
    return <AccessPrompt title="Entre para acessar seu perfil" onLoginRequired={onLoginRequired} />;
  }

  const { planLabel, remaining, usage } = userPlanInfo(user);

  const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formJson(form) as Record<string, string>;

    setError("");
    setMessage("");

    if (values.newPassword !== values.confirmPassword) {
      setError("A confirmação da nova senha não bate.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await api<{ message: string }>("/api/account/password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        }),
      });
      form.reset();
      setMessage(response.message || "Senha atualizada com sucesso.");
    } catch (apiError) {
      setError(apiError instanceof Error ? apiError.message : "Não foi possível alterar a senha.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="bv-page simple-page profile-page">
      <h1>Perfil</h1>
      <p>Gerencie seus dados de acesso e acompanhe seu plano atual.</p>
      <div className="profile-grid">
        <article className="profile-card profile-account-card">
          <span className="account-avatar">{userInitials(user)}</span>
          <div className="profile-account-copy">
            <span>Conta</span>
            <strong>{user.name}</strong>
            <p>{user.email}</p>
            {user.phone && <p>{user.phone}</p>}
            <div className="profile-business-data">
              <small>{businessModelLabel(user.business_model)}</small>
              <small>{marketplaceExperienceLabel(user.marketplace_experience)}</small>
            </div>
          </div>
          <div className="profile-metrics">
            <span>Plano atual</span>
            <strong>{planLabel}</strong>
            <small>Pesquisas restantes: {remaining}</small>
            <div className="usage-track">
              <i style={{ width: `${usage}%` }} />
            </div>
          </div>
          <button type="button" onClick={onPlans}>
            Ver planos desde {money.format(Number(settings.starter_monthly || 19.9))}
          </button>
          {user.plan !== "free" && (
            <button className="cancel-plan-button" type="button" onClick={() => setCancelPlanOpen(true)}>
              <CircleX size={15} />
              Cancelar plano
            </button>
          )}
        </article>

        <form className="profile-card profile-password-form" onSubmit={submitPassword}>
          <Lock size={24} />
          <div className="profile-security-copy">
            <span>Segurança</span>
            <strong>Alterar senha</strong>
            <p>Use uma senha forte e guarde em local seguro.</p>
          </div>
          <label>
            Senha atual
            <div className="password-field">
              <input name="currentPassword" type={showPassword ? "text" : "password"} autoComplete="current-password" required />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Ocultar senhas" : "Mostrar senhas"}
                title={showPassword ? "Ocultar senhas" : "Mostrar senhas"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>
          <label>
            Nova senha
            <input name="newPassword" type={showPassword ? "text" : "password"} minLength={10} autoComplete="new-password" required />
          </label>
          <label>
            Confirmar nova senha
            <input name="confirmPassword" type={showPassword ? "text" : "password"} minLength={10} autoComplete="new-password" required />
          </label>
          {message && <p className="success-text">{message}</p>}
          {error && <p className="form-error">{error}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? "Salvando..." : "Salvar nova senha"}
          </button>
        </form>
      </div>
      {cancelPlanOpen && (
        <CancelPlanModal
          contacts={contacts}
          onClose={() => setCancelPlanOpen(false)}
        />
      )}
    </section>
  );
}

function cancellationWhatsappHref(contacts: Contact[], reason: string) {
  const contact = contacts.find((item) => item.status === "active" && /whats|telefone|phone|celular/i.test(item.channel))
    || contacts.find((item) => /whats|telefone|phone|celular/i.test(item.channel))
    || defaultContacts[0];
  const digits = contact.value.replace(/\D/g, "") || defaultContacts[0].value.replace(/\D/g, "");
  const phone = digits.startsWith("55") ? digits : `55${digits}`;
  const message = `quero cancelar meu plano por motivo: ${reason.trim()}`;

  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function CancelPlanModal({ contacts, onClose }: { contacts: Contact[]; onClose: () => void }) {
  const [reason, setReason] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanReason = reason.trim();
    if (!cleanReason) {
      return;
    }
    window.location.assign(cancellationWhatsappHref(contacts, cleanReason));
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-plan-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <form className="cancel-plan-modal" onSubmit={submit}>
        <button className="modal-close" type="button" onClick={onClose} aria-label="Fechar cancelamento">
          <X size={20} />
        </button>
        <span className="cancel-plan-icon"><MessageCircle size={24} /></span>
        <div className="cancel-plan-heading">
          <span>Atendimento Confweb</span>
          <h2 id="cancel-plan-title">Solicitar cancelamento</h2>
          <p>Conte brevemente o motivo. Você continuará no WhatsApp do nosso comercial para concluir a solicitação.</p>
        </div>
        <label>
          Motivo do cancelamento
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: Não estou usando a ferramenta neste momento."
            rows={4}
            maxLength={500}
            required
          />
          <small>{reason.length}/500</small>
        </label>
        <div className="cancel-plan-actions">
          <button type="button" onClick={onClose}>Voltar</button>
          <button className="cancel-plan-confirm" type="submit" disabled={!reason.trim()}>
            <MessageCircle size={18} />
            Solicitar no WhatsApp
          </button>
        </div>
      </form>
    </div>
  );
}

function ticketStatusLabel(status: string) {
  return {
    open: "Aberto",
    waiting: "Aguardando resposta",
    closed: "Fechado",
  }[status] || status;
}

function ticketPriorityLabel(priority: string) {
  return {
    low: "Baixa",
    normal: "Normal",
    high: "Alta",
  }[priority] || priority;
}

function SupportPage({
  user,
  tickets,
  onTicketsChange,
  onLoginRequired,
}: {
  user: User | null;
  tickets: Ticket[];
  onTicketsChange: (tickets: Ticket[]) => void;
  onLoginRequired: () => boolean;
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onLoginRequired()) {
      return;
    }

    const form = event.currentTarget;
    setSubmitting(true);
    setMessage("");
    setError("");

    try {
      const ticket = await api<Ticket>("/api/support", {
        method: "POST",
        body: JSON.stringify(formJson(form)),
      });
      onTicketsChange([ticket, ...tickets]);
      form.reset();
      setMessage("Chamado aberto com sucesso. Acompanhe a resposta abaixo.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Não foi possível abrir o chamado.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) {
    return <AccessPrompt title="Entre para abrir suporte" onLoginRequired={onLoginRequired} />;
  }

  return (
    <section className="bv-page simple-page">
      <h1>Suporte</h1>
      <p>Envie sua dúvida para a equipe Confweb e acompanhe a resposta por aqui.</p>
      <form className="support-form" onSubmit={submit}>
        <input name="subject" placeholder="Assunto" maxLength={120} required />
        <select name="priority" defaultValue="normal">
          <option value="low">Baixa</option>
          <option value="normal">Normal</option>
          <option value="high">Alta</option>
        </select>
        <textarea name="message" placeholder="Descreva sua dúvida" maxLength={3000} required />
        <button type="submit" disabled={submitting}>
          {submitting ? "Enviando..." : "Enviar para o suporte"}
        </button>
      </form>
      {message && <p className="success-text">{message}</p>}
      {error && <p className="form-error">{error}</p>}
      <div className="ticket-list">
        {tickets.length ? tickets.map((ticket) => (
          <article key={ticket.id}>
            <div className="support-ticket-head">
              <strong>{ticket.subject}</strong>
              <span className={`support-ticket-status is-${ticket.status}`}>
                {ticketStatusLabel(ticket.status)}
              </span>
            </div>
            <span>
              Prioridade {ticketPriorityLabel(ticket.priority)} · Aberto em {formatCacheDate(ticket.created_at)}
            </span>
            <div className="support-ticket-message">
              <small>Sua mensagem</small>
              <p>{ticket.message}</p>
            </div>
            {ticket.response && (
              <div className="support-ticket-response">
                <small>Resposta da equipe Confweb</small>
                <p>{ticket.response}</p>
              </div>
            )}
          </article>
        )) : (
          <p className="muted-box">Você ainda não abriu nenhum chamado. Envie sua dúvida pelo formulário acima.</p>
        )}
      </div>
    </section>
  );
}

function AccessPrompt({ title, onLoginRequired }: { title: string; onLoginRequired: () => boolean }) {
  return (
    <section className="bv-page simple-page access-prompt">
      <Lock size={34} />
      <h1>{title}</h1>
      <p>O Busca Vendas usa login real para salvar pesquisas, suporte e permissões de plano.</p>
      <button type="button" onClick={onLoginRequired}>Entrar agora</button>
    </section>
  );
}

function LoginModal({
  initialMode,
  onClose,
  onLogin,
  onLegal,
}: {
  initialMode: "login" | "register";
  onClose: () => void;
  onLogin: (user: User) => void;
  onLegal: (mode: "terms" | "privacy") => void;
}) {
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register" | "recovery">(initialMode);
  const [showPassword, setShowPassword] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");
    const controller = new AbortController();
    let finished = false;
    let timedOut = false;
    const timer = window.setTimeout(() => {
      if (finished) {
        return;
      }
      timedOut = true;
      controller.abort();
      setError("O servidor demorou para responder. Aguarde alguns instantes e tente novamente.");
      setSubmitting(false);
    }, 12000);
    try {
      const endpoint = authMode === "login"
        ? "/api/auth/login"
        : authMode === "register"
          ? "/api/auth/register"
          : "/api/auth/recovery-request";
      const data = await api<{ user?: User; message?: string }>(endpoint, {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify(formJson(event.currentTarget)),
      });
      finished = true;
      if (authMode === "recovery") {
        setSuccess(data.message || "Solicitação registrada.");
      } else if (data.user) {
        onLogin(data.user);
      }
    } catch (apiError) {
      if (!finished && !timedOut) {
        setError(apiError instanceof Error ? apiError.message : "Não foi possível entrar.");
      }
    } finally {
      finished = true;
      window.clearTimeout(timer);
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Login"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <form className="login-modal" onSubmit={submit}>
        <button className="modal-close" type="button" onClick={onClose} aria-label="Fechar login">
          <X size={20} />
        </button>
        <BrandMark />
        <h2>{authMode === "login" ? "Acesso seguro" : authMode === "register" ? "Criar conta grátis" : "Recuperar acesso"}</h2>
        <div className="auth-switch" aria-label="Escolha login ou cadastro">
          <button className={authMode === "login" ? "active" : ""} type="button" onClick={() => setAuthMode("login")}>
            Entrar
          </button>
          <button className={authMode === "register" ? "active" : ""} type="button" onClick={() => setAuthMode("register")}>
            Criar grátis
          </button>
        </div>
        {authMode === "register" && (
          <label>
            Nome
            <input name="name" type="text" placeholder="Seu nome" required />
          </label>
        )}
        <label>
          E-mail
          <input name="email" type="email" placeholder="seu@email.com" required />
        </label>
        {authMode === "register" && (
          <label>
            Telefone
            <input name="phone" type="tel" placeholder="(11) 99999-9999" autoComplete="tel" required />
          </label>
        )}
        {authMode === "register" && (
          <label>
            Modelo de negócio
            <select name="business_model" defaultValue="" required>
              <option value="" disabled>Selecione seu modelo</option>
              {Object.entries(BUSINESS_MODEL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        )}
        {authMode === "register" && (
          <label>
            Já vende em E-commerce ou Marketplace?
            <select name="marketplace_experience" defaultValue="" required>
              <option value="" disabled>Selecione uma opção</option>
              {Object.entries(MARKETPLACE_EXPERIENCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        )}
        {authMode !== "recovery" && <label>
          Senha
          <div className="password-field">
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              minLength={authMode === "register" ? 10 : undefined}
              autoComplete={authMode === "login" ? "current-password" : "new-password"}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              title={showPassword ? "Ocultar senha" : "Mostrar senha"}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </label>}
        {authMode === "register" && (
          <>
            <p className="password-guidance">Use pelo menos 10 caracteres, com letra maiúscula, minúscula e número.</p>
            <label className="consent-row">
              <input name="acceptedTerms" type="checkbox" value="true" required />
              <span>
                Li e aceito os{" "}
                <button type="button" onClick={() => onLegal("terms")}>Termos de Uso</button>.
              </span>
            </label>
            <label className="consent-row">
              <input name="acceptedPrivacy" type="checkbox" value="true" required />
              <span>
                Li e aceito a{" "}
                <button type="button" onClick={() => onLegal("privacy")}>Política de Privacidade</button>.
              </span>
            </label>
          </>
        )}
        {authMode === "register" && <p className="login-note">Plano grátis liberado com 1 pesquisa completa.</p>}
        {authMode === "recovery" && (
          <p className="login-note">A solicitação será encaminhada ao suporte para confirmação segura da sua identidade.</p>
        )}
        {error && <p className="form-error">{error}</p>}
        {success && <p className="form-success">{success}</p>}
        <button className="login-submit" type="submit" disabled={submitting}>
          {authMode === "login" ? <LogIn size={19} /> : <UserRound size={19} />}
          {submitting ? "Aguarde..." : authMode === "login" ? "Entrar" : authMode === "register" ? "Criar conta" : "Solicitar recuperação"}
        </button>
        {authMode === "login" && (
          <button className="forgot-password" type="button" onClick={() => setAuthMode("recovery")}>
            Esqueci minha senha
          </button>
        )}
        {authMode === "recovery" && (
          <button className="forgot-password" type="button" onClick={() => setAuthMode("login")}>
            Voltar para o login
          </button>
        )}
      </form>
    </div>
  );
}

function LegalFooter({ onMode }: { onMode: (mode: Mode) => void }) {
  return (
    <footer className="legal-footer">
      <span>Busca Vendas por Confweb</span>
      <button type="button" onClick={() => onMode("terms")}>Termos de Uso</button>
      <button type="button" onClick={() => onMode("privacy")}>Política de Privacidade</button>
      <a href="https://www.confweb.com.br" target="_blank" rel="noreferrer">Confweb</a>
    </footer>
  );
}

function LegalPage({ kind, onBack }: { kind: "terms" | "privacy"; onBack: () => void }) {
  if (kind === "privacy") {
    return (
      <section className="bv-page legal-page">
        <button className="legal-back" type="button" onClick={onBack}>Voltar ao Busca Vendas</button>
        <span className="legal-kicker">Privacidade e segurança</span>
        <h1>Política de Privacidade</h1>
        <p className="legal-updated">Última atualização: 28 de julho de 2026.</p>
        <h2>1. Quais dados tratamos</h2>
        <p>Tratamos nome, e-mail, telefone, dados de acesso, histórico de pesquisas, plano contratado, registros de suporte e informações necessárias à cobrança. Os dados completos do cartão são encaminhados à infraestrutura de pagamentos do Asaas e não são exibidos no painel administrativo.</p>
        <h2>2. Para que usamos os dados</h2>
        <p>Usamos os dados para autenticar sua conta, entregar pesquisas, manter seu histórico, calcular limites do plano, processar pagamentos, responder ao suporte, prevenir fraude e melhorar a estabilidade do serviço.</p>
        <h2>3. Operadores e compartilhamento</h2>
        <p>Podemos usar fornecedores de infraestrutura, pagamentos e coleta de dados públicos, incluindo Hostinger, Asaas e Scrape.do. Compartilhamos somente o necessário para executar cada serviço e cumprir obrigações legais.</p>
        <h2>4. Segurança e retenção</h2>
        <p>Aplicamos controle de acesso, senhas protegidas por hash, sessões revogáveis, conexão HTTPS, criptografia de credenciais de integração e backups operacionais. Mantemos os dados enquanto a conta estiver ativa ou pelo prazo necessário para obrigações legais e financeiras.</p>
        <h2>5. Seus direitos</h2>
        <p>Você pode pedir confirmação, acesso, correção, portabilidade ou exclusão dos dados, observadas as retenções legais aplicáveis. Solicitações podem ser enviadas pelo suporte do Busca Vendas ou para alisson.confweb@gmail.com.</p>
      </section>
    );
  }

  return (
    <section className="bv-page legal-page">
      <button className="legal-back" type="button" onClick={onBack}>Voltar ao Busca Vendas</button>
      <span className="legal-kicker">Regras do serviço</span>
      <h1>Termos de Uso</h1>
      <p className="legal-updated">Última atualização: 28 de julho de 2026.</p>
      <h2>1. O serviço</h2>
      <p>O Busca Vendas ajuda a analisar o potencial comercial de produtos na internet a partir de anúncios e métricas públicas do Mercado Livre. Os resultados apoiam decisões comerciais, mas não constituem garantia de vendas, lucro ou desempenho futuro.</p>
      <h2>2. Conta e uso permitido</h2>
      <p>Você deve fornecer dados verdadeiros, proteger sua senha e usar a plataforma de forma lícita. É proibido compartilhar acesso, automatizar pesquisas sem autorização, tentar contornar limites ou interferir na segurança e disponibilidade do serviço.</p>
      <h2>3. Planos, cobrança e acesso</h2>
      <p>O plano grátis inclui uma pesquisa completa. Planos mensais são cobrados de forma recorrente no cartão; planos anuais são cobrados em pagamento único por Pix ou cartão. Em caso de inadimplência, cancelamento ou estorno, os recursos pagos podem ser suspensos até a regularização.</p>
      <h2>4. Dados de mercado</h2>
      <p>Preços, vendas e anúncios podem mudar ou deixar de estar públicos. A Confweb emprega cache e atualização periódica para reduzir custo e melhorar disponibilidade, informando a data da consulta quando aplicável.</p>
      <h2>5. Cancelamento e suporte</h2>
      <p>O cancelamento interrompe cobranças futuras, sem apagar registros financeiros que precisem ser mantidos por lei. Dúvidas, solicitações e problemas podem ser enviados pela área de suporte do aplicativo ou para alisson.confweb@gmail.com.</p>
    </section>
  );
}

function AdminPanel({ user, onSettingsChange }: { user: User; onSettingsChange: () => void }) {
  const [tab, setTab] = useState<"overview" | "searches" | "users" | "finance" | "contacts" | "tips" | "support" | "settings">("overview");
  const [data, setData] = useState<AdminData | null>(null);
  const [message, setMessage] = useState("");

  const load = async () => {
    const [summary, users, settings, tips, tickets, finance, contacts] = await Promise.all([
      api<AdminData["summary"]>("/api/admin/summary"),
      api<User[]>("/api/admin/users"),
      api<SettingsMap>("/api/admin/settings"),
      api<Tip[]>("/api/admin/tips"),
      api<Ticket[]>("/api/admin/support"),
      api<FinanceRecord[]>("/api/admin/finance"),
      api<Contact[]>("/api/admin/commercial-contacts"),
    ]);
    setData({ summary, users, settings, tips, tickets, finance, contacts });
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const meli = params.get("meli");
    if (!meli) {
      return;
    }

    const messages: Record<string, string> = {
      connected: "Mercado Livre conectado com sucesso.",
      error: "Erro ao conectar o Mercado Livre. Verifique App ID, Secret e Redirect URI.",
      invalid_state: "Sessão OAuth expirou. Tente conectar novamente.",
      unauthorized: "Somente administradores autorizados podem conectar o Mercado Livre.",
    };

    if (messages[meli]) {
      setMessage(messages[meli]);
      setTab("settings");
    }

    params.delete("meli");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, []);

  const afterSave = async (text = "Alteração salva.") => {
    setMessage(text);
    await load();
    onSettingsChange();
  };

  if (!data) {
    return <LoadingScreen />;
  }

  const tabs: { id: typeof tab; label: string; Icon: LucideIcon }[] = [
    { id: "overview", label: "Visão geral", Icon: LayoutDashboard },
    { id: "searches", label: "Base de pesquisas", Icon: Database },
    { id: "users", label: "Usuários", Icon: UsersRound },
    { id: "finance", label: "Financeiro", Icon: CreditCard },
    { id: "contacts", label: "Comercial", Icon: MessageCircle },
    { id: "tips", label: "Dicas", Icon: BookOpen },
    { id: "support", label: "Suporte", Icon: Headphones },
    { id: "settings", label: "Configurações", Icon: Settings },
  ];

  return (
    <section className="bv-page simple-page admin-page">
      <div className="admin-header">
        <div>
          <h1>Painel admin</h1>
          <p>Controle operação, financeiro, usuários, suporte, dicas e integrações de dados e pagamentos.</p>
        </div>
        {message && <span>{message}</span>}
      </div>
      <div className="admin-tabs">
        {tabs.map(({ id, label, Icon }) => (
          <button className={tab === id ? "active" : ""} key={id} type="button" onClick={() => setTab(id)}>
            <Icon size={18} />
            {label}
          </button>
        ))}
      </div>
      {tab === "overview" && <AdminOverview data={data} />}
      {tab === "searches" && <AdminSearchCache />}
      {tab === "users" && <AdminUsers currentUser={user} users={data.users} afterSave={afterSave} />}
      {tab === "finance" && <AdminFinance finance={data.finance} users={data.users} afterSave={afterSave} />}
      {tab === "contacts" && <AdminContacts contacts={data.contacts} settings={data.settings} afterSave={afterSave} />}
      {tab === "tips" && <AdminTips tips={data.tips} afterSave={afterSave} />}
      {tab === "support" && <AdminSupport tickets={data.tickets} afterSave={afterSave} />}
      {tab === "settings" && <AdminSettings settings={data.settings} afterSave={afterSave} />}
    </section>
  );
}

function AdminSearchCache() {
  const [data, setData] = useState<AdminSearchCacheData | null>(null);
  const [filter, setFilter] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [message, setMessage] = useState("");

  const load = async (query = filter) => {
    const params = new URLSearchParams();
    if (query.trim()) {
      params.set("q", query.trim());
    }
    const suffix = params.toString();
    const response = await api<AdminSearchCacheData>(`/api/admin/search-cache${suffix ? `?${suffix}` : ""}`);
    setData(response);
  };

  useEffect(() => {
    load("");
  }, []);

  const submitFilter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    await load(filter);
  };

  const refresh = async (record: AdminSearchCacheRecord) => {
    setBusyKey(record.key);
    setMessage("");
    try {
      const response = await api<{ message?: string }>("/api/admin/search-cache/refresh", {
        method: "POST",
        body: JSON.stringify({ key: record.key }),
      });
      setMessage(response.message || `Pesquisa "${record.query}" atualizada.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível atualizar a pesquisa.");
    } finally {
      setBusyKey("");
    }
  };

  const remove = async (record: AdminSearchCacheRecord) => {
    if (!window.confirm(`Excluir "${record.query}" da base compartilhada e dos históricos associados?`)) {
      return;
    }
    setBusyKey(record.key);
    setMessage("");
    try {
      await api("/api/admin/search-cache", {
        method: "DELETE",
        body: JSON.stringify({ key: record.key }),
      });
      setMessage(`Pesquisa "${record.query}" excluída da base interna.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível excluir a pesquisa.");
    } finally {
      setBusyKey("");
    }
  };

  if (!data) {
    return <LoadingScreen />;
  }

  return (
    <div className="admin-section search-cache-admin">
      <div className="cache-admin-intro">
        <div>
          <span>Banco compartilhado Confweb</span>
          <h2>Pesquisas reaproveitadas antes de consultar a API</h2>
          <p>
            Quando outro usuário procura o mesmo produto dentro de {data.ttlDays} dias, o Busca Vendas entrega esta base e economiza créditos.
          </p>
        </div>
        <form className="cache-filter" onSubmit={submitFilter}>
          <Search size={18} />
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Buscar produto na base" />
          <button type="submit">Buscar</button>
        </form>
      </div>

      <div className="cache-summary">
        <Stat title="Pesquisas salvas" value={number.format(data.summary.total)} icon={<Database />} />
        <Stat title="Bases atualizadas" value={number.format(data.summary.fresh)} icon={<RefreshCw />} />
        <Stat title="Reaproveitamentos" value={number.format(data.summary.historyUses)} icon={<UsersRound />} />
        <Stat title="Créditos poupados" value={number.format(data.summary.estimatedCreditsSaved)} icon={<WalletCards />} />
      </div>

      <div className="cache-legend">
        <span><i className="fresh" /> Atual: até {data.ttlDays} dias</span>
        <span><i className="stale" /> Atualização pendente: até {data.staleDays} dias</span>
        <span><i className="expired" /> Vencida: nova consulta necessária</span>
        <span>{number.format(data.summary.itemCache)} anúncios individuais reaproveitáveis</span>
      </div>

      {message && <p className="cache-admin-message">{message}</p>}

      <div className="cache-record-list">
        {data.records.length ? data.records.map((record) => (
          <article className="cache-record" key={record.key}>
            <div className="cache-record-main">
              <div className="cache-record-title">
                <span className={`cache-status ${record.status}`}>
                  {record.status === "fresh" ? "Atual" : record.status === "stale" ? "Atualizar em breve" : "Vencida"}
                </span>
                <div>
                  <h3>{record.query}</h3>
                  <small>Fonte: {historySourceLabel(record.source)} · Atualizada em {formatCacheDate(record.updated_at)}</small>
                </div>
              </div>
              <div className="cache-record-metrics">
                <span><small>Top anúncios</small><strong>{record.items_count}</strong></span>
                <span><small>Vendas</small><strong>{number.format(record.total_demand)}</strong></span>
                <span><small>Receita</small><strong>{money.format(record.total_revenue)}</strong></span>
                <span><small>Usada por</small><strong>{number.format(record.users_count)} usuário(s)</strong></span>
                <span><small>Acessos</small><strong>{number.format(record.usage_count)}</strong></span>
              </div>
            </div>

            <details className="cache-record-details">
              <summary>Ver anúncios salvos</summary>
              <div>
                {record.items.slice(0, 3).map((item, index) => (
                  <a href={item.permalink} target="_blank" rel="noreferrer" key={`${record.key}-${item.id || index}`}>
                    <b>{index + 1}. {item.title}</b>
                    <span>{number.format(Number(item.soldQuantity || 0))} vendas · {money.format(Number(item.price || 0))}</span>
                  </a>
                ))}
              </div>
            </details>

            <div className="cache-record-actions">
              <button type="button" onClick={() => refresh(record)} disabled={busyKey === record.key}>
                <RefreshCw size={17} />
                {busyKey === record.key ? "Atualizando..." : "Atualizar pela API"}
              </button>
              <button className="danger" type="button" onClick={() => remove(record)} disabled={busyKey === record.key}>
                <Trash2 size={17} />
                Excluir
              </button>
            </div>
          </article>
        )) : (
          <p className="muted-box">Nenhuma pesquisa encontrada nesta base.</p>
        )}
      </div>
    </div>
  );
}

function formatCacheDate(value: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR");
}

function AdminOverview({ data }: { data: AdminData }) {
  return (
    <div className="admin-grid">
      <Stat title="Usuários" value={number.format(data.summary.users)} icon={<UsersRound />} />
      <Stat title="Pesquisas" value={number.format(data.summary.searches)} icon={<Search />} />
      <Stat title="Receita paga" value={money.format(data.summary.revenue)} icon={<WalletCards />} />
      <Stat title="Suporte aberto" value={number.format(data.summary.tickets)} icon={<Headphones />} />
    </div>
  );
}

function Stat({ title, value, icon }: { title: string; value: string; icon: ReactNode }) {
  return (
    <article className="stat-card">
      {icon}
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  );
}

function AdminUsers({
  currentUser,
  users,
  afterSave,
}: {
  currentUser: User;
  users: User[];
  afterSave: (message?: string) => void | Promise<void>;
}) {
  const creator = isCreator(currentUser);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState("");

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    await api("/api/admin/users", { method: "POST", body: JSON.stringify(formJson(form)) });
    form.reset();
    afterSave();
  };

  const update = async (event: FormEvent<HTMLFormElement>, userId: number) => {
    event.preventDefault();
    const form = event.currentTarget;
    await api(`/api/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify(formJson(form)) });
    afterSave();
  };

  const remove = async (item: User) => {
    if (!window.confirm(`Excluir o usuário "${item.name}" (${item.email})? O acesso e o histórico de pesquisas dessa conta serão removidos.`)) {
      return;
    }

    setDeleteError("");
    setDeletingId(item.id);
    try {
      await api(`/api/admin/users/${item.id}`, { method: "DELETE" });
      await afterSave("Usuário excluído.");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Não foi possível excluir o usuário.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="admin-section">
      <form className="admin-form" onSubmit={create}>
        <input name="name" placeholder="Nome" required />
        <input name="email" type="email" placeholder="E-mail" required />
        <input name="phone" type="tel" placeholder="Telefone" />
        <select name="business_model" defaultValue="">
          <option value="">Modelo de negócio (opcional)</option>
          {Object.entries(BUSINESS_MODEL_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select name="marketplace_experience" defaultValue="">
          <option value="">Experiência (opcional)</option>
          {Object.entries(MARKETPLACE_EXPERIENCE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <input name="password" type="password" placeholder="Senha inicial" required />
        <select name="plan" defaultValue="free">
          <option value="free">Grátis</option>
          <option value="starter">10 pesquisas</option>
          <option value="scale">Ilimitado</option>
        </select>
        {creator && (
          <select name="role" defaultValue="user">
            <option value="user">Cliente</option>
            <option value="admin">Admin autorizado</option>
          </select>
        )}
        <input name="search_limit" type="number" placeholder="Limite" />
        <button type="submit">Criar usuário</button>
      </form>
      {deleteError && <p className="form-error">{deleteError}</p>}
      <div className="table-list">
        {users.map((item) => {
          const itemIsCreator = creator && item.email.toLowerCase() === currentUser.email.toLowerCase();
          const canDelete = item.id !== currentUser.id && (creator || item.role !== "admin");

          return (
            <form className="table-row" key={item.id} onSubmit={(event) => update(event, item.id)}>
              <input name="name" defaultValue={item.name} />
              <div className="user-contact-cell">
                <strong>{item.email}</strong>
                <small>{item.phone || "Sem telefone"}</small>
                <small>{businessModelLabel(item.business_model)}</small>
                <small>{marketplaceExperienceLabel(item.marketplace_experience)}</small>
              </div>
              <input name="phone" type="tel" defaultValue={item.phone || ""} placeholder="Telefone" />
              <select name="status" defaultValue={item.status}>
                <option value="active">Ativo</option>
                <option value="blocked">Bloqueado</option>
              </select>
              <select name="plan" defaultValue={item.plan}>
                <option value="free">Grátis</option>
                <option value="starter">10 pesquisas</option>
                <option value="scale">Ilimitado</option>
              </select>
              {creator ? (
                <select name="role" defaultValue={item.role} disabled={itemIsCreator}>
                  <option value="user">Cliente</option>
                  <option value="admin">Admin autorizado</option>
                </select>
              ) : (
                <span>{item.role === "admin" ? "Admin autorizado" : "Cliente"}</span>
              )}
              <input name="search_limit" type="number" defaultValue={item.search_limit ?? ""} placeholder="Ilimitado" />
              <input
                name="new_password"
                type="password"
                minLength={10}
                autoComplete="new-password"
                placeholder="Nova senha (opcional)"
                title="Use para definir uma senha temporária após confirmar a identidade do usuário."
              />
              <span>{itemIsCreator ? "Criador" : `${item.searches_used} usadas`}</span>
              <div className="user-row-actions">
                <button type="submit">Salvar</button>
                {canDelete && (
                  <button
                    className="danger-button"
                    type="button"
                    disabled={deletingId === item.id}
                    onClick={() => remove(item)}
                    title="Excluir usuário"
                  >
                    <Trash2 size={17} />
                    {deletingId === item.id ? "Excluindo..." : "Excluir"}
                  </button>
                )}
              </div>
            </form>
          );
        })}
      </div>
    </div>
  );
}

function AdminFinance({ finance, users, afterSave }: { finance: FinanceRecord[]; users: User[]; afterSave: () => void }) {
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const allSelected = finance.length > 0 && selectedIds.size === finance.length;

  useEffect(() => {
    const availableIds = new Set(finance.map((record) => record.id));
    setSelectedIds((current) => new Set([...current].filter((id) => availableIds.has(id))));
  }, [finance]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    await api("/api/admin/finance", { method: "POST", body: JSON.stringify(formJson(form)) });
    form.reset();
    afterSave();
  };

  const remove = async (record: FinanceRecord) => {
    if (!window.confirm(
      `Excluir "${record.description}" do financeiro interno?\n\nEssa ação não exclui nem estorna a cobrança no Asaas.`,
    )) {
      return;
    }

    setDeleteError("");
    setDeletingId(record.id);
    try {
      await api(`/api/admin/finance/${record.id}`, { method: "DELETE" });
      await afterSave();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Não foi possível excluir o registro.");
    } finally {
      setDeletingId(null);
    }
  };

  const toggleSelected = (recordId: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(recordId)) {
        next.delete(recordId);
      } else {
        next.add(recordId);
      }
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(finance.map((record) => record.id)));
  };

  const removeSelected = async () => {
    const ids = [...selectedIds];
    if (!ids.length || !window.confirm(
      `Excluir ${ids.length} registro(s) selecionado(s) do financeiro interno?\n\nEssa ação não exclui nem estorna cobranças no Asaas.`,
    )) {
      return;
    }

    setDeleteError("");
    setDeletingSelected(true);
    try {
      await api("/api/admin/finance", {
        method: "DELETE",
        body: JSON.stringify({ ids }),
      });
      setSelectedIds(new Set());
      await afterSave();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Não foi possível excluir os registros.");
    } finally {
      setDeletingSelected(false);
    }
  };

  return (
    <div className="admin-section">
      <form className="admin-form" onSubmit={create}>
        <select name="user_id" defaultValue="">
          <option value="">Sem usuário</option>
          {users.map((item) => <option key={item.id} value={item.id}>{item.email}</option>)}
        </select>
        <select name="type" defaultValue="subscription">
          <option value="subscription">Assinatura</option>
          <option value="manual">Manual</option>
          <option value="refund">Reembolso</option>
        </select>
        <input name="description" placeholder="Descrição" required />
        <input name="amount" type="number" step="0.01" placeholder="Valor" required />
        <select name="status" defaultValue="pending">
          <option value="pending">Pendente</option>
          <option value="paid">Pago</option>
          <option value="canceled">Cancelado</option>
        </select>
        <button type="submit">Registrar</button>
      </form>
      {deleteError && <p className="form-error">{deleteError}</p>}
      <div className="finance-bulk-toolbar">
        <label>
          <input
            type="checkbox"
            checked={allSelected}
            disabled={!finance.length || deletingSelected}
            onChange={toggleAll}
          />
          Selecionar todos
        </label>
        <span>{selectedIds.size} selecionado(s)</span>
        <button
          className="danger-button"
          type="button"
          disabled={!selectedIds.size || deletingSelected}
          onClick={removeSelected}
        >
          <Trash2 size={17} />
          {deletingSelected ? "Excluindo..." : "Excluir selecionados"}
        </button>
      </div>
      <div className="table-list">
        {finance.map((record) => (
          <article className="table-row finance-row" key={record.id}>
            <label className="finance-row-check" title={`Selecionar ${record.description}`}>
              <input
                type="checkbox"
                aria-label={`Selecionar ${record.description}`}
                checked={selectedIds.has(record.id)}
                disabled={deletingSelected}
                onChange={() => toggleSelected(record.id)}
              />
            </label>
            <strong>{record.description}</strong>
            <span>{record.user_email || "Sem usuário"}</span>
            <span>{record.type}</span>
            <span>{record.status}</span>
            <b>{money.format(record.amount)}</b>
            <button
              className="danger-button"
              type="button"
              disabled={deletingSelected || deletingId === record.id}
              onClick={() => remove(record)}
              title="Excluir registro interno"
            >
              <Trash2 size={17} />
              {deletingId === record.id ? "Excluindo..." : "Excluir"}
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

function AdminContacts({ contacts, settings, afterSave }: { contacts: Contact[]; settings: SettingsMap; afterSave: () => void }) {
  const saveCommercialCard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await api("/api/admin/settings", { method: "PATCH", body: JSON.stringify(formJson(event.currentTarget)) });
    afterSave();
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    await api("/api/admin/commercial-contacts", { method: "POST", body: JSON.stringify(formJson(form)) });
    form.reset();
    afterSave();
  };

  const update = async (event: FormEvent<HTMLFormElement>, contactId: number) => {
    event.preventDefault();
    const form = event.currentTarget;
    await api(`/api/admin/commercial-contacts/${contactId}`, { method: "PATCH", body: JSON.stringify(formJson(form)) });
    afterSave();
  };

  return (
    <div className="admin-section">
      <section className="settings-card commercial-content-editor">
        <div className="settings-card-heading">
          <div className="settings-card-title">
            <span className="settings-eyebrow">Card da página inicial</span>
            <h2>Treinamento e resultados da Confweb</h2>
            <p>Edite a chamada, a prova social, o botão da landing page e o suporte discreto exibidos ao lado das pesquisas.</p>
          </div>
        </div>
        <form className="settings-form" onSubmit={saveCommercialCard}>
          <div className="settings-grid commercial-editor-grid">
            <label>
              Chamada curta
              <input
                name="commercial_training_eyebrow"
                defaultValue={settings.commercial_training_eyebrow || defaultSettings.commercial_training_eyebrow}
                required
              />
            </label>
            <label>
              Texto do botão
              <input
                name="commercial_training_button"
                defaultValue={settings.commercial_training_button || defaultSettings.commercial_training_button}
                required
              />
            </label>
            <label className="wide">
              Título principal
              <textarea
                name="commercial_training_title"
                defaultValue={settings.commercial_training_title || defaultSettings.commercial_training_title}
                rows={3}
                required
              />
            </label>
            <label className="wide">
              Texto de autoridade e resultado
              <textarea
                name="commercial_training_body"
                defaultValue={settings.commercial_training_body || defaultSettings.commercial_training_body}
                rows={4}
                required
              />
            </label>
            <label className="wide">
              Link da landing page
              <input
                name="commercial_training_url"
                type="url"
                defaultValue={settings.commercial_training_url || defaultSettings.commercial_training_url}
                placeholder="https://www.confweb.com.br/sua-pagina"
                required
              />
            </label>
            <label>
              Chamada discreta do suporte
              <input
                name="commercial_support_text"
                defaultValue={settings.commercial_support_text || defaultSettings.commercial_support_text}
                required
              />
            </label>
            <label>
              Botão do suporte
              <input
                name="commercial_support_button"
                defaultValue={settings.commercial_support_button || defaultSettings.commercial_support_button}
                required
              />
            </label>
          </div>
          <div className="settings-card-actions">
            <button className="primary-action" type="submit">
              <Rocket size={18} />
              Salvar card comercial
            </button>
          </div>
        </form>
      </section>

      <div className="admin-section-heading commercial-contacts-heading">
        <div>
          <h2>Contatos da Confweb</h2>
          <p>O WhatsApp principal é usado no suporte discreto e nas chamadas comerciais da ferramenta.</p>
        </div>
      </div>
      <form className="admin-form" onSubmit={create}>
        <input name="name" placeholder="Nome" required />
        <input name="channel" placeholder="Canal: WhatsApp, E-mail, Site..." required />
        <input name="value" placeholder="Contato" required />
        <select name="is_primary" defaultValue="0">
          <option value="1">Principal</option>
          <option value="0">Secundário</option>
        </select>
        <select name="status" defaultValue="active">
          <option value="active">Ativo</option>
          <option value="inactive">Inativo</option>
        </select>
        <button type="submit">Adicionar contato</button>
      </form>
      <div className="table-list">
        {contacts.map((contact) => (
          <form className="table-row contact-admin-row" key={contact.id} onSubmit={(event) => update(event, contact.id)}>
            <input name="name" defaultValue={contact.name} required />
            <input name="channel" defaultValue={contact.channel} required />
            <input name="value" defaultValue={contact.value} required />
            <select name="is_primary" defaultValue={String(contact.is_primary ? 1 : 0)}>
              <option value="1">Principal</option>
              <option value="0">Secundário</option>
            </select>
            <select name="status" defaultValue={contact.status}>
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </select>
            <button type="submit">Salvar</button>
          </form>
        ))}
      </div>
    </div>
  );
}

function AdminTips({ tips, afterSave }: { tips: Tip[]; afterSave: () => void }) {
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    await api("/api/admin/tips", { method: "POST", body: JSON.stringify(formJson(form)) });
    form.reset();
    afterSave();
  };

  const update = async (event: FormEvent<HTMLFormElement>, tipId: number) => {
    event.preventDefault();
    const form = event.currentTarget;
    await api(`/api/admin/tips/${tipId}`, { method: "PATCH", body: JSON.stringify(formJson(form)) });
    afterSave();
  };

  return (
    <div className="admin-section">
      <form className="admin-form long" onSubmit={create}>
        <input name="title" placeholder="Título" required />
        <textarea name="body" placeholder="Conteúdo" required />
        <input name="cta" placeholder="CTA" defaultValue="Ler agora" />
        <select name="status" defaultValue="published">
          <option value="published">Publicado</option>
          <option value="draft">Rascunho</option>
        </select>
        <button type="submit">Publicar dica</button>
      </form>
      <div className="table-list">
        {tips.map((tip) => (
          <form className="tip-admin-row" key={tip.id} onSubmit={(event) => update(event, tip.id)}>
            <input name="title" defaultValue={tip.title} required />
            <textarea name="body" defaultValue={tip.body} required />
            <input name="cta" defaultValue={tip.cta} />
            <select name="status" defaultValue={tip.status}>
              <option value="published">Publicado</option>
              <option value="draft">Rascunho</option>
            </select>
            <button type="submit">Salvar dica</button>
          </form>
        ))}
      </div>
    </div>
  );
}

function AdminSupport({
  tickets,
  afterSave,
}: {
  tickets: Ticket[];
  afterSave: (message?: string) => void | Promise<void>;
}) {
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const update = async (event: FormEvent<HTMLFormElement>, ticketId: number) => {
    event.preventDefault();
    const form = event.currentTarget;
    setSavingId(ticketId);
    setError("");

    try {
      await api(`/api/admin/support/${ticketId}`, {
        method: "PATCH",
        body: JSON.stringify(formJson(form)),
      });
      await afterSave("Resposta do suporte salva.");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Não foi possível salvar a resposta.");
    } finally {
      setSavingId(null);
    }
  };

  if (!tickets.length) {
    return (
      <div className="support-admin-empty">
        <Headphones size={30} />
        <strong>Nenhum chamado recebido</strong>
        <p>Quando um usuário enviar uma dúvida pela área Suporte, ela aparecerá aqui para resposta.</p>
      </div>
    );
  }

  return (
    <div className="table-list">
      {error && <p className="form-error">{error}</p>}
      {tickets.map((ticket) => (
        <form className="support-admin-row" key={ticket.id} onSubmit={(event) => update(event, ticket.id)}>
          <div className="support-admin-summary">
            <strong>{ticket.subject}</strong>
            <span>{ticket.user_email || "Usuário"} · {formatCacheDate(ticket.created_at)}</span>
            <p>{ticket.message}</p>
          </div>
          <select name="status" defaultValue={ticket.status}>
            <option value="open">Aberto</option>
            <option value="waiting">Aguardando</option>
            <option value="closed">Fechado</option>
          </select>
          <select name="priority" defaultValue={ticket.priority}>
            <option value="low">Baixa</option>
            <option value="normal">Normal</option>
            <option value="high">Alta</option>
          </select>
          <textarea
            name="response"
            defaultValue={ticket.response || ""}
            placeholder="Escreva a resposta para o usuário"
            maxLength={3000}
          />
          <button type="submit" disabled={savingId === ticket.id}>
            {savingId === ticket.id ? "Salvando..." : "Responder"}
          </button>
        </form>
      ))}
    </div>
  );
}

function AdminSettings({ settings, afterSave }: { settings: SettingsMap; afterSave: (text?: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [asaasEnvironment, setAsaasEnvironment] = useState(settings.asaas_environment || "sandbox");
  const [oxylabsMode, setOxylabsMode] = useState(settings.oxylabs_mode || "web_unblocker");
  return <AdminSettingsSimple settings={settings} afterSave={afterSave} />;

  const showMeli = true;
  const showScrapeDo = true;
  const showZyte = false;
  const showOxylabs = settings.oxylabs_enabled === "true";
  const zyteSearchPages = settings.zyte_search_pages || "4";
  const zyteDetailLimit = settings.zyte_detail_limit || "60";
  const zyteIpType = settings.zyte_ip_type || "auto";
  const cacheTtlDays = settings.market_cache_ttl_days || "7";
  const minChampionSales = settings.min_champion_sales || "1000";
  const oxylabsEndpoint = oxylabsMode === "web_unblocker"
    ? "https://unblock.oxylabs.io:60000"
    : "https://realtime.oxylabs.io/v1/queries";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = formJson(form);
    payload.scrapedo_enabled = "true";
    payload.scrapedo_endpoint = "https://api.scrape.do/";
    payload.scrapedo_search_pages = "4";
    payload.scrapedo_detail_limit = "36";
    payload.zyte_search_enabled = "false";
    payload.zyte_mode = "browser_html";
    payload.zyte_endpoint = "https://api.zyte.com/v1/extract";
    payload.zyte_search_pages = "4";
    payload.zyte_detail_limit = "60";
    payload.meli_scraper_enabled = "false";
    payload.proxy_enabled = "false";
    payload.proxy_url = "";
    payload.min_champion_sales = "1000";
    payload.market_cache_ttl_days = "7";
    for (const key of ["asaas_api_key", "asaas_webhook_token", "meli_client_secret", "scrapedo_api_token", "proxy_password", "zyte_api_key", "oxylabs_password"]) {
      if (!payload[key]) {
        delete payload[key];
      }
    }
    await api("/api/admin/settings", { method: "PATCH", body: JSON.stringify(payload) });
    afterSave("Configurações de dados salvas.");
  };

  const testMeliCatalog = async () => {
    setConnectError("");
    setBusy(true);
    try {
      const data = await api<{ message?: string }>("/api/admin/meli/catalog-test", { method: "POST" });
      afterSave(data.message || "Catálogo oficial conectado com sucesso.");
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : "Falha ao testar o catálogo oficial.");
    } finally {
      setBusy(false);
    }
  };

  const testAsaas = async () => {
    setConnectError("");
    setBusy(true);
    try {
      const data = await api<{ message?: string }>("/api/admin/asaas/test", { method: "POST" });
      afterSave(data.message || "Asaas conectada com sucesso.");
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : "Falha ao testar Asaas.");
    } finally {
      setBusy(false);
    }
  };

  const testZyte = async () => {
    setConnectError("");
    setBusy(true);
    try {
      const data = await api<{ message?: string }>("/api/admin/zyte/test", { method: "POST" });
      afterSave(data.message || "Zyte conectada com sucesso.");
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : "Falha ao testar Zyte.");
    } finally {
      setBusy(false);
    }
  };

  const testScrapeDo = async () => {
    setConnectError("");
    setBusy(true);
    try {
      const data = await api<{ available?: boolean; message?: string; remainingCredits?: number | null }>("/api/admin/scrapedo/test", { method: "POST" });
      if (data.available === false) {
        setConnectError(data.message || "A conta Scrape.do está sem créditos.");
        afterSave(data.message || "A conta Scrape.do está sem créditos.");
        return;
      }
      const credits = Number(data.remainingCredits || 0);
      afterSave(credits > 0 ? `Scrape.do conectada. ${number.format(credits)} créditos disponíveis.` : data.message || "Scrape.do conectada com sucesso.");
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : "Falha ao testar Scrape.do.");
    } finally {
      setBusy(false);
    }
  };

  const testOxylabs = async () => {
    setConnectError("");
    setBusy(true);
    try {
      const data = await api<{ message?: string }>("/api/admin/oxylabs/test", { method: "POST" });
      afterSave(data.message || "Oxylabs conectado com sucesso.");
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : "Falha ao testar Oxylabs.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-section">
      {showMeli && (
        <section className="meli-connect-card">
          <div>
            <span>{settings.meli_oauth_connected ? "Fonte oficial conectada" : "Aguardando OAuth"}</span>
            <h2>Catálogo oficial Mercado Livre</h2>
            <p>
              Usa catálogo, anúncio vencedor e ranking de mais vendidos. Esta é a primeira fonte da pesquisa e fica invisível para o cliente.
            </p>
            <div className="credential-status">
              <b>App ID: {settings.meli_client_id ? "configurado" : "pendente"}</b>
              <b>Secret: {settings.meli_client_secret_configured ? "configurada" : "pendente"}</b>
              <b>OAuth: {settings.meli_oauth_connected ? "conectado" : "pendente"}</b>
            </div>
            <small>Salve App ID e Secret antes de conectar. O teste usa “creatina 1kg” e não consome pesquisa de cliente.</small>
            {settings.meli_last_error && <strong className="oauth-error">{settings.meli_last_error}</strong>}
            {connectError && <strong className="oauth-error">{connectError}</strong>}
          </div>
          <div className="meli-actions">
            {settings.meli_oauth_connected ? (
              <button className="connect-button" type="button" onClick={testMeliCatalog} disabled={busy}>
                <Search size={18} />
                {busy ? "Testando..." : "Testar catálogo"}
              </button>
            ) : (
              <button
                className="connect-button"
                type="button"
                onClick={() => window.location.assign("/api/admin/meli/connect")}
                disabled={busy || !settings.meli_client_id || !settings.meli_client_secret_configured}
              >
                <LogIn size={18} />
                Conectar Mercado Livre
              </button>
            )}
          </div>
        </section>
      )}

      <section className="meli-connect-card">
        <div>
          <span>{settings.asaas_connected ? "Pagamentos conectados" : "Aguardando API Key"}</span>
          <h2>Asaas Pagamentos</h2>
          <p>
            Configure Pix anual, cartão mensal e webhook. Os compradores pagam pela tela de checkout e o webhook libera o plano automaticamente.
          </p>
          <div className="credential-status">
            <b>API Key: {settings.asaas_api_key_configured ? "configurada" : "pendente"}</b>
            <b>Ambiente: {asaasEnvironment === "production" ? "produção" : "sandbox"}</b>
            <b>Webhook: {settings.asaas_webhook_token_configured ? "token configurado" : "token pendente"}</b>
          </div>
          <small>Webhook para cadastrar no Asaas: {settings.asaas_webhook_url || "/api/asaas/webhook"}</small>
          {settings.asaas_last_error && <strong className="oauth-error">{settings.asaas_last_error}</strong>}
          {connectError && <strong className="oauth-error">{connectError}</strong>}
        </div>
        <div className="meli-actions">
          <button className="connect-button" type="button" onClick={testAsaas} disabled={busy || !settings.asaas_connected}>
            <LogIn size={18} />
            {busy ? "Testando..." : "Testar Asaas"}
          </button>
        </div>
      </section>

      {showScrapeDo && (
        <section className="meli-connect-card">
          <div>
            <span>{settings.scrapedo_connected ? "Fallback residencial conectado" : "Aguardando token"}</span>
            <h2>Scrape.do</h2>
            <p>
              Completa as categorias em que a fonte oficial não retornar três anúncios. O cliente não vê nem configura esta integração.
            </p>
            <div className="credential-status">
              <b>Token: {settings.scrapedo_api_token_configured ? "configurado" : "pendente"}</b>
              <b>Rede: residencial brasileira</b>
              <b>Uso: somente após a fonte oficial</b>
              <b>Cache: {cacheTtlDays} dias</b>
            </div>
            <small>O plano gratuito permite validar a integração antes de contratar.</small>
            {settings.scrapedo_last_error && <strong className="oauth-error">{settings.scrapedo_last_error}</strong>}
            {connectError && <strong className="oauth-error">{connectError}</strong>}
          </div>
          <div className="meli-actions">
            <button className="connect-button" type="button" onClick={testScrapeDo} disabled={busy || !settings.scrapedo_connected}>
              <Search size={18} />
              {busy ? "Testando..." : "Testar Scrape.do"}
            </button>
          </div>
        </section>
      )}

      {showZyte && (
      <section className="meli-connect-card">
        <div>
          <span>{settings.zyte_connected ? "Fallback conectado" : "Fallback opcional"}</span>
          <h2>Zyte API</h2>
          <p>
            A Zyte só será consultada quando o catálogo oficial não completar três resultados reais.
          </p>
          <div className="credential-status">
            <b>API Key: {settings.zyte_api_key_configured ? "configurada" : "pendente"}</b>
            <b>Uso: automático como reserva</b>
            <b>Leitura: lista estruturada + HTML</b>
            <b>IP: {zyteIpType === "residential" ? "residencial brasileiro" : "automático"}</b>
            <b>Cache: {cacheTtlDays} dias</b>
          </div>
          <small>Não precisa configurar Mercado Livre, proxy ou navegador local para o cliente usar a ferramenta.</small>
          {settings.zyte_last_error && (
            <div className="integration-warning">
              <strong>Zyte conectada, mas sem Top 3 completo nessa última busca.</strong>
              <span>{settings.zyte_last_error}</span>
              <small>Quando a Zyte não entregar 3 anúncios completos, a busca não será consumida do cliente.</small>
            </div>
          )}
          {connectError && <strong className="oauth-error">{connectError}</strong>}
        </div>
        <div className="meli-actions">
          <button className="connect-button" type="button" onClick={testZyte} disabled={busy || !settings.zyte_connected}>
            <LogIn size={18} />
            {busy ? "Testando..." : "Testar Zyte"}
          </button>
        </div>
      </section>
      )}

      {showOxylabs && (
        <section className="meli-connect-card">
          <div>
            <span>{settings.oxylabs_connected ? "Fallback conectado" : "Fallback opcional"}</span>
            <h2>Oxylabs Web Unblocker</h2>
            <p>
              Mantenha a Oxylabs como fallback premium se quiser. Os compradores não veem nem preenchem esses dados.
            </p>
            <div className="credential-status">
              <b>Usuário: {settings.oxylabs_username ? "configurado" : "pendente"}</b>
              <b>Senha: {settings.oxylabs_password_configured ? "configurada" : "pendente"}</b>
            </div>
            <small>Para a tela "Integracao com o Desbloqueador Web", use Web Unblocker Proxy.</small>
            {settings.oxylabs_last_error && <strong className="oauth-error">{settings.oxylabs_last_error}</strong>}
            {connectError && <strong className="oauth-error">{connectError}</strong>}
          </div>
          <div className="meli-actions">
            <button className="connect-button" type="button" onClick={testOxylabs} disabled={busy || !settings.oxylabs_connected}>
              <LogIn size={18} />
              {busy ? "Testando..." : "Testar Oxylabs"}
            </button>
          </div>
        </section>
      )}

      <form className="settings-form" onSubmit={submit}>
        {showMeli && (
          <section className="settings-card">
            <div className="settings-card-title">
              <span>Pesquisa oficial</span>
              <h3>Mercado Livre</h3>
              <p>Credenciais usadas somente pelo servidor para consultar catálogo e ranking de mais vendidos.</p>
            </div>
            <div className="settings-grid">
              <label>
                Mercado Livre App ID
                <input name="meli_client_id" defaultValue={settings.meli_client_id || ""} inputMode="numeric" />
                <small className="field-hint">Número da aplicação no DevCenter.</small>
              </label>
              <label>
                Mercado Livre Secret Key
                <input
                  name="meli_client_secret"
                  type="password"
                  placeholder={settings.meli_client_secret_configured ? "Secret configurada" : "Cole a Secret Key"}
                />
                <small className="field-hint">
                  {settings.meli_client_secret_configured ? "Secret já configurada. Deixe em branco para manter." : "A chave nunca é enviada ao navegador do cliente."}
                </small>
              </label>
              <label className="wide">
                Redirect URI
                <input name="meli_redirect_uri" defaultValue={settings.meli_redirect_uri || ""} readOnly />
                <small className="field-hint">Cadastre exatamente esta URL no aplicativo do Mercado Livre.</small>
              </label>
            </div>
          </section>
        )}

        <section className="settings-card">
          <div className="settings-card-title">
            <span>Pagamentos</span>
            <h3>Asaas</h3>
            <p>Chave de cobrança, Pix, cartão e webhook que libera o plano depois do pagamento.</p>
          </div>
          <div className="settings-grid">
            <label>
              Asaas API Key
              <input name="asaas_api_key" type="password" placeholder={settings.asaas_api_key_configured ? "API Key configurada" : "Cole a API Key da Asaas"} />
              <small className="field-hint">
                {settings.asaas_api_key_configured ? "API Key ja configurada. Deixe em branco para manter." : "Use a chave do ambiente escolhido."}
              </small>
            </label>
            <label>
              Ambiente Asaas
              <select name="asaas_environment" value={asaasEnvironment} onChange={(event) => setAsaasEnvironment(event.target.value)}>
                <option value="sandbox">Sandbox</option>
                <option value="production">Producao</option>
              </select>
              <small className="field-hint">Sandbox para testes; produção para cobrar clientes reais.</small>
            </label>
            <label>
              Endpoint Asaas
              <input
                name="asaas_endpoint"
                defaultValue={settings.asaas_endpoint || (asaasEnvironment === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3")}
              />
              <small className="field-hint">Use o endpoint do mesmo ambiente da chave.</small>
            </label>
            <label>
              Token webhook Asaas
              <input name="asaas_webhook_token" type="password" placeholder={settings.asaas_webhook_token_configured ? "Token configurado" : "Crie um token forte"} />
              <small className="field-hint">Cadastre o mesmo token no painel Asaas em Webhooks.</small>
            </label>
            <label className="wide">
              URL webhook Asaas
              <input readOnly value={settings.asaas_webhook_url || "/api/asaas/webhook"} />
              <small className="field-hint">Copie esta URL para o painel Asaas depois que o domínio estiver no ar.</small>
            </label>
          </div>
        </section>

        {showScrapeDo && (
          <section className="settings-card">
            <div className="settings-card-title">
              <span>Fallback residencial</span>
              <h3>Scrape.do</h3>
              <p>Um token no servidor. Rede brasileira, rotação de IP e navegador ficam automáticos.</p>
            </div>
            <div className="settings-grid">
              <label className="wide">
                Token Scrape.do
                <input
                  name="scrapedo_api_token"
                  type="password"
                  placeholder={settings.scrapedo_api_token_configured ? "Token configurado" : "Cole o token da Scrape.do"}
                />
                <small className="field-hint">
                  {settings.scrapedo_api_token_configured ? "Token já configurado. Deixe em branco para manter." : "Copie o token exibido no dashboard da Scrape.do."}
                </small>
              </label>
              <div className="settings-summary-grid wide" aria-label="Configuração automática da Scrape.do">
                <div>
                  <span>Prioridade</span>
                  <strong>Depois da API oficial</strong>
                </div>
                <div>
                  <span>Rede</span>
                  <strong>Residencial Brasil</strong>
                </div>
                <div>
                  <span>Profundidade</span>
                  <strong>2 páginas / 9 anúncios</strong>
                </div>
                <div>
                  <span>Base interna</span>
                  <strong>Cache por {cacheTtlDays} dias</strong>
                </div>
              </div>
            </div>
          </section>
        )}

        {showZyte && (
        <section className="settings-card">
          <div className="settings-card-title">
            <span>Fallback opcional</span>
            <h3>Zyte</h3>
            <p>Use somente como reserva para categorias que não completarem o Top 3 pela fonte oficial.</p>
          </div>
          <div className="settings-grid">
            <label className="wide">
              Zyte API Key
              <input name="zyte_api_key" type="password" placeholder={settings.zyte_api_key_configured ? "API Key configurada" : "Cole sua API Key da Zyte"} />
              <small className="field-hint">
                {settings.zyte_api_key_configured ? "API Key já configurada. Deixe em branco para manter." : "Copie a API Key em Zyte API Access e clique em Salvar configurações."}
              </small>
            </label>
            <label>
              Rede usada pela Zyte
              <select name="zyte_ip_type" defaultValue={zyteIpType}>
                <option value="auto">Automática</option>
                <option value="residential">Residencial brasileira</option>
              </select>
              <small className="field-hint">
                O modo residencial exige aprovação KYC da Zyte. Ative somente depois que o acesso for liberado.
              </small>
            </label>
            <label>
              País da pesquisa
              <input name="zyte_geolocation" defaultValue={settings.zyte_geolocation || "BR"} readOnly />
              <small className="field-hint">Brasil, para preços e resultados do Mercado Livre brasileiro.</small>
            </label>
            <div className="settings-summary-grid wide" aria-label="Configuração automática da Zyte">
              <div>
                <span>Prioridade</span>
                <strong>Depois da fonte oficial</strong>
              </div>
              <div>
                <span>Modo de leitura</span>
                <strong>ProductList + HTML</strong>
              </div>
              <div>
                <span>Profundidade</span>
                <strong>{zyteSearchPages} páginas / {zyteDetailLimit} anúncios</strong>
              </div>
              <div>
                <span>Base interna</span>
                <strong>Cache por {cacheTtlDays} dias</strong>
              </div>
              <div>
                <span>Top 3 campeão</span>
                <strong>Mínimo {number.format(Number(minChampionSales) || 1000)} vendas</strong>
              </div>
              <div>
                <span>Motor local e proxy</span>
                <strong>Desligados</strong>
              </div>
            </div>
          </div>
        </section>
        )}

        {showOxylabs && (
          <section className="settings-card">
            <div className="settings-card-title">
              <span>Fallback opcional</span>
              <h3>Oxylabs</h3>
              <p>Use apenas se quiser manter uma fonte reserva premium para desbloqueio de páginas.</p>
            </div>
            <div className="settings-grid">
              <label>
                Tipo de integração
                <select name="oxylabs_mode" value={oxylabsMode} onChange={(event) => setOxylabsMode(event.target.value)}>
                  <option value="web_unblocker">Web Unblocker Proxy</option>
                  <option value="web_scraper_api">Web Scraper API Realtime</option>
                </select>
                <small className="field-hint">Use Web Unblocker Proxy para as credenciais do print da Oxylabs.</small>
              </label>
              <label>
                Oxylabs Username
                <input name="oxylabs_username" defaultValue={settings.oxylabs_username || ""} placeholder="Usuário da API Oxylabs" />
                <small className="field-hint">Copie o nome de usuário exibido na Oxylabs.</small>
              </label>
              <label>
                Oxylabs Password
                <input name="oxylabs_password" type="password" placeholder={settings.oxylabs_password_configured ? "Senha configurada" : "Senha da API Oxylabs"} />
                <small className="field-hint">
                  {settings.oxylabs_password_configured ? "Senha ja configurada. Deixe em branco para manter." : "Cole a senha do API User da Oxylabs."}
                </small>
              </label>
              <label>
                Região da consulta
                <input name="oxylabs_geo_location" defaultValue={settings.oxylabs_geo_location || "Brazil"} />
                <small className="field-hint">Use Brazil para buscar como usuário brasileiro.</small>
              </label>
              <label>
                Endpoint Oxylabs
                <input key={oxylabsMode} name="oxylabs_endpoint" defaultValue={oxylabsEndpoint} />
                <small className="field-hint">
                  {oxylabsMode === "web_unblocker" ? "Padrão do Desbloqueador Web: unblock.oxylabs.io:60000." : "Padrão da API Realtime: realtime.oxylabs.io/v1/queries."}
                </small>
              </label>
            </div>
          </section>
        )}

        <section className="settings-card">
          <div className="settings-card-title">
            <span>Comercial</span>
            <h3>Planos e CTA</h3>
            <p>Valores exibidos na página de planos e chamada para o comercial da Confweb.</p>
          </div>
          <div className="settings-grid">
            <label>
              Plano 10 pesquisas mensal
              <input name="starter_monthly" defaultValue={settings.starter_monthly} />
            </label>
            <label>
              Plano 10 pesquisas anual
              <input name="starter_yearly" defaultValue={settings.starter_yearly} />
            </label>
            <label>
              Plano ilimitado mensal
              <input name="scale_monthly" defaultValue={settings.scale_monthly} />
            </label>
            <label>
              Plano ilimitado anual
              <input name="scale_yearly" defaultValue={settings.scale_yearly} />
            </label>
            <label className="wide">
              CTA comercial
              <input name="commercial_cta" defaultValue={settings.commercial_cta} />
            </label>
          </div>
        </section>

        <div className="settings-save-bar">
          <div>
            <strong>Salvar configurações</strong>
            <span>Aplica pagamentos, fontes de dados, planos e textos comerciais.</span>
          </div>
          <button type="submit">Salvar tudo</button>
        </div>
      </form>
    </div>
  );
}

type SettingsAccordionKey = "search" | "meli" | "scrapedo" | "payments";

function SettingsAccordionTrigger({
  id,
  title,
  description,
  status,
  Icon,
  open,
  onToggle,
}: {
  id: SettingsAccordionKey;
  title: string;
  description: string;
  status: string;
  Icon: LucideIcon;
  open: boolean;
  onToggle: (id: SettingsAccordionKey) => void;
}) {
  return (
    <button
      className="settings-accordion-trigger"
      type="button"
      aria-expanded={open}
      aria-controls={`settings-panel-${id}`}
      onClick={() => onToggle(id)}
    >
      <span className="settings-accordion-icon" aria-hidden="true">
        <Icon size={22} />
      </span>
      <span className="settings-accordion-copy">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <span className="settings-accordion-status">{status}</span>
      <ChevronDown className="settings-accordion-chevron" size={22} aria-hidden="true" />
    </button>
  );
}

function AdminSettingsSimple({ settings, afterSave }: { settings: SettingsMap; afterSave: (text?: string) => void }) {
  const [busy, setBusy] = useState<"provider-save" | "meli-save" | "meli-test" | "meli-disconnect" | "asaas-save" | "asaas-test" | "scrapedo-save" | "scrapedo-test" | "">("");
  const [providerMode, setProviderMode] = useState(settings.market_search_provider || "auto");
  const [providerError, setProviderError] = useState("");
  const [meliError, setMeliError] = useState("");
  const [redirectCopied, setRedirectCopied] = useState(false);
  const [meliDiagnostic, setMeliDiagnostic] = useState<MeliDiagnostic | null>(null);
  const [asaasError, setAsaasError] = useState("");
  const [scrapeDoError, setScrapeDoError] = useState("");
  const [openSections, setOpenSections] = useState<Record<SettingsAccordionKey, boolean>>({
    search: false,
    meli: false,
    scrapedo: false,
    payments: false,
  });

  const toggleSection = (section: SettingsAccordionKey) => {
    setOpenSections((current) => ({ ...current, [section]: !current[section] }));
  };

  const saveSearchProvider = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProviderError("");
    setBusy("provider-save");
    try {
      const data = await api<{ message?: string; mode?: string }>("/api/admin/search-provider/configure", {
        method: "POST",
        body: JSON.stringify({ mode: providerMode }),
      });
      if (data.mode) {
        setProviderMode(data.mode);
      }
      await afterSave(data.message || "Motor de busca atualizado.");
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : "Não foi possível salvar o motor de busca.");
    } finally {
      setBusy("");
    }
  };

  const saveAndConnectMeli = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload = formJson(event.currentTarget);
    setMeliError("");
    setBusy("meli-save");
    try {
      await api("/api/admin/meli/configure", {
        method: "POST",
        body: JSON.stringify({
          clientId: payload.meli_client_id || "",
          clientSecret: payload.meli_client_secret || "",
        }),
      });
      window.location.assign("/api/admin/meli/connect");
    } catch (error) {
      setMeliError(error instanceof Error ? error.message : "Não foi possível salvar a integração do Mercado Livre.");
      setBusy("");
    }
  };

  const testMeli = async () => {
    setMeliError("");
    setBusy("meli-test");
    try {
      const data = await api<MeliDiagnostic & { message?: string }>("/api/admin/meli/test", { method: "POST" });
      setMeliDiagnostic(data);
      afterSave(data.message || data.summary || "Diagnóstico oficial concluído.");
    } catch (error) {
      setMeliError(error instanceof Error ? error.message : "Não foi possível validar o Mercado Livre.");
    } finally {
      setBusy("");
    }
  };

  const disconnectMeli = async () => {
    setMeliError("");
    setBusy("meli-disconnect");
    try {
      await api("/api/admin/meli/disconnect", { method: "POST" });
      afterSave("Mercado Livre desconectado. O Client ID e a Secret Key foram mantidos.");
    } catch (error) {
      setMeliError(error instanceof Error ? error.message : "Não foi possível desconectar o Mercado Livre.");
    } finally {
      setBusy("");
    }
  };

  const copyMeliRedirectUri = async () => {
    try {
      await navigator.clipboard.writeText(settings.meli_redirect_uri || "");
      setRedirectCopied(true);
      window.setTimeout(() => setRedirectCopied(false), 2200);
    } catch {
      setMeliError("Não consegui copiar automaticamente. Selecione a URL e copie manualmente.");
    }
  };

  const saveAsaas = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = formJson(form);

    setAsaasError("");
    setBusy("asaas-save");
    try {
      const setup = await api<{ message?: string }>("/api/admin/asaas/configure", {
        method: "POST",
        body: JSON.stringify({ apiKey: payload.asaas_api_key || "" }),
      });
      form.reset();
      afterSave(setup.message || "Asaas salvo, validado e pronto para testar.");
    } catch (error) {
      setAsaasError(error instanceof Error ? error.message : "Não foi possível salvar o Asaas.");
    } finally {
      setBusy("");
    }
  };

  const testAsaas = async () => {
    setAsaasError("");
    setBusy("asaas-test");
    try {
      const data = await api<{ message?: string }>("/api/admin/asaas/setup", { method: "POST" });
      afterSave(data.message || "Asaas e webhook validados com sucesso.");
    } catch (error) {
      setAsaasError(error instanceof Error ? error.message : "Não foi possível validar o Asaas.");
    } finally {
      setBusy("");
    }
  };

  const saveAndTestScrapeDo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = formJson(form);
    setScrapeDoError("");
    setBusy("scrapedo-save");
    try {
      const data = await api<{
        available?: boolean;
        ok?: boolean;
        error?: string;
        message?: string;
        remainingCredits?: number | null;
      }>("/api/admin/scrapedo/configure", {
        method: "POST",
        body: JSON.stringify({
          token: payload.scrapedo_api_token || "",
          cacheTtlDays: payload.market_cache_ttl_days || settings.market_cache_ttl_days || "7",
        }),
      });
      form.reset();
      if (data.ok === false) {
        setScrapeDoError(data.error || "O token foi salvo, mas a API não respondeu corretamente.");
        afterSave("Token da Scrape.do salvo. O teste de conexão precisa ser revisado.");
        return;
      }
      if (data.available === false) {
        setScrapeDoError(data.message || "Token válido, mas a conta Scrape.do está sem créditos.");
        afterSave(data.message || "Token válido, mas a conta Scrape.do está sem créditos.");
        return;
      }
      const credits = Number(data.remainingCredits || 0);
      afterSave(
        credits > 0
          ? `Scrape.do conectada. ${number.format(credits)} créditos disponíveis.`
          : data.message || "Token salvo e Scrape.do validada.",
      );
    } catch (error) {
      setScrapeDoError(error instanceof Error ? error.message : "Não foi possível salvar o token da Scrape.do.");
    } finally {
      setBusy("");
    }
  };

  const testScrapeDo = async () => {
    setScrapeDoError("");
    setBusy("scrapedo-test");
    try {
      const data = await api<{ available?: boolean; message?: string; remainingCredits?: number | null }>("/api/admin/scrapedo/test", { method: "POST" });
      if (data.available === false) {
        setScrapeDoError(data.message || "A conta Scrape.do está sem créditos.");
        afterSave(data.message || "A conta Scrape.do está sem créditos.");
        return;
      }
      const credits = Number(data.remainingCredits || 0);
      afterSave(
        credits > 0
          ? `Scrape.do conectada. ${number.format(credits)} créditos disponíveis.`
          : data.message || "Scrape.do validada com sucesso.",
      );
    } catch (error) {
      setScrapeDoError(error instanceof Error ? error.message : "Não foi possível validar a Scrape.do.");
    } finally {
      setBusy("");
    }
  };

  const isBusy = Boolean(busy);

  return (
    <div className="admin-section settings-simple">
      <form className="settings-card settings-accordion-item provider-mode-card" onSubmit={saveSearchProvider}>
        <SettingsAccordionTrigger
          id="search"
          title="Motor de busca"
          description="Defina qual fonte atende pesquisas que ainda não estão na base interna."
          status={providerMode === "meli_only" ? "Somente Mercado Livre" : providerMode === "scrapedo_only" ? "Somente Scrape.do" : "Automático"}
          Icon={Search}
          open={openSections.search}
          onToggle={toggleSection}
        />

        <div className="settings-accordion-content" id="settings-panel-search" hidden={!openSections.search}>

        <div className="settings-grid settings-grid-compact">
          <label className="wide">
            Motor usado quando não houver resultado salvo
            <select
              name="market_search_provider"
              value={providerMode}
              onChange={(event) => setProviderMode(event.target.value)}
            >
              <option value="auto">Automático: Mercado Livre primeiro</option>
              <option value="meli_only">Somente Mercado Livre</option>
              <option value="scrapedo_only">Somente Scrape.do</option>
            </select>
            <small className="field-hint">
              {providerMode === "meli_only"
                ? "Não usa créditos da Scrape.do, mesmo se a API oficial não completar o resultado."
                : providerMode === "scrapedo_only"
                  ? "Ignora a API oficial e usa a Scrape.do para produtos que não estiverem na base interna."
                  : "Tenta todas as rotas oficiais do Mercado Livre. A Scrape.do só entra se elas não completarem o resultado."}
            </small>
          </label>
        </div>

        <p className="integration-note provider-priority-note">
          Prioridade real: base interna, Mercado Livre oficial e, somente no modo automático, Scrape.do como emergência.
        </p>

        {providerError && <strong className="oauth-error">{providerError}</strong>}

        <div className="settings-card-actions">
          <button className="primary-action" type="submit" disabled={isBusy}>
            <Database size={18} />
            {busy === "provider-save" ? "Salvando..." : "Salvar motor de busca"}
          </button>
        </div>
        </div>
      </form>

      <section className="settings-accordion-group" aria-labelledby="settings-api-title">
        <div className="settings-accordion-group-heading">
          <span>Integrações</span>
          <div>
            <h3 id="settings-api-title">APIs</h3>
            <p>Abra somente a integração que deseja configurar ou testar.</p>
          </div>
        </div>

      <form className="settings-card settings-accordion-item" onSubmit={saveAndConnectMeli}>
        <SettingsAccordionTrigger
          id="meli"
          title="Mercado Livre"
          description="Credenciais, autorização OAuth e diagnóstico da fonte oficial."
          status={settings.meli_oauth_connected ? "Conectado" : "Pendente"}
          Icon={PackageSearch}
          open={openSections.meli}
          onToggle={toggleSection}
        />

        <div className="settings-accordion-content" id="settings-panel-meli" hidden={!openSections.meli}>

        <div className="integration-setup-guide">
          <div>
            <span>1</span>
            <p><b>Cadastre a URL de retorno</b> abaixo na aplicação do Mercado Livre.</p>
          </div>
          <div>
            <span>2</span>
            <p><b>Cole o Client ID e a Secret Key</b> exibidos no DevCenter.</p>
          </div>
          <div>
            <span>3</span>
            <p><b>Clique em salvar e conectar</b> e autorize a conta principal uma única vez.</p>
          </div>
        </div>

        <div className="settings-grid">
          <label>
            Client ID
            <input
              name="meli_client_id"
              defaultValue={settings.meli_client_id || ""}
              inputMode="numeric"
              pattern="[0-9]+"
              placeholder="Ex.: 1234567890123456"
              required
            />
            <small className="field-hint">Use o número da aplicação, não o e-mail da conta.</small>
          </label>
          <label>
            Secret Key
            <input
              name="meli_client_secret"
              type="password"
              autoComplete="off"
              placeholder={settings.meli_client_secret_configured ? "Secret Key já salva; deixe em branco para manter" : "Cole a Secret Key"}
            />
            <small className="field-hint">A chave fica protegida no servidor e nunca aparece para os compradores.</small>
          </label>
          <label className="wide">
            URL de retorno para cadastrar no Mercado Livre
            <div className="copy-field">
              <input readOnly value={settings.meli_redirect_uri || ""} />
              <button type="button" onClick={copyMeliRedirectUri} disabled={!settings.meli_redirect_uri} title="Copiar URL de retorno">
                {redirectCopied ? <CircleCheck size={18} /> : <ClipboardCopy size={18} />}
                {redirectCopied ? "Copiada" : "Copiar"}
              </button>
            </div>
            <small className="field-hint">Cole exatamente esta URL em URIs de redirect no DevCenter.</small>
          </label>
        </div>

        {(meliError || settings.meli_last_error) && (
          <strong className="oauth-error">{meliError || settings.meli_last_error}</strong>
        )}

        {meliDiagnostic && (
          <section className={`meli-diagnostic ${meliDiagnostic.readyForBuscaVendas ? "is-ready" : "is-limited"}`}>
            <div className="meli-diagnostic-heading">
              <div>
                <span>Diagnóstico oficial</span>
                <h4>{meliDiagnostic.readyForBuscaVendas ? "API pronta para pesquisas" : "OAuth válido, acesso de dados limitado"}</h4>
              </div>
              <b>{meliDiagnostic.readyForBuscaVendas ? "Operacional" : "Aguardando liberação"}</b>
            </div>
            <div className="meli-diagnostic-grid">
              {meliDiagnostic.checks.map((check) => (
                <div className={check.ok ? "diagnostic-check is-ok" : "diagnostic-check is-blocked"} key={check.key}>
                  {check.ok ? <CircleCheck size={18} /> : <CircleAlert size={18} />}
                  <div>
                    <strong>{check.label}</strong>
                    <small>{check.detail}</small>
                  </div>
                </div>
              ))}
            </div>
            <p>{meliDiagnostic.summary}</p>
            <small>Teste realizado somente na API oficial, sem consumir créditos da Scrape.do.</small>
          </section>
        )}

        <p className="integration-note">
          Depois da autorização, todos os usuários pesquisam pela integração central. Eles não veem nem preenchem estas credenciais. A Scrape.do continua disponível como apoio quando a API oficial não liberar um dado público.
        </p>

        <div className="settings-card-actions">
          <button className="primary-action" type="submit" disabled={isBusy}>
            <LogIn size={18} />
            {busy === "meli-save"
              ? "Salvando..."
              : settings.meli_oauth_connected
                ? "Salvar e reconectar"
                : "Salvar e conectar"}
          </button>
          {settings.meli_oauth_connected && (
            <>
              <button className="secondary-action" type="button" onClick={testMeli} disabled={isBusy}>
                {busy === "meli-test" ? "Diagnosticando..." : "Diagnóstico oficial"}
              </button>
              <button className="secondary-action danger-action" type="button" onClick={disconnectMeli} disabled={isBusy}>
                {busy === "meli-disconnect" ? "Desconectando..." : "Desconectar"}
              </button>
            </>
          )}
        </div>
        </div>
      </form>

      <form className="settings-card settings-accordion-item" onSubmit={saveAndTestScrapeDo}>
        <SettingsAccordionTrigger
          id="scrapedo"
          title="Scrape.do"
          description="Token, créditos, atualização da base e testes da fonte de emergência."
          status={settings.scrapedo_connected ? "Conectada" : "Pendente"}
          Icon={Database}
          open={openSections.scrapedo}
          onToggle={toggleSection}
        />

        <div className="settings-accordion-content" id="settings-panel-scrapedo" hidden={!openSections.scrapedo}>

        <div className="settings-grid settings-grid-compact">
          <label className="wide">
            Token da Scrape.do
            <input
              name="scrapedo_api_token"
              type="password"
              autoComplete="off"
              placeholder={settings.scrapedo_api_token_configured ? "Token já salvo; deixe em branco para manter" : "Cole seu token aqui"}
            />
            <small className="field-hint">
              Aceita o token puro, uma URL da Scrape.do ou um valor começando com token=.
            </small>
          </label>
          <label>
            Atualizar pesquisas salvas
            <select name="market_cache_ttl_days" defaultValue={settings.market_cache_ttl_days || "7"}>
              <option value="3">A cada 3 dias</option>
              <option value="7">A cada 7 dias</option>
              <option value="14">A cada 14 dias</option>
            </select>
            <small className="field-hint">Enquanto atualiza, o último resultado completo continua disponível.</small>
          </label>
        </div>

        <div className="settings-summary-grid" aria-label="Resumo da base interna">
          <div>
            <span>Pesquisas prontas</span>
            <strong>{number.format(Number(settings.market_cache_entries || 0))}</strong>
          </div>
          <div>
            <span>Anúncios reaproveitáveis</span>
            <strong>{number.format(Number(settings.market_item_cache_entries || 0))}</strong>
          </div>
          <div>
            <span>Atualização dos anúncios</span>
            <strong>A cada {settings.market_cache_ttl_days || "7"} dias</strong>
          </div>
          <div>
            <span>Créditos registrados no mês</span>
            <strong>
              {number.format(Number(settings.scrapedo_monthly_credits_used || 0))}
              {" / "}
              {number.format(Number(settings.scrapedo_monthly_credit_budget || 0))}
            </strong>
          </div>
          <div>
            <span>Saldo atual na Scrape.do</span>
            <strong>
              {settings.scrapedo_provider_remaining_credits
                ? number.format(Number(settings.scrapedo_provider_remaining_credits))
                : "Teste a conexão"}
            </strong>
          </div>
          <div>
            <span>Consultas externas no mês</span>
            <strong>{number.format(Number(settings.scrapedo_provider_searches || 0))}</strong>
          </div>
          <div>
            <span>Fila da API agora</span>
            <strong>{number.format(Number(settings.scrapedo_queued_requests || 0))}</strong>
          </div>
        </div>

        {(scrapeDoError || settings.scrapedo_last_error) && (
          <strong className="oauth-error">{scrapeDoError || settings.scrapedo_last_error}</strong>
        )}

        <div className="settings-card-actions">
          <button className="primary-action" type="submit" disabled={isBusy}>
            <Search size={18} />
            {busy === "scrapedo-save" ? "Salvando e testando..." : "Salvar e testar API"}
          </button>
          {settings.scrapedo_api_token_configured && (
            <button className="secondary-action" type="button" onClick={testScrapeDo} disabled={isBusy}>
              {busy === "scrapedo-test" ? "Testando..." : "Testar token salvo"}
            </button>
          )}
        </div>
        </div>
      </form>
      </section>

      <form className="settings-card settings-accordion-item" onSubmit={saveAsaas}>
        <SettingsAccordionTrigger
          id="payments"
          title="Pagamentos"
          description="Configure a Asaas, o ambiente de cobrança e o webhook."
          status={settings.asaas_api_key_configured ? (settings.asaas_environment === "production" ? "Produção" : "Sandbox") : "Pendente"}
          Icon={CreditCard}
          open={openSections.payments}
          onToggle={toggleSection}
        />

        <div className="settings-accordion-content" id="settings-panel-payments" hidden={!openSections.payments}>

        <div className="settings-grid">
          <label className="wide">
            Asaas API Key
            <input
              name="asaas_api_key"
              type="password"
              autoComplete="off"
              placeholder={settings.asaas_api_key_configured ? "API Key já salva; deixe em branco para manter" : "Cole a API Key da Asaas"}
            />
            <small className="field-hint">A chave informa automaticamente se o ambiente é Sandbox ou Produção.</small>
          </label>
          <label>
            Ambiente detectado
            <input readOnly value={settings.asaas_environment === "production" ? "Produção oficial" : "Sandbox para testes"} />
          </label>
          <label>
            URL do webhook
            <input readOnly value={settings.asaas_webhook_url || "/api/asaas/webhook"} />
          </label>
        </div>

        <div className="asaas-test-guide">
          <div>
            <span>1</span>
            <p><b>Cole a API Key.</b> O Busca Vendas identifica o ambiente e valida a conta sem criar cobrança.</p>
          </div>
          <div>
            <span>2</span>
            <p><b>Salve uma vez.</b> O webhook seguro é criado automaticamente no Asaas.</p>
          </div>
          <div>
            <span>3</span>
            <p><b>Abra Planos.</b> No Sandbox você testa; em Produção as cobranças são reais.</p>
          </div>
          {settings.asaas_last_event && (
            <small>Último evento recebido: {settings.asaas_last_event}</small>
          )}
        </div>

        {(asaasError || (settings.asaas_webhook_ready !== "true" && settings.asaas_last_error)) && (
          <strong className="oauth-error">
            {asaasError || settings.asaas_last_error}
          </strong>
        )}

        <div className="settings-card-actions">
          <button className="primary-action" type="submit" disabled={isBusy}>
            <CreditCard size={18} />
            {busy === "asaas-save" ? "Salvando e validando..." : "Salvar e preparar Asaas"}
          </button>
          {settings.asaas_api_key_configured && (
            <button className="secondary-action" type="button" onClick={testAsaas} disabled={isBusy}>
              {busy === "asaas-test" ? "Validando..." : "Validar chave e webhook"}
            </button>
          )}
        </div>
        </div>
      </form>
    </div>
  );
}

export default App;
