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
