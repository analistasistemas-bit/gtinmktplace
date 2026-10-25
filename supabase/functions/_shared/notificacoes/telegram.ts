type Linha = string | null | false | undefined;
/** Layout para celular (mesmo padrão das mensagens gerenciais): título, linha em branco, uma
 * informação por linha; blocos separados por linha em branco e bloco vazio some. */
export const blocos = (...bs: Linha[][]): string =>
  bs.map((b) => b.filter((l): l is string => !!l)).filter((b) => b.length).map((b) => b.join('\n')).join('\n\n');

export interface ItemAlerta {
  ml_item_id: string;
  titulo: string | null;
  motivo: string | null;
  permalink: string | null;
}

// Mapa local (Deno não compartilha módulo com o front); manter em sincronia com src/lib/moderacao.ts.
const MOTIVO_LABEL: Record<string, string> = {
  forbidden: 'Proibido pelo ML',
  waiting_for_patch: 'Aguardando correção',
  poor_quality_thumbnail: 'Foto reprovada',
  poor_quality_picture: 'Foto reprovada',
  deleted: 'Removido pelo ML',
};

function traduzir(motivo: string | null): string {
  if (!motivo) return 'moderado';
  return motivo.split(',').map((s) => s.trim()).filter(Boolean)
    .map((c) => MOTIVO_LABEL[c] ?? c).join(' · ');
}

export function montarMensagemModerados(itens: ItemAlerta[]): string {
  const cabecalho = itens.length === 1
    ? '🚫 1 anúncio moderado pelo Mercado Livre'
    : `🚫 ${itens.length} anúncios moderados pelo Mercado Livre`;
  return blocos([cabecalho], ...itens.map((i) => [`• ${i.titulo ?? i.ml_item_id}`, `Motivo: ${traduzir(i.motivo)}`, i.permalink]));
}

export interface CatalogoNoMatchAlerta {
  ml_item_id: string;
  titulo: string | null;
  cores: string[];
  motivo?: 'elegibilidade_esgotada' | 'sem_variation_id' | 'elegibilidade_nao_resolvida';
  /** Categoria compatível com a ficha do GTIN, calculada ANTES de publicar (spec 2026-08-22). */
  categoriaSugerida?: { id: string; nome: string } | null;
  /** SKU único, sem variação no ML: a mensagem fala do anúncio, sem cor nem "variação". */
  semVariacao?: boolean;
}

// Alerta PROATIVO (ADR-0036): no opt-in de catálogo, alguma variação não tem ficha equivalente
// (ex.: GTIN só existe em ficha de kit). Se ela ficar sem associação, o ML pausa o anúncio inteiro
// depois. A ação "Não encontro minha variação" é só na UI do ML (não há endpoint OAuth), então o
// sistema avisa o operador p/ resolver manualmente ANTES da pausa.
export function montarMensagemCatalogoNoMatch(item: CatalogoNoMatchAlerta): string {
  const nome = item.titulo ?? item.ml_item_id;
  const url = `https://www.mercadolivre.com.br/produzir/catalogo/${item.ml_item_id}`;
  const causa = item.motivo === 'elegibilidade_esgotada'
    ? 'elegibilidade esgotada após múltiplas tentativas'
    : item.motivo === 'elegibilidade_nao_resolvida'
    ? 'sem resposta de elegibilidade do Mercado Livre após todas as tentativas'
    : item.motivo === 'sem_variation_id'
    ? 'sem identificador de variação no Mercado Livre'
    : 'sem ficha equivalente';
  return blocos(
    [item.semVariacao ? '⚠️ Catálogo: anúncio não vai competir' : '⚠️ Catálogo: variação não vai competir'],
    [
      `Anúncio: "${nome}"`,
      !item.semVariacao && `${item.cores.length === 1 ? 'Variação' : 'Variações'}: ${item.cores.join(', ')}`,
      `Motivo: ${causa}`,
      'Risco: o Mercado Livre pode pausar/inativar o anúncio.',
    ],
    [
      'Para evitar:',
      '1. Abra o link abaixo',
      '2. Publicar no catálogo',
      item.semVariacao
        ? '3. Associe a ficha do produto ou informe que ela não existe'
        : '3. Na cor sem ficha, clique "Não encontro minha variação"',
      '4. Confirmar',
    ],
    // Regra do projeto: NUNCA trocar categoria de anúncio publicado (re-moderação, incidente
    // Aquaphor) — a sugestão é para a PRÓXIMA publicação, e a mensagem diz isso.
    item.categoriaSugerida ? [
      `💡 A ficha de catálogo deste produto vive na categoria "${item.categoriaSugerida.nome}" (${item.categoriaSugerida.id}).`,
      'Não troque a categoria do anúncio já publicado — considere-a numa próxima publicação.',
    ] : [],
    [url],
  );
}

