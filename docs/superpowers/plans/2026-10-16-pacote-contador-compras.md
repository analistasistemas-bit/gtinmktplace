# Pacote do contador: compras (Plano 2b-1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o `pacote-AAAA-MM.zip` do card "Pacote do contador" (`/estoque`) passa a levar as compras do mês (XMLs das notas de compra + `relatorio-compras.xlsx`/`.pdf`, uma linha por item com CSOSN/CST) e sai mesmo com o Mercado Livre fora (vendas "indisponíveis"), exceto em sessão de suporte.

**Architecture:** tudo no navegador. Compras: lista paginada de `notas_compra` por emissão (RLS + filtro de org), fila de downloads do bucket `notas-compra` (4 em paralelo, 30 s cada) com SHA-256 dos bytes, leitura com o `lerNfe` existente + extração própria de CSOSN/CST e `finNFe` via `DOMParser`. Vendas (2a) ganham o estado `indisponível`. A edge `baixar-notas-venda` só muda o alvo de auditoria e o código de erro da auditoria.

**Tech Stack:** React + TS, vitest 3.2.4 (jsdom, `TZ=America/Sao_Paulo`), `xlsx` 0.20.3, `jspdf` 4.2.1 + `jspdf-autotable` 5.0.8, `fflate` 0.8.3, Supabase JS (storage + PostgREST), Edge Function Deno.

**Spec:** `docs/superpowers/specs/2026-10-16-pacote-contador-compras-design.md`.

## Global Constraints

- Sem migration. Sem edge nova. `supabase/functions/_shared/nfe/ler-nfe.ts` **não muda** (sem redeploy de `importar-nota-compra`). Só `baixar-notas-venda/index.ts` muda (redeploy na Task 7).
- Competência das compras = `emitida_em` (timestamptz) no mês em America/Sao_Paulo: `>= <AAAA-MM-01T00:00:00-03:00>` e `< <1º dia do mês seguinte T00:00:00-03:00>` (SP sem horário de verão desde 2019).
- Listagem com `buscarTodasPaginas` (`src/lib/paginacao-supabase.ts`), `.eq('org_id', org)`, ordem `emitida_em` + `id`. Falha em qualquer página aborta o pacote.
- Download: `supabase.storage.from('notas-compra').download(xml_path)`; hash SHA-256 hex dos **bytes** (`arrayBuffer`); os mesmos bytes vão para o zip. Concorrência 4, timeout 30 000 ms por XML.
- Pastas do zip: `compras/xmls/<chave>.xml` (importada), `compras/xmls-desfeitas/<chave>.xml`, `compras/xmls-canceladas/<chave>.xml`. Relatórios: `relatorio-compras.xlsx`, `relatorio-compras.pdf`. Vendas do 2a inalteradas (`xmls/<caminho ML>`, `relatorio-vendas.*`).
- Desfeitas e canceladas: XML no zip (pasta própria), **fora** da planilha e dos totais, listadas na Conferência com "desfeita no PubliAI em <data>" / "marcada cancelada no PubliAI em <data>" (data = `desfeita_em`).
- Dinheiro em centavos inteiros (`Math.round(valor * 100)` sobre os números do `lerNfe`); xlsx `#,##0.00` em toda coluna de dinheiro; quantidade `#,##0.####`; chave, número, série, CNPJ, NCM, CFOP e códigos tributários como **texto**.
- Diferença por nota = `vNF − (vProd − vDesc + vFrete + vSeg + vOutro + vII + vIPI + vIPIDevol + vST + vFCPST)`.
- Mensagens/textos (verbatim):
  - aviso cobertura: `Compras pela data de emissão; só notas importadas no PubliAI. Quantidade, unidade e CFOP são os do documento do fornecedor.`
  - aviso regeneração: `O pacote reflete as notas e situações no momento da geração; se uma nota deste mês for importada depois, gere de novo e substitua o anterior.`
  - mês sem compras: `Nenhuma nota de compra no mês`
  - vendas indisponíveis (Conferência de vendas e aba Vendas): `Vendas indisponíveis: <motivo> — gere o pacote de novo depois.`
  - rede: `falha de rede ao falar com o servidor`
  - toasts: `Pacote de <mes> gerado.` · `Pacote de <mes> gerado como PARCIAL — <motivos separados por "; ">` (motivos: `vendas indisponíveis`, `vendas com falha`, `<n> compras com falha`)
  - org trocada: `A organização mudou durante o download — gere o pacote de novo.`
- Classificação da falha de vendas (função `falhaVendas`): fatal = `AbortError`, `ErroOrgMudou`, `ErroAuditoria`, `ErroPacote` 401/403, qualquer falha **em sessão de suporte** (`useSupportStore.getState().context !== null`), erro inesperado; indisponível = `ErroPacote` 429/409/502/503/504/200, `ErroDownloadIncompleto`, `TypeError` (rede).
- Fixtures só com CNPJs `11222333000181` / `11444777000161`; nunca XML real no repo.
- Testes: `pnpm vitest run <arquivo>`; portão `pnpm preflight` (inclui `tsc -b`).

## Review Focus

1. Mês de outubro com fuso do processo diferente de São Paulo — limites `2026-10-01T03:00:00.000Z` / `2026-11-01T03:00:00.000Z` (Task 2).
2. XML com BOM: hash dos bytes confere; nada de `blob.text()` no caminho do hash (Task 2).
3. Vendas em 429 fora do suporte → pacote sai com compras e PARCIAL; em suporte → aborta (Task 5).
4. Frete só no total da nota → diferença aparece só se o `vNF` não fechar com os componentes do `ICMSTot` (Task 1).
5. Nota com `<det>` cujo IPI tem `<CST>` e ICMS não tem → tributação "não informado" (não pega o CST do IPI) (Task 1).

---

### Task 1: Leitura e montagem das compras (`compras-ler.ts`)

**Files:**
- Create: `src/lib/pacote-contador/tipos-compras.ts`
- Create: `src/lib/pacote-contador/compras-ler.ts`
- Test: `src/lib/pacote-contador/__tests__/fixtures-compras.ts`, `src/lib/pacote-contador/__tests__/compras-ler.test.ts`

**Interfaces:**
- Consumes: `lerNfe(texto): { ok: true; nota: NotaCompraLida } | { ok: false; erro: string }` de `supabase/functions/_shared/nfe/ler-nfe.ts`; tipos de `supabase/functions/_shared/nfe/tipos.ts`; `competenciaSP` de `src/lib/pacote-contador/ler.ts`.
- Produces: tipos `NotaCompraRow`, `XmlCompra`, `LinhaCompra`, `TotalNotaCompra`, `ConferenciaCompras`, `LeituraCompras`; `lerCompra(texto: string)`; `montarCompras(mes: string, notas: NotaCompraRow[], xmls: Map<string, XmlCompra>): LeituraCompras`.

- [ ] **Step 1: `tipos-compras.ts`**

```ts
// ADR-0181 Plano 2b-1 — modelo das compras do pacote do contador. Valores em centavos inteiros.
export interface NotaCompraRow {
  id: string; chave: string; numero: number; serie: number;
  emitente_cnpj: string; emitente_nome: string; emitida_em: string; valor_total: number;
  assinada: boolean; xml_path: string; xml_sha256: string | null;
  status: 'importada' | 'desfeita' | 'cancelada';
  importada_em: string; desfeita_em: string | null; divergencia_total_aceita: number | null;
}

export type XmlCompra =
  | { tipo: 'ok'; bytes: Uint8Array }
  | { tipo: 'indisponivel'; motivo: string }
  | { tipo: 'sem_hash' }
  | { tipo: 'divergente' };

export interface LinhaCompra {
  instante: number; emissao: string; importacao: string; fornecedor: string; cnpj: string;
  numero: string; serie: string; chave: string; finalidade: string;
  nItem: number; cProd: string; xProd: string; ncm: string; cfop: string;
  tribTipo: 'CSOSN' | 'CST' | ''; tribCodigo: string;   // '' + '' = não informado
  qCom: number; uCom: string;
  produtosC: number; freteC: number; seguroC: number; descontoC: number; outrasC: number;
  ipiC: number; stC: number; fcpstC: number;
}

export interface TotalNotaCompra {
  instante: number; chave: string; numero: string; fornecedor: string;
  vProdC: number; vFreteC: number; vSegC: number; vDescC: number; vOutroC: number; vIPIC: number;
  vSTC: number; vFCPSTC: number; vNFC: number; diferencaC: number; divergenciaAceitaC: number | null;
}

export interface ConferenciaCompras {
  mes: string; vazio: boolean; parcial: boolean; motivosParcial: string[];
  selecionadas: number; detalhadas: number; itens: number; comFalha: number;
  desfeitas: Array<{ chave: string; numero: number; fornecedor: string; em: string | null; comXml: boolean }>;
  canceladas: Array<{ chave: string; numero: number; fornecedor: string; em: string | null; comXml: boolean }>;
  semAssinatura: string[];
  finalidadeAtipica: Array<{ chave: string; finNFe: string }>;
  indisponiveis: Array<{ chave: string; motivo: string }>;
  semHash: string[]; divergentes: string[];
  ilegiveis: Array<{ chave: string; erro: string }>;
  totalMesC: number; totalSemDetalheC: number;
}

export interface LeituraCompras {
  linhas: LinhaCompra[]; totaisNota: TotalNotaCompra[]; conferencia: ConferenciaCompras;
  arquivos: Record<string, Uint8Array>;   // caminho no zip → bytes
}

export const AVISOS_COMPRAS = [
  'Compras pela data de emissão; só notas importadas no PubliAI. Quantidade, unidade e CFOP são os do documento do fornecedor.',
  'O pacote reflete as notas e situações no momento da geração; se uma nota deste mês for importada depois, gere de novo e substitua o anterior.',
] as const;
```

