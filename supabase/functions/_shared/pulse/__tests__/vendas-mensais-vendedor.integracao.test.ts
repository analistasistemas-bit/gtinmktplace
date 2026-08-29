import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../../../src/lib/database.types.ts';
import {
  estimarVendasMensais,
  medianaVendasMensaisDoUniverso,
} from '../vendas-mensais-vendedor.ts';

function carregarEnvLocal(): Record<string, string> {
  const candidatos = [
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '../../.env.local'),
  ];
  for (const path of candidatos) {
    if (!existsSync(path)) continue;
    return Object.fromEntries(
      readFileSync(path, 'utf8')
        .split('\n')
        .filter((l) => l.includes('=') && !l.startsWith('#'))
        .map((l) => {
          const i = l.indexOf('=');
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        }),
    );
  }
  return {};
}

const envLocal = carregarEnvLocal();
const url = envLocal.VITE_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const anon = envLocal.VITE_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const email = envLocal.VALIDATION_EMAIL ?? process.env.VALIDATION_EMAIL;
const senha = envLocal.VALIDATION_PASSWORD ?? process.env.VALIDATION_PASSWORD;

const credenciaisReais = Boolean(
  url
  && anon
  && email
  && senha
  && url !== 'https://test.supabase.co'
  && anon !== 'test-anon-key-not-a-secret',
);

const skipMsg = credenciaisReais
  ? undefined
  : '.env.local com VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VALIDATION_EMAIL e VALIDATION_PASSWORD '
    + 'necessários para validação contra pulse_vendedores (RLS exige sessão autenticada)';

async function carregarPulseVendedores() {
  const login = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon! },
    body: JSON.stringify({ email, password: senha }),
  });
  if (!login.ok) throw new Error(`Login VALIDATION falhou: HTTP ${login.status}`);
  const { access_token: token } = await login.json() as { access_token?: string };
  if (!token) throw new Error('Login VALIDATION não devolveu access_token');

  const db = createClient<Database>(url!, anon!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const PAGE = 1000;
  const rows: Array<{ seller_id: number; transactions_total: number | null; dia: string }> = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from('pulse_vendedores')
      .select('seller_id, transactions_total, dia')
      .order('dia', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

describe.skipIf(!credenciaisReais)('vendas-mensais-vendedor — integração pulse_vendedores', () => {
  it(skipMsg ?? 'valida estimativas contra dados reais de produção', async () => {
    const rows = await carregarPulseVendedores();
    expect(rows.length).toBeGreaterThan(0);

    const serie = rows
      .filter((r): r is typeof r & { transactions_total: number } => r.transactions_total != null)
      .map((r) => ({
        seller_id: r.seller_id,
        transactions_total: r.transactions_total,
        dia: r.dia,
      }));

    const resultados = estimarVendasMensais(serie);

    for (const r of resultados.values()) {
      if (r.estado === 'valor') {
        expect(r.vendas_mes).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(r.vendas_mes)).toBe(true);
      }
    }

    const porVendedor = new Map<string, typeof serie>();
    for (const s of serie) {
      const k = String(s.seller_id);
      const b = porVendedor.get(k) ?? [];
      b.push(s);
      porVendedor.set(k, b);
    }
    for (const [sellerId, snaps] of porVendedor) {
      if (snaps.length < 2) continue;
      const ordenado = [...snaps].sort((a, b) => a.dia.localeCompare(b.dia));
      const delta = ordenado.at(-1)!.transactions_total - ordenado[0].transactions_total;
      const r = resultados.get(sellerId);
      if (delta < 0) {
        expect(r?.estado).toBe('sem_estimativa_no_periodo');
      }
    }

    const mediana = medianaVendasMensaisDoUniverso(resultados);
    expect(mediana).not.toBeNull();
    expect(Number.isFinite(mediana)).toBe(true);
    expect(mediana!).toBeGreaterThan(0);
    expect(mediana!).toBeLessThan(500);

    const valores = [...resultados.values()]
      .filter((r): r is Extract<typeof r, { estado: 'valor' }> => r.estado === 'valor')
      .map((r) => r.vendas_mes);
    if (valores.length >= 2) {
      const media = valores.reduce((a, b) => a + b, 0) / valores.length;
      expect(mediana!).toBeLessThan(media);
    }

    const comDoisOuMais = [...porVendedor.entries()].filter(([, s]) => s.length >= 2);
    const comValor = comDoisOuMais.filter(([id]) => resultados.get(id)?.estado === 'valor');
    expect(comValor.length).toBeGreaterThan(comDoisOuMais.length * 0.5);
  }, 60_000);
});

if (!credenciaisReais) {
  describe('vendas-mensais-vendedor — integração pulse_vendedores (skip)', () => {
    it('pula: credenciais reais ausentes', () => {
      expect(skipMsg).toBeTruthy();
    });
  });
}
