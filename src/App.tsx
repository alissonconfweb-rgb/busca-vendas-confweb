import {
  BarChart3,
  BookOpen,
  ChevronRight,
  CreditCard,
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
  Search,
  Settings,
  Sparkles,
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
type Mode = "search" | "history" | "plans" | "learn" | "commercial" | "support" | "admin";

type User = {
  id: number;
  name: string;
  email: string;
  role: Role;
  status: string;
  plan: Plan;
  search_limit: number | null;
  searches_used: number;
  can_admin?: boolean;
  is_creator?: boolean;
};

type SettingsMap = Record<string, string>;

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
};

type SearchResult = {
  ok: boolean;
  source: string;
  metricsMode?: "sales" | "market_signal";
  salesAvailable?: boolean;
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

type HistoryRecord = {
  id: number;
  query: string;
  source: string;
  total_demand: number;
  total_revenue: number;
  created_at: string;
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
  commercial_cta: "Falar com Comercial Confweb",
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
];

const searchSteps = [
  "Abrindo o Mercado Livre",
  "Filtrando produto exato",
  "Validando anúncios reais",
  "Selecionando Top 3",
];

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const data = response.status === 204 ? null : await response.json();

  if (!response.ok) {
    throw new ApiError(data?.error || data?.message || "Erro na requisição.", response.status);
  }

  return data as T;
}

function formJson(form: HTMLFormElement) {
  return Object.fromEntries(new FormData(form).entries());
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
    api<{ user: User | null }>("/api/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setCheckingSession(false));
  }, []);

  if (checkingSession) {
    return <LoadingScreen />;
  }

  return <ProductApp user={user} onUserChange={setUser} />;
}

function ProductApp({ user, onUserChange }: { user: User | null; onUserChange: (user: User | null) => void }) {
  const [mode, setMode] = useState<Mode>("search");
  const [loginOpen, setLoginOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsMap>(defaultSettings);
  const [tips, setTips] = useState<Tip[]>(defaultTips);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [contacts, setContacts] = useState<Contact[]>(defaultContacts);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

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

  const requireLogin = () => {
    if (user) {
      return true;
    }
    setLoginOpen(true);
    return false;
  };

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    onUserChange(null);
    setMode("search");
  };

  return (
    <div className="bv-shell">
      <Sidebar
        mode={mode}
        user={user}
        settings={settings}
        onMode={setMode}
        onLogin={() => setLoginOpen(true)}
      />
      <main className="bv-main">
        <TopBar
          user={user}
          onMode={setMode}
          onLogin={() => setLoginOpen(true)}
          onLogout={logout}
        />
        {mode === "search" && (
          <SearchPage
            user={user}
            settings={settings}
            tips={tips}
            contacts={contacts}
            onLoginRequired={requireLogin}
            onHistoryRefresh={() => setRefreshKey((key) => key + 1)}
          />
        )}
        {mode === "history" && <HistoryPage user={user} history={history} onLoginRequired={requireLogin} />}
        {mode === "plans" && <PlansPage settings={settings} onLoginRequired={requireLogin} />}
        {mode === "learn" && <LearnPage tips={tips} />}
        {mode === "commercial" && <CommercialPage contacts={contacts} cta={settings.commercial_cta} />}
        {mode === "support" && (
          <SupportPage
            user={user}
            tickets={tickets}
            onTicketsChange={setTickets}
            onLoginRequired={requireLogin}
          />
        )}
        {mode === "admin" && user && canUseAdmin(user) && (
          <AdminPanel user={user} onSettingsChange={() => setRefreshKey((key) => key + 1)} />
        )}
      </main>
      {loginOpen && (
        <LoginModal
          onClose={() => setLoginOpen(false)}
          onLogin={(loggedUser) => {
            onUserChange(loggedUser);
            setLoginOpen(false);
          }}
        />
      )}
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
      <img src={confwebLogoUrl} alt="Confweb" />
      <div>
        <strong>Busca<br />Vendas</strong>
        <span>by Confweb</span>
      </div>
    </div>
  );
}

