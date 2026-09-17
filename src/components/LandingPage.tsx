import { ArrowRight, BarChart3, Check, ChevronDown, CircleCheck, Headphones, Layers3, LogIn, Search, ShieldCheck, Sparkles, TrendingUp, WalletCards } from "lucide-react";
import { BrandMark } from "./BrandMark";

type LandingPageProps = {
  signedIn: boolean;
  starterPrice: string;
  scalePrice: string;
  onSearch: () => void;
  onLogin: () => void;
  onRegister: () => void;
  onSelectPlan: (plan: "starter" | "scale") => void;
  onLegal: (mode: "terms" | "privacy") => void;
  onSupport: () => void;
};

export function LandingPage({ signedIn, starterPrice, scalePrice, onSearch, onLogin, onRegister, onSelectPlan, onLegal, onSupport }: LandingPageProps) {
  return (
    <div className="bv-landing">
      <a className="landing-skip" href="#conteudo">Ir para o conteúdo</a>
      <header className="landing-header">
        <div className="landing-container landing-header-inner">
          <a className="landing-brand-link" href="/#inicio" aria-label="BuscaVendas, início"><BrandMark light /></a>
          <nav aria-label="Navegação da apresentação">
            <a className="landing-nav-link" href="#como-funciona">Como funciona</a>
            <a className="landing-nav-link" href="#planos">Planos</a>
            <button className="landing-login" type="button" onClick={signedIn ? onSearch : onLogin}><LogIn size={17} />{signedIn ? "Acessar" : "Entrar"}</button>
          </nav>
        </div>
      </header>

      <main id="conteudo">
        <section className="landing-hero">
          <div className="landing-container landing-hero-grid">
            <div className="landing-hero-copy">
              <span className="landing-eyebrow landing-hero-eyebrow"><Search size={15} /> DA IDEIA À DECISÃO DE VENDA</span>
              <h1>Seu próximo produto.<br /><em>Uma decisão<br className="landing-desktop-break" /> com dados.</em></h1>
              <p>Descubra o que já vende no Mercado Livre, compare os anúncios e simule sua margem antes de investir em estoque.</p>
              <div className="landing-hero-actions">
                <button className="landing-button" type="button" onClick={onSearch}>Pesquisar meu produto <ArrowRight size={19} /></button>
                <a className="landing-text-link" href="#como-funciona">Conhecer a ferramenta <ArrowRight size={16} /></a>
              </div>
              <div className="landing-assurances">
                <span><CircleCheck size={16} />1 pesquisa grátis</span>
                <span><CircleCheck size={16} />Sem cartão de crédito</span>
              </div>
            </div>
            <SearchPreview />
          </div>
          <div className="landing-container landing-hero-footnote"><span>PARA QUEM QUER VENDER COM MAIS CLAREZA</span><p>Seu primeiro produto ou sua próxima oportunidade.</p><a href="#como-funciona" aria-label="Ver como funciona"><ChevronDown size={20} /></a></div>
        </section>

        <section className="landing-section landing-container" id="como-funciona" aria-labelledby="how-title">
          <div className="landing-section-heading">
            <div><span className="landing-eyebrow">MENOS ACHISMO. MAIS DIREÇÃO.</span><h2 id="how-title">Uma pesquisa.<br />Três respostas importantes.</h2></div>
            <p>Entenda a oportunidade por trás do produto e chegue à sua decisão com mais informação.</p>
          </div>
          <div className="landing-feature-grid">
            {[
              { icon: Search, number: "01", title: "Esse produto vende?", body: "Digite o produto que você tem em mente. Veja os anúncios encontrados e os indicadores de vendas disponíveis.", label: "Entenda a demanda" },
              { icon: BarChart3, number: "02", title: "Como está o mercado?", body: "Compare os três anúncios da análise, seus preços e o faturamento calculado a partir das vendas informadas.", label: "Conheça a concorrência" },
              { icon: WalletCards, number: "03", title: "Quanto pode sobrar?", body: "Informe seu custo e simule o resultado por venda, considerando as taxas e o frete apresentados na ferramenta.", label: "Simule sua margem" },
            ].map(({ icon: Icon, number, title, body, label }) => (
              <article className="landing-feature" key={number}>
                <div className="landing-feature-top"><Icon size={25} strokeWidth={1.6} /><span>{number}</span></div>
                <h3>{title}</h3><p>{body}</p><span className="landing-feature-label">{label} <ArrowRight size={15} /></span>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-decision" aria-labelledby="decision-title">
          <div className="landing-container landing-decision-grid">
            <div className="landing-decision-visual" aria-label="Etapas para analisar um produto">
              <span className="landing-eyebrow">SUA IDEIA, VISTA POR OUTRO ÂNGULO</span>
              <div className="landing-query-example"><Search size={20} /><span>Qual produto você quer vender?</span><ArrowRight size={20} /></div>
              <div className="landing-insight"><span><TrendingUp size={22} /></span><div><b>Vendas e preços</b><p>O que os anúncios mostram sobre a demanda.</p></div><Check size={18} /></div>
              <div className="landing-insight"><span><Layers3 size={22} /></span><div><b>Anúncios lado a lado</b><p>Referências para comparar sua oportunidade.</p></div><Check size={18} /></div>
              <div className="landing-insight"><span><WalletCards size={22} /></span><div><b>Simulação de margem</b><p>Seu custo faz parte da conta.</p></div><Check size={18} /></div>
            </div>
            <div className="landing-decision-copy"><span className="landing-eyebrow">PESQUISE ANTES DE INVESTIR</span><h2 id="decision-title">A boa compra começa<br />antes do estoque.</h2><p>Um produto interessante merece uma análise. O BuscaVendas reúne referências do mercado para ajudar você a avaliar sua ideia com mais segurança.</p><ul><li><Check size={18} />Compare produtos antes de escolher.</li><li><Check size={18} />Teste diferentes custos na simulação.</li><li><Check size={18} />Reabra suas análises no histórico.</li></ul><button className="landing-text-link landing-link-dark" type="button" onClick={onSearch}>Fazer minha primeira pesquisa <ArrowRight size={18} /></button><small>Os dados refletem as informações disponíveis nos anúncios. Simulações não são garantia de vendas ou lucro.</small></div>
          </div>
        </section>

        <section className="landing-section landing-container landing-plans-section" id="planos" aria-labelledby="pricing-title">
          <div className="landing-centered-heading"><span className="landing-eyebrow">COMECE COM UMA IDEIA</span><h2 id="pricing-title">Um plano para cada momento.</h2><p>Experimente a ferramenta e amplie suas pesquisas quando precisar.</p></div>
          <div className="landing-pricing-grid">
            <article className="landing-pricing-card"><span className="landing-plan-kicker">PARA CONHECER</span><h3>Grátis</h3><p>O primeiro passo para validar sua ideia.</p><div className="landing-price">R$ 0<small>para começar</small></div><button className="landing-button landing-button-outline" type="button" onClick={signedIn ? onSearch : onRegister}>{signedIn ? "Acessar minha conta" : "Criar conta grátis"}<ArrowRight size={17} /></button><ul><li><Check size={17} />1 pesquisa completa</li><li><Check size={17} />Top 3 anúncios da análise</li><li><Check size={17} />Simulação com seu custo</li></ul></article>
            <article className="landing-pricing-card"><span className="landing-plan-kicker">PARA EXPLORAR</span><h3>10 pesquisas</h3><p>Compare ideias e encontre seu caminho.</p><div className="landing-price">{starterPrice}<small>/mês</small></div><button className="landing-button landing-button-outline" type="button" onClick={() => onSelectPlan("starter")}>Escolher 10 pesquisas<ArrowRight size={17} /></button><ul><li><Check size={17} />10 pesquisas completas por mês</li><li><Check size={17} />Análise de vendas e faturamento</li><li><Check size={17} />Simulação de margem e histórico</li></ul></article>
            <article className="landing-pricing-card landing-pricing-featured"><span className="landing-plan-kicker">PARA IR ALÉM <Sparkles size={15} /></span><h3>Ilimitado</h3><p>Mais liberdade para descobrir oportunidades.</p><div className="landing-price">{scalePrice}<small>/mês</small></div><button className="landing-button" type="button" onClick={() => onSelectPlan("scale")}>Escolher Ilimitado<ArrowRight size={17} /></button><ul><li><Check size={17} />Pesquisas completas ilimitadas</li><li><Check size={17} />Análise de vendas e faturamento</li><li><Check size={17} />Simulação de margem e histórico</li></ul></article>
          </div>
          <p className="landing-pricing-note"><ShieldCheck size={16} />Planos mensais com cobrança recorrente. Opção anual disponível na contratação.</p>
        </section>

        <section className="landing-ecosystem" aria-labelledby="ecosystem-title"><div className="landing-container landing-ecosystem-inner"><div><span className="landing-eyebrow">UM ECOSSISTEMA. SEU PRÓXIMO PASSO.</span><h2 id="ecosystem-title">Ainda não sabe o que vender?</h2><p>No VemSerSeller, descubra seu perfil e conheça produtos adequados à sua realidade. Depois, aprofunde a pesquisa aqui no BuscaVendas.</p><a className="landing-button landing-button-white" href="https://vemserseller.confweb.com.br/" target="_blank" rel="noreferrer">Conhecer o VemSerSeller <ArrowRight size={18} /></a></div><div className="landing-ecosystem-path"><span><Sparkles size={23} /><b>VemSer<span>Seller</span></b><small>Descubra seu caminho</small></span><ArrowRight className="landing-ecosystem-arrow" size={25} /><span><Search size={23} /><b>Busca<span>Vendas</span></b><small>Pesquise a oportunidade</small></span><p>by <b>CONFWEB</b></p></div></div></section>

        <section className="landing-section landing-container landing-faq" aria-labelledby="faq-title"><div><span className="landing-eyebrow">ANTES DA PRIMEIRA BUSCA</span><h2 id="faq-title">Ficou alguma dúvida?</h2><button className="landing-text-link landing-link-dark" type="button" onClick={onSupport}>Falar com o suporte <ArrowRight size={17} /></button></div><div className="landing-faq-items">{[
          ["Preciso pagar para testar?", "Não. Você pode criar sua conta e fazer uma pesquisa completa grátis, sem cadastrar cartão de crédito. Depois, escolha um plano se quiser continuar pesquisando."],
          ["De onde vêm as informações?", "A análise utiliza informações disponíveis nos anúncios do Mercado Livre. As vendas são as divulgadas pela fonte; o faturamento é calculado com base nesses dados. A disponibilidade e a atualização podem variar por anúncio."],
          ["O BuscaVendas garante que vou vender?", "Não. A ferramenta ajuda a pesquisar o mercado e simular margens. Seu resultado depende de fatores como custo, concorrência, frete e operação. Use a análise como apoio à sua decisão."],
          ["Qual a diferença para o VemSerSeller?", "O VemSerSeller ajuda você a descobrir o que vender de acordo com seu perfil. O BuscaVendas aprofunda a análise de um produto, mostrando referências de demanda, preços e uma simulação de margem."],
        ].map(([question, answer]) => <details key={question}><summary>{question}<ChevronDown size={18} /></summary><p>{answer}</p></details>)}</div></section>

        <section className="landing-final-cta"><div className="landing-container"><span className="landing-eyebrow">SUA PRÓXIMA IDEIA MERECE UMA PESQUISA</span><h2>Comece a vender com mais clareza.</h2><button className="landing-button" type="button" onClick={onSearch}>Pesquisar meu produto <ArrowRight size={19} /></button><p>1 pesquisa completa grátis para começar.</p></div></section>
      </main>

      <footer className="landing-footer"><div className="landing-container"><div className="landing-footer-top"><BrandMark /><p>Informação para decidir.<br />Confweb para crescer.</p><a href="https://www.confweb.com.br" target="_blank" rel="noreferrer">Conheça a Confweb <ArrowRight size={15} /></a></div><div className="landing-footer-bottom"><span>© {new Date().getFullYear()} BuscaVendas by Confweb.</span><nav aria-label="Informações legais"><button type="button" onClick={() => onLegal("terms")}>Termos de uso</button><button type="button" onClick={() => onLegal("privacy")}>Privacidade</button><button type="button" onClick={onSupport}>Suporte</button></nav></div></div></footer>
    </div>
  );
}

function SearchPreview() {
  return (
    <div className="landing-preview" aria-label="Prévia ilustrativa da análise, com dados de exemplo">
      <div className="landing-preview-top"><span><i /><i /><i /></span><span>UMA IDEIA. UMA ANÁLISE.</span><Search size={14} /></div>
      <div className="landing-preview-body"><div className="landing-preview-query"><Search size={17} /><span>Fone bluetooth</span><span className="landing-preview-search"><ArrowRight size={17} /></span></div><div className="landing-preview-title"><div><small>CONHEÇA SEU MERCADO</small><h2>Oportunidades à vista.</h2></div><span><BarChart3 size={19} /></span></div>
        <div className="landing-preview-products">{[{rank:"01",color:"orange",price:"R$ 129,90",sales:"2.400",size:57},{rank:"02",color:"navy",price:"R$ 159,90",sales:"1.800",size:51},{rank:"03",color:"sage",price:"R$ 99,90",sales:"1.250",size:54}].map(product=><div className="landing-preview-product" key={product.rank}><div className={`landing-product-art ${product.color}`}><span>{product.rank}</span><Headphones size={product.size} strokeWidth={1.2} /></div><small>Fone sem fio</small><b>{product.price}</b><span>{product.sales} vendidos</span></div>)}</div>
        <div className="landing-preview-margin"><span className="landing-preview-margin-icon"><TrendingUp size={24} /></span><div><small>DEPOIS, OLHE PARA SUA MARGEM</small><b>Seu custo. Sua simulação.</b></div><ArrowRight size={19} /></div>
        <p className="landing-preview-disclaimer">Prévia ilustrativa · produtos e valores de exemplo</p>
      </div>
      <div className="landing-preview-caption"><CircleCheck size={17} /><span>Mais contexto para sua próxima decisão.</span></div>
    </div>
  );
}
