// Dados do payload cru `/orders` do ML (ml_vendas.raw) que o detalhe da venda mostra: meio de
// pagamento, frete pago pelo comprador, cupom e tipo de anúncio. Puro e testável; o `raw` vem de
// fora (jsonb), então tudo passa por type guards antes de agregar.
import { round2 } from './formato';

/** Uma linha de `ml_vendas` com só os trechos do `raw` que interessam (ver `buscarDetalheMLDasVendas`). */
export interface DetalheMLVenda {
  id: string;
  pagamentos: unknown;
  cupom: unknown;
  itens_ml: unknown;
}

export interface DetalheMLPedido {
  /** Um rótulo por pagamento (ex.: "Crédito Visa 3x"). */
  pagamentos: string[];
  aprovadoEm: string | null;
  /** Σ shipping_cost dos pagamentos aprovados/estornados. */
  freteComprador: number;
  cupom: number;
  tiposAnuncio: string[];
}

const BANDEIRAS: Record<string, string> = { visa: 'Visa', master: 'Mastercard', amex: 'Amex', elo: 'Elo' };
const ANUNCIOS: Record<string, string> = { gold_special: 'Clássico', gold_pro: 'Premium', free: 'Grátis' };

const registro = (v: unknown): Record<string, unknown> | null =>
  v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const numero = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const texto = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** "Crédito Visa 3x", "Pix", "Saldo MP"… A bandeira só entra nos cartões. */
export function labelPagamento(tipo: string, metodo: string | null, parcelas: number): string {
  const bandeira = metodo ? BANDEIRAS[metodo] ?? metodo.charAt(0).toUpperCase() + metodo.slice(1) : null;
  const base = (() => {
    switch (tipo) {
      case 'credit_card': return ['Crédito', bandeira].filter(Boolean).join(' ');
      case 'debit_card': return ['Débito', bandeira].filter(Boolean).join(' ');
      case 'account_money': return 'Saldo MP';
      case 'bank_transfer': return metodo === 'pix' ? 'Pix' : 'Transferência';
      case 'ticket': return 'Boleto';
      case 'digital_currency': return 'Mercado Crédito';
      case 'prepaid_card': return 'Pré-pago';
      default: return tipo;
    }
  })();
  return parcelas > 1 ? `${base} ${parcelas}x` : base;
}

/** Junta o detalhe de todas as orders (linhas ml_vendas) de um pedido/pack. */
export function agregarDetalheML(linhas: DetalheMLVenda[]): DetalheMLPedido {
  const pagamentos: string[] = [];
  const idsVistos = new Set<unknown>();
  const aprovacoes: string[] = [];
  const tipos = new Set<string>();
  let freteComprador = 0;
  let cupom = 0;

  for (const l of linhas) {
    for (const bruto of lista(l.pagamentos)) {
      const pg = registro(bruto);
      if (!pg) continue;
      const status = texto(pg.status);
      if (status === 'rejected' || status === 'cancelled') continue;
      // O mesmo pagamento pode aparecer em várias orders do pack; sem id, mantém.
      if (pg.id != null) {
        if (idsVistos.has(pg.id)) continue;
        idsVistos.add(pg.id);
      }
      const tipo = texto(pg.payment_type);
      if (tipo) pagamentos.push(labelPagamento(tipo, texto(pg.payment_method_id), numero(pg.installments)));
      if (status === 'approved' || status === 'refunded') {
        freteComprador += numero(pg.shipping_cost);
        const aprovado = texto(pg.date_approved);
        if (aprovado) aprovacoes.push(aprovado);
      }
    }
    cupom += numero(registro(l.cupom)?.amount);
    for (const bruto of lista(l.itens_ml)) {
      const tipo = texto(registro(bruto)?.listing_type_id);
      if (tipo) tipos.add(ANUNCIOS[tipo] ?? tipo);
    }
  }

  return {
    // Num pack cada order tem o seu pagamento, quase sempre do mesmo meio: "Saldo MP" ×4 vira um só.
    pagamentos: [...new Set(pagamentos)],
    aprovadoEm: aprovacoes.length > 0 ? aprovacoes.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a)) : null,
    freteComprador: round2(freteComprador),
    cupom: round2(cupom),
    tiposAnuncio: [...tipos],
  };
}
