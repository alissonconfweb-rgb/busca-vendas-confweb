export function BrandMark({ light = false }: { light?: boolean }) {
  return (
    <span className={`confweb-brand${light ? " confweb-brand-light" : ""}`} role="img" aria-label="BuscaVendas by Confweb">
      <svg className="confweb-brand-symbol" width="40" height="50" viewBox="0 0 40 50" fill="none" aria-hidden="true">
        <path d="M11 13H7.8a3 3 0 0 0-3 2.6L1.8 41a3 3 0 0 0 3 3.4h24.4a3 3 0 0 0 3-3.4l-3-25.4a3 3 0 0 0-3-2.6H15" />
        <path d="M11 17V9a6 6 0 0 1 12 0v1M11 36l12-12m-9 0h9v9" />
        <path d="m7 33-2 4m19 12h12L33 24" />
      </svg>
      <span className="confweb-brand-type">
        <span className="confweb-brand-name">Busca<span>Vendas</span></span>
        <span className="confweb-brand-signature">by <b>CONFWEB</b></span>
      </span>
    </span>
  );
}
