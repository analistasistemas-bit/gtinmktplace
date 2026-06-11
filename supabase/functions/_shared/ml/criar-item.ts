import type { PayloadItem } from './publicar.ts';
import { ordenarCoresAlfabetica } from '../cor/ordenar.ts';
import { humanizarErroML } from './erro-ml.ts';

export interface ResultadoItem {
  id: string;
  permalink: string;
  variations: Array<{ id: string | number; seller_custom_field?: string }>;
}

export async function criarItemML(accessToken: string, payload: PayloadItem): Promise<ResultadoItem> {
  const resp = await fetch('https://api.mercadolibre.com/items', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await resp.json();
  if (!resp.ok) {
    const e = new Error(humanizarErroML(resp.status, json));
    (e as { status?: number }).status = resp.status;
    throw e;
  }
  return { id: json.id, permalink: json.permalink, variations: json.variations ?? [] };
}

/**
 * O ML rejeita emojis na descrição (DESCRIPTION_PLAIN_TEXT_NOT_ALLOWED). O template
 * do copywriter (M3.1) usa emojis no preview; aqui removemos só para o envio ao ML.
 * Checkmarks viram "- " (mantêm a lista); bullet "•" e acentos são aceitos.
 */
export function sanitizarDescricaoML(texto: string): string {
  return texto
    .replace(/[✔✅☑]️?[ \t]*/g, '- ')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2600}-\u{26FF}\u{2B00}-\u{2BFF}️]/gu, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/^[ \t]+/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Reescreve só a lista da seção "🎨 CORES DISPONÍVEIS" da descrição, preservando
 * todo o resto do texto. Usado no UPDATE: quando entra uma cor nova, a descrição
 * herdada do anúncio (sem IA, ADR-0016) precisa refletir a cor adicionada.
 * Determinística (sem IA). Se a seção não existir, retorna o texto original intacto.
 * A lista é sempre escrita em ordem alfabética (pedido do operador 2026-06-09).
 */
export function atualizarSecaoCores(descricao: string, cores: string[]): string {
  const linhas = descricao.split('\n');
  const headerIdx = linhas.findIndex((l) => /CORES DISPON[IÍ]VEIS/i.test(l));
  if (headerIdx === -1) return descricao;

  let inicio = headerIdx + 1;
  while (inicio < linhas.length && linhas[inicio].trim() === '') inicio++;
  let fim = inicio;
  while (fim < linhas.length && /^\s*-\s+/.test(linhas[fim])) fim++;

  const novaLista = ordenarCoresAlfabetica(cores).map((c) => `- ${c}`);
  const depois = linhas.slice(fim);
  if (depois.length > 0 && depois[0].trim() !== '') depois.unshift('');
  return [...linhas.slice(0, headerIdx + 1), '', ...novaLista, ...depois].join('\n');
}

/** Lê a descrição ao vivo do item (`plain_text`). Item sem descrição → ''. */
export async function buscarDescricaoML(accessToken: string, itemId: string): Promise<string> {
  const resp = await fetch(`https://api.mercadolibre.com/items/${itemId}/description`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (resp.status === 404) return '';
  if (!resp.ok) throw new Error(`Descrição GET (${resp.status}): ${await resp.text()}`);
  const json = await resp.json().catch(() => ({}));
  return (json?.plain_text as string) ?? '';
}

/**
 * Decide se a descrição precisa ser reenviada ao ML no UPDATE (ADR-0016 adendo 2026-06-07).
 * Compara a descrição DESEJADA (cores atualizadas + sanitizada como o ML guarda) contra a
 * que está AO VIVO no item. Cobre dois casos com o mesmo gatilho: cor nova (a seção de cores
 * muda) e descrição corrigida/regenerada pelo operador (o texto muda). Reposição pura de
 * estoque → desejada == live → não reenvia (sem custo). Sem IA, determinística.
 */
export function resolverDescricaoUpdate(
  descricaoDb: string | null,
  cores: string[],
  liveMl: string,
): { novaDescricao: string; precisaPush: boolean } | null {
  if (!descricaoDb) return null;
  const novaDescricao = atualizarSecaoCores(descricaoDb, cores);
  const desejada = sanitizarDescricaoML(novaDescricao).trim();
  return { novaDescricao, precisaPush: desejada !== (liveMl ?? '').trim() };
}

/**
 * Cria/atualiza a descrição do item. No ML a descrição é um recurso separado
 * (`/items/{id}/description`), não vai no POST /items. Idempotente: tenta POST
 * (criar) e cai para PUT (atualizar) se já existir — seguro em retries.
 */
export async function garantirDescricaoML(
  accessToken: string,
  itemId: string,
  texto: string,
): Promise<void> {
  const url = `https://api.mercadolibre.com/items/${itemId}/description`;
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const body = JSON.stringify({ plain_text: sanitizarDescricaoML(texto) });

  let resp = await fetch(url, { method: 'POST', headers, body });
  if (resp.status === 400 || resp.status === 409) {
    resp = await fetch(url, { method: 'PUT', headers, body });
  }
  if (!resp.ok) {
    throw new Error(`Descrição (${resp.status}): ${await resp.text()}`);
  }
}