- [ ] **Step 2: Fixtures** (`__tests__/fixtures-compras.ts`)

```ts
import { strToU8 } from 'fflate';
import type { NotaCompraRow } from '../tipos-compras';
const NS = 'xmlns="http://www.portalfiscal.inf.br/nfe"';
export const CH = (n: number) => `2626101122233300018155001${String(n).padStart(9, '0')}1${String(n).padStart(8, '0')}0`;

type Item = { cfop?: string; icms?: string; ipiCst?: string; vProd?: string; vFrete?: string; qCom?: string };
export function xmlCompra(o: { n: number; dhEmi?: string; finNFe?: string; itens?: Item[]; tot?: Partial<Record<string, string>> }): string {
  const itens = o.itens ?? [{}];
  const det = itens.map((it, i) => `<det nItem="${i + 1}"><prod><cProd>P${i + 1}</cProd><cEAN>SEM GTIN</cEAN><xProd>Item ${i + 1}</xProd>`
    + `<NCM>61159500</NCM><CFOP>${it.cfop ?? '5102'}</CFOP><uCom>PC</uCom><qCom>${it.qCom ?? '2.0000'}</qCom><vProd>${it.vProd ?? '100.00'}</vProd>`
    + `${it.vFrete ? `<vFrete>${it.vFrete}</vFrete>` : ''}</prod><imposto>`
    + `${it.icms ?? '<ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS>'}`
    + `${it.ipiCst ? `<IPI><IPINT><CST>${it.ipiCst}</CST></IPINT></IPI>` : ''}</imposto></det>`).join('');
  const t = { vProd: '100.00', vFrete: '0.00', vSeg: '0.00', vDesc: '0.00', vOutro: '0.00', vIPI: '0.00', vST: '0.00', vFCPST: '0.00', vNF: '100.00', ...o.tot };
  const tot = Object.entries(t).map(([k, v]) => `<${k}>${v}</${k}>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc ${NS} versao="4.00"><NFe><infNFe Id="NFe${CH(o.n)}" versao="4.00">`
    + `<ide><mod>55</mod><serie>1</serie><nNF>${o.n}</nNF><dhEmi>${o.dhEmi ?? '2026-10-13T15:57:33-03:00'}</dhEmi><tpNF>1</tpNF><finNFe>${o.finNFe ?? '1'}</finNFe></ide>`
    + `<emit><CNPJ>11222333000181</CNPJ><xNome>FORNECEDOR TESTE LTDA</xNome></emit><dest><CNPJ>11444777000161</CNPJ></dest>`
    + `${det}<total><ICMSTot>${tot}</ICMSTot></total></infNFe></NFe>`
    + `<protNFe versao="4.00"><infProt><chNFe>${CH(o.n)}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;
}

export function row(o: Partial<NotaCompraRow> & { n: number }): NotaCompraRow {
  return {
    id: `id-${o.n}`, chave: CH(o.n), numero: o.n, serie: 1, emitente_cnpj: '11222333000181', emitente_nome: 'FORNECEDOR TESTE LTDA',
    emitida_em: '2026-10-13T18:57:33+00:00', valor_total: 100, assinada: true, xml_path: `org/${CH(o.n)}/h.xml`, xml_sha256: 'a'.repeat(64),
    status: 'importada', importada_em: '2026-10-14T12:00:00+00:00', desfeita_em: null, divergencia_total_aceita: null, ...o,
  };
}
export const ok = (xml: string) => ({ tipo: 'ok' as const, bytes: strToU8(xml) });
```

- [ ] **Step 3: Testes que falham** (`__tests__/compras-ler.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { lerCompra, montarCompras } from '../compras-ler';
import type { XmlCompra } from '../tipos-compras';
import { xmlCompra, row, ok, CH } from './fixtures-compras';

const M = '2026-10';
const mapa = (e: Array<[string, XmlCompra]>) => new Map(e);