// ─── Faturamento (ADR-0037) ────────────────────────────────────────────────

export interface NovaVendaAlerta {
  order_id: number;
  pack_id?: number | null;
  comprador: string | null;
  itens: Array<{ titulo: string | null; quantity: number; ean: string | null }>;
  /** null = valor não confirmado (cupom do vendedor sem leitura do MP, ADR-0180) — sai sem valor. */
  total: number | null;
  moeda: string;
}

const fmtBRL = (n: number, moeda: string) =>
  moeda === 'BRL' ? `R$ ${n.toFixed(2).replace('.', ',')}` : `${moeda} ${n.toFixed(2)}`;

/**
 * Detalhe da venda no ML. A rota `/vendas/{id}/detalhe` aceita pack_id e order_id; a antiga
 * `/vendas/pacote/{id}/detalhe` foi descontinuada e devolve 301 para `/vendas/lista` (medido em
 * 15/09/2026, com id real e inventado), então o alerta de venda com pack caía na lista.
 * Espelha `urlVendaML` de `src/lib/ml-status.ts` — duplicado de propósito: runtimes separados.
 */
export function urlVendaML(packOuOrderId: number): string {
  return `https://www.mercadolivre.com.br/vendas/${packOuOrderId}/detalhe`;
}

export function montarMensagemNovaVenda(v: NovaVendaAlerta): string {
  return blocos(
    [`💰 Nova venda${v.total != null ? ` — ${fmtBRL(v.total, v.moeda)}` : ''}`],
    [v.comprador && `Comprador: ${v.comprador}`],
    v.itens.flatMap((i) => [`• ${i.quantity}× ${i.titulo ?? 'item'}`, i.ean && `  EAN ${i.ean}`]),
    // Número exibido = o do ML (pack quando houver), igual ao da tela de vendas do ML.
    [`🔗 Pedido ${v.pack_id ?? v.order_id}`, urlVendaML(v.pack_id ?? v.order_id)],
  );
}

export function montarMensagemAltaFrete(a: {
  titulo: string | null; mlItemId: string; atual: number; anterior: number; pct: number;
}): string {
  return blocos(
    ['🚚 Frete subiu'],
    [
      `Anúncio: ${a.titulo ?? a.mlItemId} (${a.mlItemId})`,
      `Esta venda: ${fmtBRL(a.atual, 'BRL')}`,
      `Venda anterior: ${fmtBRL(a.anterior, 'BRL')}`,
      `Aumento: +${a.pct}%`,
    ],
    ['Possível causa: o ML mudou peso/dimensões da embalagem. Confira o anúncio.'],
  );
}

export interface NovaPerguntaAlerta {
  question_id: number;
  texto: string;
  item_titulo: string | null;
}

export function montarMensagemNovaPergunta(p: NovaPerguntaAlerta): string {
  return blocos(
    ['❓ Nova pergunta'],
    [p.item_titulo && `Anúncio: "${p.item_titulo}"`, `"${p.texto}"`],
    [
      `Responda pelo PubliAI (menu Faturamento › Perguntas).`,
      // A API do ML não expõe permalink por pergunta, então o link é a caixa do vendedor
      // (mesma URL do atalho da aba Perguntas). O link do anúncio não ajuda a responder.
      `https://www.mercadolivre.com.br/perguntas/vendedor`,
    ],
  );
}

export interface NovaMensagemAlerta {
  texto: string;
  item_titulo: string | null;
}

export function montarMensagemNovaMensagem(m: NovaMensagemAlerta): string {
  return blocos(
    ['💬 Nova mensagem do comprador'],
    [m.item_titulo && `Anúncio: "${m.item_titulo}"`, `"${m.texto}"`],
    [`Responda pelo PubliAI (menu Faturamento › Mensagens).`],
  );
}

export interface NovaDevolucaoAlerta {
  claim_id: number;
  order_id: number | null;
  pack_id?: number | null;
  tipo: string;
  motivo: string | null;
  valor: number | null;
  moeda: string;
}

