import { ArrowRight, BarChart3, BookOpen, Check, ChevronDown, CircleCheck, History, LogIn, PackageSearch, Search, ShieldCheck, Sparkles, TrendingUp, WalletCards } from "lucide-react";
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

const includedInAnalysis = [
  "3 anúncios com vendas divulgadas",
  "Quantidade vendida, preço e receita calculada",
  "Simulação de ganho com seu custo",
  "Opções Clássico e Premium",
  "Histórico para reabrir suas análises",
];

const questions = [
  {
    question: "O que recebo em uma pesquisa completa?",
    answer: "Uma análise de três anúncios do produto no Mercado Livre, com foto, título, quantidade de vendas divulgada, preço e link para o anúncio. Você também vê a receita calculada, o resumo dos três resultados e a simulação de quanto pode sobrar por venda ao informar seu custo.",
  },
  {
    question: "Essas vendas são por mês? E o faturamento é exato?",
    answer: "A quantidade de vendas é a divulgada no anúncio, sem um período mensal definido. A receita é calculada multiplicando essa quantidade pelo preço coletado. Ela serve como referência: não é o faturamento contábil do vendedor e não representa todas as vendas do Mercado Livre. O resumo considera apenas os três anúncios da análise.",
  },
  {
    question: "Como funciona o cálculo de quanto eu ganho?",
    answer: "A simulação usa o preço do anúncio analisado e desconta comissão, tarifa fixa, frete e o custo do produto que você informar. Você pode alternar entre Clássico e Premium. Comissão e frete podem ser cotados ou estimados, conforme os dados disponíveis. O valor é uma estimativa de sobra por venda; impostos, publicidade e outros custos da sua operação precisam ser considerados à parte.",
  },
  {
    question: "E se não houver dados suficientes para a análise?",
    answer: "A pesquisa só é descontada do seu saldo quando a análise completa é entregue. Se não forem encontrados três anúncios com os dados necessários, a ferramenta orienta você a revisar o termo e pesquisar novamente. Quando identifica uma possível correção de digitação, pode pedir sua confirmação antes de continuar.",
  },
  {
    question: "Os três anúncios são sempre os maiores de todo o Mercado Livre?",
    answer: "A ferramenta seleciona os anúncios entre os resultados encontrados para o termo pesquisado. Quando há anúncios com volume de vendas suficiente, eles aparecem como campeões. Também pode apresentar líderes de mercados menos consolidados. A análise é uma amostra dos anúncios encontrados, não um ranking de todo o marketplace.",
  },
  {
    question: "O que muda entre o plano grátis e os planos pagos?",
    answer: "A quantidade de pesquisas disponíveis. A conta grátis inclui uma pesquisa completa, com os anúncios, os valores e a simulação de ganho. O plano de 10 pesquisas amplia o limite, e o Ilimitado permite continuar pesquisando sem esse limite enquanto o acesso ao plano estiver ativo.",
  },
];

