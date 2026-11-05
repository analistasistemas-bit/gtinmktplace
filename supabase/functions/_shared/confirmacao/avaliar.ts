// ADR-0195: veredito da conferência pós-escrita. Compara o ML com o valor ENVIADO (depois do teto),
// nunca com o saldo do banco. Função pura; quem lê e grava é `confirmar-publicacao-ml`.

export interface EnviadoSku { qtd: number; anterior: number | null; variacao_id: string | null }

export interface Divergente { sku: string; enviado: number; observado: number | null }

export interface Avaliacao {
  ok: boolean;
  /** O ML segue no saldo anterior a uma escrita que pedia mudança: o PUT não valeu. */
  naoAplicada: boolean;
  /** Algum divergente teve movimento na janela: pode ser webhook atrasado, não falha do canal. */
  explicavelPorMovimento: boolean;
  divergentes: Divergente[];
}

export function avaliarConfirmacao(a: {
  enviado: Record<string, EnviadoSku>;
  observado: Record<string, number | null>;
  movimentos: Record<string, number>;
  /** Parte de `movimentos` que veio de venda no próprio ML: ela mexe no saldo do canal com ou sem o PUT. */
  movimentosMl?: Record<string, number>;
}): Avaliacao {
  const divergentes: Divergente[] = [];
  let naoAplicada = false;
  let explicavelPorMovimento = false;
  for (const [sku, { qtd, anterior }] of Object.entries(a.enviado)) {
    const observado = a.observado[sku] ?? null;
    const movimento = a.movimentos[sku] ?? 0;
    const vendaMl = a.movimentosMl?.[sku] ?? 0;
    // PUT ignorado deixa o ML em `anterior + vendas do ML`; PUT aplicado, em `enviado + vendas do ML`.
    // Vem antes da conta com movimentos: entrada no ledger poderia "explicar" o saldo velho
    // (enviado 10, anterior 15, entrada +5) e esconder a escrita perdida. Nesse caso não dá para
    // separar os dois cenários: fica explicável (inconclusivo), nunca confirmado.
    const ignorada = anterior !== null && anterior !== qtd
      && observado === anterior + vendaMl && observado !== qtd + vendaMl;
    if (ignorada) {
      divergentes.push({ sku, enviado: qtd, observado });
      if (observado === qtd + movimento) explicavelPorMovimento = true;
      else naoAplicada = true;
      continue;
    }
    if (observado === qtd || observado === qtd + movimento || observado === qtd + vendaMl) continue;
    divergentes.push({ sku, enviado: qtd, observado });
    explicavelPorMovimento ||= movimento !== 0;
  }
  return { ok: divergentes.length === 0, naoAplicada, explicavelPorMovimento, divergentes };
}

/** Atraso da 2ª e da 3ª leitura, em segundos. A 1ª sai 60 s depois do envio. */
export const ATRASOS_RELEITURA = [180, 600];

export function proximoPasso(a: {
  ok: boolean;
  naoAplicada: boolean;
  explicavelPorMovimento: boolean;
  leituraFalhou: boolean;
  tentativa: number;
}): { status: 'confirmado' | 'falhou' | 'inconclusivo' } | { reler: number } {
  if (a.ok) return { status: 'confirmado' };
  const reler = ATRASOS_RELEITURA[a.tentativa - 1];
  if (reler !== undefined) return { reler };
  if (a.leituraFalhou) return { status: 'inconclusivo' };
  if (a.naoAplicada) return { status: 'falhou' };
  return { status: a.explicavelPorMovimento ? 'inconclusivo' : 'falhou' };
}
