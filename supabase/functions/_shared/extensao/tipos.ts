// Tipos compartilhados da Extensão PubliAI (ADR-0189). Sem imports de runtime:
// roda no Deno (edge), no vitest e no bundle da extensão.

/** Ausência nunca vira zero (D-7): ou há valor, ou há motivo. */
export type Disponivel<T> = { estado: 'ok'; valor: T; aviso?: string } | { estado: 'indisponivel'; motivo: string };

export interface ComissaoML {
  percentual: number;
  fixa: number;
  /** sale_fee_amount do ML, válido só para `precoConsultado`. */
  saleFeeAmount?: number;
  precoConsultado?: number;
}

export interface EntradaMargemTipo {
  comissao: Disponivel<ComissaoML>;
  frete: Disponivel<number>;
}

export interface EntradaMargem {
  preco: number;
  aliquotaPct: Disponivel<number>;
  /** null = operador ainda não informou custo. */
  custoPacote: Disponivel<number> | null;
  classico: EntradaMargemTipo;
  premium: EntradaMargemTipo;
}

export interface MargemTipo {
  comissao: number;
  imposto: number;
  frete: number;
  custo: number | null;
  recebe: number;
  lucro: number | null;
  margemPct: number | null;
  avisos: string[];
}

export interface MinhaMargem {
  preco: number;
  classico: Disponivel<MargemTipo>;
  premium: Disponivel<MargemTipo>;
}

/** Vendedor da página (/users, D-10). `vendas` = transactions.total, janela móvel de ~365 dias (ADR-0142):
 *  `periodo` só quando o ML informa em dias; "historic"/ausente → null (rótulo neutro, nunca "total histórico"). */
export interface VendedorML {
  nickname: string | null;
  /** level_id do ML (ex.: 5_green). */
  nivel: string | null;
  /** power_seller_status do ML (silver/gold/platinum). */
  medalha: string | null;
  vendas: number;
  periodo: string | null;
  uf: string | null;
}
