# Pacote do contador: compras (Plano 2b-1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o `pacote-AAAA-MM.zip` do card "Pacote do contador" (`/estoque`) passa a levar as compras do mês (XMLs das notas de compra + `relatorio-compras.xlsx`/`.pdf`, uma linha por item com CSOSN/CST) e sai mesmo com o Mercado Livre fora (vendas "indisponíveis"), exceto em sessão de suporte.

**Architecture:** tudo no navegador. Compras: lista paginada de `notas_compra` por emissão (RLS + filtro de org), fila de downloads do bucket `notas-compra` (4 em paralelo, 30 s cada, cancelável) com SHA-256 dos bytes, leitura com o `lerNfe` existente + extração própria de CSOSN/CST e `finNFe` via `DOMParser`. Vendas (2a) ganham o estado `indisponível`. A edge `baixar-notas-venda` só muda o alvo de auditoria e o código de erro da auditoria.

**Tech Stack:** React + TS, vitest 3.2.4 (jsdom 29, `TZ=America/Sao_Paulo`), `xlsx` 0.20.3, `jspdf` 4.2.1 + `jspdf-autotable` 5.0.8, `fflate` 0.8.3, `@supabase/storage-js` 2.106.2 (`download(path, options?, { signal })`), Edge Function Deno.

**Spec:** `docs/superpowers/specs/2026-10-16-pacote-contador-compras-design.md`.

**Revisão do plano:** Codex `gpt-6.1-sol` high (2026-10-16), rodada 1: 14 achados — 13 incorporados, 1 com ruling (R2).

## Global Constraints

- Sem migration. Sem edge nova. `supabase/functions/_shared/nfe/ler-nfe.ts` **não muda** (sem redeploy de `importar-nota-compra`). Só `baixar-notas-venda/index.ts` muda (redeploy na Task 7).
- Competência das compras = `emitida_em` (timestamptz) no mês em America/Sao_Paulo: `>= AAAA-MM-01T00:00:00-03:00` e `< <1º dia do mês seguinte>T00:00:00-03:00` (SP sem horário de verão desde 2019).
- Listagem com `buscarTodasPaginas` (`src/lib/paginacao-supabase.ts`, páginas de 1000), `.eq('org_id', org)`, ordem `emitida_em` + `id`. Falha em qualquer página aborta o pacote.
- Download: `supabase.storage.from('notas-compra').download(xml_path, undefined, { signal })`; SHA-256 hex dos **bytes** (`arrayBuffer`); os mesmos bytes vão para o zip. Concorrência 4; timeout 30 000 ms cobrindo download + leitura + hash; cancelamento externo propaga para o request.
- Pastas do zip: `compras/xmls/<chave>.xml` (importada), `compras/xmls-desfeitas/<chave>.xml`, `compras/xmls-canceladas/<chave>.xml`. Relatórios: `relatorio-compras.xlsx`, `relatorio-compras.pdf`. Vendas do 2a inalteradas (`xmls/<caminho ML>`, `relatorio-vendas.*`).
- Desfeitas e canceladas: XML no zip (pasta própria), **fora** da planilha e dos totais, com a mesma classificação de integridade/assinatura/leitura das importadas; Conferência com "desfeita no PubliAI em <data>" / "marcada cancelada no PubliAI em <data>" (data = `desfeita_em`).
- Dinheiro em centavos inteiros (`Math.round(valor * 100)` sobre os números do `lerNfe`); xlsx `#,##0.00` em toda coluna de dinheiro; quantidade `#,##0.####`; chave, número, série, CNPJ, NCM, CFOP e códigos tributários como **texto**.
- Diferença por nota = `vNF − (vProd − vDesc + vFrete + vSeg + vOutro + vII + vIPI + vIPIDevol + vST + vFCPST)` (spec reconciliada).
- **Selo PARCIAL global:** se vendas ou compras tiverem qualquer falha, os **quatro** relatórios recebem o selo com todos os motivos.
- Mensagens/textos (verbatim):
  - aviso cobertura: `Compras pela data de emissão; só notas importadas no PubliAI. Quantidade, unidade e CFOP são os do documento do fornecedor.`
  - aviso regeneração: `O pacote reflete as notas e situações no momento da geração; se uma nota deste mês for importada depois, gere de novo e substitua o anterior.`
  - mês sem compras: `Nenhuma nota de compra no mês`
  - vendas indisponíveis: `Vendas indisponíveis: <motivo> — gere o pacote de novo depois.`
  - rede: `falha de rede ao falar com o servidor`
  - toasts: `Pacote de <mes> gerado.` · `Pacote de <mes> gerado como PARCIAL — <motivos separados por "; ">` (motivos: `vendas indisponíveis`, `vendas com falha`, `<n> compras com falha`)
  - org trocada: `A organização mudou durante o download — gere o pacote de novo.`
- Classificação da falha de vendas (`falhaVendas`): fatal = `AbortError`, `ErroOrgMudou`, `ErroAuditoria`, `ErroPacote` 401/403, qualquer falha **em sessão de suporte** (`useSupportStore.getState().context !== null`), qualquer outro erro (bug, inclusive `TypeError` de código); indisponível = `ErroPacote` 429/409/502/503/504/200, `ErroDownloadIncompleto`, **`ErroRede`** (só a falha do `fetch` antes dos headers, convertida em `baixar.ts`).
- Fixtures só com CNPJs `11222333000181` / `11444777000161`; nunca XML real no repo.
- Testes: `pnpm vitest run <arquivo>`; portão `pnpm preflight` (inclui `tsc -b` com `noUnusedLocals`). `crypto.subtle` **não existe** no jsdom do vitest: todo teste que gere hash começa com `import { webcrypto } from 'node:crypto'; vi.stubGlobal('crypto', webcrypto);`.

**Rulings do plano:**
- R1. Fórmula da diferença inclui `vII` e `vIPIDevol` (componentes do `vNF` no leiaute); a spec foi corrigida para bater.
- R2. A camada HTTP da edge (`index.ts`, `Deno.serve`) segue sem teste unitário (mesmo ruling R5 do 2a): a mudança são dois literais; `deno check` + lint cobrem a sintaxe, e o caminho de auditoria em suporte fica na validação (Task 7). Custo se errado: falha de auditoria em suporte com `codigo` ausente cairia como `ErroPacote` 502 — e em suporte qualquer falha já aborta, então o efeito é só a mensagem.
- R3. O teste de limites do mês não manipula `process.env.TZ` (não muda o fuso efetivo do processo); o código usa offset explícito `-03:00`, e o teste fixa as strings UTC esperadas.

## Review Focus

1. Formato ERP do Plano 1 (`<det><nItem>1</nItem>…`, sem atributo) — CSOSN/CST tem de casar pelo número do item (Task 1).
2. XML com BOM: hash dos bytes confere com oráculo independente (`createHash`) (Task 2).
3. Uma nota cujo download rejeita (`TypeError: Failed to fetch`) não derruba as outras (Task 2).
4. Vendas em 429 fora do suporte → pacote com compras e selo PARCIAL nos 4 relatórios; em suporte → aborta (Task 5).
5. StrictMode: o card não fica preso em "Gerando…" depois do primeiro pacote (Task 5).

---

### Task 1: Leitura e montagem das compras (`compras-ler.ts`)

**Files:**
- Create: `src/lib/pacote-contador/tipos-compras.ts`
- Create: `src/lib/pacote-contador/compras-ler.ts`
- Test: `src/lib/pacote-contador/__tests__/fixtures-compras.ts`, `src/lib/pacote-contador/__tests__/compras-ler.test.ts`

**Interfaces:**
- Consumes: `lerNfe(texto): { ok: true; nota: NotaCompraLida } | { ok: false; erro: string }` (`supabase/functions/_shared/nfe/ler-nfe.ts`, sem alteração); tipos de `supabase/functions/_shared/nfe/tipos.ts` (`TotaisNota` tem `vII`, `vIPIDevol`).
- Produces: tipos `NotaCompraRow`, `XmlCompra`, `LinhaCompra`, `TotalNotaCompra`, `RegistroExcluida`, `ConferenciaCompras`, `LeituraCompras`, `AVISOS_COMPRAS`; `lerCompra(texto)`; `montarCompras(mes, notas, xmls): LeituraCompras`.

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

export interface RegistroExcluida { chave: string; numero: number; fornecedor: string; em: string | null; comXml: boolean }

