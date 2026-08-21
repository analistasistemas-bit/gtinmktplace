import { redisGet, redisSet } from '../redis/client.ts';

const API = 'https://api.mercadolibre.com';
const TIMEOUT_MS = 15_000;
const TTL_PERFIL = 60 * 60 * 24;

export interface PerfilVendedor {
  seller_id: number;
  nickname: string | null;
  nivel: string | null;
  power_seller: string | null;
  transactions_total: number;
  uf: string | null;
  detalhe: {
    transactions: {
      period: string | null;
      total: number;
      completed: number | null;
      canceled: number | null;
      ratings: { positive: number | null; neutral: number | null; negative: number | null };
    };
    metrics: Record<string, unknown>;
  };
}

function registro(valor: unknown): Record<string, unknown> | null {
  return typeof valor === 'object' && valor != null && !Array.isArray(valor)
    ? valor as Record<string, unknown>
    : null;
}

function textoOuNulo(valor: unknown): string | null {
  return typeof valor === 'string' ? valor : null;
}

function numeroOuNulo(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

function eTextoOuNulo(valor: unknown): valor is string | null {
  return valor === null || typeof valor === 'string';
}

function eNumeroOuNulo(valor: unknown): valor is number | null {
  return valor === null || numeroOuNulo(valor) != null;
}

export function normalizarPerfilVendedor(json: unknown): PerfilVendedor | null {
  const bruto = registro(json);
  const reputacao = registro(bruto?.seller_reputation);
  const transactions = registro(reputacao?.transactions);
  const ratings = registro(transactions?.ratings);
  const address = registro(bruto?.address);
  const state = registro(address?.state);
  const sellerId = numeroOuNulo(bruto?.id);
  const total = numeroOuNulo(transactions?.total);
  if (sellerId == null || total == null) return null;

  return {
    seller_id: sellerId,
    nickname: textoOuNulo(bruto?.nickname),
    nivel: textoOuNulo(reputacao?.level_id),
    power_seller: textoOuNulo(reputacao?.power_seller_status),
    transactions_total: total,
    uf: textoOuNulo(state?.id),
    detalhe: {
      transactions: {
        period: textoOuNulo(transactions?.period),
        total,
        completed: numeroOuNulo(transactions?.completed),
        canceled: numeroOuNulo(transactions?.canceled),
        ratings: {
          positive: numeroOuNulo(ratings?.positive),
          neutral: numeroOuNulo(ratings?.neutral),
          negative: numeroOuNulo(ratings?.negative),
        },
      },
      metrics: registro(reputacao?.metrics) ?? {},
    },
  };
}

export function validarPerfilVendedor(valor: unknown): PerfilVendedor | null {
  const perfil = registro(valor);
  const detalhe = registro(perfil?.detalhe);
  const transactions = registro(detalhe?.transactions);
  const ratings = registro(transactions?.ratings);
  const metrics = registro(detalhe?.metrics);
  const sellerId = numeroOuNulo(perfil?.seller_id);
  const transactionsTotal = numeroOuNulo(perfil?.transactions_total);
  const total = numeroOuNulo(transactions?.total);
  if (
    sellerId == null || transactionsTotal == null || total == null || transactionsTotal !== total || metrics == null ||
    !eTextoOuNulo(perfil?.nickname) || !eTextoOuNulo(perfil?.nivel) || !eTextoOuNulo(perfil?.power_seller) ||
    !eTextoOuNulo(perfil?.uf) || !eTextoOuNulo(transactions?.period) ||
    !eNumeroOuNulo(transactions?.completed) || !eNumeroOuNulo(transactions?.canceled) ||
    !eNumeroOuNulo(ratings?.positive) || !eNumeroOuNulo(ratings?.neutral) || !eNumeroOuNulo(ratings?.negative)
  ) return null;

  return valor as PerfilVendedor;
}

async function mlGetJson(path: string, token: string): Promise<unknown | null> {
  try {
    const resposta = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return resposta.ok ? await resposta.json() : null;
  } catch {
    return null;
  }
}

export async function buscarPerfilVendedor(token: string, sellerId: number): Promise<PerfilVendedor | null> {
  const chave = `cache:seller:v2:${sellerId}`;
  const cache = await redisGet(chave).catch(() => null);
  if (cache) {
    try {
      const salvo = validarPerfilVendedor(JSON.parse(cache));
      if (salvo) return salvo;
    } catch { /* cache inválido: consulta a fonte */ }
  }

  const perfil = normalizarPerfilVendedor(await mlGetJson(`/users/${sellerId}`, token));
  if (perfil) await redisSet(chave, JSON.stringify(perfil), TTL_PERFIL).catch(() => undefined);
  return perfil;
}
