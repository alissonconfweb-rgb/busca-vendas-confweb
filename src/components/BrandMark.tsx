export function BrandMark({ light = false }: { light?: boolean }) {
  return (
    <span className={`confweb-brand${light ? " confweb-brand-light" : ""}`} role="img" aria-label="BuscaVendas by Confweb">
      <img className="confweb-brand-symbol" src="/confweb-mark-transparent.png" width="50" height="50" alt="" aria-hidden="true" />
      <span className="confweb-brand-type">
        <span className="confweb-brand-name">Busca<span>Vendas</span></span>
        <span className="confweb-brand-signature">by <b>CONFWEB</b></span>
      </span>
    </span>
  );
}