export interface ConferenciaCompras {
  mes: string; vazio: boolean; parcial: boolean; motivosParcial: string[];
  selecionadas: number; detalhadas: number; itens: number; comFalha: number;
  desfeitas: RegistroExcluida[]; canceladas: RegistroExcluida[];
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

type Item = { cfop?: string; icms?: string; ipiCst?: string; vProd?: string; vFrete?: string; vSeg?: string; vOutro?: string; qCom?: string };
/** `erp: true` usa o formato de exportação de ERP aceito pelo Plano 1: `<det><nItem>N</nItem>…` (sem atributo). */
export function xmlCompra(o: { n: number; dhEmi?: string; finNFe?: string; itens?: Item[]; tot?: Partial<Record<string, string>>; erp?: boolean }): string {
  const itens = o.itens ?? [{}];
  const det = itens.map((it, i) => `${o.erp ? `<det><nItem>${i + 1}</nItem>` : `<det nItem="${i + 1}">`}<prod><cProd>P${i + 1}</cProd><cEAN>SEM GTIN</cEAN><xProd>Item ${i + 1}</xProd>`
    + `<NCM>61159500</NCM><CFOP>${it.cfop ?? '5102'}</CFOP><uCom>PC</uCom><qCom>${it.qCom ?? '2.0000'}</qCom><vProd>${it.vProd ?? '100.00'}</vProd>`
    + `${it.vFrete ? `<vFrete>${it.vFrete}</vFrete>` : ''}${it.vSeg ? `<vSeg>${it.vSeg}</vSeg>` : ''}${it.vOutro ? `<vOutro>${it.vOutro}</vOutro>` : ''}</prod><imposto>`
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
  it('CSOSN, CST (ICMS00/ICMS60), ausente, e CST de IPI não capturado', () => {
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
  it('formato ERP (<nItem> como elemento) casa pelo número do item', () => {
    const r = lerCompra(xmlCompra({ n: 1, erp: true, itens: [{}, { icms: '<ICMS><ICMS00><orig>0</orig><CST>00</CST></ICMS00></ICMS>' }] }));
    if (!r.ok) throw new Error(r.erro);
    expect([1, 2].map((i) => r.trib.get(i))).toEqual([{ tipo: 'CSOSN', codigo: '102' }, { tipo: 'CST', codigo: '00' }]);
  });
  it('XML ilegível devolve ok:false', () => {
    expect(lerCompra('<nfeProc><quebrado').ok).toBe(false);
  });
});

describe('montarCompras', () => {
  it('linhas em centavos, ordem emissão/número/item, totais por componente e diferença', () => {
    const a = xmlCompra({ n: 2, dhEmi: '2026-10-20T10:00:00-03:00', itens: [{ vProd: '62.19', vSeg: '1.50', vOutro: '0.25' }, { vProd: '37.81' }],
      tot: { vProd: '100.00', vFrete: '10.00', vSeg: '1.50', vOutro: '0.25', vFCPST: '2.00', vNF: '113.75' } });
    const b = xmlCompra({ n: 1, dhEmi: '2026-10-05T10:00:00-03:00', tot: { vNF: '101.00' } });
    const l = montarCompras(M, [row({ n: 2, divergencia_total_aceita: 1 }), row({ n: 1 })], mapa([['id-2', ok(a)], ['id-1', ok(b)]]));
    expect(l.linhas.map((x) => [x.numero, x.nItem])).toEqual([['1', 1], ['2', 1], ['2', 2]]);
    expect(l.linhas[1]).toMatchObject({ produtosC: 6219, seguroC: 150, outrasC: 25, tribTipo: 'CSOSN', tribCodigo: '102', chave: CH(2), cnpj: '11222333000181', qCom: 2, finalidade: '1' });
    const t2 = l.totaisNota.find((t) => t.chave === CH(2))!;
    expect(t2).toMatchObject({ vProdC: 10000, vFreteC: 1000, vSegC: 150, vOutroC: 25, vFCPSTC: 200, vNFC: 11375, diferencaC: 0, divergenciaAceitaC: 100 });
    expect(l.totaisNota.find((t) => t.chave === CH(1))!.diferencaC).toBe(100);
    expect(l.conferencia).toMatchObject({ selecionadas: 2, detalhadas: 2, itens: 3, totalMesC: 21475, parcial: false, comFalha: 0 });
    expect(l.arquivos[`compras/xmls/${CH(1)}.xml`]).toBeDefined();
  });
  it('vII e vIPIDevol entram na diferença', () => {
    const l = montarCompras(M, [row({ n: 1 })], mapa([['id-1', ok(xmlCompra({ n: 1, tot: { vII: '3.00', vIPIDevol: '2.00', vNF: '105.00' } }))]]));
    expect(l.totaisNota[0].diferencaC).toBe(0);
  });
  it('desfeita e cancelada: XML na pasta própria, fora da planilha e dos totais, com a mesma classificação', () => {
    const l = montarCompras(M, [
      row({ n: 1 }), row({ n: 2, status: 'desfeita', desfeita_em: '2026-10-15T12:00:00+00:00', assinada: false }),
      row({ n: 3, status: 'cancelada', desfeita_em: '2026-10-16T12:00:00+00:00' }),
      row({ n: 4, status: 'desfeita' }), row({ n: 5, status: 'cancelada' }),
    ], mapa([['id-1', ok(xmlCompra({ n: 1 }))], ['id-2', ok(xmlCompra({ n: 2 }))], ['id-3', ok(xmlCompra({ n: 3 }))],
      ['id-4', { tipo: 'sem_hash' }], ['id-5', { tipo: 'divergente' }]]));
    expect(l.linhas.map((x) => x.numero)).toEqual(['1']);
    expect(l.totaisNota).toHaveLength(1);
    expect(Object.keys(l.arquivos).sort()).toEqual([`compras/xmls-canceladas/${CH(3)}.xml`, `compras/xmls-desfeitas/${CH(2)}.xml`, `compras/xmls/${CH(1)}.xml`]);
    expect(l.conferencia.desfeitas.map((d) => [d.chave, d.comXml])).toEqual([[CH(2), true], [CH(4), false]]);
    expect(l.conferencia.desfeitas[0].em).toBe('2026-10-15T12:00:00+00:00');
    expect(l.conferencia.canceladas.map((d) => d.chave)).toEqual([CH(3), CH(5)]);
    expect(l.conferencia.semAssinatura).toEqual([CH(2)]);
    expect(l.conferencia.semHash).toEqual([CH(4)]);
    expect(l.conferencia.divergentes).toEqual([CH(5)]);
    expect(l.conferencia).toMatchObject({ comFalha: 2, parcial: true, totalMesC: 10000, totalSemDetalheC: 0 });
  });
  it('falhas de importadas marcam PARCIAL; ilegível íntegro vai no zip; total sem detalhe separado', () => {
    const l = montarCompras(M, [row({ n: 1, valor_total: 50 }), row({ n: 2, valor_total: 70 }), row({ n: 3 }), row({ n: 4 })], mapa([
      ['id-1', { tipo: 'indisponivel', motivo: 'tempo esgotado' }], ['id-2', { tipo: 'divergente' }],
      ['id-3', { tipo: 'sem_hash' }], ['id-4', ok('<nfeProc><quebrado')],
    ]));
    expect(l.conferencia).toMatchObject({ selecionadas: 4, detalhadas: 0, comFalha: 4, parcial: true, totalMesC: 0, totalSemDetalheC: (50 + 70 + 100 + 100) * 100 });
    expect(l.conferencia.indisponiveis).toEqual([{ chave: CH(1), motivo: 'tempo esgotado' }]);
    expect(l.conferencia.divergentes).toEqual([CH(2)]);
    expect(l.conferencia.semHash).toEqual([CH(3)]);
    expect(l.conferencia.ilegiveis[0].chave).toBe(CH(4));
    expect(l.conferencia.motivosParcial).toEqual(['4 compras com falha']);
    expect(Object.keys(l.arquivos)).toEqual([`compras/xmls/${CH(4)}.xml`]);
  });
  it('sem assinatura e finalidade atípica (2 e 4) sinalizadas; mês vazio', () => {
    const l = montarCompras(M, [row({ n: 1, assinada: false }), row({ n: 2 })],
      mapa([['id-1', ok(xmlCompra({ n: 1, finNFe: '4' }))], ['id-2', ok(xmlCompra({ n: 2, finNFe: '2' }))]]));
    expect(l.conferencia.semAssinatura).toEqual([CH(1)]);
    expect(l.conferencia.finalidadeAtipica).toEqual([{ chave: CH(1), finNFe: '4' }, { chave: CH(2), finNFe: '2' }]);
    expect(l.linhas.map((x) => x.finalidade)).toEqual(['4', '2']);
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
type Trib = { tipo: 'CSOSN' | 'CST' | ''; codigo: string };

/** lerNfe (reuso, sem alteração) + CSOSN/CST só de det/imposto/ICMS/<grupo> e o finNFe. */
export function lerCompra(texto: string):
  | { ok: true; nota: NotaCompraLida; trib: Map<number, Trib>; finNFe: string | null }
  | { ok: false; erro: string } {
  const lida = lerNfe(texto);
  if (!lida.ok) return { ok: false, erro: lida.erro };
  const doc = new DOMParser().parseFromString(texto, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return { ok: false, erro: 'XML ilegível' };
  const trib = new Map<number, Trib>();
  for (const det of Array.from(doc.getElementsByTagNameNS('*', 'det'))) {
    // Atributo (SEFAZ) ou elemento <nItem> (exportação de ERP aceita pelo Plano 1).
    const n = Number(det.getAttribute('nItem') ?? filhos(det, 'nItem')[0]?.textContent?.trim());
    if (!Number.isInteger(n) || n <= 0) continue;
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
    if (!n.assinada) conf.semAssinatura.push(n.chave);
    // Mesma classificação para todas as situações: integridade → leitura.
    let falhou = false;
    let lida: Extract<ReturnType<typeof lerCompra>, { ok: true }> | null = null;
    if (x.tipo === 'ok') {
      arquivos[`${PASTA[n.status]}${n.chave}.xml`] = x.bytes;   // íntegro vai no zip, mesmo se ilegível
      const r = lerCompra(dec.decode(x.bytes));
      if (r.ok) lida = r; else { falhou = true; conf.ilegiveis.push({ chave: n.chave, erro: r.erro }); }
    } else {
      falhou = true;
      if (x.tipo === 'indisponivel') conf.indisponiveis.push({ chave: n.chave, motivo: x.motivo });
      else if (x.tipo === 'sem_hash') conf.semHash.push(n.chave);
      else conf.divergentes.push(n.chave);
    }
    if (falhou) conf.comFalha += 1;
    if (n.status !== 'importada') {
      (n.status === 'desfeita' ? conf.desfeitas : conf.canceladas)
        .push({ chave: n.chave, numero: n.numero, fornecedor: n.emitente_nome, em: n.desfeita_em, comXml: x.tipo === 'ok' });
      continue;
    }
    if (!lida) { conf.totalSemDetalheC += c(n.valor_total); continue; }
    const nota = lida.nota; const t = nota.totais;
    const instante = Date.parse(nota.emitidaEm);
    const fin = lida.finNFe ?? '';
    if (fin && fin !== '1') conf.finalidadeAtipica.push({ chave: n.chave, finNFe: fin });
    for (const it of nota.itens) {
      const trib = lida.trib.get(it.nItem) ?? { tipo: '' as const, codigo: '' };
      linhas.push({
        instante, emissao: nota.emitidaEm, importacao: n.importada_em, fornecedor: nota.emitenteNome, cnpj: nota.emitenteCnpj,
        numero: String(nota.numero), serie: String(nota.serie), chave: nota.chave, finalidade: fin,
        nItem: it.nItem, cProd: it.cProd, xProd: it.xProd, ncm: it.ncm ?? '', cfop: it.cfop, tribTipo: trib.tipo, tribCodigo: trib.codigo,
        qCom: it.qCom, uCom: it.uCom, produtosC: c(it.vProd), freteC: c(it.vFrete), seguroC: c(it.vSeg), descontoC: c(it.vDesc),
        outrasC: c(it.vOutro), ipiC: c(it.vIPI), stC: c(it.vST), fcpstC: c(it.vFCPST),
      });
    }
    // R1: vII e vIPIDevol integram o vNF no leiaute.
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
  if (conf.comFalha) conf.motivosParcial.push(`${conf.comFalha} compras com falha`);
  conf.parcial = conf.motivosParcial.length > 0;
  return { linhas, totaisNota, conferencia: conf, arquivos };
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/compras-ler.test.ts`
Expected: PASS. Ajuste só fixtures, nunca a regra.

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
- Consumes: `NotaCompraRow`, `XmlCompra` (Task 1); `buscarTodasPaginas`; `supabase` (`@/lib/supabase`).
- Produces: `limitesMesSP(mes)`; `listarNotasCompraMes(mes, org): Promise<NotaCompraRow[]>`; `sha256Hex(bytes): Promise<string>`; `baixarXmlCompra(nota, signal, timeoutMs?): Promise<XmlCompra>` (rejeita só com `AbortError` quando o sinal externo aborta); `baixarXmlsCompra(notas, signal, onProgresso?, concorrencia?, timeoutMs?): Promise<Map<string, XmlCompra>>`.

- [ ] **Step 1: Testes que falham**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { webcrypto, createHash } from 'node:crypto';
vi.stubGlobal('crypto', webcrypto);

const range = vi.fn();
const download = vi.fn();
const chain: Record<string, unknown> = {};
for (const k of ['select', 'eq', 'gte', 'lt', 'order']) chain[k] = vi.fn(() => chain);
chain.range = (de: number, ate: number) => range(de, ate);
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: vi.fn(() => chain),
  storage: { from: vi.fn(() => ({ download: (p: string, o: unknown, f: { signal: AbortSignal }) => download(p, o, f) })) },
} }));
import { limitesMesSP, listarNotasCompraMes, sha256Hex, baixarXmlCompra, baixarXmlsCompra } from '../compras-fonte';
import { row } from './fixtures-compras';

const bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x3c, 0x61, 0x2f, 0x3e]);   // BOM + "<a/>"
const H = createHash('sha256').update(bom).digest('hex');                // oráculo independente
const sinal = () => new AbortController().signal;
beforeEach(() => { range.mockReset(); download.mockReset(); });

describe('limitesMesSP (R3: offset explícito, não depende do fuso do processo)', () => {
  it('outubro e dezembro', () => {
    expect(limitesMesSP('2026-10')).toEqual({ de: '2026-10-01T03:00:00.000Z', ate: '2026-11-01T03:00:00.000Z' });
    expect(limitesMesSP('2026-12')).toEqual({ de: '2026-12-01T03:00:00.000Z', ate: '2027-01-01T03:00:00.000Z' });
  });
});

describe('listarNotasCompraMes', () => {
  it('pagina até o fim, com filtro de org, limites, ordem e ranges', async () => {
    range.mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, i) => row({ n: i + 1 })), error: null })
      .mockResolvedValueOnce({ data: [row({ n: 2001 })], error: null });
    expect(await listarNotasCompraMes('2026-10', 'org-1')).toHaveLength(1001);
    expect(range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
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

describe('baixarXmlCompra', () => {
  it('hash é dos bytes (com BOM), bate com o oráculo, e os bytes voltam inteiros', async () => {
    expect(await sha256Hex(bom)).toBe(H);
    download.mockResolvedValueOnce({ data: new Blob([bom]), error: null });
    expect(await baixarXmlCompra(row({ n: 1, xml_sha256: H }), sinal())).toEqual({ tipo: 'ok', bytes: bom });
    expect(download.mock.calls[0][2].signal).toBeInstanceOf(AbortSignal);
  });
  it('divergente, sem hash, erro do storage, rejeição de rede e timeout', async () => {
    download.mockResolvedValueOnce({ data: new Blob([bom]), error: null });
    expect(await baixarXmlCompra(row({ n: 1, xml_sha256: 'b'.repeat(64) }), sinal())).toEqual({ tipo: 'divergente' });
    expect(await baixarXmlCompra(row({ n: 1, xml_sha256: null }), sinal())).toEqual({ tipo: 'sem_hash' });
    expect(await baixarXmlCompra(row({ n: 1, xml_sha256: 'xyz' }), sinal())).toEqual({ tipo: 'sem_hash' });
    download.mockResolvedValueOnce({ data: null, error: { message: 'Object not found' } });
    expect(await baixarXmlCompra(row({ n: 1, xml_sha256: H }), sinal())).toEqual({ tipo: 'indisponivel', motivo: 'Object not found' });
    download.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await baixarXmlCompra(row({ n: 1, xml_sha256: H }), sinal())).toEqual({ tipo: 'indisponivel', motivo: 'Failed to fetch' });
    download.mockImplementationOnce((_p: string, _o: unknown, f: { signal: AbortSignal }) => new Promise((_, rej) => f.signal.addEventListener('abort', () => rej(new DOMException('a', 'AbortError')))));
    expect(await baixarXmlCompra(row({ n: 1, xml_sha256: H }), sinal(), 20)).toEqual({ tipo: 'indisponivel', motivo: 'tempo esgotado' });
  });
  it('timeout cobre a leitura dos bytes; cancelamento externo rejeita com AbortError', async () => {
    download.mockResolvedValueOnce({ data: { arrayBuffer: () => new Promise(() => {}) }, error: null });
    expect(await baixarXmlCompra(row({ n: 1, xml_sha256: H }), sinal(), 20)).toEqual({ tipo: 'indisponivel', motivo: 'tempo esgotado' });
    const ac = new AbortController();
    download.mockImplementationOnce(() => new Promise(() => {}));
    const p = baixarXmlCompra(row({ n: 1, xml_sha256: H }), ac.signal);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('baixarXmlsCompra', () => {
  it('no máximo 4 em paralelo, inclusive após timeouts; progresso; uma falha não derruba as outras', async () => {
    let ativos = 0; let pico = 0; let k = 0;
    download.mockImplementation((_p: string, _o: unknown, f: { signal: AbortSignal }) => {
      ativos += 1; pico = Math.max(pico, ativos);
      const i = k++;
      return new Promise((res, rej) => {
        let feito = false;
        const fim = () => { if (!feito) { feito = true; ativos -= 1; } };
        f.signal.addEventListener('abort', () => { fim(); rej(new DOMException('a', 'AbortError')); });
        if (i < 4) return;                              // os 4 primeiros estouram o timeout
        if (i === 5) { setTimeout(() => { fim(); rej(new TypeError('Failed to fetch')); }, 2); return; }
        setTimeout(() => { fim(); res({ data: new Blob([bom]), error: null }); }, 2);
      });
    });
    const notas = Array.from({ length: 10 }, (_, i) => row({ n: i + 1, xml_sha256: H }));
    const prog: number[] = [];
    const r = await baixarXmlsCompra(notas, sinal(), (f) => prog.push(f), 4, 15);
    expect(pico).toBeLessThanOrEqual(4);
    expect(r.size).toBe(10);
    expect([...r.values()].filter((x) => x.tipo === 'ok')).toHaveLength(5);
    expect(r.get('id-6')).toEqual({ tipo: 'indisponivel', motivo: 'Failed to fetch' });
    expect(prog.at(-1)).toBe(10);
  });
  it('cancelamento antes e durante', async () => {
    const ac = new AbortController(); ac.abort();
    await expect(baixarXmlsCompra([row({ n: 1 })], ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
    download.mockImplementation(() => new Promise(() => {}));
    const ac2 = new AbortController();
    const p = baixarXmlsCompra([row({ n: 1, xml_sha256: H }), row({ n: 2, xml_sha256: H })], ac2.signal);
    ac2.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/compras-fonte.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```ts
// ADR-0181 Plano 2b-1 — fonte das compras: notas do mês (RLS + org) e XMLs do bucket com hash dos BYTES.
import { supabase } from '@/lib/supabase';
import { buscarTodasPaginas } from '@/lib/paginacao-supabase';
import type { NotaCompraRow, XmlCompra } from './tipos-compras';

const COLS = 'id, chave, numero, serie, emitente_cnpj, emitente_nome, emitida_em, valor_total, assinada, xml_path, xml_sha256, status, importada_em, desfeita_em, divergencia_total_aceita';
const TIMEOUT_MS = 30_000;
const CONCORRENCIA = 4;

/** Limites do mês em America/Sao_Paulo. */
// ponytail: offset fixo −03:00 (sem horário de verão desde 2019). Upgrade se voltar: Intl com timeZone.
export function limitesMesSP(mes: string): { de: string; ate: string } {
  const [a, m] = mes.split('-').map(Number);
  const prox = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
  return { de: new Date(`${mes}-01T00:00:00-03:00`).toISOString(), ate: new Date(`${prox}-01T00:00:00-03:00`).toISOString() };
}

type Pagina = PromiseLike<{ data: NotaCompraRow[] | null; error: { message: string } | null }>;
export async function listarNotasCompraMes(mes: string, org: string): Promise<NotaCompraRow[]> {
  const { de, ate } = limitesMesSP(mes);
  return buscarTodasPaginas<NotaCompraRow>((ini, fim) => supabase.from('notas_compra').select(COLS)
    .eq('org_id', org).gte('emitida_em', de).lt('emitida_em', ate)
    .order('emitida_em').order('id').range(ini, fim) as unknown as Pagina);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
}

const abortErr = () => new DOMException('cancelado', 'AbortError');

/** Um XML: download + leitura + hash sob o MESMO prazo e cancelamento; falha vira dado, só o abort externo rejeita. */
export async function baixarXmlCompra(nota: NotaCompraRow, signal: AbortSignal, timeoutMs = TIMEOUT_MS): Promise<XmlCompra> {
  if (signal.aborted) throw abortErr();
  if (!nota.xml_sha256 || !/^[0-9a-f]{64}$/.test(nota.xml_sha256)) return { tipo: 'sem_hash' };
  const ctl = new AbortController();
  const repassar = () => ctl.abort();
  signal.addEventListener('abort', repassar, { once: true });
  let esgotou = false;
  const timer = setTimeout(() => { esgotou = true; ctl.abort(); }, timeoutMs);
  const parado = new Promise<never>((_, rej) => ctl.signal.addEventListener('abort', () => rej(abortErr()), { once: true }));
  parado.catch(() => {});
  try {
    const trabalho = (async (): Promise<XmlCompra> => {
      const r = await supabase.storage.from('notas-compra').download(nota.xml_path, undefined, { signal: ctl.signal });
      if (r.error || !r.data) return { tipo: 'indisponivel', motivo: r.error?.message ?? 'XML não encontrado' };
      const bytes = new Uint8Array(await r.data.arrayBuffer());   // bytes: nunca blob.text() no caminho do hash (BOM)
      return (await sha256Hex(bytes)) === nota.xml_sha256 ? { tipo: 'ok', bytes } : { tipo: 'divergente' };
    })();
    trabalho.catch(() => {});
    const res = await Promise.race([trabalho, parado]);
    if (signal.aborted) throw abortErr();
    return res;
  } catch (e) {
    if (signal.aborted) throw abortErr();
    if (esgotou) return { tipo: 'indisponivel', motivo: 'tempo esgotado' };
    return { tipo: 'indisponivel', motivo: e instanceof Error ? e.message : 'falha ao baixar o XML' };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', repassar);
    ctl.abort();   // derruba o request perdedor (não fica rodando além dos 4)
  }
}

export async function baixarXmlsCompra(
  notas: NotaCompraRow[], signal: AbortSignal, onProgresso?: (feitos: number, total: number) => void,
  concorrencia = CONCORRENCIA, timeoutMs = TIMEOUT_MS,
): Promise<Map<string, XmlCompra>> {
  if (signal.aborted) throw abortErr();
  const out = new Map<string, XmlCompra>();
  let i = 0; let feitos = 0;
  const trabalhador = async () => {
    while (i < notas.length) {
      if (signal.aborted) throw abortErr();
      const n = notas[i++];
      out.set(n.id, await baixarXmlCompra(n, signal, timeoutMs));
      onProgresso?.(++feitos, notas.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concorrencia, notas.length) }, trabalhador));
  return out;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/compras-fonte.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pacote-contador/
git commit -m "feat(adr-0181): fonte das compras — notas do mês paginadas e XMLs com hash dos bytes"
```

---

### Task 3: Relatórios de compras (xlsx + PDF)

**Files:**
- Create: `src/lib/pacote-contador/cabecalho-compras.ts`, `relatorio-compras-xlsx.ts`, `relatorio-compras-pdf.ts`
- Test: `src/lib/pacote-contador/__tests__/relatorio-compras.test.ts`

**Interfaces:**
- Consumes: `LeituraCompras`, `AVISOS_COMPRAS` (Task 1); `Cabecalho`, `dataHoraBR`, `reais` (`src/lib/pacote-contador/cabecalho.ts`).
- Produces: `linhasConferenciaCompras(l, cab): Array<[string, string]>`; `gerarRelatorioComprasXlsx(l, cab): Uint8Array`; `montarRelatorioComprasPdf(l, cab): jsPDF`; `gerarRelatorioComprasPdf(l, cab): Uint8Array`.

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
const comp = montarCompras('2026-10', [row({ n: 1, divergencia_total_aceita: 0.5 }), row({ n: 2, status: 'desfeita', desfeita_em: '2026-10-15T12:00:00+00:00' })],
  new Map([['id-1', ok(xmlCompra({ n: 1, finNFe: '2', itens: [{ vProd: '10.00', vSeg: '1.25', vOutro: '0.75' }], tot: { vProd: '10.00', vSeg: '1.25', vOutro: '0.75', vNF: '12.00' } }))],
    ['id-2', ok(xmlCompra({ n: 2 }))]]));
const abrir = (b: Uint8Array) => XLSX.read(b, { type: 'array', cellNF: true });

describe('relatório de compras', () => {
  it('xlsx: abas, textos, formatos, totais e conferência', () => {
    const wb = abrir(gerarRelatorioComprasXlsx(comp, CAB));
    expect(wb.SheetNames).toEqual(['Compras', 'Conferência de compras']);
    const ws = wb.Sheets.Compras;
    const rows = XLSX.utils.sheet_to_json<L>(ws, { header: 1, raw: true });
    const i = rows.findIndex((r) => r[0] === 'Data de emissão');
    const cab = rows[i] as string[];
    const col = (nome: string) => cab.indexOf(nome);
    const r1 = i + 1;
    expect(rows[r1][col('Chave')]).toBe(CH(1));
    expect(rows[r1][col('Finalidade')]).toBe('2');
    for (const nome of ['Chave', 'NCM', 'CFOP', 'CNPJ', 'Número']) expect(ws[XLSX.utils.encode_cell({ r: r1, c: col(nome) })].t).toBe('s');
    expect(ws[XLSX.utils.encode_cell({ r: r1, c: col('Produtos') })]).toMatchObject({ v: 10, z: '#,##0.00' });
    expect(ws[XLSX.utils.encode_cell({ r: r1, c: col('Seguro') })].v).toBe(1.25);
    expect(ws[XLSX.utils.encode_cell({ r: r1, c: col('Quantidade') })].z).toBe('#,##0.####');
    expect(rows[r1][col('Tipo trib.')]).toBe('CSOSN');
    expect(rows.some((r) => r[0] === 'Total do mês' && r[1] === 12)).toBe(true);
    expect(rows.some((r) => r[0] === CH(1) && r[13] === 0.5)).toBe(true);   // divergência aceita
    const conf = XLSX.utils.sheet_to_json<L>(wb.Sheets['Conferência de compras'], { header: 1 }).flat().join(' | ');
    expect(conf).toContain('Compras pela data de emissão; só notas importadas no PubliAI.');
    expect(conf).toContain('desfeita no PubliAI em');
    expect(conf).toContain(CH(2));
    expect(conf).toContain('finNFe 2');
  });
  it('PDF: colunas exigidas, totais e conferência; PARCIAL quando há falha', () => {
    const t = montarRelatorioComprasPdf(comp, CAB).output();
    for (const s of ['Total do m', 'Importa', 'CNPJ', 'Fin.', 'Seguro', 'Outras', 'vSeg', 'vOutro', 'Div. aceita', '11222333000181']) expect(t).toContain(s);
    const parcial = montarCompras('2026-10', [row({ n: 1 })], new Map([['id-1', { tipo: 'divergente' as const }]]));
    const p = montarRelatorioComprasPdf(parcial, CAB).output();
    expect(p).toContain('PACOTE PARCIAL');
    expect(p).toContain(CH(1));
  });
  it('mês vazio', () => {
    const wb = abrir(gerarRelatorioComprasXlsx(montarCompras('2026-10', [], new Map()), CAB));
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
const COL_QTD = 15;
const DINHEIRO_ITEM = [17, 18, 19, 20, 21, 22, 23, 24];
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
  aoa.push([]);
  formatar.push({ r: aoa.length, c: 1, z: '#,##0.00' });
  aoa.push(['Total do mês', reais(c.totalMesC)]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);   // strings → 't: s' (chave, NCM, CFOP, CNPJ ficam texto)
  for (const f of formatar) {
    const cel = ws[XLSX.utils.encode_cell({ r: f.r, c: f.c })] as XLSX.CellObject | undefined;
    if (cel?.t === 'n') cel.z = f.z;
  }
  const conf = XLSX.utils.aoa_to_sheet(linhasConferenciaCompras(l, cab));
  conf['!cols'] = [{ wch: 60 }, { wch: 80 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Compras');
  XLSX.utils.book_append_sheet(wb, conf, 'Conferência de compras');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
```

- [ ] **Step 5: `relatorio-compras-pdf.ts`** (células com quebra de linha para caber em A4 paisagem, sem perder campo)

```ts
// ADR-0181 Plano 2b-1 — relatório de compras (PDF, A4 paisagem): itens, totais por nota e página de Conferência.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { LeituraCompras } from './tipos-compras';
import { dataHoraBR, reais, type Cabecalho } from './cabecalho';
import { linhasConferenciaCompras } from './cabecalho-compras';

const brl = (c: number) => reais(c).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function montarRelatorioComprasPdf(l: LeituraCompras, cab: Cabecalho): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });   // compress: false (padrão)
  const c = l.conferencia;
  let y = 12;
  if (c.parcial) {
    doc.setTextColor(180, 0, 0); doc.setFontSize(11);
    doc.text(`PACOTE PARCIAL — ${c.motivosParcial.join('; ')}`, 10, y, { maxWidth: 275 }); y += 6;
    doc.setTextColor(0, 0, 0);
  }
  doc.setFontSize(12);
  doc.text(`Relatório de compras · ${cab.org} · ${c.mes}`, 10, y); y += 4;
  autoTable(doc, {
    startY: y + 2,
    head: [['Emissão\nImportação', 'Fornecedor\nCNPJ', 'Nº/Série\nFin.', 'Chave', 'Item\nCód. fornecedor', 'Descrição', 'NCM\nCFOP', 'Trib.',
      'Qtd\nUn', 'Produtos', 'Frete\nSeguro', 'Desconto\nOutras', 'IPI', 'ST\nFCP-ST']],
    body: l.linhas.map((x) => [`${dataHoraBR(x.instante)}\n${dataHoraBR(Date.parse(x.importacao))}`, `${x.fornecedor}\n${x.cnpj}`,
      `${x.numero}/${x.serie}\n${x.finalidade}`, x.chave, `${x.nItem}\n${x.cProd}`, x.xProd, `${x.ncm}\n${x.cfop}`,
      x.tribTipo ? `${x.tribTipo} ${x.tribCodigo}` : 'não informado', `${x.qCom}\n${x.uCom}`, brl(x.produtosC),
      `${brl(x.freteC)}\n${brl(x.seguroC)}`, `${brl(x.descontoC)}\n${brl(x.outrasC)}`, brl(x.ipiC), `${brl(x.stC)}\n${brl(x.fcpstC)}`]),
    styles: { fontSize: 5.5, cellPadding: 0.8 },
    headStyles: { fillColor: [60, 60, 60] },
    columnStyles: { 3: { fontSize: 4.8, cellWidth: 50 } },
    showHead: 'everyPage',
  });
  autoTable(doc, {
    head: [['Chave', 'Nº', 'Fornecedor', 'vProd', 'vFrete', 'vSeg', 'vDesc', 'vOutro', 'vIPI', 'vST', 'vFCPST', 'vNF', 'Diferença', 'Div. aceita']],
    body: l.totaisNota.map((t) => [t.chave, t.numero, t.fornecedor, brl(t.vProdC), brl(t.vFreteC), brl(t.vSegC), brl(t.vDescC), brl(t.vOutroC),
      brl(t.vIPIC), brl(t.vSTC), brl(t.vFCPSTC), brl(t.vNFC), brl(t.diferencaC), t.divergenciaAceitaC == null ? '' : brl(t.divergenciaAceitaC)]),
    foot: [['Total do mês', '', '', '', '', '', '', '', '', '', '', brl(c.totalMesC), '', '']],
    styles: { fontSize: 6 },
    columnStyles: { 0: { fontSize: 4.8, cellWidth: 50 } },
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
- Modify: `src/lib/pacote-contador/tipos.ts`, `ler.ts`, `cabecalho.ts`, `relatorio-xlsx.ts`, `relatorio-pdf.ts`, `baixar.ts`
- Modify: `supabase/functions/baixar-notas-venda/index.ts`
- Test: `src/lib/pacote-contador/__tests__/vendas-indisponivel.test.ts` (novo), `src/lib/pacote-contador/__tests__/baixar.test.ts` (ajuste)

**Interfaces:**
- Produces: `Conferencia.indisponivel: string | null`; `lerPacoteIndisponivel(mes, motivo, agora?): LeituraPacote`; classes `ErroOrgMudou`, `ErroAuditoria`, `ErroRede`; `falhaVendas(e, emSuporte)`.

- [ ] **Step 1: Testes que falham** — `__tests__/vendas-indisponivel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { lerPacoteIndisponivel, lerPacoteVazio } from '../ler';
import { gerarRelatorioXlsx } from '../relatorio-xlsx';
import { montarRelatorioPdf } from '../relatorio-pdf';
import { falhaVendas, ErroPacote, ErroOrgMudou, ErroAuditoria, ErroRede } from '../baixar';
import { ErroDownloadIncompleto } from '../tipos';

const CAB = { org: 'EMPRESA TESTE LTDA', cnpj: null, contaMl: '', geradoEm: new Date('2026-11-02T12:00:00-03:00') };
const MOT = 'O Mercado Livre limitou os downloads — tente de novo em alguns minutos (cerca de 5).';
const MSG = `Vendas indisponíveis: ${MOT} — gere o pacote de novo depois.`;

describe('vendas indisponíveis', () => {
  it('estado distinto de vazio, PARCIAL, sem totais nem cabeçalho de notas', () => {
    const l = lerPacoteIndisponivel('2026-10', MOT);
    expect(l.conferencia).toMatchObject({ vazio: false, parcial: true, indisponivel: MSG, motivosParcial: ['vendas indisponíveis'] });
    expect(lerPacoteVazio('2026-10').conferencia.indisponivel).toBeNull();
    const wb = XLSX.read(gerarRelatorioXlsx(l, CAB), { type: 'array' });
    const vendas = XLSX.utils.sheet_to_json<Array<string | number>>(wb.Sheets.Vendas, { header: 1 }).flat().join(' | ');
    expect(vendas).toContain(MSG);
    expect(vendas).not.toContain('Vendas autorizadas');
    expect(vendas).not.toContain('Data de emissão');
    expect(XLSX.utils.sheet_to_json<string[]>(wb.Sheets['Conferência'], { header: 1 }).flat().join(' ')).toContain(MSG);
    const pdf = montarRelatorioPdf(l, CAB).output();
    expect(pdf).toContain('Vendas indispon');
    expect(pdf).not.toContain('Vendas autorizadas');
  });
});

describe('falhaVendas', () => {
  const tipo = (e: unknown, s = false) => falhaVendas(e, s).tipo;
  it('classifica', () => {
    for (const st of [429, 409, 502, 503, 504, 200]) expect(tipo(new ErroPacote('x', st))).toBe('indisponivel');
    expect(tipo(new ErroDownloadIncompleto())).toBe('indisponivel');
    expect(falhaVendas(new ErroRede(), false)).toEqual({ tipo: 'indisponivel', motivo: 'falha de rede ao falar com o servidor' });
    for (const e of [new ErroPacote('x', 401), new ErroPacote('x', 403), new ErroOrgMudou(), new ErroAuditoria('a'),
      new DOMException('c', 'AbortError'), new Error('bug'), new TypeError("Cannot read properties of undefined (reading 'x')")]) {
      expect(tipo(e)).toBe('fatal');
    }
    expect(tipo(new ErroPacote('x', 429), true)).toBe('fatal');   // suporte: sem fallback
  });
});
```

`__tests__/baixar.test.ts` — importar `ErroOrgMudou, ErroAuditoria, ErroRede` de `../baixar`; no teste "org divergente recusa" acrescentar `await expect(…).rejects.toBeInstanceOf(ErroOrgMudou)` (mantendo a asserção da mensagem); e acrescentar:
```ts
  it('erro de auditoria vira ErroAuditoria; falha do fetch vira ErroRede', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => resp(JSON.stringify({ error: 'Não foi possível registrar a auditoria do suporte — o pacote não foi liberado.', codigo: 'auditoria' }), { status: 502, headers: { 'Content-Type': 'application/json' } })));
    await expect(baixarNotasMes('2026-09', 'org-1')).rejects.toBeInstanceOf(ErroAuditoria);
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(baixarNotasMes('2026-09', 'org-1')).rejects.toBeInstanceOf(ErroRede);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/vendas-indisponivel.test.ts src/lib/pacote-contador/__tests__/baixar.test.ts`
Expected: FAIL (exports inexistentes).

- [ ] **Step 3: `tipos.ts` e `ler.ts`**

`tipos.ts` — na interface `Conferencia`, trocar `mes: string; vazio: boolean; mesEmAndamento: boolean;` por `mes: string; vazio: boolean; mesEmAndamento: boolean; indisponivel: string | null;`.
`ler.ts` — em `conferenciaVazia`, trocar `mes, vazio, mesEmAndamento: competenciaSP(agora.getTime()) === mes, parcial: false, motivosParcial: [],` por `mes, vazio, mesEmAndamento: competenciaSP(agora.getTime()) === mes, indisponivel: null, parcial: false, motivosParcial: [],`, e acrescentar depois de `lerPacoteVazio`:
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

`cabecalho.ts` — trocar `  if (c.vazio) out.push(['Nenhuma nota no mês', '']);` por:
```ts
  if (c.vazio) out.push(['Nenhuma nota no mês', '']);
  if (c.indisponivel) out.push([c.indisponivel, '']);
```

`relatorio-xlsx.ts` — substituir **exatamente** este trecho atual:
```ts
  aoa.push([`Relatório de vendas · ${cab.org} · ${c.mes}`], [], CABECALHO);
  const dinheiro = new Map<number, [number, number]>();   // linha → [1ª, última] coluna de dinheiro
  for (const n of l.notas) {
    dinheiro.set(aoa.length, [6, 9]);
    aoa.push([dataHoraBR(n.instante), rotuloTipo(n.tipo), rotuloStatus(n.status), n.numero, n.serie, n.chave,
      reais(n.produtosC), reais(n.freteC), reais(n.descontoC), reais(n.totalC), n.cartaCorrecao ? 'sim' : '']);
  }
  aoa.push([], ['Grupo', 'Quantidade', 'Produtos', 'Frete', 'Desconto', 'Total']);
  for (const t of totaisPorGrupo(l.notas)) {
    dinheiro.set(aoa.length, [2, 5]);
    aoa.push([t.grupo, t.quantidade, reais(t.produtosC), reais(t.freteC), reais(t.descontoC), reais(t.totalC)]);
  }
```
por:
```ts
  aoa.push([`Relatório de vendas · ${cab.org} · ${c.mes}`], []);
  const dinheiro = new Map<number, [number, number]>();   // linha → [1ª, última] coluna de dinheiro
  if (c.indisponivel) {
    aoa.push([c.indisponivel]);   // sem notas nem totais: valores desconhecidos
  } else {
    aoa.push(CABECALHO);
    for (const n of l.notas) {
      dinheiro.set(aoa.length, [6, 9]);
      aoa.push([dataHoraBR(n.instante), rotuloTipo(n.tipo), rotuloStatus(n.status), n.numero, n.serie, n.chave,
        reais(n.produtosC), reais(n.freteC), reais(n.descontoC), reais(n.totalC), n.cartaCorrecao ? 'sim' : '']);
    }
    aoa.push([], ['Grupo', 'Quantidade', 'Produtos', 'Frete', 'Desconto', 'Total']);
    for (const t of totaisPorGrupo(l.notas)) {
      dinheiro.set(aoa.length, [2, 5]);
      aoa.push([t.grupo, t.quantidade, reais(t.produtosC), reais(t.freteC), reais(t.descontoC), reais(t.totalC)]);
    }
  }
```
(o resto do arquivo não muda; `dinheiro` fica declarado fora do `if`.)

`relatorio-pdf.ts` — trocar `  doc.text(\`Relatório de vendas · ${cab.org} · ${c.mes}\`, 10, y); y += 4;` por:
```ts
  doc.text(`Relatório de vendas · ${cab.org} · ${c.mes}`, 10, y); y += 4;
  if (c.indisponivel) {
    doc.setFontSize(10);
    doc.text(c.indisponivel, 10, y + 6, { maxWidth: 270 });
  } else {
```
e trocar a única linha `  doc.addPage();` (a que antecede `doc.text('Conferência', 10, 12);`) por:
```ts
  }
  doc.addPage();
```
(as duas `autoTable` de notas e totais ficam dentro do `else`; reindente.)

- [ ] **Step 5: `baixar.ts`**

Acrescentar, depois da classe `ErroPacote`:
```ts
export class ErroOrgMudou extends Error {
  constructor() { super('A organização mudou durante o download — gere o pacote de novo.'); this.name = 'ErroOrgMudou'; }
}
export class ErroAuditoria extends Error {
  constructor(m: string) { super(m); this.name = 'ErroAuditoria'; }
}
/** Só a falha do fetch antes dos headers — TypeError de código continua sendo bug (fatal). */
export class ErroRede extends Error {
  constructor() { super('falha de rede ao falar com o servidor'); this.name = 'ErroRede'; }
}
```
`lerJson` passa a devolver `Promise<{ error?: string; vazio?: boolean; codigo?: string } | null>`. Trocar o bloco `const r = await fetch(…, { method: 'POST', signal, headers: …, body: JSON.stringify({ mes }), });` por:
```ts
  let r: Response;
  try {
    r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/baixar-notas-venda`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ mes }),
    });
  } catch (e) {
    if (ehAbort(e)) throw e;
    throw new ErroRede();
  }
```
No ramo `if (!r.ok || !r.headers.get('X-Org-Id')) {`, logo depois de `const j = tipo.includes('json') ? await lerJson(r) : null;`:
```ts
    if (j?.codigo === 'auditoria') throw new ErroAuditoria(j.error ?? 'Falha ao registrar a auditoria do suporte.');
```
Trocar `throw new ErroPacote('A organização mudou durante o download — gere o pacote de novo.', 409);` por `throw new ErroOrgMudou();`. E no fim do arquivo:
```ts
const INDISPONIVEL = new Set([429, 409, 502, 503, 504, 200]);
/** Falha da parte de vendas: vira "indisponível" (pacote sai com compras) ou aborta tudo. Em suporte, sempre aborta. */
export function falhaVendas(e: unknown, emSuporte: boolean): { tipo: 'indisponivel'; motivo: string } | { tipo: 'fatal' } {
  if (emSuporte || ehAbort(e) || e instanceof ErroOrgMudou || e instanceof ErroAuditoria) return { tipo: 'fatal' };
  if (e instanceof ErroPacote) return INDISPONIVEL.has(e.status) ? { tipo: 'indisponivel', motivo: e.message } : { tipo: 'fatal' };
  if (e instanceof ErroDownloadIncompleto || e instanceof ErroRede) return { tipo: 'indisponivel', motivo: e.message };
  return { tipo: 'fatal' };
}
```

- [ ] **Step 6: Edge `baixar-notas-venda/index.ts`**

- `const alvo = { type: 'notas_venda_mes', id: mes || 'invalido' };` → `const alvo = { type: 'pacote_contador_mes', id: mes || 'invalido' };`
- `return json({ error: 'Não foi possível registrar a auditoria do suporte — o pacote não foi liberado.' }, 502);` → `return json({ error: 'Não foi possível registrar a auditoria do suporte — o pacote não foi liberado.', codigo: 'auditoria' }, 502);`

Run: `deno check --config supabase/functions/deno.json supabase/functions/baixar-notas-venda/index.ts && pnpm lint:functions`

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm vitest run src/lib/pacote-contador src/components/estoque/pacote-contador supabase/functions/baixar-notas-venda && pnpm exec tsc -b --force`
Expected: PASS (o card ainda usa a API antiga e segue verde: `ErroOrgMudou` mantém a mensagem).

- [ ] **Step 8: Commit**

```bash
git add src/lib/pacote-contador/ supabase/functions/baixar-notas-venda/index.ts
git commit -m "feat(adr-0181): vendas indisponíveis, erros tipados e auditoria do pacote inteiro"
```

---

### Task 5: Pacote com compras e orquestração no card

**Files:**
- Modify: `src/lib/pacote-contador/montar.ts`
- Modify: `src/components/estoque/pacote-contador/card-pacote-contador.tsx`
- Test: `src/lib/pacote-contador/__tests__/montar.test.ts` (ajuste), `src/components/estoque/pacote-contador/__tests__/card-pacote-contador.test.tsx` (ajuste + casos novos)

**Interfaces:**
- Consumes: Tasks 1–4; `useSupportStore` (`src/stores/support-store.ts`); `fetchEmpresaFiscal` (`src/lib/queries.ts`).
- Produces: `montarPacote(p: { vendas: LeituraPacote; xlsxVendas: Uint8Array; pdfVendas: Uint8Array; compras: LeituraCompras; xlsxCompras: Uint8Array; pdfCompras: Uint8Array }): Uint8Array`; `comSeloGlobal<T extends { conferencia: { parcial: boolean; motivosParcial: string[] } }>(l: T, motivos: string[]): T`.

- [ ] **Step 1: Testes que falham**

`montar.test.ts` — imports: `import { lerPacote, lerPacoteVazio, lerPacoteIndisponivel } from '../ler'; import { montarCompras } from '../compras-ler'; import { comSeloGlobal } from '../montar'; import { xmlCompra, row, ok, CH } from './fixtures-compras';` e trocar os dois primeiros testes por:
```ts
const COMP = montarCompras('2026-10', [row({ n: 1 }), row({ n: 2, status: 'desfeita' }), row({ n: 3, status: 'cancelada' })],
  new Map([['id-1', ok(xmlCompra({ n: 1 }))], ['id-2', ok(xmlCompra({ n: 2 }))], ['id-3', ok(xmlCompra({ n: 3 }))]]));
const B = new Uint8Array([1]);
  it('vendas (xmls/) + compras (3 pastas) + 4 relatórios', () => {
    const l = lerPacote(zip({ 'Emitidas/a.xml': nfe({ n: 1 }) }), '2026-09', AG);
    const z = unzipSync(montarPacote({ vendas: l, xlsxVendas: B, pdfVendas: B, compras: COMP, xlsxCompras: B, pdfCompras: B }));
    expect(Object.keys(z).sort()).toEqual([`compras/xmls-canceladas/${CH(3)}.xml`, `compras/xmls-desfeitas/${CH(2)}.xml`, `compras/xmls/${CH(1)}.xml`,
      'relatorio-compras.pdf', 'relatorio-compras.xlsx', 'relatorio-vendas.pdf', 'relatorio-vendas.xlsx', 'xmls/Emitidas/a.xml']);
    expect(strFromU8(z['xmls/Emitidas/a.xml'])).toBe(nfe({ n: 1 }));
  });
  it('vendas vazias ou indisponíveis: sem xmls/ de vendas', () => {
    for (const vendas of [lerPacoteVazio('2026-09', AG), lerPacoteIndisponivel('2026-09', 'x', AG)]) {
      const z = unzipSync(montarPacote({ vendas, xlsxVendas: B, pdfVendas: B, compras: COMP, xlsxCompras: B, pdfCompras: B }));
      expect(Object.keys(z).some((k) => k.startsWith('xmls/'))).toBe(false);
    }
  });
  it('comSeloGlobal junta os motivos sem mutar a leitura original', () => {
    const v = lerPacoteVazio('2026-09', AG);
    const g = comSeloGlobal(v, ['vendas indisponíveis', '1 compras com falha']);
    expect(g.conferencia).toMatchObject({ parcial: true, motivosParcial: ['vendas indisponíveis', '1 compras com falha'] });
    expect(v.conferencia.parcial).toBe(false);
  });
```

`card-pacote-contador.test.tsx` — trocar o mock de `@/stores/support-store` e acrescentar os mocks de compras (antes dos imports do componente):
```tsx
let suporte: object | null = null;
vi.mock('@/stores/support-store', () => ({ effectiveOrgId: () => orgAtual, useSupportStore: { getState: () => ({ context: suporte }) } }));
const listar = vi.fn(); const baixarXmls = vi.fn();
vi.mock('@/lib/pacote-contador/compras-fonte', () => ({
  listarNotasCompraMes: (...a: unknown[]) => listar(...a),
  baixarXmlsCompra: (...a: unknown[]) => baixarXmls(...a),
}));
```
`beforeEach`/`afterEach` (substituem os atuais):
```tsx
beforeEach(() => {
  vi.setSystemTime(new Date('2026-10-16T12:00:00-03:00'));   // mês padrão = 2026-09 em todos os testes
  orgAtual = 'org-1'; suporte = null;
  baixar.mockReset(); salvar.mockReset();
  listar.mockReset().mockResolvedValue([]); baixarXmls.mockReset().mockResolvedValue(new Map());
  vi.mocked(toast.error).mockReset(); vi.mocked(toast.success).mockReset();
});
afterEach(() => { vi.useRealTimers(); });
```
(reinicie também o mock de `fetchEmpresaFiscal` que o arquivo já tem, com `mockResolvedValue(null)` ou o valor que ele usa hoje.) **Remover** o teste antigo `'erro do servidor vira toast com a mensagem'` (429 agora vira fallback) e trocar os `toast.success` com o texto de vazio por `'Pacote de 2026-09 gerado.'`. Acrescentar:
```tsx
  const clicar = () => fireEvent.click(screen.getByRole('button', { name: 'Baixar pacote' }));
  it.each([
    ['429', new ErroPacote('limite', 429)], ['502', new ErroPacote('indisponível', 502)], ['rede', new ErroRede()],
  ])('vendas %s fora do suporte: pacote sai com compras e PARCIAL', async (_n, erro) => {
    baixar.mockRejectedValueOnce(erro);
    render(<CardPacoteContador />); clicar();
    await waitFor(() => expect(salvar).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith('Pacote de 2026-09 gerado como PARCIAL — vendas indisponíveis');
  });
  it.each([
    ['auditoria', new ErroAuditoria('auditoria falhou')], ['401', new ErroPacote('Sessão expirada — entre de novo.', 401)],
    ['403', new ErroPacote('sem acesso', 403)], ['org', new ErroOrgMudou()],
  ])('vendas %s aborta', async (_n, erro) => {
    baixar.mockRejectedValueOnce(erro);
    render(<CardPacoteContador />); clicar();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(erro.message));
    expect(salvar).not.toHaveBeenCalled();
  });
  it('em suporte: 429 e zip de vendas ilegível abortam', async () => {
    suporte = { orgId: 'org-1', scope: 'full' };
    baixar.mockRejectedValueOnce(new ErroPacote('limite', 429));
    const { unmount } = render(<CardPacoteContador />); clicar();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('limite'));
    unmount();
    baixar.mockResolvedValueOnce({ tipo: 'zip', bytes: new Uint8Array([1, 2, 3]), contaMl: '99' });
    render(<CardPacoteContador />); clicar();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('O download veio incompleto — gere o pacote de novo.'));
    expect(salvar).not.toHaveBeenCalled();
  });
  it('falha ao listar compras aborta', async () => {
    baixar.mockResolvedValueOnce({ tipo: 'vazio', contaMl: '99' });
    listar.mockRejectedValueOnce(new Error('timeout'));
    render(<CardPacoteContador />); clicar();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('timeout'));
    expect(salvar).not.toHaveBeenCalled();
  });
  it('vendas indisponíveis + compra com falha: PARCIAL e selo nos 4 relatórios', async () => {
    baixar.mockRejectedValueOnce(new ErroPacote('limite', 429));
    listar.mockResolvedValueOnce([row({ n: 1 })]);
    baixarXmls.mockResolvedValueOnce(new Map([['id-1', { tipo: 'divergente' }]]));
    render(<CardPacoteContador />); clicar();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Pacote de 2026-09 gerado como PARCIAL — vendas indisponíveis; 1 compras com falha'));
    const z = unzipSync(salvar.mock.calls[0][1] as Uint8Array);
    for (const nome of ['relatorio-vendas.xlsx', 'relatorio-compras.xlsx']) {
      const wb = XLSX.read(z[nome], { type: 'array' });
      expect(String(XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 })[0][0]))
        .toBe('PACOTE PARCIAL — vendas indisponíveis; 1 compras com falha');
    }
    for (const nome of ['relatorio-vendas.pdf', 'relatorio-compras.pdf']) expect(strFromU8(z[nome])).toContain('PACOTE PARCIAL');
  });
  it('StrictMode: depois do pacote o botão volta a "Baixar pacote"', async () => {
    baixar.mockResolvedValueOnce({ tipo: 'vazio', contaMl: '99' });
    render(<StrictMode><CardPacoteContador /></StrictMode>); clicar();
    await waitFor(() => expect(salvar).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Baixar pacote' })).toBeEnabled());
  });
  it('rejeição tardia depois de desmontar não gera toast', async () => {
    let falhar: (e: unknown) => void = () => {};
    baixar.mockImplementationOnce(() => new Promise((_, rej) => { falhar = rej; }));
    const { unmount } = render(<CardPacoteContador />); clicar();
    unmount();
    falhar(new ErroPacote('limite', 429));
    await new Promise((r) => setTimeout(r, 20));
    expect(toast.error).not.toHaveBeenCalled();
    expect(salvar).not.toHaveBeenCalled();
  });
```
Imports do teste: `import { StrictMode } from 'react'; import { afterEach } from 'vitest'; import { unzipSync, strFromU8 } from 'fflate'; import * as XLSX from 'xlsx';`, `ErroPacote, ErroOrgMudou, ErroAuditoria, ErroRede` de `@/lib/pacote-contador/baixar`, `row` de `@/lib/pacote-contador/__tests__/fixtures-compras`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/montar.test.ts src/components/estoque/pacote-contador/__tests__/card-pacote-contador.test.tsx`
Expected: FAIL.

- [ ] **Step 3: `montar.ts`** — substituir `montarPacote` por (e acrescentar o import de `LeituraCompras`):

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

/** Cópia com o selo PARCIAL do pacote inteiro (vendas + compras) — os 4 relatórios mostram os mesmos motivos. */
export function comSeloGlobal<T extends { conferencia: { parcial: boolean; motivosParcial: string[] } }>(l: T, motivos: string[]): T {
  if (!motivos.length) return l;
  return { ...l, conferencia: { ...l.conferencia, parcial: true, motivosParcial: motivos } };
}
```

- [ ] **Step 4: Card** — imports (o `ErroPacote` **sai**: ficaria sem uso, TS6133):
```tsx
import { useSupportStore, effectiveOrgId } from '@/stores/support-store';
import { baixarNotasMes, ErroOrgMudou, falhaVendas } from '@/lib/pacote-contador/baixar';
import { lerPacote, lerPacoteVazio, lerPacoteIndisponivel } from '@/lib/pacote-contador/ler';
import type { LeituraPacote } from '@/lib/pacote-contador/tipos';
import { listarNotasCompraMes, baixarXmlsCompra } from '@/lib/pacote-contador/compras-fonte';
import { montarCompras } from '@/lib/pacote-contador/compras-ler';
import { gerarRelatorioComprasXlsx } from '@/lib/pacote-contador/relatorio-compras-xlsx';
import { gerarRelatorioComprasPdf } from '@/lib/pacote-contador/relatorio-compras-pdf';
import { montarPacote, comSeloGlobal, nomePacote, salvarArquivo, mesesDisponiveis, mesAnteriorSP } from '@/lib/pacote-contador/montar';
```
`Etapa` passa a `'ocioso' | 'baixando' | 'compras' | 'lendo' | 'montando'`, com `compras: 'Baixando as notas de compra…'` em `ROTULO`. Estado e efeito (substituem o `useEffect` de unmount atual):
```tsx
  const [progresso, setProgresso] = useState('');
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;   // StrictMode: setup → cleanup → setup precisa voltar a true
    return () => { montado.current = false; atual.current?.abort(); };
  }, []);
```
`gerar()`:
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
      const xmls = await baixarXmlsCompra(notas, ctl.signal, (f, t) => { if (montado.current) setProgresso(`${f} de ${t} XMLs`); });
      conferir();
      const v = await pVendas;
      conferir();
      const indisponivel = (e: unknown): LeituraPacote => {
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
      const emp = await fetchEmpresaFiscal();   // dados da org de AGORA, não do render
      conferir();
      setEtapa('montando'); await respirar(); conferir();
      const motivos = [...vendas.conferencia.motivosParcial, ...compras.conferencia.motivosParcial];
      const vG = comSeloGlobal(vendas, motivos);
      const cG = comSeloGlobal(compras, motivos);
      const cab = { org: emp?.razao_social ?? `Organização ${org}`, cnpj: emp?.cnpj ?? null, contaMl: v.ok ? v.r.contaMl : '', geradoEm: new Date() };
      const pacote = montarPacote({
        vendas: vG, xlsxVendas: gerarRelatorioXlsx(vG, cab), pdfVendas: gerarRelatorioPdf(vG, cab),
        compras: cG, xlsxCompras: gerarRelatorioComprasXlsx(cG, cab), pdfCompras: gerarRelatorioComprasPdf(cG, cab),
      });
      conferir();
      salvarArquivo(nomePacote(mes), pacote, 'application/zip');
      // Toast pelos estados LOCAIS (não pelos motivos globais) para não chamar falha de compra de "vendas com falha".
      const toastMot: string[] = [];
      if (vendas.conferencia.indisponivel) toastMot.push('vendas indisponíveis');
      else if (vendas.conferencia.parcial) toastMot.push('vendas com falha');
      if (compras.conferencia.comFalha) toastMot.push(`${compras.conferencia.comFalha} compras com falha`);
      if (toastMot.length) toast.error(`Pacote de ${mes} gerado como PARCIAL — ${toastMot.join('; ')}`);
      else toast.success(`Pacote de ${mes} gerado.`);
    } catch (e) {
      const cancelado = ctl.signal.aborted || (e as Error)?.name === 'AbortError';
      if (!ctl.signal.aborted) ctl.abort();   // derruba downloads pendentes
      if (montado.current && !cancelado) toast.error(e instanceof Error ? e.message : 'Não foi possível gerar o pacote.');
    } finally {
      emCurso.current = false;
      if (montado.current) { setEtapa('ocioso'); setProgresso(''); }
    }
  }
```
O `<span aria-live>` passa a `{ROTULO[etapa]}{progresso ? ` (${progresso})` : ''}`, e a descrição do card a `XMLs de venda (Mercado Livre) e de compra, com os relatórios nota a nota (Excel e PDF) de um mês.`

Nota: os motivos globais vêm de `motivosParcial` das duas leituras (`vendas indisponíveis` da Task 4 e `<n> compras com falha` da Task 1), por isso o selo é `PACOTE PARCIAL — vendas indisponíveis; 1 compras com falha`.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm vitest run src/lib/pacote-contador src/components/estoque src/pages && pnpm exec tsc -b --force`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pacote-contador/ src/components/estoque/pacote-contador/
git commit -m "feat(adr-0181): pacote do contador com compras e vendas indisponíveis"
```

---

### Task 6: Docs e portão

**Files:** ADR-0181 (D-13 compras implementado na branch; decisões 1–5 da spec; R1), `docs/reference/edge-functions.md` (alvo `pacote_contador_mes`, `codigo: 'auditoria'`), `docs/TASKS.md` (seção Plano 2b-1: merge, redeploy da edge, validação Task 7; 2b-2 inventário pendente), `docs/project-status.md`, `obsidian-vault/03-Módulos/Fiscal.md` e `Estoque.md`. Redação neutra (repo público). Status: **implementado na branch, aguardando merge/deploy**.

- [ ] **Step 1:** atualizar os docs (fatos copiados do código, não de memória).
- [ ] **Step 2:** `pnpm preflight` → verde.
- [ ] **Step 3:** commit `docs(adr-0181): Plano 2b-1 — compras no pacote do contador`.

---

### Task 7 (pós-merge autorizado): deploy e validação

- [ ] **Step 1:** `supabase functions deploy baixar-notas-venda --project-ref txvncrgkoynoxwopfkbp` (sem `--no-verify-jwt`); conferir nova versão ACTIVE, `verify_jwt=true`, 401 sem auth.
- [ ] **Step 2:** org de teste descartável + VALIDATION (procedimento do Plano 1): importar uma nota de teste (XML com destinatário trocado) e gerar o pacote do mês da emissão; conferir linhas, totais e diferença contra o XML; as vendas da org de teste ficam "indisponíveis" (sem conexão ML) e o pacote sai PARCIAL com as compras; desfazer a nota e gerar de novo (vai para `compras/xmls-desfeitas/`).
- [ ] **Step 3:** limpar tudo (dados, bucket, perfil restaurado) e registrar no ADR-0181.
