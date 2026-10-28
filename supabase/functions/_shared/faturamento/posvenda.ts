// Mapeadores puros do detalhe de reclamação/devolução (ADR-0192). Sem Deno/npm — testável.
import type { RevisaoML } from './devolucao.ts';

export type Autor = 'comprador' | 'vendedor' | 'ml';

export interface MensagemHistorico {
  data: string;
  autor: Autor;
  destinatario: Autor | null;
  texto: string;
  anexos: string[];
  status: string | null;
  moderacao: string | null;
}

export interface MotivoRevisao { id: string; texto: string; exige_foto: boolean; aplica: string[] }

export interface ReembolsoParcial { ofertas: Array<{ percentual: number; valor: number }>; minimo: number | null }

export interface Resolucao {
  papel: string; tipo: string; status: string;
  detalhes: Array<{ chave: string; valor: string }>;
  criada_em: string; atualizada_em: string;
}

export interface DetalheReclamacao {
  claim_id: number;
  return_id: number | null;
  stage: string | null;
  status: string | null;
  estado: {
    titulo: string | null; descricao: string | null; problema: string | null;
    prazo: string | null; vez_de: 'vendedor' | 'comprador' | 'ml' | null;
  };
  comprador_quer: string | null;
  resolucoes: Resolucao[];
  resolucao_final: { motivo: string | null; data: string | null } | null;
  afeta_reputacao: string | null;
  custo_devolucao: number | null;
  historico: MensagemHistorico[];
  acoes: string[];
  revisoes: RevisaoML[];
  pedidos_devolucao: number[];
  motivos_falha_revisao: MotivoRevisao[];
  reembolso_parcial: ReembolsoParcial | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) ? n : null;
};

/** `mediator` = ML; o papel da conta (`respondent`/`complainant`...) = vendedor; o resto = comprador. */
export function autorDoPapel(role: string | null | undefined, papelDaConta: string | null | undefined): Autor {
  if (role === 'mediator') return 'ml';
  if (papelDaConta && role === papelDaConta) return 'vendedor';
  return 'comprador';
}

/** GET claims/{id}/messages → histórico cronológico. */
export function montarHistorico(resp: unknown, papelDaConta: string | null | undefined): MensagemHistorico[] {
  if (!Array.isArray(resp)) return [];
  const out: MensagemHistorico[] = [];
  for (const raw of resp) {
    const m = obj(raw);
    if (!m) continue;
    const data = str(m.date_created) ?? str(m.message_date);
    if (!data) continue;
    const anexos = (Array.isArray(m.attachments) ? m.attachments : [])
      .map((a) => str(obj(a)?.original_filename) ?? str(obj(a)?.filename))
      .filter((x): x is string => x != null);
    const dest = str(m.receiver_role);
    out.push({
      data,
      autor: autorDoPapel(str(m.sender_role), papelDaConta),
      destinatario: dest ? autorDoPapel(dest, papelDaConta) : null,
      texto: str(m.message) ?? '',
      anexos,
      status: str(m.status),
      moderacao: str(obj(m.message_moderation)?.status),
    });
  }
  return out.sort((a, b) => Date.parse(a.data) - Date.parse(b.data));
}

const EXIGE_FOTO = new Set(['SRF2', 'SRF4']);

/** GET returns/reasons?flow=seller_return_failed → motivos de revisão reprovada. `aplica` preserva `apply`. */
export function motivosRevisao(resp: unknown): MotivoRevisao[] {
  if (!Array.isArray(resp)) return [];
  const out: MotivoRevisao[] = [];
  for (const raw of resp) {
    const r = obj(raw);
    const id = str(r?.id);
    if (!r || !id) continue;
    out.push({
      id,
      texto: str(r.detail) ?? str(r.name) ?? id,
      exige_foto: EXIGE_FOTO.has(id),
      aplica: (Array.isArray(r.apply) ? r.apply : []).filter((x): x is string => typeof x === 'string'),
    });
  }
  return out;
}

/** GET partial-refund/available-offers → ofertas (sem 100%, que é reembolso total) e piso. */
export function ofertasReembolso(resp: unknown): ReembolsoParcial | null {
  const r = obj(resp);
  if (!r || !Array.isArray(r.available_offers)) return null;
  const ofertas: ReembolsoParcial['ofertas'] = [];
  for (const o of r.available_offers) {
    const percentual = num(obj(o)?.percentage);
    const valor = num(obj(o)?.amount);
    if (percentual != null && valor != null && percentual < 100) ofertas.push({ percentual, valor });
  }
  const min = (Array.isArray(r.restrictions) ? r.restrictions : []).map(obj).find((x) => x?.type === 'minimum');
  return { ofertas, minimo: num(min?.percentage) };
}

/** GET claims/{id}/expected-resolutions → resoluções esperadas (percentual da oferta fica em `detalhes`). */
export function mapearResolucoes(resp: unknown): Resolucao[] {
  if (!Array.isArray(resp)) return [];
  const out: Resolucao[] = [];
  for (const raw of resp) {
    const r = obj(raw);
    const tipo = str(r?.expected_resolution);
    if (!r || !tipo) continue;
    const detalhes = (Array.isArray(r.details) ? r.details : []).flatMap((d): Array<{ chave: string; valor: string }> => {
      const o = obj(d);
      if (!o) return [];
      if ('key' in o) return [{ chave: String(o.key), valor: String(o.value ?? '') }];
      return Object.entries(o).map(([chave, v]) => ({ chave, valor: String(v ?? '') }));
    });
    out.push({
      papel: str(r.player_role) ?? '', tipo, status: str(r.status) ?? '', detalhes,
      criada_em: str(r.date_created) ?? '', atualizada_em: str(r.last_updated) ?? '',
    });
  }
  return out;
}