export function LandingPage({ signedIn, starterPrice, scalePrice, onSearch, onLogin, onRegister, onSelectPlan, onLegal, onSupport }: LandingPageProps) {
  const start = signedIn ? onSearch : onRegister;
  const startLabel = signedIn ? "Pesquisar um produto" : "Fazer minha pesquisa grátis";

  return (
    <div className="bv-landing landing-product-focused">
      <a className="landing-skip" href="#conteudo">Ir para o conteúdo</a>
      <header className="landing-header">
        <div className="landing-container landing-header-inner">
          <a className="landing-brand-link" href="/#inicio" aria-label="BuscaVendas, início"><BrandMark light /></a>
          <nav aria-label="Navegação da apresentação">
            <a className="landing-nav-link" href="#resultado">O que você recebe</a>
            <a className="landing-nav-link" href="#planos">Planos</a>
            <button className="landing-login" type="button" onClick={signedIn ? onSearch : onLogin}>
              <LogIn size={17} />{signedIn ? "Acessar" : "Entrar"}
            </button>
          </nav>
        </div>
      </header>

      <main id="conteudo">
        <section className="landing-hero">
          <div className="landing-container landing-hero-grid">
            <div className="landing-hero-copy">
              <span className="landing-eyebrow landing-hero-eyebrow"><Search size={15} /> PESQUISA DE PRODUTOS NO MERCADO LIVRE</span>
              <h1>Descubra o potencial de vendas <em>do seu produto.</em></h1>
              <p>Veja quanto os anúncios encontrados já venderam, o preço praticado e a receita calculada. Depois, informe seu custo e simule quanto pode sobrar em cada venda.</p>
              <div className="landing-hero-actions">
                <button className="landing-button" type="button" onClick={start}>{startLabel} <ArrowRight size={19} /></button>
                <a className="landing-text-link" href="#resultado">Ver o que a pesquisa entrega <ArrowRight size={16} /></a>
              </div>
              <div className="landing-assurances">
                <span><CircleCheck size={16} />1 análise completa grátis</span>
                <span><CircleCheck size={16} />Cadastro sem cartão</span>
              </div>
            </div>
            <AnalysisPreview />
          </div>
          <div className="landing-container landing-hero-footnote">
            <span>DO PRODUTO PESQUISADO À SIMULAÇÃO DE GANHO</span>
            <p>Vendas divulgadas · preços · taxas · seu custo</p>
            <a href="#resultado" aria-label="Ver o resultado de uma pesquisa"><ChevronDown size={20} /></a>
          </div>
        </section>

        <section className="landing-section landing-container" id="resultado" aria-labelledby="result-title">
          <div className="landing-section-heading">
            <div><span className="landing-eyebrow">O QUE A FERRAMENTA MOSTRA</span><h2 id="result-title">Três anúncios.<br />Uma visão da oportunidade.</h2></div>
            <p>A pesquisa reúne anúncios do produto no Mercado Livre e mostra os dados de cada um para você comparar.</p>
          </div>
          <div className="landing-feature-grid">
            {[
              { icon: PackageSearch, number: "01", title: "Anúncios para comparar", body: "Veja foto, título, quantidade vendida e preço de cada anúncio. Acesse o link do Mercado Livre para conferir a oferta.", label: "Top 3 anúncios da análise" },
              { icon: BarChart3, number: "02", title: "Dinheiro movimentado", body: "Consulte a receita calculada de cada anúncio e a soma dos três resultados, junto com as vendas divulgadas e o preço médio.", label: "Resumo dos anúncios encontrados" },
              { icon: WalletCards, number: "03", title: "Quanto ganho neste produto?", body: "Escolha Clássico ou Premium, confira os descontos considerados e informe o custo do produto para calcular a sobra estimada.", label: "Simulação em cada anúncio" },
            ].map(({ icon: Icon, number, title, body, label }) => (
              <article className="landing-feature" key={number}>
                <div className="landing-feature-top"><Icon size={25} strokeWidth={1.6} /><span>{number}</span></div>
                <h3>{title}</h3><p>{body}</p><span className="landing-feature-label">{label}</span>
              </article>
            ))}
          </div>
          <p className="landing-data-context">A receita é calculada pelo preço coletado × vendas divulgadas. O total considera os três anúncios analisados; não é o tamanho de todo o mercado nem uma previsão das suas vendas.</p>
        </section>

        <section className="landing-decision" aria-labelledby="margin-title">
          <div className="landing-container landing-decision-grid">
            <div className="landing-margin-explainer">
              <div className="landing-margin-explainer-head"><TrendingUp size={21} /><h3>Quanto ganho neste produto?</h3></div>
              <p>O cálculo usa o preço do anúncio analisado.</p>
              <div className="landing-listing-options"><span>Clássico</span><span>Premium</span><small>Dois tipos de anúncio para simular</small></div>
              <dl className="landing-cost-breakdown">
                <div><dt>Preço de venda</dt><dd>Valor do anúncio</dd></div>
                <div><dt><span>−</span> Comissão</dt><dd>Conforme o tipo de anúncio</dd></div>
                <div><dt><span>−</span> Tarifa fixa</dt><dd>Quando aplicável</dd></div>
                <div><dt><span>−</span> Frete</dt><dd>Cotado ou estimado</dd></div>
                <div><dt><span>−</span> Custo do produto</dt><dd>Você informa</dd></div>
              </dl>
              <div className="landing-margin-outcome"><span>O QUE VOCÊ CONFERE</span><strong>Quanto sobra depois do seu custo</strong></div>
            </div>
            <div className="landing-decision-copy">
              <span className="landing-eyebrow">DEMANDA É SÓ UMA PARTE DA DECISÃO</span>
              <h2 id="margin-title">Vende.<br />Mas a conta fecha para você?</h2>
              <p>A análise tem uma simulação de ganho em cada anúncio. Assim, você compara o preço de quem já vende com o custo que consegue na compra.</p>
              <ul>
                <li><Check size={18} />Alterne entre anúncio Clássico e Premium.</li>
                <li><Check size={18} />Veja comissão, tarifa fixa e frete.</li>
                <li><Check size={18} />Informe seu custo e clique em Calcular.</li>
              </ul>
              <button className="landing-text-link landing-link-dark" type="button" onClick={start}>Pesquisar e simular meu ganho <ArrowRight size={18} /></button>
              <small>Comissão e frete podem ser estimados, conforme os dados disponíveis. A sobra não inclui automaticamente impostos, publicidade e outros custos da sua operação.</small>
            </div>
          </div>
        </section>

        <section className="landing-section landing-container landing-how-section" id="como-funciona" aria-labelledby="how-title">
          <div className="landing-section-heading"><div><span className="landing-eyebrow">DA PRIMEIRA BUSCA À ANÁLISE</span><h2 id="how-title">Você digita o produto.<br />A ferramenta pesquisa os anúncios.</h2></div><p>Use o nome do produto, o tipo ou a marca para orientar a pesquisa.</p></div>
          <ol className="landing-workflow">
            <li><span>1</span><div><h3>Crie sua conta grátis</h3><p>O cadastro libera uma pesquisa completa para conhecer a ferramenta.</p></div></li>
            <li><span>2</span><div><h3>Busque a demanda</h3><p>Digite o produto e clique em Buscar demanda. Aguarde a análise dos anúncios.</p></div></li>
            <li><span>3</span><div><h3>Compare e calcule</h3><p>Confira os resultados e informe seu custo para simular a sobra por venda.</p></div></li>
          </ol>
          <div className="landing-tools-included">
            <div><History size={21} /><span><b>Minhas pesquisas</b><small>Reabra análises concluídas no histórico.</small></span></div>
            <div><BookOpen size={21} /><span><b>Dicas para vender</b><small>Consulte os conteúdos disponíveis na ferramenta.</small></span></div>
            <div><ShieldCheck size={21} /><span><b>Saldo preservado</b><small>A pesquisa é descontada após a entrega da análise completa.</small></span></div>
          </div>
        </section>

        <section className="landing-section landing-container landing-plans-section" id="planos" aria-labelledby="pricing-title">
          <div className="landing-centered-heading">
            <span className="landing-eyebrow">A MESMA ANÁLISE. DIFERENTES LIMITES.</span>
            <h2 id="pricing-title">Escolha quantos produtos quer pesquisar.</h2>
            <p>A primeira pesquisa grátis já inclui os anúncios, os valores e a simulação de ganho.</p>
          </div>
          <div className="landing-pricing-grid">
            {[
              { plan: "free", kicker: "PARA TESTAR A FERRAMENTA", title: "Grátis", description: "1 pesquisa completa para começar.", price: "R$ 0", suffix: "sem cartão", action: signedIn ? "Acessar minha conta" : "Criar conta grátis", onClick: start },
              { plan: "starter", kicker: "PARA PESQUISAR SEUS PRODUTOS", title: "10 pesquisas", description: "10 pesquisas completas por mês.", price: starterPrice, suffix: "/mês", action: "Escolher 10 pesquisas", onClick: () => onSelectPlan("starter") },
              { plan: "scale", kicker: "PARA PESQUISAR SEM CONTAR", title: "Ilimitado", description: "Pesquisas sem limite no plano ativo.", price: scalePrice, suffix: "/mês", action: "Escolher Ilimitado", onClick: () => onSelectPlan("scale") },
            ].map(plan => (
              <article className={`landing-pricing-card${plan.plan === "scale" ? " landing-pricing-featured" : ""}`} key={plan.plan}>
                <span className="landing-plan-kicker">{plan.kicker}</span>
                <h3>{plan.title}</h3><p>{plan.description}</p>
                <div className="landing-price">{plan.price}<small>{plan.suffix}</small></div>
                <button className={`landing-button${plan.plan === "scale" ? "" : " landing-button-outline"}`} type="button" onClick={plan.onClick}>{plan.action}<ArrowRight size={17} /></button>
                <ul>{includedInAnalysis.map(item => <li key={item}><Check size={17} />{item}</li>)}</ul>
              </article>
            ))}
          </div>
          <p className="landing-pricing-note"><ShieldCheck size={16} />Mensal com cobrança recorrente no cartão. Opção anual via Pix ou cartão na contratação.</p>
        </section>

        <section className="landing-ecosystem" aria-labelledby="ecosystem-title">
          <div className="landing-container landing-ecosystem-inner">
            <div><span className="landing-eyebrow">FERRAMENTAS CONFWEB</span><h2 id="ecosystem-title">Já sabe o que quer vender?<br />Pesquise aqui.</h2><p>Se você ainda precisa escolher um produto, conheça o VemSerSeller. Ele ajuda a identificar seu perfil e produtos para começar. No BuscaVendas, você pesquisa a demanda de um produto que tem em mente.</p><a className="landing-button landing-button-white" href="https://vemserseller.confweb.com.br/" target="_blank" rel="noreferrer">Ainda não sei o que vender <ArrowRight size={18} /></a></div>
            <div className="landing-ecosystem-path"><span><Sparkles size={23} /><b>VemSer<span>Seller</span></b><small>Descubra o que vender</small></span><ArrowRight className="landing-ecosystem-arrow" size={25} /><span><Search size={23} /><b>Busca<span>Vendas</span></b><small>Analise o produto</small></span><p>by <b>CONFWEB</b></p></div>
          </div>
        </section>

        <section className="landing-section landing-container landing-faq" aria-labelledby="faq-title">
          <div><span className="landing-eyebrow">ENTENDA SUA ANÁLISE</span><h2 id="faq-title">O que os dados<br />querem dizer.</h2><button className="landing-text-link landing-link-dark" type="button" onClick={onSupport}>Falar com o suporte <ArrowRight size={17} /></button></div>
          <div className="landing-faq-items">{questions.map(({ question, answer }) => <details key={question}><summary>{question}<ChevronDown size={18} /></summary><p>{answer}</p></details>)}</div>
        </section>

        <section className="landing-final-cta"><div className="landing-container"><span className="landing-eyebrow">ANTES DE INVESTIR NO PRODUTO</span><h2>Veja a demanda.<br />Simule quanto pode sobrar.</h2><button className="landing-button" type="button" onClick={start}>{startLabel} <ArrowRight size={19} /></button><p>Crie sua conta e faça uma pesquisa completa grátis.</p></div></section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container">
          <div className="landing-footer-top"><BrandMark /><p>Pesquisa de demanda e simulação de ganho<br />para produtos no Mercado Livre.</p><a href="https://www.confweb.com.br" target="_blank" rel="noreferrer">Conheça a Confweb <ArrowRight size={15} /></a></div>
          <div className="landing-footer-bottom"><span>© {new Date().getFullYear()} BuscaVendas by Confweb.</span><nav aria-label="Informações legais"><button type="button" onClick={() => onLegal("terms")}>Termos de uso</button><button type="button" onClick={() => onLegal("privacy")}>Privacidade</button><button type="button" onClick={onSupport}>Suporte</button></nav></div>
        </div>
      </footer>
    </div>
  );
}

