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
    ? '🚫 1 anúncio moderado pelo Mercado Livre:'
    : `🚫 ${itens.length} anúncios moderados pelo Mercado Livre:`;
  const linhas = itens.map((i) => {
    const nome = i.titulo ?? i.ml_item_id;
    const link = i.permalink ? ` — ${i.permalink}` : '';
    return `• ${nome} (${traduzir(i.motivo)})${link}`;
  });
  return [cabecalho, ...linhas].join('\n');
}

export interface CatalogoNoMatchAlerta {
  ml_item_id: string;
  titulo: string | null;
  cores: string[];
}

// Alerta PROATIVO (ADR-0036): no opt-in de catálogo, alguma variação não tem ficha equivalente
// (ex.: GTIN só existe em ficha de kit). Se ela ficar sem associação, o ML pausa o anúncio inteiro
// depois. A ação "Não encontro minha variação" é só na UI do ML (não há endpoint OAuth), então o
// sistema avisa o operador p/ resolver manualmente ANTES da pausa.
export function montarMensagemCatalogoNoMatch(item: CatalogoNoMatchAlerta): string {
  const nome = item.titulo ?? item.ml_item_id;
  const cores = item.cores.join(', ');
  const plural = item.cores.length === 1 ? 'a variação' : 'as variações';
  const url = `https://www.mercadolivre.com.br/produzir/catalogo/${item.ml_item_id}`;
  return [
    `⚠️ Catálogo: ${plural} ${cores} do anúncio "${nome}" não tem ficha equivalente e não vai competir.`,
    `Se ficar assim, o Mercado Livre pode pausar/inativar o anúncio.`,
    `Para evitar: abra o link → Publicar no catálogo → na cor sem ficha clique "Não encontro minha variação" → Confirmar.`,
    url,
  ].join('\n');
}

// ─── Faturamento (ADR-0037) ────────────────────────────────────────────────

export interface NovaVendaAlerta {
  order_id: number;
  comprador: string | null;
  itens: Array<{ titulo: string | null; quantity: number; ean: string | null }>;
  total: number;
  moeda: string;
}

const fmtBRL = (n: number, moeda: string) =>
  moeda === 'BRL' ? `R$ ${n.toFixed(2).replace('.', ',')}` : `${moeda} ${n.toFixed(2)}`;

export function montarMensagemNovaVenda(v: NovaVendaAlerta): string {
  const itens = v.itens
    .map((i) => `• ${i.quantity}× ${i.titulo ?? 'item'}${i.ean ? ` — EAN ${i.ean}` : ''}`)
    .join('\n');
  const comprador = v.comprador ? ` de ${v.comprador}` : '';
  return [
    `💰 Nova venda${comprador} — ${fmtBRL(v.total, v.moeda)}`,
    itens,
    `Pedido ${v.order_id}`,
  ].filter(Boolean).join('\n');
}

export interface NovaPerguntaAlerta {
  question_id: number;
  texto: string;
  item_titulo: string | null;
}

export function montarMensagemNovaPergunta(p: NovaPerguntaAlerta): string {
  const sobre = p.item_titulo ? ` sobre "${p.item_titulo}"` : '';
  return [
    `❓ Nova pergunta${sobre}:`,
    `"${p.texto}"`,
    `Responda pelo PubliAI (menu Faturamento › Perguntas).`,
  ].join('\n');
}

export interface NovaMensagemAlerta {
  texto: string;
  item_titulo: string | null;
}

export function montarMensagemNovaMensagem(m: NovaMensagemAlerta): string {
  const sobre = m.item_titulo ? ` sobre "${m.item_titulo}"` : '';
  return [
    `💬 Nova mensagem do comprador${sobre}:`,
    `"${m.texto}"`,
    `Responda pelo PubliAI (menu Faturamento › Mensagens).`,
  ].join('\n');
}

export interface NovaDevolucaoAlerta {
  claim_id: number;
  order_id: number | null;
  tipo: string;
  motivo: string | null;
  valor: number | null;
  moeda: string;
}

export function montarMensagemLiberacao(total: number, n: number, moeda: string): string {
  const plural = n === 1 ? 'venda' : 'vendas';
  return [
    `🏦 Hoje libera ${fmtBRL(total, moeda)} no seu saldo Mercado Pago`,
    `Referente a ${n} ${plural} cujo prazo de liberação venceu hoje.`,
  ].join('\n');
}

export function montarMensagemNovaDevolucao(d: NovaDevolucaoAlerta): string {
  const valor = d.valor != null ? ` (${fmtBRL(d.valor, d.moeda)})` : '';
  const pedido = d.order_id ? ` do pedido ${d.order_id}` : '';
  const motivo = d.motivo ? ` — ${d.motivo}` : '';
  return [
    `↩️ Nova ${d.tipo === 'return' ? 'devolução' : 'reclamação'}${pedido}${valor}${motivo}`,
    `Acompanhe em Faturamento › Devoluções e aja dentro do prazo do ML.`,
  ].join('\n');
}

/** Alerta de liveness (ADR-0069): token OAuth do ML revogado/expirado — vendas, perguntas e
 * devoluções param de sincronizar silenciosamente até a reconexão. `orgId` fica no parâmetro para
 * uso futuro (ex.: link direto pra org em setups multi-tenant); hoje a mensagem é genérica. */
export function montarMensagemConexaoBloqueada(orgId: string, motivo: string): string {
  void orgId;
  return [
    `🔌 A conexão com o Mercado Livre parou de sincronizar (${motivo}).`,
    `Reconecte em Configurações › Mercado Livre para retomar vendas/perguntas/devoluções.`,
  ].join('\n');
}

/** Envia via Bot API com as credenciais do usuário (vindas da tabela configuracoes).
 * Sem token/chatId → no-op (retorna false). */
export async function enviarTelegram(token: string | null, chatId: string | null, texto: string): Promise<boolean> {
  if (!token || !chatId) {
    console.warn('Telegram sem credenciais (token/chat_id); pulando envio.');
    return false;
  }
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: texto, disable_web_page_preview: true }),
    });
    if (!resp.ok) {
      console.warn(`Telegram sendMessage ${resp.status}: ${await resp.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('Telegram falhou:', (e as Error).message);
    return false;
  }
}