describe('lerCompra', () => {
  it('CSOSN (Simples), CST (ICMS00/ICMS60), misto, ausente e CST de IPI não capturado', () => {
    const r = lerCompra(xmlCompra({ n: 1, itens: [
      {}, { icms: '<ICMS><ICMS00><orig>0</orig><CST>00</CST></ICMS00></ICMS>' },
      { icms: '<ICMS><ICMS60><orig>0</orig><CST>60</CST></ICMS60></ICMS>' },
      { icms: '<ICMS><ICMS10><orig>2</orig></ICMS10></ICMS>', ipiCst: '53' },
    ] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([1, 2, 3, 4].map((i) => r.trib.get(i))).toEqual([
      { tipo: 'CSOSN', codigo: '102' }, { tipo: 'CST', codigo: '00' }, { tipo: 'CST', codigo: '60' }, { tipo: '', codigo: '' },
    ]);
    expect(r.finNFe).toBe('1');
  });
  it('XML ilegível devolve ok:false', () => {
    expect(lerCompra('<nfeProc><quebrado').ok).toBe(false);
  });
});

describe('montarCompras', () => {
  it('linhas por item em centavos, ordem emissão/número/item, totais por componente e diferença', () => {
    const a = xmlCompra({ n: 2, dhEmi: '2026-10-20T10:00:00-03:00', itens: [{ vProd: '62.19' }, { vProd: '37.81' }],
      tot: { vProd: '100.00', vFrete: '10.00', vFCPST: '2.00', vNF: '112.00' } });
    const b = xmlCompra({ n: 1, dhEmi: '2026-10-05T10:00:00-03:00', tot: { vNF: '101.00' } });
    const l = montarCompras(M, [row({ n: 2, divergencia_total_aceita: 1 }), row({ n: 1 })],
      mapa([['id-2', ok(a)], ['id-1', ok(b)]]));
    expect(l.linhas.map((x) => [x.numero, x.nItem])).toEqual([['1', 1], ['2', 1], ['2', 2]]);
    expect(l.linhas[1]).toMatchObject({ produtosC: 6219, tribTipo: 'CSOSN', tribCodigo: '102', chave: CH(2), cnpj: '11222333000181', qCom: 2 });
    const t2 = l.totaisNota.find((t) => t.chave === CH(2))!;
    expect(t2).toMatchObject({ vProdC: 10000, vFreteC: 1000, vFCPSTC: 200, vNFC: 11200, diferencaC: 0, divergenciaAceitaC: 100 });
    expect(l.totaisNota.find((t) => t.chave === CH(1))!.diferencaC).toBe(100);
    expect(l.conferencia).toMatchObject({ selecionadas: 2, detalhadas: 2, itens: 3, totalMesC: 21300, parcial: false });
    expect(l.arquivos[`compras/xmls/${CH(1)}.xml`]).toBeDefined();
  });
  it('desfeita e cancelada: XML na pasta própria, fora da planilha e dos totais', () => {
    const l = montarCompras(M, [
      row({ n: 1 }), row({ n: 2, status: 'desfeita', desfeita_em: '2026-10-15T12:00:00+00:00' }), row({ n: 3, status: 'cancelada', desfeita_em: '2026-10-16T12:00:00+00:00' }),
    ], mapa([['id-1', ok(xmlCompra({ n: 1 }))], ['id-2', ok(xmlCompra({ n: 2 }))], ['id-3', ok(xmlCompra({ n: 3 }))]]));
    expect(l.linhas.map((x) => x.numero)).toEqual(['1']);
    expect(l.totaisNota).toHaveLength(1);
    expect(Object.keys(l.arquivos).sort()).toEqual([`compras/xmls-canceladas/${CH(3)}.xml`, `compras/xmls-desfeitas/${CH(2)}.xml`, `compras/xmls/${CH(1)}.xml`]);
    expect(l.conferencia.desfeitas[0]).toMatchObject({ chave: CH(2), em: '2026-10-15T12:00:00+00:00', comXml: true });
    expect(l.conferencia.canceladas[0].chave).toBe(CH(3));
    expect(l.conferencia.parcial).toBe(false);
  });
  it('falhas por nota marcam PARCIAL; ilegível íntegro vai no zip; total sem detalhe separado', () => {
    const l = montarCompras(M, [row({ n: 1, valor_total: 50 }), row({ n: 2, valor_total: 70 }), row({ n: 3 }), row({ n: 4 })], mapa([
      ['id-1', { tipo: 'indisponivel', motivo: 'tempo esgotado' }], ['id-2', { tipo: 'divergente' }],
      ['id-3', { tipo: 'sem_hash' }], ['id-4', ok('<nfeProc><quebrado')],
    ]));
    expect(l.conferencia).toMatchObject({ selecionadas: 4, detalhadas: 0, comFalha: 4, parcial: true, totalMesC: 0, totalSemDetalheC: (50 + 70 + 100 + 100) * 100 });
    expect(l.conferencia.indisponiveis).toEqual([{ chave: CH(1), motivo: 'tempo esgotado' }]);
    expect(l.conferencia.divergentes).toEqual([CH(2)]);
    expect(l.conferencia.semHash).toEqual([CH(3)]);
    expect(l.conferencia.ilegiveis[0].chave).toBe(CH(4));
    expect(Object.keys(l.arquivos)).toEqual([`compras/xmls/${CH(4)}.xml`]);
  });
  it('sem assinatura e finalidade atípica sinalizadas; mês vazio', () => {
    const l = montarCompras(M, [row({ n: 1, assinada: false })], mapa([['id-1', ok(xmlCompra({ n: 1, finNFe: '4' }))]]));
    expect(l.conferencia.semAssinatura).toEqual([CH(1)]);
    expect(l.conferencia.finalidadeAtipica).toEqual([{ chave: CH(1), finNFe: '4' }]);
    expect(l.linhas[0].finalidade).toBe('4');
    expect(montarCompras(M, [], new Map()).conferencia).toMatchObject({ vazio: true, parcial: false, selecionadas: 0 });
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/compras-ler.test.ts`
Expected: FAIL — `Cannot find module '../compras-ler'`.

- [ ] **Step 5: Implementar `compras-ler.ts`**

```ts
// ADR-0181 Plano 2b-1 — lê as notas de compra do mês e monta linhas/totais/conferência. XML é a fonte fiscal.
import { lerNfe } from '../../../supabase/functions/_shared/nfe/ler-nfe.ts';
import type { NotaCompraLida } from '../../../supabase/functions/_shared/nfe/tipos.ts';
import type { ConferenciaCompras, LeituraCompras, LinhaCompra, NotaCompraRow, TotalNotaCompra, XmlCompra } from './tipos-compras';

const c = (n: number) => Math.round(n * 100);
const filhos = (e: Element, tag: string) => Array.from(e.children).filter((x) => x.localName === tag);

/** lerNfe (reuso, sem alteração) + CSOSN/CST só de det/imposto/ICMS/<grupo> e o finNFe. */
export function lerCompra(texto: string):
  | { ok: true; nota: NotaCompraLida; trib: Map<number, { tipo: 'CSOSN' | 'CST' | ''; codigo: string }>; finNFe: string | null }
  | { ok: false; erro: string } {
  const lida = lerNfe(texto);
  if (!lida.ok) return { ok: false, erro: lida.erro };
  const doc = new DOMParser().parseFromString(texto, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return { ok: false, erro: 'XML ilegível' };
  const trib = new Map<number, { tipo: 'CSOSN' | 'CST' | ''; codigo: string }>();
  for (const det of Array.from(doc.getElementsByTagNameNS('*', 'det'))) {
    const n = Number(det.getAttribute('nItem'));
    const icms = filhos(det, 'imposto').flatMap((i) => filhos(i, 'ICMS'))[0];
    const grupo = icms ? Array.from(icms.children)[0] : undefined;
    const csosn = grupo ? filhos(grupo, 'CSOSN')[0]?.textContent?.trim() : undefined;
    const cst = grupo ? filhos(grupo, 'CST')[0]?.textContent?.trim() : undefined;
    trib.set(n, csosn ? { tipo: 'CSOSN', codigo: csosn } : cst ? { tipo: 'CST', codigo: cst } : { tipo: '', codigo: '' });
  }
  const finNFe = doc.getElementsByTagNameNS('*', 'finNFe')[0]?.textContent?.trim() ?? null;
  return { ok: true, nota: lida.nota, trib, finNFe };
}

const PASTA = { importada: 'compras/xmls/', desfeita: 'compras/xmls-desfeitas/', cancelada: 'compras/xmls-canceladas/' } as const;

export function montarCompras(mes: string, notas: NotaCompraRow[], xmls: Map<string, XmlCompra>): LeituraCompras {
  const conf: ConferenciaCompras = {
    mes, vazio: notas.length === 0, parcial: false, motivosParcial: [], selecionadas: notas.length, detalhadas: 0, itens: 0, comFalha: 0,
    desfeitas: [], canceladas: [], semAssinatura: [], finalidadeAtipica: [], indisponiveis: [], semHash: [], divergentes: [], ilegiveis: [],
    totalMesC: 0, totalSemDetalheC: 0,
  };
  const linhas: LinhaCompra[] = [];
  const totaisNota: TotalNotaCompra[] = [];
  const arquivos: Record<string, Uint8Array> = {};
  const dec = new TextDecoder();

  for (const n of notas) {
    const x = xmls.get(n.id) ?? { tipo: 'indisponivel' as const, motivo: 'não baixado' };
    if (x.tipo === 'ok') arquivos[`${PASTA[n.status]}${n.chave}.xml`] = x.bytes;
    if (n.status !== 'importada') {
      const reg = { chave: n.chave, numero: n.numero, fornecedor: n.emitente_nome, em: n.desfeita_em, comXml: x.tipo === 'ok' };
      (n.status === 'desfeita' ? conf.desfeitas : conf.canceladas).push(reg);
      if (x.tipo !== 'ok') { conf.comFalha += 1; conf.indisponiveis.push({ chave: n.chave, motivo: x.tipo === 'indisponivel' ? x.motivo : x.tipo }); }
      continue;
    }
    if (!n.assinada) conf.semAssinatura.push(n.chave);
    if (x.tipo !== 'ok') {
      conf.comFalha += 1; conf.totalSemDetalheC += c(n.valor_total);
      if (x.tipo === 'indisponivel') conf.indisponiveis.push({ chave: n.chave, motivo: x.motivo });
      else if (x.tipo === 'sem_hash') conf.semHash.push(n.chave);
      else conf.divergentes.push(n.chave);
      continue;
    }
    const r = lerCompra(dec.decode(x.bytes));
    if (!r.ok) { conf.comFalha += 1; conf.totalSemDetalheC += c(n.valor_total); conf.ilegiveis.push({ chave: n.chave, erro: r.erro }); continue; }
    const nota = r.nota; const t = nota.totais;
    const instante = Date.parse(nota.emitidaEm);
    const fin = r.finNFe ?? '';
    if (fin && fin !== '1') conf.finalidadeAtipica.push({ chave: n.chave, finNFe: fin });
    for (const it of nota.itens) {
      const trib = r.trib.get(it.nItem) ?? { tipo: '' as const, codigo: '' };
      linhas.push({
        instante, emissao: nota.emitidaEm, importacao: n.importada_em, fornecedor: nota.emitenteNome, cnpj: nota.emitenteCnpj,
        numero: String(nota.numero), serie: String(nota.serie), chave: nota.chave, finalidade: fin,
        nItem: it.nItem, cProd: it.cProd, xProd: it.xProd, ncm: it.ncm ?? '', cfop: it.cfop, tribTipo: trib.tipo, tribCodigo: trib.codigo,
        qCom: it.qCom, uCom: it.uCom, produtosC: c(it.vProd), freteC: c(it.vFrete), seguroC: c(it.vSeg), descontoC: c(it.vDesc),
        outrasC: c(it.vOutro), ipiC: c(it.vIPI), stC: c(it.vST), fcpstC: c(it.vFCPST),
      });
    }
    const componentes = c(t.vProd) - c(t.vDesc) + c(t.vFrete) + c(t.vSeg) + c(t.vOutro) + c(t.vII) + c(t.vIPI) + c(t.vIPIDevol) + c(t.vST) + c(t.vFCPST);
    totaisNota.push({
      instante, chave: nota.chave, numero: String(nota.numero), fornecedor: nota.emitenteNome,
      vProdC: c(t.vProd), vFreteC: c(t.vFrete), vSegC: c(t.vSeg), vDescC: c(t.vDesc), vOutroC: c(t.vOutro), vIPIC: c(t.vIPI),
      vSTC: c(t.vST), vFCPSTC: c(t.vFCPST), vNFC: c(t.vNF), diferencaC: c(t.vNF) - componentes,
      divergenciaAceitaC: n.divergencia_total_aceita == null ? null : c(n.divergencia_total_aceita),
    });
    conf.detalhadas += 1; conf.itens += nota.itens.length; conf.totalMesC += c(t.vNF);
  }

  linhas.sort((a, b) => a.instante - b.instante || Number(a.numero) - Number(b.numero) || a.nItem - b.nItem);
  totaisNota.sort((a, b) => a.instante - b.instante || Number(a.numero) - Number(b.numero));
  if (conf.comFalha) conf.motivosParcial.push(`${conf.comFalha} compra(s) com falha`);
  conf.parcial = conf.motivosParcial.length > 0;
  return { linhas, totaisNota, conferencia: conf, arquivos };
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/compras-ler.test.ts`
Expected: PASS. Ajuste só fixtures (ex.: se o `lerNfe` exigir um campo que a fixture não tem), nunca a regra. Se o `lerNfe` recusar `finNFe`/`mod` ausentes ou exigir `xNome` do destinatário, complete a fixture.

- [ ] **Step 7: Commit**

```bash
git add src/lib/pacote-contador/
git commit -m "feat(adr-0181): leitura e montagem das compras do pacote do contador"
```

---

### Task 2: Fonte das compras (`compras-fonte.ts`)

**Files:**
- Create: `src/lib/pacote-contador/compras-fonte.ts`
- Test: `src/lib/pacote-contador/__tests__/compras-fonte.test.ts`

**Interfaces:**
- Consumes: `NotaCompraRow`, `XmlCompra` (Task 1); `buscarTodasPaginas` (`src/lib/paginacao-supabase.ts`); `supabase` (`@/lib/supabase`).
- Produces: `limitesMesSP(mes: string): { de: string; ate: string }`; `listarNotasCompraMes(mes: string, org: string): Promise<NotaCompraRow[]>`; `sha256Hex(bytes: Uint8Array): Promise<string>`; `baixarXmlCompra(nota: NotaCompraRow, signal: AbortSignal, timeoutMs?: number): Promise<XmlCompra>`; `baixarXmlsCompra(notas: NotaCompraRow[], signal: AbortSignal, onProgresso?: (feitos: number, total: number) => void, concorrencia?: number): Promise<Map<string, XmlCompra>>`.

- [ ] **Step 1: Testes que falham**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const range = vi.fn();
const download = vi.fn();
const chain: Record<string, unknown> = {};
for (const k of ['select', 'eq', 'gte', 'lt', 'order']) chain[k] = vi.fn(() => chain);
chain.range = (de: number, ate: number) => range(de, ate);
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: vi.fn(() => chain),
  storage: { from: vi.fn(() => ({ download: (p: string) => download(p) })) },
} }));
import { limitesMesSP, listarNotasCompraMes, sha256Hex, baixarXmlCompra, baixarXmlsCompra } from '../compras-fonte';
import { row } from './fixtures-compras';

beforeEach(() => { range.mockReset(); download.mockReset(); });

describe('limitesMesSP', () => {
  it('outubro e dezembro, independentes do fuso do processo', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    try {
      expect(limitesMesSP('2026-10')).toEqual({ de: '2026-10-01T03:00:00.000Z', ate: '2026-11-01T03:00:00.000Z' });
      expect(limitesMesSP('2026-12')).toEqual({ de: '2026-12-01T03:00:00.000Z', ate: '2027-01-01T03:00:00.000Z' });
    } finally { process.env.TZ = tz; }
  });
});

describe('listarNotasCompraMes', () => {
  it('pagina até o fim, com filtro de org, limites e ordem', async () => {
    const pag1 = Array.from({ length: 1000 }, (_, i) => row({ n: i + 1 }));
    range.mockResolvedValueOnce({ data: pag1, error: null }).mockResolvedValueOnce({ data: [row({ n: 2001 })], error: null });
    const r = await listarNotasCompraMes('2026-10', 'org-1');
    expect(r).toHaveLength(1001);
    expect(chain.eq).toHaveBeenCalledWith('org_id', 'org-1');
    expect(chain.gte).toHaveBeenCalledWith('emitida_em', '2026-10-01T03:00:00.000Z');
    expect(chain.lt).toHaveBeenCalledWith('emitida_em', '2026-11-01T03:00:00.000Z');
    expect(chain.order).toHaveBeenCalledWith('emitida_em');
    expect(chain.order).toHaveBeenCalledWith('id');
  });
  it('falha numa página intermediária aborta', async () => {
    range.mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, i) => row({ n: i + 1 })), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'timeout' } });
    await expect(listarNotasCompraMes('2026-10', 'org-1')).rejects.toThrow('timeout');
  });
});

describe('download e hash', () => {
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x3c, 0x61, 0x2f, 0x3e]);   // BOM + "<a/>"
  it('hash é dos bytes (com BOM) e os bytes voltam inteiros', async () => {
    const h = await sha256Hex(bom);
    download.mockResolvedValueOnce({ data: new Blob([bom]), error: null });
    const r = await baixarXmlCompra(row({ n: 1, xml_sha256: h }), new AbortController().signal);
    expect(r).toEqual({ tipo: 'ok', bytes: bom });
  });
  it('divergente, sem hash, erro do storage e timeout', async () => {
    download.mockResolvedValueOnce({ data: new Blob([bom]), error: null });
    expect(await baixarXmlCompra(row({ n: 1, xml_sha256: 'b'.repeat(64) }), new AbortController().signal)).toEqual({ tipo: 'divergente' });
    expect(await baixarXmlCompra(row({ n: 1, xml_sha256: null }), new AbortController().signal)).toEqual({ tipo: 'sem_hash' });
    expect(await baixarXmlCompra(row({ n: 1, xml_sha256: 'xyz' }), new AbortController().signal)).toEqual({ tipo: 'sem_hash' });
    download.mockResolvedValueOnce({ data: null, error: { message: 'Object not found' } });
    expect(await baixarXmlCompra(row({ n: 1 }), new AbortController().signal)).toEqual({ tipo: 'indisponivel', motivo: 'Object not found' });
    download.mockImplementationOnce(() => new Promise(() => {}));
    expect(await baixarXmlCompra(row({ n: 1 }), new AbortController().signal, 20)).toEqual({ tipo: 'indisponivel', motivo: 'tempo esgotado' });
  });
  it('fila: no máximo 4 em paralelo, progresso e cancelamento', async () => {
    let ativos = 0; let pico = 0;
    download.mockImplementation(async () => {
      ativos += 1; pico = Math.max(pico, ativos);
      await new Promise((r) => setTimeout(r, 5));
      ativos -= 1;
      return { data: new Blob([bom]), error: null };
    });
    const h = await sha256Hex(bom);
    const notas = Array.from({ length: 10 }, (_, i) => row({ n: i + 1, xml_sha256: h }));
    const prog: number[] = [];
    const r = await baixarXmlsCompra(notas, new AbortController().signal, (f) => prog.push(f));
    expect(pico).toBeLessThanOrEqual(4);
    expect(r.size).toBe(10);
    expect(prog.at(-1)).toBe(10);
    const ac = new AbortController(); ac.abort();
    await expect(baixarXmlsCompra(notas, ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/compras-fonte.test.ts`
Expected: FAIL — módulo inexistente. (Se `crypto.subtle` não existir no jsdom, no topo do teste: `import { webcrypto } from 'node:crypto'; vi.stubGlobal('crypto', webcrypto);` — só no teste.)

- [ ] **Step 3: Implementar**

```ts
// ADR-0181 Plano 2b-1 — fonte das compras: notas do mês (RLS + org) e XMLs do bucket com hash dos BYTES.
import { supabase } from '@/lib/supabase';
import { buscarTodasPaginas } from '@/lib/paginacao-supabase';
import type { NotaCompraRow, XmlCompra } from './tipos-compras';

const COLS = 'id, chave, numero, serie, emitente_cnpj, emitente_nome, emitida_em, valor_total, assinada, xml_path, xml_sha256, status, importada_em, desfeita_em, divergencia_total_aceita';
const TIMEOUT_MS = 30_000;
const CONCORRENCIA = 4;

/** Limites do mês em America/Sao_Paulo (UTC−03:00 fixo; sem horário de verão desde 2019). */
// ponytail: offset fixo −03:00. Upgrade se o Brasil voltar a ter horário de verão: Intl com timeZone.
export function limitesMesSP(mes: string): { de: string; ate: string } {
  const [a, m] = mes.split('-').map(Number);
  const prox = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
  return { de: new Date(`${mes}-01T00:00:00-03:00`).toISOString(), ate: new Date(`${prox}-01T00:00:00-03:00`).toISOString() };
}

export async function listarNotasCompraMes(mes: string, org: string): Promise<NotaCompraRow[]> {
  const { de, ate } = limitesMesSP(mes);
  return buscarTodasPaginas<NotaCompraRow>((ini, fim) => supabase.from('notas_compra').select(COLS)
    .eq('org_id', org).gte('emitida_em', de).lt('emitida_em', ate)
    .order('emitida_em').order('id').range(ini, fim) as unknown as PromiseLike<{ data: NotaCompraRow[] | null; error: { message: string } | null }>);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
}

const abortErr = () => new DOMException('cancelado', 'AbortError');

export async function baixarXmlCompra(nota: NotaCompraRow, signal: AbortSignal, timeoutMs = TIMEOUT_MS): Promise<XmlCompra> {
  if (signal.aborted) throw abortErr();
  if (!nota.xml_sha256 || !/^[0-9a-f]{64}$/.test(nota.xml_sha256)) return { tipo: 'sem_hash' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const esgotado = new Promise<'timeout'>((r) => { timer = setTimeout(() => r('timeout'), timeoutMs); });
  const cancelado = new Promise<never>((_, rej) => signal.addEventListener('abort', () => rej(abortErr()), { once: true }));
  cancelado.catch(() => {});
  try {
    const r = await Promise.race([supabase.storage.from('notas-compra').download(nota.xml_path), esgotado, cancelado]);
    if (r === 'timeout') return { tipo: 'indisponivel', motivo: 'tempo esgotado' };
    if (r.error || !r.data) return { tipo: 'indisponivel', motivo: r.error?.message ?? 'XML não encontrado' };
    const bytes = new Uint8Array(await r.data.arrayBuffer());   // bytes: nunca blob.text() no caminho do hash (BOM)
    return (await sha256Hex(bytes)) === nota.xml_sha256 ? { tipo: 'ok', bytes } : { tipo: 'divergente' };
  } finally {
    clearTimeout(timer);
  }
}

export async function baixarXmlsCompra(
  notas: NotaCompraRow[], signal: AbortSignal, onProgresso?: (feitos: number, total: number) => void, concorrencia = CONCORRENCIA,
): Promise<Map<string, XmlCompra>> {
  if (signal.aborted) throw abortErr();
  const out = new Map<string, XmlCompra>();
  let i = 0; let feitos = 0;
  const trabalhador = async () => {
    while (i < notas.length) {
      if (signal.aborted) throw abortErr();
      const n = notas[i++];
      out.set(n.id, await baixarXmlCompra(n, signal));
      onProgresso?.(++feitos, notas.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concorrencia, notas.length) }, trabalhador));
  return out;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/compras-fonte.test.ts`
Expected: PASS. Se o teste de `process.env.TZ` não afetar o `Date` no meio do processo, troque por `vi.useFakeTimers` não — mantenha: o código usa offset explícito e não depende do fuso; o teste só documenta isso.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pacote-contador/
git commit -m "feat(adr-0181): fonte das compras — notas do mês paginadas e XMLs com hash dos bytes"
```

---

### Task 3: Relatórios de compras (xlsx + PDF)

**Files:**
- Create: `src/lib/pacote-contador/relatorio-compras-xlsx.ts`, `src/lib/pacote-contador/relatorio-compras-pdf.ts`, `src/lib/pacote-contador/cabecalho-compras.ts`
- Test: `src/lib/pacote-contador/__tests__/relatorio-compras.test.ts`

**Interfaces:**
- Consumes: `LeituraCompras`, `AVISOS_COMPRAS` (Task 1); `Cabecalho`, `dataHoraBR`, `reais` de `src/lib/pacote-contador/cabecalho.ts` (2a).
- Produces: `linhasConferenciaCompras(l: LeituraCompras, cab: Cabecalho): Array<[string, string]>`; `gerarRelatorioComprasXlsx(l, cab): Uint8Array`; `montarRelatorioComprasPdf(l, cab): jsPDF`; `gerarRelatorioComprasPdf(l, cab): Uint8Array`.

- [ ] **Step 1: Teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { gerarRelatorioComprasXlsx } from '../relatorio-compras-xlsx';
import { montarRelatorioComprasPdf } from '../relatorio-compras-pdf';
import { montarCompras } from '../compras-ler';
import { xmlCompra, row, ok, CH } from './fixtures-compras';

type L = Array<string | number>;
const CAB = { org: 'EMPRESA TESTE LTDA', cnpj: '11444777000161', contaMl: '', geradoEm: new Date('2026-11-02T12:00:00-03:00') };
const comp = montarCompras('2026-10', [row({ n: 1 }), row({ n: 2, status: 'desfeita', desfeita_em: '2026-10-15T12:00:00+00:00' })],
  new Map([['id-1', ok(xmlCompra({ n: 1, itens: [{ vProd: '10.00' }], tot: { vProd: '10.00', vNF: '10.00' } }))], ['id-2', ok(xmlCompra({ n: 2 }))]]));

describe('relatório de compras', () => {
  it('xlsx: abas, textos, formatos de dinheiro e quantidade, totais e conferência', () => {
    const wb = XLSX.read(gerarRelatorioComprasXlsx(comp, CAB), { type: 'array' });
    expect(wb.SheetNames).toEqual(['Compras', 'Conferência de compras']);
    const ws = wb.Sheets.Compras;
    const rows = XLSX.utils.sheet_to_json<L>(ws, { header: 1, raw: true });
    const i = rows.findIndex((r) => r[0] === 'Data de emissão');
    const cab = rows[i] as string[];
    const col = (nome: string) => cab.indexOf(nome);
    const r1 = i + 1;
    expect(rows[r1][col('Chave')]).toBe(CH(1));
    expect(ws[XLSX.utils.encode_cell({ r: r1, c: col('Chave') })].t).toBe('s');
    expect(ws[XLSX.utils.encode_cell({ r: r1, c: col('NCM') })].t).toBe('s');
    expect(ws[XLSX.utils.encode_cell({ r: r1, c: col('Produtos') })]).toMatchObject({ v: 10, z: '#,##0.00' });
    expect(ws[XLSX.utils.encode_cell({ r: r1, c: col('Quantidade') })].z).toBe('#,##0.####');
    expect(rows[r1][col('Tipo trib.')]).toBe('CSOSN');
    expect(rows.some((r) => r[0] === 'Total do mês' && r[1] === 10)).toBe(true);
    const conf = XLSX.utils.sheet_to_json<L>(wb.Sheets['Conferência de compras'], { header: 1 }).flat().join(' | ');
    expect(conf).toContain('Compras pela data de emissão; só notas importadas no PubliAI.');
    expect(conf).toContain('desfeita no PubliAI em');
    expect(conf).toContain(CH(2));
  });
  it('PDF: tabela, totais e conferência; PARCIAL quando há falha', () => {
    expect(montarRelatorioComprasPdf(comp, CAB).output()).toContain('Total do m');
    const parcial = montarCompras('2026-10', [row({ n: 1 })], new Map([['id-1', { tipo: 'divergente' as const }]]));
    const t = montarRelatorioComprasPdf(parcial, CAB).output();
    expect(t).toContain('PACOTE PARCIAL');
    expect(t).toContain(CH(1));
  });
  it('mês vazio', () => {
    const wb = XLSX.read(gerarRelatorioComprasXlsx(montarCompras('2026-10', [], new Map()), CAB), { type: 'array' });
    expect(XLSX.utils.sheet_to_json<L>(wb.Sheets['Conferência de compras'], { header: 1 }).flat().join(' ')).toContain('Nenhuma nota de compra no mês');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/relatorio-compras.test.ts`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: `cabecalho-compras.ts`**

```ts
import { AVISOS_COMPRAS, type LeituraCompras } from './tipos-compras';
import { dataHoraBR, reais, type Cabecalho } from './cabecalho';

const brl = (c: number) => reais(c).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quando = (iso: string | null) => (iso ? dataHoraBR(Date.parse(iso)) : '—');

/** Linhas da Conferência de compras. Sempre [rótulo, valor] (o PDF depende das 2 colunas). */
export function linhasConferenciaCompras(l: LeituraCompras, cab: Cabecalho): Array<[string, string]> {
  const c = l.conferencia;
  const out: Array<[string, string]> = [];
  if (c.parcial) out.push([`PACOTE PARCIAL — ${c.motivosParcial.join('; ')}`, '']);
  out.push(['Organização', cab.org], ['CNPJ', cab.cnpj ?? '—'], ['Mês', c.mes], ['Gerado em', dataHoraBR(cab.geradoEm.getTime())],
    ['Notas selecionadas no mês', String(c.selecionadas)], ['Notas detalhadas', String(c.detalhadas)], ['Itens', String(c.itens)],
    ['Notas desfeitas', String(c.desfeitas.length)], ['Notas marcadas canceladas', String(c.canceladas.length)], ['Notas com falha', String(c.comFalha)],
    ['Total do mês (notas detalhadas)', brl(c.totalMesC)]);
  if (c.totalSemDetalheC) out.push(['Total das notas sem detalhe (valor registrado na importação)', brl(c.totalSemDetalheC)]);
  if (c.vazio) out.push(['Nenhuma nota de compra no mês', '']);
  for (const a of AVISOS_COMPRAS) out.push([a, '']);
  const secao = (titulo: string, itens: Array<[string, string]>) => { if (itens.length) out.push(['', ''], [titulo, ''], ...itens); };
  secao('Notas desfeitas (fora da planilha e dos totais)', c.desfeitas.map((d) => [d.chave, `nº ${d.numero} · ${d.fornecedor} · desfeita no PubliAI em ${quando(d.em)}${d.comXml ? '' : ' · sem XML'}`]));
  secao('Notas marcadas canceladas (fora da planilha e dos totais)', c.canceladas.map((d) => [d.chave, `nº ${d.numero} · ${d.fornecedor} · marcada cancelada no PubliAI em ${quando(d.em)}${d.comXml ? '' : ' · sem XML'}`]));
  secao('Cópias sem assinatura digital', c.semAssinatura.map((ch) => [ch, '']));
  secao('Finalidade diferente de normal (finNFe ≠ 1)', c.finalidadeAtipica.map((f) => [f.chave, `finNFe ${f.finNFe}`]));
  secao('XML indisponível', c.indisponiveis.map((x) => [x.chave, x.motivo]));
  secao('Integridade não comprovada (sem hash registrado)', c.semHash.map((ch) => [ch, '']));
  secao('XML diferente do importado', c.divergentes.map((ch) => [ch, '']));
  secao('XML ilegível (incluído no pacote)', c.ilegiveis.map((x) => [x.chave, x.erro]));
  return out;
}
```

- [ ] **Step 4: `relatorio-compras-xlsx.ts`**

```ts
// ADR-0181 Plano 2b-1 — relatório de compras (xlsx): uma linha por item; totais por nota (ICMSTot) e do mês.
import * as XLSX from 'xlsx';
import type { LeituraCompras } from './tipos-compras';
import { dataHoraBR, reais, type Cabecalho } from './cabecalho';
import { linhasConferenciaCompras } from './cabecalho-compras';

export const COLUNAS_COMPRAS = ['Data de emissão', 'Data de importação', 'Fornecedor', 'CNPJ', 'Número', 'Série', 'Chave', 'Finalidade',
  'Nº item', 'Código do fornecedor', 'Descrição', 'NCM', 'CFOP', 'Tipo trib.', 'Código trib.', 'Quantidade', 'Unidade',
  'Produtos', 'Frete', 'Seguro', 'Desconto', 'Outras', 'IPI', 'ST', 'FCP-ST'];
const DINHEIRO_ITEM = new Set([17, 18, 19, 20, 21, 22, 23, 24]);
const COL_QTD = 15;
export const COLUNAS_TOTAIS = ['Chave', 'Número', 'Fornecedor', 'vProd', 'vFrete', 'vSeg', 'vDesc', 'vOutro', 'vIPI', 'vST', 'vFCPST', 'vNF', 'Diferença', 'Divergência aceita'];

export function gerarRelatorioComprasXlsx(l: LeituraCompras, cab: Cabecalho): Uint8Array {
  const c = l.conferencia;
  const aoa: Array<Array<string | number>> = [];
  const formatar: Array<{ r: number; c: number; z: string }> = [];
  if (c.parcial) aoa.push([`PACOTE PARCIAL — ${c.motivosParcial.join('; ')}`], []);
  aoa.push([`Relatório de compras · ${cab.org} · ${c.mes}`], [], COLUNAS_COMPRAS);
  for (const x of l.linhas) {
    const r = aoa.length;
    aoa.push([dataHoraBR(x.instante), dataHoraBR(Date.parse(x.importacao)), x.fornecedor, x.cnpj, x.numero, x.serie, x.chave, x.finalidade,
      x.nItem, x.cProd, x.xProd, x.ncm, x.cfop, x.tribTipo || 'não informado', x.tribCodigo, x.qCom, x.uCom,
      reais(x.produtosC), reais(x.freteC), reais(x.seguroC), reais(x.descontoC), reais(x.outrasC), reais(x.ipiC), reais(x.stC), reais(x.fcpstC)]);
    for (const k of DINHEIRO_ITEM) formatar.push({ r, c: k, z: '#,##0.00' });
    formatar.push({ r, c: COL_QTD, z: '#,##0.####' });
  }
  aoa.push([], ['Totais por nota (do ICMSTot)'], COLUNAS_TOTAIS);
  for (const t of l.totaisNota) {
    const r = aoa.length;
    aoa.push([t.chave, t.numero, t.fornecedor, reais(t.vProdC), reais(t.vFreteC), reais(t.vSegC), reais(t.vDescC), reais(t.vOutroC),
      reais(t.vIPIC), reais(t.vSTC), reais(t.vFCPSTC), reais(t.vNFC), reais(t.diferencaC), t.divergenciaAceitaC == null ? '' : reais(t.divergenciaAceitaC)]);
    for (let k = 3; k <= 13; k++) formatar.push({ r, c: k, z: '#,##0.00' });
  }
  const rTotal = aoa.length + 1;
  aoa.push([], ['Total do mês', reais(c.totalMesC)]);
  formatar.push({ r: rTotal, c: 1, z: '#,##0.00' });

  const ws = XLSX.utils.aoa_to_sheet(aoa);   // strings → 't: s' (chave, NCM, CFOP, CNPJ ficam texto)
  for (const f of formatar) {
    const cel = ws[XLSX.utils.encode_cell({ r: f.r, c: f.c })] as XLSX.CellObject | undefined;
    if (cel && cel.t === 'n') cel.z = f.z;
  }
  const conf = XLSX.utils.aoa_to_sheet(linhasConferenciaCompras(l, cab));
  conf['!cols'] = [{ wch: 60 }, { wch: 80 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Compras');
  XLSX.utils.book_append_sheet(wb, conf, 'Conferência de compras');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
```

- [ ] **Step 5: `relatorio-compras-pdf.ts`**

```ts
// ADR-0181 Plano 2b-1 — relatório de compras (PDF, A4 paisagem): itens, totais por nota e página de Conferência.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { LeituraCompras } from './tipos-compras';
import { dataHoraBR, reais, type Cabecalho } from './cabecalho';
import { linhasConferenciaCompras } from './cabecalho-compras';

const brl = (c: number) => reais(c).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function montarRelatorioComprasPdf(l: LeituraCompras, cab: Cabecalho): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const c = l.conferencia;
  let y = 12;
  if (c.parcial) {
    doc.setTextColor(180, 0, 0); doc.setFontSize(11);
    doc.text(`PACOTE PARCIAL — ${c.motivosParcial.join('; ')}`, 10, y); y += 6;
    doc.setTextColor(0, 0, 0);
  }
  doc.setFontSize(12);
  doc.text(`Relatório de compras · ${cab.org} · ${c.mes}`, 10, y); y += 4;
  autoTable(doc, {
    startY: y + 2,
    head: [['Emissão', 'Fornecedor', 'Nº/Série', 'Chave', 'Item', 'Descrição', 'NCM', 'CFOP', 'Trib.', 'Qtd', 'Un', 'Produtos', 'Frete', 'Desc.', 'IPI', 'ST', 'FCP-ST']],
    body: l.linhas.map((x) => [dataHoraBR(x.instante), x.fornecedor, `${x.numero}/${x.serie}`, x.chave, String(x.nItem), x.xProd, x.ncm, x.cfop,
      x.tribTipo ? `${x.tribTipo} ${x.tribCodigo}` : 'não informado', String(x.qCom), x.uCom,
      brl(x.produtosC), brl(x.freteC), brl(x.descontoC), brl(x.ipiC), brl(x.stC), brl(x.fcpstC)]),
    styles: { fontSize: 5.5, cellPadding: 0.8 },
    headStyles: { fillColor: [60, 60, 60] },
    columnStyles: { 3: { fontSize: 4.8, cellWidth: 52 } },
    showHead: 'everyPage',
  });
  autoTable(doc, {
    head: [['Chave', 'Nº', 'Fornecedor', 'vProd', 'vFrete', 'vDesc', 'vIPI', 'vST', 'vFCPST', 'vNF', 'Diferença']],
    body: l.totaisNota.map((t) => [t.chave, t.numero, t.fornecedor, brl(t.vProdC), brl(t.vFreteC), brl(t.vDescC), brl(t.vIPIC), brl(t.vSTC), brl(t.vFCPSTC), brl(t.vNFC), brl(t.diferencaC)]),
    foot: [['Total do mês', '', '', '', '', '', '', '', '', brl(c.totalMesC), '']],
    styles: { fontSize: 6.5 },
  });
  doc.addPage();
  doc.setFontSize(12);
  doc.text('Conferência de compras', 10, 12);
  autoTable(doc, { startY: 16, columns: [{ header: '', dataKey: 0 }, { header: '', dataKey: 1 }], showHead: 'never',
    body: linhasConferenciaCompras(l, cab), styles: { fontSize: 8 }, columnStyles: { 0: { cellWidth: 120 } } });
  return doc;
}

export function gerarRelatorioComprasPdf(l: LeituraCompras, cab: Cabecalho): Uint8Array {
  return new Uint8Array(montarRelatorioComprasPdf(l, cab).output('arraybuffer'));
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/relatorio-compras.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/pacote-contador/
git commit -m "feat(adr-0181): relatório de compras do pacote do contador (xlsx e PDF)"
```

---

### Task 4: Vendas "indisponíveis", erros tipados e auditoria do pacote

**Files:**
- Modify: `src/lib/pacote-contador/tipos.ts` (campo `indisponivel` em `Conferencia`)
- Modify: `src/lib/pacote-contador/ler.ts` (`conferenciaVazia` + `lerPacoteIndisponivel`)
- Modify: `src/lib/pacote-contador/cabecalho.ts`, `relatorio-xlsx.ts`, `relatorio-pdf.ts` (estado indisponível)
- Modify: `src/lib/pacote-contador/baixar.ts` (`ErroOrgMudou`, `ErroAuditoria`, `falhaVendas`)
- Modify: `supabase/functions/baixar-notas-venda/index.ts` (alvo e `codigo`)
- Test: `src/lib/pacote-contador/__tests__/vendas-indisponivel.test.ts`, ajustes em `__tests__/baixar.test.ts`

**Interfaces:**
- Produces: `Conferencia.indisponivel: string | null`; `lerPacoteIndisponivel(mes: string, motivo: string, agora?: Date): LeituraPacote`; `class ErroOrgMudou extends Error`; `class ErroAuditoria extends Error`; `falhaVendas(e: unknown, emSuporte: boolean): { tipo: 'indisponivel'; motivo: string } | { tipo: 'fatal' }`.

- [ ] **Step 1: Testes que falham** (`__tests__/vendas-indisponivel.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { lerPacoteIndisponivel, lerPacoteVazio } from '../ler';
import { gerarRelatorioXlsx } from '../relatorio-xlsx';
import { montarRelatorioPdf } from '../relatorio-pdf';
import { falhaVendas, ErroPacote, ErroOrgMudou, ErroAuditoria } from '../baixar';
import { ErroDownloadIncompleto } from '../tipos';

const CAB = { org: 'EMPRESA TESTE LTDA', cnpj: null, contaMl: '', geradoEm: new Date('2026-11-02T12:00:00-03:00') };
const MSG = 'Vendas indisponíveis: O Mercado Livre limitou os downloads — tente de novo em alguns minutos (cerca de 5). — gere o pacote de novo depois.';

describe('vendas indisponíveis', () => {
  it('estado distinto de vazio, PARCIAL, sem totais', () => {
    const l = lerPacoteIndisponivel('2026-10', 'O Mercado Livre limitou os downloads — tente de novo em alguns minutos (cerca de 5).');
    expect(l.conferencia).toMatchObject({ vazio: false, parcial: true, indisponivel: expect.any(String) });
    expect(lerPacoteVazio('2026-10').conferencia.indisponivel).toBeNull();
    const wb = XLSX.read(gerarRelatorioXlsx(l, CAB), { type: 'array' });
    const vendas = XLSX.utils.sheet_to_json<Array<string | number>>(wb.Sheets.Vendas, { header: 1 }).flat().join(' | ');
    expect(vendas).toContain(MSG);
    expect(vendas).not.toContain('Vendas autorizadas');
    expect(vendas).not.toContain('Data de emissão');
    expect(XLSX.utils.sheet_to_json<string[]>(wb.Sheets['Conferência'], { header: 1 }).flat().join(' ')).toContain(MSG);
    expect(montarRelatorioPdf(l, CAB).output()).toContain('Vendas indispon');
  });
});

describe('falhaVendas', () => {
  const ind = (e: unknown, s = false) => falhaVendas(e, s).tipo;
  it('classifica', () => {
    for (const st of [429, 409, 502, 503, 504, 200]) expect(ind(new ErroPacote('x', st))).toBe('indisponivel');
    expect(ind(new ErroDownloadIncompleto())).toBe('indisponivel');
    expect(ind(new TypeError('Failed to fetch'))).toBe('indisponivel');
    expect(falhaVendas(new TypeError('Failed to fetch'), false)).toEqual({ tipo: 'indisponivel', motivo: 'falha de rede ao falar com o servidor' });
    for (const e of [new ErroPacote('x', 401), new ErroPacote('x', 403), new ErroOrgMudou(), new ErroAuditoria('a'), new DOMException('c', 'AbortError'), new Error('bug')]) {
      expect(ind(e)).toBe('fatal');
    }
    expect(ind(new ErroPacote('x', 429), true)).toBe('fatal');   // suporte: sem fallback
  });
});
```

Em `__tests__/baixar.test.ts`, trocar a asserção de org divergente para `rejects.toBeInstanceOf(ErroOrgMudou)` (mensagem igual) e acrescentar:
```ts
  it('erro de auditoria vira ErroAuditoria', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => resp(JSON.stringify({ error: 'Não foi possível registrar a auditoria do suporte — o pacote não foi liberado.', codigo: 'auditoria' }), { status: 502, headers: { 'Content-Type': 'application/json' } })));
    await expect(baixarNotasMes('2026-09', 'org-1')).rejects.toBeInstanceOf(ErroAuditoria);
  });
```
(import `ErroOrgMudou`, `ErroAuditoria` de `../baixar`).

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/vendas-indisponivel.test.ts src/lib/pacote-contador/__tests__/baixar.test.ts`
Expected: FAIL (exports inexistentes).

- [ ] **Step 3: `tipos.ts` e `ler.ts`**

Em `Conferencia` (tipos.ts), depois de `mesEmAndamento: boolean;`, acrescentar `indisponivel: string | null;`.
Em `ler.ts`, no objeto de `conferenciaVazia`, acrescentar `indisponivel: null,` e, depois de `lerPacoteVazio`:
```ts
/** Vendas não confirmadas (ML/servidor falhou): sem totais conhecidos; o pacote inteiro fica PARCIAL. */
export function lerPacoteIndisponivel(mes: string, motivo: string, agora: Date = new Date()): LeituraPacote {
  const c = conferenciaVazia(mes, agora, false);
  c.indisponivel = `Vendas indisponíveis: ${motivo} — gere o pacote de novo depois.`;
  c.motivosParcial.push('vendas indisponíveis');
  c.parcial = true;
  return { notas: [], conferencia: c, arquivos: {} };
}
```

- [ ] **Step 4: `cabecalho.ts`, `relatorio-xlsx.ts`, `relatorio-pdf.ts`**

`cabecalho.ts` — em `linhasConferencia`, logo depois da linha `if (c.vazio) out.push(['Nenhuma nota no mês', '']);`:
```ts
  if (c.indisponivel) out.push([c.indisponivel, '']);
```
`relatorio-xlsx.ts` — em `gerarRelatorioXlsx`, logo depois de `aoa.push([\`Relatório de vendas · ${cab.org} · ${c.mes}\`], [], CABECALHO);` trocar por:
```ts
  aoa.push([`Relatório de vendas · ${cab.org} · ${c.mes}`], []);
  if (c.indisponivel) {
    aoa.push([c.indisponivel]);
  } else {
    aoa.push(CABECALHO);
```
e fechar o `else` depois do laço dos totais (o bloco de notas + totais fica dentro do `else`; o restante — `aoa_to_sheet`, formatos, aba Conferência — fica fora). Mantenha o mesmo cuidado de formatos já existente.
`relatorio-pdf.ts` — em `montarRelatorioPdf`, logo depois de `doc.text(\`Relatório de vendas · ${cab.org} · ${c.mes}\`, 10, y); y += 4;`:
```ts
  if (c.indisponivel) {
    doc.setFontSize(10);
    doc.text(c.indisponivel, 10, y + 6, { maxWidth: 270 });
  } else {
```
envolvendo as duas tabelas (notas e totais) e fechando antes do `doc.addPage()` da Conferência.

- [ ] **Step 5: `baixar.ts`**

Acrescentar as classes e a classificação, e trocar a org divergente e a auditoria:
```ts
export class ErroOrgMudou extends Error {
  constructor() { super('A organização mudou durante o download — gere o pacote de novo.'); this.name = 'ErroOrgMudou'; }
}
export class ErroAuditoria extends Error {
  constructor(m: string) { super(m); this.name = 'ErroAuditoria'; }
}

const INDISPONIVEL = new Set([429, 409, 502, 503, 504, 200]);
/** Falha da parte de vendas: vira "indisponível" (pacote sai com compras) ou aborta tudo. Em suporte, sempre aborta. */
export function falhaVendas(e: unknown, emSuporte: boolean): { tipo: 'indisponivel'; motivo: string } | { tipo: 'fatal' } {
  if (emSuporte || ehAbort(e) || e instanceof ErroOrgMudou || e instanceof ErroAuditoria) return { tipo: 'fatal' };
  if (e instanceof ErroPacote) return INDISPONIVEL.has(e.status) ? { tipo: 'indisponivel', motivo: e.message } : { tipo: 'fatal' };
  if (e instanceof ErroDownloadIncompleto) return { tipo: 'indisponivel', motivo: e.message };
  if (e instanceof TypeError) return { tipo: 'indisponivel', motivo: 'falha de rede ao falar com o servidor' };
  return { tipo: 'fatal' };
}
```
`lerJson` passa a tipar `{ error?: string; vazio?: boolean; codigo?: string }`. No ramo `if (!r.ok || !r.headers.get('X-Org-Id'))`, antes do `throw new ErroPacote(...)`:
```ts
    if (j?.codigo === 'auditoria') throw new ErroAuditoria(j.error ?? 'Falha ao registrar a auditoria do suporte.');
```
E trocar `throw new ErroPacote('A organização mudou durante o download — gere o pacote de novo.', 409);` por `throw new ErroOrgMudou();`.

- [ ] **Step 6: Edge `baixar-notas-venda/index.ts`**

- `const alvo = { type: 'notas_venda_mes', id: mes || 'invalido' };` → `const alvo = { type: 'pacote_contador_mes', id: mes || 'invalido' };`
- `return json({ error: 'Não foi possível registrar a auditoria do suporte — o pacote não foi liberado.' }, 502);` → `return json({ error: 'Não foi possível registrar a auditoria do suporte — o pacote não foi liberado.', codigo: 'auditoria' }, 502);`

Run: `deno check --config supabase/functions/deno.json supabase/functions/baixar-notas-venda/index.ts && pnpm lint:functions`

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm vitest run src/lib/pacote-contador src/components/estoque/pacote-contador supabase/functions/baixar-notas-venda`
Expected: PASS (o card ainda usa a API antiga; os testes dele seguem verdes — a classe `ErroOrgMudou` mantém a mensagem).

- [ ] **Step 8: Commit**

```bash
git add src/lib/pacote-contador/ supabase/functions/baixar-notas-venda/index.ts
git commit -m "feat(adr-0181): vendas indisponíveis, erros tipados e auditoria do pacote inteiro"
```

---

### Task 5: Pacote com compras e orquestração no card

**Files:**
- Modify: `src/lib/pacote-contador/montar.ts` (`montarPacote` com vendas + compras)
- Modify: `src/components/estoque/pacote-contador/card-pacote-contador.tsx`
- Test: `src/lib/pacote-contador/__tests__/montar.test.ts` (ajuste), `src/components/estoque/pacote-contador/__tests__/card-pacote-contador.test.tsx` (ajuste + casos novos)

**Interfaces:**
- Consumes: Tasks 1–4; `useSupportStore` de `src/stores/support-store.ts`; `fetchEmpresaFiscal` de `src/lib/queries.ts`.
- Produces: `montarPacote(p: { vendas: LeituraPacote; xlsxVendas: Uint8Array; pdfVendas: Uint8Array; compras: LeituraCompras; xlsxCompras: Uint8Array; pdfCompras: Uint8Array }): Uint8Array`.

- [ ] **Step 1: Testes que falham**

`montar.test.ts` — trocar os dois primeiros testes por:
```ts
import { montarCompras } from '../compras-ler';
import { xmlCompra, row, ok, CH } from './fixtures-compras';
const COMP = montarCompras('2026-10', [row({ n: 1 }), row({ n: 2, status: 'desfeita' })],
  new Map([['id-1', ok(xmlCompra({ n: 1 }))], ['id-2', ok(xmlCompra({ n: 2 }))]]));
const B = new Uint8Array([1]);
  it('vendas (xmls/) + compras (3 pastas) + 4 relatórios', () => {
    const l = lerPacote(zip({ 'Emitidas/a.xml': nfe({ n: 1 }) }), '2026-09', AG);
    const z = unzipSync(montarPacote({ vendas: l, xlsxVendas: B, pdfVendas: B, compras: COMP, xlsxCompras: B, pdfCompras: B }));
    expect(Object.keys(z).sort()).toEqual([`compras/xmls-desfeitas/${CH(2)}.xml`, `compras/xmls/${CH(1)}.xml`,
      'relatorio-compras.pdf', 'relatorio-compras.xlsx', 'relatorio-vendas.pdf', 'relatorio-vendas.xlsx', 'xmls/Emitidas/a.xml']);
    expect(strFromU8(z['xmls/Emitidas/a.xml'])).toBe(nfe({ n: 1 }));
  });
  it('vendas vazias/indisponíveis: sem xmls/ de vendas', () => {
    const z = unzipSync(montarPacote({ vendas: lerPacoteVazio('2026-09', AG), xlsxVendas: B, pdfVendas: B, compras: COMP, xlsxCompras: B, pdfCompras: B }));
    expect(Object.keys(z).some((k) => k.startsWith('xmls/'))).toBe(false);
  });
```
`card-pacote-contador.test.tsx` — adicionar mocks:
```tsx
const listar = vi.fn(); const baixarXmls = vi.fn();
vi.mock('@/lib/pacote-contador/compras-fonte', () => ({
  listarNotasCompraMes: (...a: unknown[]) => listar(...a),
  baixarXmlsCompra: (...a: unknown[]) => baixarXmls(...a),
}));
let suporte: object | null = null;
vi.mock('@/stores/support-store', () => ({ effectiveOrgId: () => orgAtual, useSupportStore: { getState: () => ({ context: suporte }) } }));
```
(substituindo o mock existente de `support-store`), e em `beforeEach`: `listar.mockReset().mockResolvedValue([]); baixarXmls.mockReset().mockResolvedValue(new Map()); suporte = null;`. Casos novos:
```tsx
  it('vendas 429 fora do suporte: pacote sai com compras e PARCIAL', async () => {
    baixar.mockRejectedValueOnce(new ErroPacote('O Mercado Livre limitou os downloads — tente de novo em alguns minutos (cerca de 5).', 429));
    render(<CardPacoteContador />);
    fireEvent.click(screen.getByRole('button', { name: 'Baixar pacote' }));
    await waitFor(() => expect(salvar).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith('Pacote de 2026-09 gerado como PARCIAL — vendas indisponíveis');
  });
  it('em suporte, 429 aborta', async () => {
    suporte = { orgId: 'org-1', scope: 'full' };
    baixar.mockRejectedValueOnce(new ErroPacote('limite', 429));
    render(<CardPacoteContador />);
    fireEvent.click(screen.getByRole('button', { name: 'Baixar pacote' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('limite'));
    expect(salvar).not.toHaveBeenCalled();
  });
  it('falha ao listar compras aborta', async () => {
    baixar.mockResolvedValueOnce({ tipo: 'vazio', contaMl: '99' });
    listar.mockRejectedValueOnce(new Error('timeout'));
    render(<CardPacoteContador />);
    fireEvent.click(screen.getByRole('button', { name: 'Baixar pacote' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('timeout'));
    expect(salvar).not.toHaveBeenCalled();
  });
  it('compra com falha entra no motivo do PARCIAL', async () => {
    baixar.mockResolvedValueOnce({ tipo: 'vazio', contaMl: '99' });
    listar.mockResolvedValueOnce([row({ n: 1 })]);
    baixarXmls.mockResolvedValueOnce(new Map([['id-1', { tipo: 'divergente' }]]));
    render(<CardPacoteContador />);
    fireEvent.click(screen.getByRole('button', { name: 'Baixar pacote' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Pacote de 2026-09 gerado como PARCIAL — 1 compras com falha'));
  });
```
(import `row` de `@/lib/pacote-contador/__tests__/fixtures-compras`). Os testes antigos que esperavam `toast.success` com texto de vazio passam a esperar `Pacote de 2026-09 gerado.`; os de org trocada passam a esperar a mesma mensagem (agora via `ErroOrgMudou`).

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/montar.test.ts src/components/estoque/pacote-contador/__tests__/card-pacote-contador.test.tsx`
Expected: FAIL.

- [ ] **Step 3: `montar.ts`**

Substituir `montarPacote` por:
```ts
import type { LeituraCompras } from './tipos-compras';

export function montarPacote(p: {
  vendas: LeituraPacote; xlsxVendas: Uint8Array; pdfVendas: Uint8Array;
  compras: LeituraCompras; xlsxCompras: Uint8Array; pdfCompras: Uint8Array;
}): Uint8Array {
  const arquivos: Record<string, Uint8Array> = {
    'relatorio-vendas.xlsx': p.xlsxVendas, 'relatorio-vendas.pdf': p.pdfVendas,
    'relatorio-compras.xlsx': p.xlsxCompras, 'relatorio-compras.pdf': p.pdfCompras,
  };
  for (const [nome, dados] of Object.entries(p.vendas.arquivos)) arquivos[`xmls/${nome}`] = dados;
  Object.assign(arquivos, p.compras.arquivos);   // já vêm com compras/xmls…/<chave>.xml
  return zipSync(arquivos, { level: 6 });
}
```

- [ ] **Step 4: Card** — reescrever `gerar()` (o restante do componente fica; `ROTULO` ganha `compras: 'Baixando as notas de compra…'` e o tipo `Etapa` ganha `'compras'`; novo estado `progresso: string`):

```tsx
  async function gerar() {
    if (emCurso.current) return;
    const org = effectiveOrgId();
    if (!org) { toast.error('Organização não identificada — recarregue a página.'); return; }
    emCurso.current = true;
    const ctl = new AbortController();
    atual.current = ctl;
    const emSuporte = useSupportStore.getState().context !== null;
    const conferir = () => {
      ctl.signal.throwIfAborted();
      if (effectiveOrgId() !== org) throw new ErroOrgMudou();
    };
    try {
      setEtapa('baixando');
      // Vendas em paralelo, sem rejeição solta: o resultado é avaliado depois.
      const pVendas = baixarNotasMes(mes, org, ctl.signal).then((r) => ({ ok: true as const, r }), (e: unknown) => ({ ok: false as const, e }));
      const notas = await listarNotasCompraMes(mes, org);
      conferir();
      setEtapa('compras');
      const xmls = await baixarXmlsCompra(notas, ctl.signal, (f, t) => setProgresso(`${f} de ${t} XMLs`));
      conferir();
      const v = await pVendas;
      conferir();
      const indisponivel = (e: unknown) => {
        const f = falhaVendas(e, emSuporte);
        if (f.tipo === 'fatal') throw e;
        return lerPacoteIndisponivel(mes, f.motivo);
      };
      setEtapa('lendo'); await respirar(); conferir();
      let vendas: LeituraPacote;
      if (!v.ok) vendas = indisponivel(v.e);
      else if (v.r.tipo === 'vazio') vendas = lerPacoteVazio(mes);
      else { try { vendas = lerPacote(v.r.bytes, mes); } catch (e) { vendas = indisponivel(e); } }
      const compras = montarCompras(mes, notas, xmls);
      const emp = await fetchEmpresaFiscal();
      conferir();
      setEtapa('montando'); await respirar(); conferir();
      const cab = { org: emp?.razao_social ?? `Organização ${org}`, cnpj: emp?.cnpj ?? null, contaMl: v.ok ? v.r.contaMl : '', geradoEm: new Date() };
      const pacote = montarPacote({
        vendas, xlsxVendas: gerarRelatorioXlsx(vendas, cab), pdfVendas: gerarRelatorioPdf(vendas, cab),
        compras, xlsxCompras: gerarRelatorioComprasXlsx(compras, cab), pdfCompras: gerarRelatorioComprasPdf(compras, cab),
      });
      conferir();
      salvarArquivo(nomePacote(mes), pacote, 'application/zip');
      const motivos: string[] = [];
      if (vendas.conferencia.indisponivel) motivos.push('vendas indisponíveis');
      else if (vendas.conferencia.parcial) motivos.push('vendas com falha');
      if (compras.conferencia.comFalha) motivos.push(`${compras.conferencia.comFalha} compras com falha`);
      if (motivos.length) toast.error(`Pacote de ${mes} gerado como PARCIAL — ${motivos.join('; ')}`);
      else toast.success(`Pacote de ${mes} gerado.`);
    } catch (e) {
      const cancelado = (e as Error)?.name === 'AbortError';
      if (!ctl.signal.aborted) ctl.abort();   // derruba downloads pendentes
      if (!cancelado) toast.error(e instanceof Error ? e.message : 'Não foi possível gerar o pacote.');
    } finally {
      emCurso.current = false;
      if (montado.current) { setEtapa('ocioso'); setProgresso(''); }
    }
  }
```
Com `const montado = useRef(true); useEffect(() => () => { montado.current = false; atual.current?.abort(); }, []);` no lugar do efeito de unmount atual, e o `<span aria-live>` passa a mostrar `{ROTULO[etapa]}{progresso ? ` (${progresso})` : ''}`. Imports novos: `useSupportStore`, `ErroOrgMudou`, `falhaVendas` (baixar), `lerPacoteIndisponivel` (ler), `listarNotasCompraMes`, `baixarXmlsCompra` (compras-fonte), `montarCompras` (compras-ler), `gerarRelatorioComprasXlsx`, `gerarRelatorioComprasPdf`, tipo `LeituraPacote`. A descrição do card passa a: `XMLs de venda (Mercado Livre) e de compra, com os relatórios nota a nota (Excel e PDF) de um mês.`

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm vitest run src/lib/pacote-contador src/components/estoque src/pages`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pacote-contador/ src/components/estoque/pacote-contador/
git commit -m "feat(adr-0181): pacote do contador com compras e vendas indisponíveis"
```

---

### Task 6: Docs e portão

**Files:** ADR-0181 (D-13 compras implementado na branch; decisões 1–5 da spec), `docs/reference/edge-functions.md` (alvo `pacote_contador_mes`, `codigo: 'auditoria'`), `docs/TASKS.md` (seção Plano 2b-1 com pendências: merge, redeploy da edge, validação Task 7), `docs/project-status.md`, `obsidian-vault/03-Módulos/Fiscal.md` e `Estoque.md`. Redação neutra (repo público). Status: **implementado na branch, aguardando merge/deploy**.

- [ ] **Step 1:** atualizar os docs (copiar fatos do código, não de memória).
- [ ] **Step 2:** `pnpm preflight` → verde.
- [ ] **Step 3:** commit `docs(adr-0181): Plano 2b-1 — compras no pacote do contador`.

---

### Task 7 (pós-merge autorizado): deploy e validação

- [ ] **Step 1:** `supabase functions deploy baixar-notas-venda --project-ref txvncrgkoynoxwopfkbp` (sem `--no-verify-jwt`); conferir v2 ACTIVE, `verify_jwt=true`, 401 sem auth.
- [ ] **Step 2:** org de teste descartável + VALIDATION (procedimento do Plano 1): importar uma nota de teste (XML com destinatário trocado) e gerar o pacote do mês da emissão; conferir linhas, totais e diferença contra o XML; desfazer a nota e gerar de novo (vai para `compras/xmls-desfeitas/`).
- [ ] **Step 3:** limpar tudo (dados, bucket, perfil restaurado) e registrar no ADR-0181.