export function montarMensagemLiberacao(total: number, n: number, moeda: string): string {
  return blocos(
    ['🏦 Liberação de hoje no Mercado Pago'],
    [`💰 Valor: ${fmtBRL(total, moeda)}`, `🧾 Vendas: ${n}`],
    [`Entra no seu saldo Mercado Pago: o prazo de liberação ${n === 1 ? 'dessa venda' : 'dessas vendas'} venceu hoje.`],
  );
}

/** Mesma condição de detalhe-pedido-itens.tsx/aba-devolucoes.tsx: 'returns' não tem claim
 * específico no ML, só a lista filtrada; os demais tipos abrem direto na reclamação. */
function urlDevolucaoML(tipo: string, claimId: number): string {
  return tipo === 'returns'
    ? 'https://www.mercadolivre.com.br/post-purchase/post-sales?main.filter=returns&temporal.filter=in-process'
    : `https://www.mercadolivre.com.br/vendas/reclamacoes/vendedor/${claimId}`;
}

export function montarMensagemNovaDevolucao(d: NovaDevolucaoAlerta): string {
  const numero = d.pack_id ?? d.order_id;
  return blocos(
    [`↩️ Nova ${d.tipo === 'return' ? 'devolução' : 'reclamação'}`],
    [
      numero ? `Pedido: ${numero}` : null,
      d.valor != null && `Valor: ${fmtBRL(d.valor, d.moeda)}`,
      d.motivo && `Motivo: ${d.motivo}`,
    ],
    [`Acompanhe em Faturamento › Devoluções e aja dentro do prazo do ML.`, urlDevolucaoML(d.tipo, d.claim_id)],
  );
}

/** Alerta de liveness (ADR-0069): token OAuth do ML revogado/expirado — vendas, perguntas e
 * devoluções param de sincronizar silenciosamente até a reconexão. `orgId` fica no parâmetro para
 * uso futuro (ex.: link direto pra org em setups multi-tenant); hoje a mensagem é genérica. */
export function montarMensagemConexaoBloqueada(orgId: string, motivo: string): string {
  void orgId;
  return blocos(
    ['🔌 A conexão com o Mercado Livre parou de sincronizar'],
    [`Motivo: ${motivo}`],
    [`Reconecte em Configurações › Mercado Livre para retomar vendas/perguntas/devoluções.`],
  );
}

/** Limite do `sendMessage`. Medido em unidades UTF-16 (`length`), que nunca é menor que a contagem
 * do Telegram — margem a favor. */
export const LIMITE_TELEGRAM = 4096;

/** Texto acima do limite vira várias mensagens, sem cortar conteúdo: quebra entre blocos (linha em
 * branco), depois entre linhas e, só para uma linha gigante, no meio dela (sem partir emoji). */
export function dividirTexto(texto: string, max = LIMITE_TELEGRAM): string[] {
  if (texto.length <= max) return [texto];
  for (const sep of ['\n\n', '\n']) {
    const partes = texto.split(sep);
    if (partes.length < 2) continue;
    const saida: string[] = [];
    let atual: string | null = null;
    for (const p of partes) {
      const junto: string = atual == null ? p : `${atual}${sep}${p}`;
      if (junto.length <= max) { atual = junto; continue; }
      if (atual != null) saida.push(atual);
      atual = p;
    }
    if (atual != null) saida.push(atual);
    return saida.filter((x) => x.trim()).flatMap((x) => dividirTexto(x, max));
  }
  const saida: string[] = [];
  for (let i = 0; i < texto.length;) {
    let fim = Math.min(i + max, texto.length);
    if (fim < texto.length && /[\uD800-\uDBFF]/.test(texto[fim - 1])) fim--;
    saida.push(texto.slice(i, fim));
    i = fim;
  }
  return saida;
}

/** Envia via Bot API com as credenciais do usuário (vindas da tabela configuracoes).
 * Sem token/chatId → no-op (retorna false). Texto longo sai em partes, na ordem; para na 1ª falha. */
export async function enviarTelegram(token: string | null, chatId: string | null, texto: string): Promise<boolean> {
  if (!token || !chatId) {
    console.warn('Telegram sem credenciais (token/chat_id); pulando envio.');
    return false;
  }
  try {
    for (const parte of dividirTexto(texto)) {
      const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: parte, disable_web_page_preview: true }),
      });
      if (!resp.ok) {
        console.warn(`Telegram sendMessage ${resp.status}: ${await resp.text()}`);
        return false;
      }
    }
    return true;
  } catch (e) {
    console.warn('Telegram falhou:', (e as Error).message);
    return false;
  }
}