function Sidebar({
  mode,
  user,
  settings,
  onMode,
  onLogin,
}: {
  mode: Mode;
  user: User | null;
  settings: SettingsMap;
  onMode: (mode: Mode) => void;
  onLogin: () => void;
}) {
  const navItems: { mode: Mode; label: string; Icon: LucideIcon }[] = [
    { mode: "search", label: "Nova pesquisa", Icon: Search },
    { mode: "history", label: "Minhas pesquisas", Icon: BarChart3 },
    { mode: "plans", label: "Planos", Icon: CreditCard },
    { mode: "learn", label: "Aprenda", Icon: BookOpen },
    { mode: "commercial", label: "Comercial Confweb", Icon: UserRound },
  ];

  if (canUseAdmin(user)) {
    navItems.push({ mode: "admin", label: "Painel admin", Icon: LayoutDashboard });
  }

  return (
    <aside className="bv-sidebar">
      <BrandMark />
      <nav className="sidebar-nav" aria-label="Navegação principal">
        {navItems.map(({ mode: itemMode, label, Icon }) => (
          <button
            className={mode === itemMode ? "active" : ""}
            key={itemMode}
            type="button"
            onClick={() => onMode(itemMode)}
          >
            <Icon size={22} />
            {label}
          </button>
        ))}
      </nav>
      <PlanStatus user={user} settings={settings} onLogin={onLogin} />
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
        <button type="button" onClick={() => onMode("learn")}>
          <Sparkles size={19} />
          Dicas
        </button>
        <button type="button" onClick={() => onMode("support")}>
          <Headphones size={20} />
          Suporte
        </button>
        {user ? (
          <button type="button" onClick={onLogout}>
            <LogOut size={20} />
            Sair
          </button>
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

function PlanStatus({ user, settings, onLogin }: { user: User | null; settings: SettingsMap; onLogin: () => void }) {
  const planLabel = user?.plan === "scale" ? "Ilimitado" : user?.plan === "starter" ? "10 pesquisas" : "Grátis";
  const limit = user?.search_limit ?? 1;
  const used = user?.searches_used ?? 0;
  const remaining = user?.search_limit === null ? "Sem limite" : `${Math.max(0, limit - used)} de ${limit}`;
  const usage =
    user?.search_limit === null
      ? 100
      : Math.max(0, Math.min(100, ((limit - used) / Math.max(1, limit)) * 100));

  return (
    <section className="plan-card">
      <span>Plano atual</span>
      <strong>{planLabel}</strong>
      <small>Pesquisas completas restantes</small>
      <b>{remaining}</b>
      <div className="usage-track">
        <i style={{ width: `${usage}%` }} />
      </div>
      <button type="button" onClick={onLogin}>
        {user ? `Planos desde ${money.format(Number(settings.starter_monthly || 19.9))}` : "Ver planos"}
      </button>
    </section>
  );
}

function SearchPage({
  user,
  settings,
  tips,
  contacts,
  onLoginRequired,
  onHistoryRefresh,
}: {
  user: User | null;
  settings: SettingsMap;
  tips: Tip[];
  contacts: Contact[];
  onLoginRequired: () => boolean;
  onHistoryRefresh: () => void;
}) {
  const [query, setQuery] = useState("fone bluetooth");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeQuery, setActiveQuery] = useState(query);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState("");
  const [cost, setCost] = useState(32);
  const [feeRate, setFeeRate] = useState(16);
  const [operationalCost, setOperationalCost] = useState(7);
  const resultsRef = useRef<HTMLDivElement>(null);

  const canSeeMargin = canUseAdmin(user) || (user?.plan && user.plan !== "free");
  const averageTicket = result?.totals.averageTicket || 0;
  const margin = useMemo(() => {
    const fee = averageTicket * (feeRate / 100);
    const contribution = averageTicket - cost - fee - operationalCost;
    return { fee, contribution, percent: averageTicket ? (contribution / averageTicket) * 100 : 0 };
  }, [averageTicket, cost, feeRate, operationalCost]);

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

  const submitSearch = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!onLoginRequired()) {
      return;
    }

    const cleanQuery = query.trim();
    if (!cleanQuery) {
      setError("Digite o produto que deseja validar.");
      return;
    }

    setActiveQuery(cleanQuery);
    setLoading(true);
    setError("");
    setResult(null);
    window.setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    const minimumFeedback = new Promise<void>((resolve) => window.setTimeout(resolve, 1800));
    try {
      const data = await api<SearchResult>(`/api/search?q=${encodeURIComponent(cleanQuery)}`);
      await minimumFeedback;
      setResult(data);
      onHistoryRefresh();
    } catch (apiError) {
      await minimumFeedback;
      setError(apiError instanceof Error ? apiError.message : "Não foi possível buscar agora.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bv-page">
      <section className="search-heading">
        <h1>Descubra se vale vender antes de comprar estoque</h1>
        <p>Digite uma palavra-chave e valide a demanda antes de comprar estoque.</p>
      </section>

      <form className="hero-search" onSubmit={submitSearch}>
        <Search size={23} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Digite uma palavra-chave" />
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

      <section className="search-grid">
        <div className="left-stack" ref={resultsRef}>
          {error && <p className="inline-error">{error}</p>}
          <ResultsPanel query={activeQuery} result={result} loading={loading} elapsedMs={elapsedMs} contacts={contacts} />
          <PlansPreview settings={settings} />
          <LearnPreview tips={tips} />
        </div>
        <aside className="right-stack">
          <DemandCard result={result} />
          <MarginCard
            locked={!canSeeMargin}
            averageTicket={averageTicket}
            cost={cost}
            feeRate={feeRate}
            operationalCost={operationalCost}
            margin={margin}
            onCost={setCost}
            onFeeRate={setFeeRate}
            onOperationalCost={setOperationalCost}
          />
          <CommercialMini contacts={contacts} />
        </aside>
      </section>
    </div>
  );
}

function whatsappHref(contacts: Contact[], query: string, salesPotential: number) {
  const contact = contacts.find((item) => /whats/i.test(item.channel)) || contacts[0];
  const digits = (contact?.value || "").replace(/\D/g, "");
  const phone = digits.startsWith("55") ? digits : digits ? `55${digits}` : "5511999999999";
  const message = [
    `Olá, Confweb! Pesquisei "${query}" no Busca Vendas.`,
    `Vi potencial de ${money.format(salesPotential)} nos 3 anúncios campeões.`,
    "Quero ajuda para vender nos marketplaces.",
  ].join(" ");

  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function ResultsPanel({
  query,
  result,
  loading = false,
  elapsedMs = 0,
  contacts,
}: {
  query: string;
  result: SearchResult | null;
  loading?: boolean;
  elapsedMs?: number;
  contacts: Contact[];
}) {
  const marketUrl = `https://lista.mercadolivre.com.br/${encodeURIComponent(query)}`;
  const items = result?.items ?? [];
  const hasItems = items.length > 0;
  const marketSignalMode = result?.metricsMode === "market_signal" || result?.salesAvailable === false;
  const publicPageMode = result?.source === "mercado_livre_scraper";
  const salesPotential = result?.totals.revenue || 0;
  const commercialHref = whatsappHref(contacts, query, salesPotential);
  const sourceText = result
    ? result.ok
      ? publicPageMode
        ? "Fonte: Mercado Livre - página pública"
        : marketSignalMode
        ? "Fonte: Mercado Livre - pagina publica"
        : "Fonte: Mercado Livre - atualizado agora"
      : result.source === "meli_forbidden"
        ? "Fonte: Mercado Livre - API aguardando liberação"
        : result.source === "market_data_pending"
          ? "Fonte: validação em andamento"
        : "Fonte: Mercado Livre - integração pendente"
    : "Fonte: Mercado Livre - aguardando pesquisa";
  const emptyHelp = result?.source === "meli_forbidden"
    ? "A conexão OAuth está válida. Para vendas reais por anúncio, precisamos da liberação oficial da API de Search ou de um provedor autorizado."
    : result?.source === "market_data_pending"
      ? "Assim que a fonte oficial retornar, você verá anúncios, demanda, ticket médio e margem com dados completos."
    : result
      ? "O Busca Vendas não mostra números simulados: use somente dados liberados pelo Mercado Livre."
      : "Entre com sua conta e busque um produto para consultar demanda, preço e concorrência.";

  return (
    <section className="market-panel">
      <div className="panel-head">
        <div>
          <h2>Top 3 anúncios campeões</h2>
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
          <strong>{result ? result.message : "Faça uma pesquisa real no Mercado Livre."}</strong>
          <p>{emptyHelp}</p>
        </div>
      )}

      {!loading && hasItems && (
        <div className="result-list">
          {items.map((item, index) => (
            <article className="result-row" key={item.id}>
              <span className="rank">{index + 1}</span>
              <img src={item.image} alt="" />
              <div className="product-copy">
                <h3>{item.title}</h3>
                <p>{item.subtitle || "Anúncio ativo no Mercado Livre"}</p>
              </div>
              <Metric
                label="Qtd. vendas"
                value={formatCountOrLabel(item.soldQuantity, item.salesMetricLabel, item.estimatedSoldQuantity)}
              />
              <Metric label="Preço" value={money.format(item.price)} />
              <Metric label="Receita" value={formatMoneyOrLabel(item.revenue, item.revenueMetricLabel, item.estimatedRevenue)} />
              <a className="row-arrow" href={item.permalink} target="_blank" rel="noreferrer" aria-label="Abrir anúncio">
                <ChevronRight size={24} />
              </a>
            </article>
          ))}
          <div className="market-cta">
            <div>
              <strong>
                Seu produto tem potencial: {money.format(salesPotential)} em vendas.
              </strong>
              <p>Bora pegar uma fatia desse mercado? Venda nos maiores marketplaces do Brasil com a Confweb.</p>
            </div>
            <a href={commercialHref} target="_blank" rel="noreferrer">
              Falar com a Confweb
              <MessageCircle size={18} />
            </a>
          </div>
        </div>
      )}
    </section>
  );
}

function SearchProgress({ query, elapsedMs }: { query: string; elapsedMs: number }) {
  const seconds = Math.floor(elapsedMs / 1000);
  const currentStep = Math.min(searchSteps.length - 1, Math.floor(seconds / 8));
  const progress = Math.min(92, 12 + seconds * 2.6);
  const statusText =
    seconds < 12
      ? "Conectando com o Mercado Livre e buscando os 3 anúncios campeões."
      : seconds < 28
        ? "Comparando títulos para evitar produto parecido ou medida errada."
        : "Finalizando o Top 3; no modo provisório essa etapa pode levar um pouco mais.";

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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatCountOrLabel(value: number | null | undefined, fallback = "Não divulgado", estimatedValue?: number | null) {
  if (typeof value === "number") {
    return number.format(value);
  }
  if (typeof estimatedValue === "number" && estimatedValue > 0) {
    return number.format(estimatedValue);
  }
  return fallback;
}

function formatMoneyOrLabel(value: number | null | undefined, fallback = "Aguardando API", estimatedValue?: number | null) {
  if (typeof value === "number") {
    return money.format(value);
  }
  if (typeof estimatedValue === "number" && estimatedValue > 0) {
    return money.format(estimatedValue);
  }
  return fallback;
}

function DemandCard({ result }: { result: SearchResult | null }) {
  const championCount = result?.items?.length || 0;

  return (
    <section className="demand-card">
      <div className="section-title">
        <BarChart3 size={26} />
        <h2>Demanda estimada</h2>
      </div>
      <dl>
        <div>
          <dt>Vendas totais nos 3</dt>
          <dd className="blue-value">
            {number.format(result?.totals.demand || 0)}
          </dd>
        </div>
        <div>
          <dt>Receita total dos 3</dt>
          <dd className="orange-value">{money.format(result?.totals.revenue || 0)}</dd>
        </div>
        <div>
          <dt>Ticket médio</dt>
          <dd>{money.format(result?.totals.averageTicket || 0)}</dd>
        </div>
        <div>
          <dt>Anúncios campeões</dt>
          <dd>{championCount ? `${number.format(championCount)} selecionados` : "0"}</dd>
        </div>
      </dl>
    </section>
  );
}

function MarginCard({
  locked,
  averageTicket,
  cost,
  feeRate,
  operationalCost,
  margin,
  onCost,
  onFeeRate,
  onOperationalCost,
}: {
  locked: boolean;
  averageTicket: number;
  cost: number;
  feeRate: number;
  operationalCost: number;
  margin: { fee: number; contribution: number; percent: number };
  onCost: (value: number) => void;
  onFeeRate: (value: number) => void;
  onOperationalCost: (value: number) => void;
}) {
  return (
    <section className="margin-card">
      <div className="section-title">
        <LineChart size={26} />
        <h2>Margem de contribuição</h2>
        {locked && <Lock className="lock-mark" size={24} />}
      </div>
      {locked ? (
        <div className="locked-margin">
          <Lock size={46} />
          <strong>Bloqueado no plano grátis</strong>
          <p>Assine para calcular margem com custo, taxa e operação.</p>
        </div>
      ) : (
        <div className="margin-form">
          <label>
            Custo do produto
            <input type="number" value={cost} onChange={(event) => onCost(Number(event.target.value))} />
          </label>
          <label>
            Taxa marketplace (%)
            <input type="number" value={feeRate} onChange={(event) => onFeeRate(Number(event.target.value))} />
          </label>
          <label>
            Custo operacional
            <input type="number" value={operationalCost} onChange={(event) => onOperationalCost(Number(event.target.value))} />
          </label>
          <dl>
            <div>
              <dt>Preço médio</dt>
              <dd>{money.format(averageTicket)}</dd>
            </div>
            <div>
              <dt>Taxa estimada</dt>
              <dd>{money.format(margin.fee)}</dd>
            </div>
            <div>
              <dt>Margem</dt>
              <dd>{money.format(margin.contribution)} ({margin.percent.toFixed(1)}%)</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}

function PlansPreview({ settings }: { settings: SettingsMap }) {
  return (
    <section className="wide-panel plans-preview">
      <div>
        <h2>Escolha um plano e desbloqueie todo o potencial</h2>
        <p>Comece com uma pesquisa gratuita e evolua para análises completas quando precisar validar estoque com segurança.</p>
      </div>
      <div className="mini-plan-grid">
        <MiniPlan title="10 pesquisas" price={money.format(Number(settings.starter_monthly || 19.9))} note={`${money.format(Number(settings.starter_yearly || 179.1))}/ano`} />
        <MiniPlan title="Ilimitado" price={money.format(Number(settings.scale_monthly || 39.9))} note={`${money.format(Number(settings.scale_yearly || 359.1))}/ano`} featured />
      </div>
    </section>
  );
}

function MiniPlan({ title, price, note, featured = false }: { title: string; price: string; note: string; featured?: boolean }) {
  return (
    <article className={featured ? "mini-plan featured" : "mini-plan"}>
      <span>{title}</span>
      <strong>{price}<small>/mês</small></strong>
      <p>{note}</p>
    </article>
  );
}

function LearnPreview({ tips }: { tips: Tip[] }) {
  return (
    <section className="wide-panel">
      <div className="panel-head compact">
        <div>
          <h2>Aprenda a vender online com menos risco</h2>
          <p>Cards de educação e nutrição para quem está começando.</p>
        </div>
      </div>
      <div className="learn-grid">
        {tips.slice(0, 3).map((tip) => (
          <article className="learn-card" key={tip.id}>
            <BookOpen size={22} />
            <strong>{tip.title}</strong>
            <p>{tip.body}</p>
            <span>{tip.cta}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function CommercialMini({ contacts }: { contacts: Contact[] }) {
  return (
    <section className="commercial-mini">
      <MessageCircle size={24} />
      <h2>Comercial Confweb</h2>
      {contacts.slice(0, 2).map((contact) => (
        <p key={contact.id}>
          <strong>{contact.name}</strong>
          {contact.channel}: {contact.value}
        </p>
      ))}
    </section>
  );
}

function HistoryPage({ user, history, onLoginRequired }: { user: User | null; history: HistoryRecord[]; onLoginRequired: () => boolean }) {
  if (!user) {
    return <AccessPrompt title="Entre para ver suas pesquisas" onLoginRequired={onLoginRequired} />;
  }

  return (
    <section className="bv-page simple-page">
      <h1>Minhas pesquisas</h1>
      <p>Histórico real salvo por usuário.</p>
      <div className="table-list">
        {history.length ? history.map((record) => (
          <article className="history-row" key={record.id}>
            <strong>{record.query}</strong>
            <span>{record.source}</span>
            <b>{number.format(record.total_demand)} vendas</b>
            <b>{money.format(record.total_revenue)}</b>
            <small>{new Date(record.created_at).toLocaleString("pt-BR")}</small>
          </article>
        )) : <p className="muted-box">Você ainda não fez pesquisas.</p>}
      </div>
    </section>
  );
}

function PlansPage({ settings, onLoginRequired }: { settings: SettingsMap; onLoginRequired: () => boolean }) {
  return (
    <section className="bv-page simple-page">
      <h1>Planos</h1>
      <p>Modelo comercial do Busca Vendas - Confweb.</p>
      <div className="plans-grid">
        <PlanBox title="Grátis" price="R$ 0,00" items={["1 pesquisa", "Margem bloqueada", "Entrada para validar a ferramenta"]} onAction={onLoginRequired} />
        <PlanBox title="10 pesquisas" price={`${money.format(Number(settings.starter_monthly || 19.9))}/mês`} items={[`${money.format(Number(settings.starter_yearly || 179.1))}/ano`, "25% de desconto no anual", "Margem completa"]} onAction={onLoginRequired} />
        <PlanBox title="Ilimitado" price={`${money.format(Number(settings.scale_monthly || 39.9))}/mês`} items={[`${money.format(Number(settings.scale_yearly || 359.1))}/ano`, "Pesquisas completas ilimitadas", "Margem completa"]} onAction={onLoginRequired} featured />
      </div>
    </section>
  );
}

function PlanBox({ title, price, items, featured = false, onAction }: { title: string; price: string; items: string[]; featured?: boolean; onAction: () => boolean }) {
  return (
    <article className={featured ? "plan-box featured" : "plan-box"}>
      <span>{title}</span>
      <strong>{price}</strong>
      {items.map((item) => <p key={item}>{item}</p>)}
      <button type="button" onClick={onAction}>Selecionar plano</button>
    </article>
  );
}

function LearnPage({ tips }: { tips: Tip[] }) {
  return (
    <section className="bv-page simple-page">
      <h1>Dicas</h1>
      <p>Conteúdo editável pelo painel admin para educar e nutrir novos vendedores.</p>
      <div className="learn-grid full">
        {tips.map((tip) => (
          <article className="learn-card" key={tip.id}>
            <BookOpen size={24} />
            <strong>{tip.title}</strong>
            <p>{tip.body}</p>
            <span>{tip.cta}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function CommercialPage({ contacts, cta }: { contacts: Contact[]; cta?: string }) {
  return (
    <section className="bv-page simple-page">
      <h1>{cta || "Falar com Comercial Confweb"}</h1>
      <p>Contatos gerenciados pelo painel admin.</p>
      <div className="contact-grid">
        {contacts.map((contact) => (
          <article className="contact-card" key={contact.id}>
            <MessageCircle size={25} />
            <strong>{contact.name}</strong>
            <span>{contact.channel}</span>
            <p>{contact.value}</p>
          </article>
        ))}
      </div>
    </section>
  );
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

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onLoginRequired()) {
      return;
    }
    const form = event.currentTarget;
    const ticket = await api<Ticket>("/api/support", {
      method: "POST",
      body: JSON.stringify(formJson(form)),
    });
    onTicketsChange([ticket, ...tickets]);
    form.reset();
    setMessage("Chamado aberto com sucesso.");
  };

  if (!user) {
    return <AccessPrompt title="Entre para abrir suporte" onLoginRequired={onLoginRequired} />;
  }

  return (
    <section className="bv-page simple-page">
      <h1>Suporte</h1>
      <p>Abra chamados reais e acompanhe resposta do admin.</p>
      <form className="support-form" onSubmit={submit}>
        <input name="subject" placeholder="Assunto" required />
        <select name="priority" defaultValue="normal">
          <option value="low">Baixa</option>
          <option value="normal">Normal</option>
          <option value="high">Alta</option>
        </select>
        <textarea name="message" placeholder="Descreva sua dúvida" required />
        <button type="submit">Enviar suporte</button>
      </form>
      {message && <p className="success-text">{message}</p>}
      <div className="ticket-list">
        {tickets.map((ticket) => (
          <article key={ticket.id}>
            <strong>{ticket.subject}</strong>
            <span>{ticket.status} · {ticket.priority}</span>
            <p>{ticket.response || ticket.message}</p>
          </article>
        ))}
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

function LoginModal({ onClose, onLogin }: { onClose: () => void; onLogin: (user: User) => void }) {
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [showPassword, setShowPassword] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const data = await api<{ user: User }>(authMode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        body: JSON.stringify(formJson(event.currentTarget)),
      });
      onLogin(data.user);
    } catch (apiError) {
      setError(apiError instanceof Error ? apiError.message : "Não foi possível entrar.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Login">
      <form className="login-modal" onSubmit={submit}>
        <button className="modal-close" type="button" onClick={onClose} aria-label="Fechar login">
          <X size={20} />
        </button>
        <BrandMark />
        <h2>{authMode === "login" ? "Acesso seguro" : "Criar conta grátis"}</h2>
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
        <label>
          Senha
          <div className="password-field">
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              minLength={6}
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
        </label>
        {authMode === "register" && <p className="login-note">Plano grátis liberado com 1 pesquisa completa.</p>}
        {error && <p className="form-error">{error}</p>}
        <button className="login-submit" type="submit" disabled={submitting}>
          {authMode === "login" ? <LogIn size={19} /> : <UserRound size={19} />}
          {submitting ? "Aguarde..." : authMode === "login" ? "Entrar" : "Criar conta"}
        </button>
      </form>
    </div>
  );
}

function AdminPanel({ user, onSettingsChange }: { user: User; onSettingsChange: () => void }) {
  const [tab, setTab] = useState<"overview" | "users" | "finance" | "contacts" | "tips" | "support" | "settings">("overview");
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
      unauthorized: "Somente o criador pode conectar o Mercado Livre.",
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
          <p>Controle operação, financeiro, usuários, suporte, dicas e integração Mercado Livre.</p>
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
      {tab === "users" && <AdminUsers currentUser={user} users={data.users} afterSave={afterSave} />}
      {tab === "finance" && <AdminFinance finance={data.finance} users={data.users} afterSave={afterSave} />}
      {tab === "contacts" && <AdminContacts contacts={data.contacts} afterSave={afterSave} />}
      {tab === "tips" && <AdminTips tips={data.tips} afterSave={afterSave} />}
      {tab === "support" && <AdminSupport tickets={data.tickets} afterSave={afterSave} />}
      {tab === "settings" && <AdminSettings settings={data.settings} afterSave={afterSave} />}
    </section>
  );
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

function AdminUsers({ currentUser, users, afterSave }: { currentUser: User; users: User[]; afterSave: () => void }) {
  const creator = isCreator(currentUser);

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

  return (
    <div className="admin-section">
      <form className="admin-form" onSubmit={create}>
        <input name="name" placeholder="Nome" required />
        <input name="email" type="email" placeholder="E-mail" required />
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
      <div className="table-list">
        {users.map((item) => {
          const itemIsCreator = creator && item.email.toLowerCase() === currentUser.email.toLowerCase();

          return (
            <form className="table-row" key={item.id} onSubmit={(event) => update(event, item.id)}>
              <input name="name" defaultValue={item.name} />
              <strong>{item.email}</strong>
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
              <span>{itemIsCreator ? "Criador" : `${item.searches_used} usadas`}</span>
              <button type="submit">Salvar</button>
            </form>
          );
        })}
      </div>
    </div>
  );
}

function AdminFinance({ finance, users, afterSave }: { finance: FinanceRecord[]; users: User[]; afterSave: () => void }) {
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    await api("/api/admin/finance", { method: "POST", body: JSON.stringify(formJson(form)) });
    form.reset();
    afterSave();
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
      <div className="table-list">
        {finance.map((record) => (
          <article className="table-row" key={record.id}>
            <strong>{record.description}</strong>
            <span>{record.user_email || "Sem usuário"}</span>
            <span>{record.type}</span>
            <span>{record.status}</span>
            <b>{money.format(record.amount)}</b>
          </article>
        ))}
      </div>
    </div>
  );
}

function AdminContacts({ contacts, afterSave }: { contacts: Contact[]; afterSave: () => void }) {
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    await api("/api/admin/commercial-contacts", { method: "POST", body: JSON.stringify(formJson(form)) });
    form.reset();
    afterSave();
  };

  return (
    <div className="admin-section">
      <form className="admin-form" onSubmit={create}>
        <input name="name" placeholder="Nome" required />
        <input name="channel" placeholder="Canal: WhatsApp, E-mail..." required />
        <input name="value" placeholder="Contato" required />
        <select name="is_primary" defaultValue="0">
          <option value="1">Principal</option>
          <option value="0">Secundário</option>
        </select>
        <button type="submit">Adicionar contato</button>
      </form>
      <div className="contact-grid">
        {contacts.map((contact) => (
          <article className="contact-card" key={contact.id}>
            <MessageCircle size={22} />
            <strong>{contact.name}</strong>
            <span>{contact.channel}</span>
            <p>{contact.value}</p>
          </article>
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
      <div className="learn-grid full">
        {tips.map((tip) => (
          <article className="learn-card" key={tip.id}>
            <BookOpen size={22} />
            <strong>{tip.title}</strong>
            <span>{tip.status}</span>
          </article>
        ))}
      </div>
    </div>
  );
}

function AdminSupport({ tickets, afterSave }: { tickets: Ticket[]; afterSave: () => void }) {
  const update = async (event: FormEvent<HTMLFormElement>, ticketId: number) => {
    event.preventDefault();
    const form = event.currentTarget;
    await api(`/api/admin/support/${ticketId}`, { method: "PATCH", body: JSON.stringify(formJson(form)) });
    afterSave();
  };

  return (
    <div className="table-list">
      {tickets.map((ticket) => (
        <form className="support-admin-row" key={ticket.id} onSubmit={(event) => update(event, ticket.id)}>
          <div>
            <strong>{ticket.subject}</strong>
            <span>{ticket.user_email || "Usuário"} · {ticket.message}</span>
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
          <input name="response" defaultValue={ticket.response || ""} placeholder="Resposta" />
          <button type="submit">Responder</button>
        </form>
      ))}
    </div>
  );
}

function AdminSettings({ settings, afterSave }: { settings: SettingsMap; afterSave: (text?: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [connectError, setConnectError] = useState("");
  const redirectUri = settings.meli_redirect_uri || `${window.location.origin}/api/meli/callback`;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = formJson(form);
    for (const key of ["meli_access_token", "meli_refresh_token", "meli_client_secret"]) {
      if (!payload[key]) {
        delete payload[key];
      }
    }
    await api("/api/admin/settings", { method: "PATCH", body: JSON.stringify(payload) });
    afterSave();
  };

  const connect = async () => {
    setConnectError("");
    setBusy(true);
    window.location.href = "/api/admin/meli/connect";
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await api("/api/admin/meli/disconnect", { method: "POST" });
      afterSave("Mercado Livre desconectado.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-section">
      <section className="meli-connect-card">
        <div>
          <span>{settings.meli_oauth_connected ? "Conectado" : "Aguardando conexão"}</span>
          <h2>Mercado Livre OAuth</h2>
          <p>
            Configure as credenciais do app Mercado Livre, salve e clique em conectar. Os compradores não veem nem preenchem esses dados.
          </p>
          <div className="credential-status">
            <b>App ID: {settings.meli_client_id ? "configurado" : "pendente"}</b>
            <b>Secret Key: {settings.meli_client_secret_configured ? "configurada" : "pendente"}</b>
          </div>
          <small>Redirect URI para cadastrar no app: {redirectUri}</small>
          {settings.meli_last_error && <strong className="oauth-error">{settings.meli_last_error}</strong>}
          {connectError && <strong className="oauth-error">{connectError}</strong>}
        </div>
        <div className="meli-actions">
          <button className="connect-button" type="button" onClick={connect} disabled={busy}>
            <LogIn size={18} />
            {settings.meli_oauth_connected ? "Reconectar Mercado Livre" : "Conectar Mercado Livre"}
          </button>
          {settings.meli_oauth_connected && (
            <button type="button" onClick={disconnect} disabled={busy}>
              Desconectar
            </button>
          )}
        </div>
      </section>

      <form className="settings-grid" onSubmit={submit}>
        <label>
          Mercado Livre App ID
          <input
            name="meli_client_id"
            defaultValue={settings.meli_client_id || ""}
            placeholder="Ex.: 1234567890123456"
            inputMode="numeric"
            pattern="[0-9]*"
          />
          <small className="field-hint">Número da aplicação no DevCenter. Não use o e-mail da conta.</small>
        </label>
        <label>
          Mercado Livre Secret Key
          <input name="meli_client_secret" type="password" placeholder={settings.meli_client_secret_configured ? "Secret configurado" : "Secret Key"} />
          <small className="field-hint">
            {settings.meli_client_secret_configured ? "Secret Key já configurada. Deixe em branco para manter." : "Cole a Secret Key do app Mercado Livre e salve antes de conectar."}
          </small>
        </label>
        <label>
          Redirect URI
          <input name="meli_redirect_uri" defaultValue={redirectUri} readOnly />
          <small className="field-hint">Cadastre exatamente esta URL no app do Mercado Livre.</small>
        </label>
        <label>
          Site Mercado Livre
          <input name="meli_site_id" defaultValue={settings.meli_site_id || "MLB"} />
        </label>
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
        <label>
          Token manual (fallback)
          <input name="meli_access_token" type="password" placeholder={settings.meli_access_token_configured ? "Token configurado" : "Opcional"} />
        </label>
        <button type="submit">Salvar configurações</button>
      </form>
    </div>
  );
}

export default App;