function AnalysisPreview() {
  return (
    <div className="landing-preview landing-analysis-preview" aria-label="Estrutura da análise: três anúncios, resumo de vendas e simulação de ganho">
      <div className="landing-preview-top"><span><i /><i /><i /></span><span>O QUE VOCÊ ENCONTRA NA FERRAMENTA</span><Search size={14} /></div>
      <div className="landing-analysis-body">
        <div className="landing-analysis-query"><Search size={17} /><span>O produto que você quer vender</span></div>
        <div className="landing-analysis-title"><span>RESULTADO DA PESQUISA</span><h2>Top 3 anúncios campeões</h2><p>Dados públicos dos anúncios encontrados</p></div>
        <div className="landing-analysis-summary"><span><TrendingUp size={17} /><b>Vendas</b><small>Soma dos anúncios</small></span><span><WalletCards size={17} /><b>Receita</b><small>Preço × vendas</small></span><span><BarChart3 size={17} /><b>Preço médio</b><small>Dos resultados</small></span></div>
        <div className="landing-analysis-rows">{[1, 2, 3].map(rank => (
          <div className="landing-analysis-row" key={rank}>
            <span className="landing-analysis-rank">{rank}</span><PackageSearch size={23} />
            <div><b>{rank}º anúncio</b><small>Foto, título e link</small></div>
            <span>Qtd. vendas<br /><strong>Preço e receita</strong></span>
          </div>
        ))}</div>
        <div className="landing-analysis-gain"><TrendingUp size={18} /><span><b>Quanto ganho neste produto?</b><small>Clássico ou Premium + seu custo</small></span><ChevronDown size={16} /></div>
        <p className="landing-analysis-caption">Estrutura da análise. Os anúncios e os valores aparecem após sua pesquisa.</p>
      </div>
    </div>
  );
}
