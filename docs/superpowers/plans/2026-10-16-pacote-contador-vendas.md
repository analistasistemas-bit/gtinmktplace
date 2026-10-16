# Pacote do contador: vendas (Plano 2a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** em `/estoque`, o usuário escolhe um mês e baixa `pacote-AAAA-MM.zip` com os XMLs fiscais do Mercado Livre do mês + `relatorio-vendas.xlsx` + `relatorio-vendas.pdf`, sem gravar XML/relatório em lugar nenhum.

**Architecture:** uma edge nova (`baixar-notas-venda`) só autentica, trava a cota por conexão, chama o download em lote do ML e repassa o zip em stream. O navegador valida o zip inteiro, classifica cada XML pelo conteúdo, gera xlsx (SheetJS) e PDF (jsPDF + autotable) e monta o pacote final com `fflate`.

**Tech Stack:** React + TS (Vite), vitest 3.2.4 (jsdom, `TZ=America/Sao_Paulo`), Supabase Edge Functions (Deno), Upstash Redis, `xlsx` 0.20.3, `jspdf` 4.2.1, `jspdf-autotable` 5.0.8, `fflate` 0.8.3 (dependência direta nova).

**Spec:** `docs/superpowers/specs/2026-10-16-pacote-contador-vendas-design.md` (ADR-0181, D-13 parte vendas, com as emendas 1 e 2 do Diego).

## Global Constraints

- Nada de XML ou relatório é gravado (banco/storage). Únicas escritas: rotação de token (`getValidAccessTokenConexao`) e `auditarOperacaoSuporte` em sessão de suporte.
- Endpoint ML (verbatim): `/users/{conta}/invoices/sites/MLB/batch_request/period/stream?start=AAAAMMDD&end=AAAAMMDD&sale=all&return=all&full=all&others=correction_letter&file_types=xml&simple_folder=false`.
- 1 lote = 1 mês. Sem retry automático. Classificação **pelo conteúdo** do XML, nunca pela pasta.
- Competência e datas exibidas em `America/Sao_Paulo`. Valores em **centavos inteiros**; chave, número e série são **texto**.
- Gate da edge: `requireUserOrg(req, { access: 'read' })` + `exigirModulo(admin, orgId, 'estoque')` + `resolverConexao(admin, orgId, 'mercado_livre')`. `verify_jwt = true`.
- Download no front por `fetch` cru + `arrayBuffer()` — **nunca** `supabase.functions.invoke()` (functions-js 2.106.2 lê zip como texto).
- A resposta binária expõe `X-Org-Id` e `X-Conta-Ml` via `Access-Control-Expose-Headers` (o `cors.ts` compartilhado não expõe nada).
- Mensagens (verbatim):
  - incompleto: `O download veio incompleto — gere o pacote de novo.`
  - trava local: `Já há um download de notas desta conta em andamento ou recém-feito — aguarde 3 minutos.`
  - 429 ML: `O Mercado Livre limitou os downloads — tente de novo em alguns minutos (cerca de 5).`
  - 401/403 ML: `A conta do Mercado Livre não autorizou o download das notas.`
  - sem conexão: `Conecte a conta do Mercado Livre em Canais.`
  - 5xx/timeout: `Mercado Livre indisponível — o pacote não foi gerado.`
  - resposta ambígua: `Não foi possível confirmar as notas do mês.`
  - org divergente: `A organização mudou durante o download — gere o pacote de novo.`
- Avisos fixos na Conferência (verbatim): `Conciliação com as vendas não incluída nesta versão.` e `Notas emitidas fora do Mercado Livre e não enviadas a ele não aparecem aqui.`
- Repo público: fixtures só com CNPJs `11222333000181` / `11444777000161`; nunca XML real no repo.
- Testes: `pnpm vitest run <arquivo>`; portão de entrega `pnpm preflight`.

**Rulings deste plano sobre a spec** (registrar no ledger):
- R1. Trava = `redisSetNX('lock:notas-venda:<conexaoId>', '1', 180)` **sem liberar** — "1 download por conexão a cada 3 min". A spec dizia "em andamento + 60 s"; o download pode durar até ~150 s, então 60 s liberaria um segundo download concorrente. Custo se errado: usuário espera até 3 min entre downloads.
- R2. Integridade = `unzipSync` sem erro (diretório central e inflate íntegros) + tamanho descompactado de cada entrada = `originalSize` declarado. CRC não é conferido (`fflate` não o expõe no unzip); `// ponytail:` no código. Custo se errado: corrupção que preserve tamanho e inflate passaria — improvável.
- R3. Grupos de totais: os 6 (venda/complementar/devolução × autorizada/cancelada), mesmo os com zero, em ordem fixa.

## Review Focus

1. XML do ML com namespace (`xmlns="http://www.portalfiscal.inf.br/nfe"`) — leitura por `getElementsByTagNameNS('*', tag)` tem de achar os campos (Task 1 cobre com fixtures com namespace).
2. Nota de 30/09 23:30−03:00 (= 01/10 02:30 UTC) — competência setembro, ordenação por instante (Task 1).
3. Mês de 404 vazio → pacote só com relatórios e "Nenhuma nota no mês"; não pode virar erro nem pacote com XML (Tasks 1, 4, 6).
4. Duplo clique / duas abas → segunda chamada recebe a trava local, não chega ao ML (Task 5).
5. Chave de 44 dígitos no xlsx continua texto exato, sem notação científica (Task 2).

---

### Task 1: Tipos e leitura do zip do ML (`ler.ts`)

**Files:**
- Modify: `package.json` (dependência `fflate`)
- Create: `src/lib/pacote-contador/tipos.ts`
- Create: `src/lib/pacote-contador/ler.ts`
- Test: `src/lib/pacote-contador/__tests__/fixtures.ts`, `src/lib/pacote-contador/__tests__/ler.test.ts`

**Interfaces:**
- Produces: tipos `NotaRelatorio`, `Conferencia`, `LeituraPacote`, `ErroDownloadIncompleto`; `lerPacote(bytes: Uint8Array, mes: string, agora?: Date): LeituraPacote`; `lerPacoteVazio(mes: string, agora?: Date): LeituraPacote`; `totaisPorGrupo(notas: NotaRelatorio[]): TotalGrupo[]`; `rotuloTipo`, `rotuloStatus`.

- [ ] **Step 1: Instalar `fflate` como dependência direta**

Run: `pnpm add fflate@0.8.3`
Expected: `package.json` ganha `"fflate": "0.8.3"` (ou `^0.8.3`); lock atualizado.

- [ ] **Step 2: Criar `tipos.ts`**

```ts
// ADR-0181 Plano 2a — modelo do pacote do contador (vendas). Valores em centavos inteiros.
export type TipoNota = 'venda' | 'complementar' | 'devolucao';
export type StatusNota = 'autorizada' | 'cancelada';

export interface NotaRelatorio {
  chave: string; numero: string; serie: string;
  emissao: string;      // dhEmi original
  instante: number;     // epoch ms de dhEmi
  competencia: string;  // AAAA-MM em America/Sao_Paulo
  tipo: TipoNota; status: StatusNota;
  produtosC: number; freteC: number; descontoC: number; totalC: number;
  cartaCorrecao: boolean; arquivo: string;
}

export interface Inutilizacao {
  arquivo: string; serie: string; inicio: string; fim: string;
  homologada: boolean; cStat: string; motivo: string;
}

export interface Conferencia {
  mes: string; vazio: boolean; mesEmAndamento: boolean;
  parcial: boolean; motivosParcial: string[];
  totalArquivos: number;
  contagem: Record<string, number>;
  outros: Array<{ arquivo: string; chave: string; cfops: string[] }>;
  denegadas: Array<{ arquivo: string; chave: string; cStat: string }>;
  cancelamentosOutroMes: Array<{ arquivo: string; chave: string }>;
  eventosRejeitados: Array<{ arquivo: string; chave: string; tpEvento: string; cStat: string }>;
  inutilizacoes: Inutilizacao[];
  incompletos: Array<{ arquivo: string; motivo: string }>;
  divergentes: string[];
  foraDoPeriodo: Array<{ chave: string; competencia: string }>;
}

export interface LeituraPacote {
  notas: NotaRelatorio[];
  conferencia: Conferencia;
  arquivos: Record<string, Uint8Array>;
}

export interface TotalGrupo {
  grupo: string; quantidade: number;
  produtosC: number; freteC: number; descontoC: number; totalC: number;
}

export class ErroDownloadIncompleto extends Error {}

export const AVISOS_FIXOS = [
  'Conciliação com as vendas não incluída nesta versão.',
  'Notas emitidas fora do Mercado Livre e não enviadas a ele não aparecem aqui.',
] as const;

export const rotuloTipo = (t: TipoNota) =>
  ({ venda: 'Venda', complementar: 'Complementar', devolucao: 'Devolução' })[t];
export const rotuloStatus = (s: StatusNota) => (s === 'autorizada' ? 'Autorizada' : 'Cancelada');

const GRUPOS: Array<[TipoNota, StatusNota, string]> = [
  ['venda', 'autorizada', 'Vendas autorizadas'], ['venda', 'cancelada', 'Vendas canceladas'],
  ['complementar', 'autorizada', 'Complementares autorizadas'], ['complementar', 'cancelada', 'Complementares canceladas'],
  ['devolucao', 'autorizada', 'Devoluções autorizadas'], ['devolucao', 'cancelada', 'Devoluções canceladas'],
];

export function totaisPorGrupo(notas: NotaRelatorio[]): TotalGrupo[] {
  return GRUPOS.map(([tipo, status, grupo]) => {
    const g = notas.filter((n) => n.tipo === tipo && n.status === status);
    const soma = (k: 'produtosC' | 'freteC' | 'descontoC' | 'totalC') => g.reduce((a, n) => a + n[k], 0);
    return { grupo, quantidade: g.length, produtosC: soma('produtosC'), freteC: soma('freteC'), descontoC: soma('descontoC'), totalC: soma('totalC') };
  });
}
```

- [ ] **Step 3: Escrever as fixtures sintéticas** (`__tests__/fixtures.ts`)

```ts
import { zipSync, strToU8 } from 'fflate';
const NS = 'xmlns="http://www.portalfiscal.inf.br/nfe"';
export const EMIT = '11222333000181';
export const CHAVE = (n: number) => `2626091122233300018155001${String(n).padStart(9, '0')}1${String(n).padStart(8, '0')}0`.slice(0, 44);

export function nfe(o: {
  n: number; dhEmi?: string; tpNF?: string; finNFe?: string; cfops?: string[]; cStat?: string;
  vProd?: string; vFrete?: string; vDesc?: string; vNF?: string; refNFe?: string; semCampo?: 'dhEmi' | 'vNF';
}): string {
  const ch = CHAVE(o.n);
  const dets = (o.cfops ?? ['5102']).map((c, i) => `<det nItem="${i + 1}"><prod><CFOP>${c}</CFOP></prod></det>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc ${NS} versao="4.00"><NFe><infNFe Id="NFe${ch}" versao="4.00">`
    + `<ide><serie>1</serie><nNF>${o.n}</nNF>${o.semCampo === 'dhEmi' ? '' : `<dhEmi>${o.dhEmi ?? '2026-09-10T10:00:00-03:00'}</dhEmi>`}`
    + `<tpNF>${o.tpNF ?? '1'}</tpNF><finNFe>${o.finNFe ?? '1'}</finNFe>${o.refNFe ? `<NFref><refNFe>${o.refNFe}</refNFe></NFref>` : ''}</ide>`
    + `<emit><CNPJ>${EMIT}</CNPJ></emit>${dets}<total><ICMSTot><vProd>${o.vProd ?? '100.00'}</vProd><vFrete>${o.vFrete ?? '0.00'}</vFrete>`
    + `<vDesc>${o.vDesc ?? '0.00'}</vDesc>${o.semCampo === 'vNF' ? '' : `<vNF>${o.vNF ?? '100.00'}</vNF>`}</ICMSTot></total></infNFe></NFe>`
    + `<protNFe versao="4.00"><infProt><chNFe>${ch}</chNFe><cStat>${o.cStat ?? '100'}</cStat></infProt></protNFe></nfeProc>`;
}

export function evento(o: { n: number; tpEvento: '110111' | '110110'; cStat?: string; seq?: number }): string {
  const ch = CHAVE(o.n);
  return `<?xml version="1.0"?><procEventoNFe ${NS} versao="1.00"><evento versao="1.00"><infEvento>`
    + `<chNFe>${ch}</chNFe><tpEvento>${o.tpEvento}</tpEvento><nSeqEvento>${o.seq ?? 1}</nSeqEvento></infEvento></evento>`
    + `<retEvento versao="1.00"><infEvento><cStat>${o.cStat ?? '135'}</cStat><chNFe>${ch}</chNFe></infEvento></retEvento></procEventoNFe>`;
}

export function inut(o: { ini: number; fim: number; cStat: string }): string {
  return `<?xml version="1.0"?><procInutNFe ${NS} versao="4.00"><inutNFe versao="4.00"><infInut>`
    + `<serie>1</serie><nNFIni>${o.ini}</nNFIni><nNFFin>${o.fim}</nNFFin><xJust>Numero nao utilizado</xJust></infInut></inutNFe>`
    + `<retInutNFe versao="4.00"><infInut><cStat>${o.cStat}</cStat><xMotivo>motivo ${o.cStat}</xMotivo></infInut></retInutNFe></procInutNFe>`;
}

export const zip = (arquivos: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(arquivos).map(([k, v]) => [k, strToU8(v)])));
```

- [ ] **Step 4: Escrever os testes que falham** (`__tests__/ler.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { lerPacote, lerPacoteVazio } from '../ler';
import { ErroDownloadIncompleto, totaisPorGrupo } from '../tipos';
import { nfe, evento, inut, zip, CHAVE } from './fixtures';

const SET = '2026-09';
const AGORA = new Date('2026-10-16T12:00:00-03:00');
const P = 'Emitidas_Mercado_Livre/NF-e de venda/XML/Autorizadas/';
const ler = (a: Record<string, string>, mes = SET) => lerPacote(zip(a), mes, AGORA);

describe('lerPacote', () => {
  it('lê venda com namespace, valores em centavos e chave como texto', () => {
    const l = ler({ [P + 'a.xml']: nfe({ n: 1, vProd: '62.19', vFrete: '5.10', vDesc: '1.00', vNF: '66.29' }) });
    expect(l.notas).toHaveLength(1);
    expect(l.notas[0]).toMatchObject({ chave: CHAVE(1), numero: '1', serie: '1', tipo: 'venda', status: 'autorizada',
      produtosC: 6219, freteC: 510, descontoC: 100, totalC: 6629, competencia: SET, cartaCorrecao: false });
    expect(l.conferencia.parcial).toBe(false);
  });
  it('complementar (finNFe 2) e devolução de venda (tpNF 0, finNFe 4, refNFe)', () => {
    const l = ler({ 'x/a.xml': nfe({ n: 1, finNFe: '2' }), 'x/b.xml': nfe({ n: 2, tpNF: '0', finNFe: '4', cfops: ['1202'], refNFe: CHAVE(9) }) });
    expect(l.notas.map((n) => n.tipo)).toEqual(['complementar', 'devolucao']);
  });
  it('remessa Full (CFOP 5949) e CFOP misto ficam fora das vendas, em "outros"', () => {
    const l = ler({ 'x/a.xml': nfe({ n: 1, cfops: ['5949'] }), 'x/b.xml': nfe({ n: 2, cfops: ['5102', '5949'] }) });
    expect(l.notas).toHaveLength(0);
    expect(l.conferencia.outros.map((o) => o.cfops)).toEqual([['5949'], ['5102', '5949']]);
  });
  it('cancelamento homologado marca a nota; rejeitado não altera e vai para eventos rejeitados', () => {
    const l = ler({ 'x/a.xml': nfe({ n: 1 }), 'x/b.xml': nfe({ n: 2 }),
      'x/c.xml': evento({ n: 1, tpEvento: '110111', cStat: '135' }), 'x/d.xml': evento({ n: 2, tpEvento: '110111', cStat: '573' }) });
    expect(l.notas.find((n) => n.chave === CHAVE(1))!.status).toBe('cancelada');
    expect(l.notas.find((n) => n.chave === CHAVE(2))!.status).toBe('autorizada');
    expect(l.conferencia.eventosRejeitados).toEqual([{ arquivo: 'x/d.xml', chave: CHAVE(2), tpEvento: '110111', cStat: '573' }]);
  });
  it('cancelamento de nota que não está no zip vai para "cancelamento de nota de outro mês"', () => {
    const l = ler({ 'x/c.xml': evento({ n: 7, tpEvento: '110111' }) });
    expect(l.conferencia.cancelamentosOutroMes).toEqual([{ arquivo: 'x/c.xml', chave: CHAVE(7) }]);
  });
  it('CC-e homologada marca a carta de correção (duas sequências contam uma vez)', () => {
    const l = ler({ 'x/a.xml': nfe({ n: 1 }), 'x/b.xml': evento({ n: 1, tpEvento: '110110', seq: 1 }), 'x/c.xml': evento({ n: 1, tpEvento: '110110', seq: 2 }) });
    expect(l.notas[0].cartaCorrecao).toBe(true);
  });
  it('inutilização homologada (102) e rejeitada (203)', () => {
    const l = ler({ 'x/a.xml': inut({ ini: 1, fim: 1, cStat: '102' }), 'x/b.xml': inut({ ini: 2, fim: 2, cStat: '203' }) });
    expect(l.conferencia.inutilizacoes.map((i) => [i.inicio, i.homologada, i.cStat])).toEqual([['1', true, '102'], ['2', false, '203']]);
    expect(l.conferencia.parcial).toBe(false);
  });
  it('denegada (cStat 110) vai para denegadas, não para vendas', () => {
    const l = ler({ 'x/a.xml': nfe({ n: 1, cStat: '110' }) });
    expect(l.notas).toHaveLength(0);
    expect(l.conferencia.denegadas[0].cStat).toBe('110');
  });
  it('chave repetida igual conta uma vez; conteúdo divergente marca PARCIAL', () => {
    const a = nfe({ n: 1 });
    expect(ler({ 'p1/a.xml': a, 'p2/a.xml': a }).notas).toHaveLength(1);
    const d = ler({ 'p1/a.xml': a, 'p2/a.xml': nfe({ n: 1, vNF: '999.00' }) });
    expect(d.conferencia.divergentes).toEqual([CHAVE(1)]);
    expect(d.conferencia.parcial).toBe(true);
  });
  it('XML ilegível e campo obrigatório ausente marcam PARCIAL com motivo', () => {
    const l = ler({ 'x/a.xml': '<nfeProc><quebrado', 'x/b.xml': nfe({ n: 2, semCampo: 'vNF' }) });
    expect(l.conferencia.incompletos.map((i) => i.arquivo)).toEqual(['x/a.xml', 'x/b.xml']);
    expect(l.conferencia.parcial).toBe(true);
    expect(l.conferencia.motivosParcial.length).toBeGreaterThan(0);
  });
  it('fuso: 30/09 23:30-03:00 é setembro; em pacote de outubro vai para "fora do período"', () => {
    const a = nfe({ n: 1, dhEmi: '2026-09-30T23:30:00-03:00' });
    expect(ler({ 'x/a.xml': a }).notas[0].competencia).toBe('2026-09');
    const out = ler({ 'x/a.xml': a }, '2026-10');
    expect(out.notas).toHaveLength(0);
    expect(out.conferencia.foraDoPeriodo).toEqual([{ chave: CHAVE(1), competencia: '2026-09' }]);
  });
  it('ordena por instante e desempata pela chave', () => {
    const l = ler({ 'x/c.xml': nfe({ n: 3, dhEmi: '2026-09-10T10:00:00-03:00' }),
      'x/a.xml': nfe({ n: 1, dhEmi: '2026-09-10T13:00:00Z' }), 'x/b.xml': nfe({ n: 2, dhEmi: '2026-09-02T08:00:00-03:00' }) });
    expect(l.notas.map((n) => n.numero)).toEqual(['2', '1', '3']);
  });
  it('zip truncado é rejeitado inteiro', () => {
    const z = zip({ 'x/a.xml': nfe({ n: 1 }) });
    expect(() => lerPacote(z.slice(0, z.length - 30), SET, AGORA)).toThrow(ErroDownloadIncompleto);
  });
  it('mês em andamento e pacote vazio', () => {
    expect(lerPacote(zip({ 'x/a.xml': nfe({ n: 1, dhEmi: '2026-10-02T10:00:00-03:00' }) }), '2026-10', AGORA).conferencia.mesEmAndamento).toBe(true);
    const v = lerPacoteVazio(SET, AGORA);
    expect(v.notas).toEqual([]);
    expect(v.conferencia).toMatchObject({ vazio: true, parcial: false, totalArquivos: 0 });
  });
  it('totais por grupo: 6 grupos em ordem fixa', () => {
    const l = ler({ 'x/a.xml': nfe({ n: 1, vNF: '10.00' }), 'x/b.xml': nfe({ n: 2, vNF: '5.00' }), 'x/c.xml': evento({ n: 2, tpEvento: '110111' }) });
    const t = totaisPorGrupo(l.notas);
    expect(t.map((g) => g.grupo)).toEqual(['Vendas autorizadas', 'Vendas canceladas', 'Complementares autorizadas',
      'Complementares canceladas', 'Devoluções autorizadas', 'Devoluções canceladas']);
    expect(t[0]).toMatchObject({ quantidade: 1, totalC: 1000 });
    expect(t[1]).toMatchObject({ quantidade: 1, totalC: 500 });
  });
});
```

- [ ] **Step 5: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/ler.test.ts`
Expected: FAIL — `Cannot find module '../ler'`.

- [ ] **Step 6: Implementar `ler.ts`**

```ts
// ADR-0181 Plano 2a — lê o zip do download em lote do ML. Classifica pelo CONTEÚDO (pastas variam).
import { unzipSync } from 'fflate';
import {
  ErroDownloadIncompleto, type Conferencia, type LeituraPacote, type NotaRelatorio,
} from './tipos';

const CFOP_VENDA = /^[567]1\d\d$|^[56]4\d\d$/;
const AUTORIZADA = new Set(['100', '150']);
const DENEGADA = new Set(['110', '301', '302', '303']);
const EVENTO_OK = new Set(['135', '155']);
const OBRIGATORIOS = ['chave', 'dhEmi', 'nNF', 'serie', 'vNF'] as const;

const el = (n: Document | Element | null, tag: string): Element | null =>
  n ? n.getElementsByTagNameNS('*', tag)[0] ?? null : null;
const tx = (n: Document | Element | null, tag: string): string | null => el(n, tag)?.textContent?.trim() || null;
const centavos = (s: string | null) => (s ? Math.round(Number(s) * 100) : 0);

const FMT_MES = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' });
export function competenciaSP(ms: number): string {
  const p = FMT_MES.formatToParts(new Date(ms));
  return `${p.find((x) => x.type === 'year')!.value}-${p.find((x) => x.type === 'month')!.value}`;
}

function conferenciaVazia(mes: string, agora: Date, vazio: boolean): Conferencia {
  return {
    mes, vazio, mesEmAndamento: competenciaSP(agora.getTime()) === mes, parcial: false, motivosParcial: [],
    totalArquivos: 0, contagem: {}, outros: [], denegadas: [], cancelamentosOutroMes: [], eventosRejeitados: [],
    inutilizacoes: [], incompletos: [], divergentes: [], foraDoPeriodo: [],
  };
}

/** Abre o zip inteiro antes de qualquer leitura. Truncado/corrompido → ErroDownloadIncompleto. */
function abrirZip(bytes: Uint8Array): Record<string, Uint8Array> {
  const declarado: Record<string, number> = {};
  let arquivos: Record<string, Uint8Array>;
  try {
    arquivos = unzipSync(bytes, { filter: (f) => { declarado[f.name] = f.originalSize; return true; } });
  } catch {
    throw new ErroDownloadIncompleto('O download veio incompleto — gere o pacote de novo.');
  }
  // ponytail: confere tamanho declarado × descompactado; CRC não (fflate não expõe no unzip). Upgrade: crc32 próprio.
  for (const [nome, dados] of Object.entries(arquivos)) {
    if (dados.length !== declarado[nome]) throw new ErroDownloadIncompleto('O download veio incompleto — gere o pacote de novo.');
  }
  return Object.fromEntries(Object.entries(arquivos).filter(([n]) => !n.endsWith('/')));
}

export function lerPacoteVazio(mes: string, agora: Date = new Date()): LeituraPacote {
  return { notas: [], conferencia: conferenciaVazia(mes, agora, true), arquivos: {} };
}

export function lerPacote(bytes: Uint8Array, mes: string, agora: Date = new Date()): LeituraPacote {
  const arquivos = abrirZip(bytes);
  const c = conferenciaVazia(mes, agora, false);
  c.totalArquivos = Object.keys(arquivos).length;
  const conta = (k: string) => { c.contagem[k] = (c.contagem[k] ?? 0) + 1; };
  const incompleto = (arquivo: string, motivo: string) => { c.incompletos.push({ arquivo, motivo }); conta('incompletos'); };

  const notas = new Map<string, NotaRelatorio>();
  const textoPorChave = new Map<string, string>();
  const cancelamentos: Array<{ arquivo: string; chave: string }> = [];
  const cces = new Set<string>();
  const parser = new DOMParser();
  const dec = new TextDecoder();

  for (const nome of Object.keys(arquivos).sort()) {
    const texto = dec.decode(arquivos[nome]);
    const doc = parser.parseFromString(texto, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) { incompleto(nome, 'XML ilegível'); continue; }
    const raiz = doc.documentElement.localName;

    if (raiz === 'nfeProc') {
      const ide = el(doc, 'ide');
      const tot = el(doc, 'ICMSTot');
      const campos = {
        chave: tx(el(doc, 'protNFe'), 'chNFe') ?? el(doc, 'infNFe')?.getAttribute('Id')?.replace(/^NFe/, '') ?? null,
        dhEmi: tx(ide, 'dhEmi'), nNF: tx(ide, 'nNF'), serie: tx(ide, 'serie'), vNF: tx(tot, 'vNF'),
      };
      const falta = OBRIGATORIOS.filter((k) => !campos[k]);
      if (falta.length) { incompleto(nome, `campo ausente: ${falta.join(', ')}`); continue; }
      const chave = campos.chave!;
      const cStat = tx(el(doc, 'protNFe'), 'cStat') ?? '';
      if (DENEGADA.has(cStat)) { c.denegadas.push({ arquivo: nome, chave, cStat }); conta('denegadas'); continue; }
      if (!AUTORIZADA.has(cStat)) { incompleto(nome, `nota sem autorização (cStat ${cStat || 'ausente'})`); continue; }
      const instante = Date.parse(campos.dhEmi!);
      if (Number.isNaN(instante)) { incompleto(nome, 'dhEmi inválida'); continue; }

      const tpNF = tx(ide, 'tpNF'); const fin = tx(ide, 'finNFe');
      const cfops = Array.from(doc.getElementsByTagNameNS('*', 'CFOP'), (e) => e.textContent?.trim() ?? '');
      let tipo: NotaRelatorio['tipo'] | null = null;
      if (tpNF === '1' && (fin === '1' || fin === '2') && cfops.length > 0 && cfops.every((x) => CFOP_VENDA.test(x))) {
        tipo = fin === '2' ? 'complementar' : 'venda';
      } else if (tpNF === '0' && fin === '4' && el(ide, 'refNFe')) {
        tipo = 'devolucao';
      }
      if (!tipo) { c.outros.push({ arquivo: nome, chave, cfops }); conta('outros'); continue; }

      if (textoPorChave.has(chave)) {
        if (textoPorChave.get(chave) !== texto && !c.divergentes.includes(chave)) c.divergentes.push(chave);
        conta('duplicadas');
        continue;
      }
      textoPorChave.set(chave, texto);
      const competencia = competenciaSP(instante);
      if (competencia !== mes) { c.foraDoPeriodo.push({ chave, competencia }); conta('fora_do_periodo'); continue; }
      notas.set(chave, {
        chave, numero: campos.nNF!, serie: campos.serie!, emissao: campos.dhEmi!, instante, competencia, tipo,
        status: 'autorizada', produtosC: centavos(tx(tot, 'vProd')), freteC: centavos(tx(tot, 'vFrete')),
        descontoC: centavos(tx(tot, 'vDesc')), totalC: centavos(campos.vNF), cartaCorrecao: false, arquivo: nome,
      });
      conta(tipo);
    } else if (raiz === 'procEventoNFe') {
      const inf = el(el(doc, 'evento'), 'infEvento');
      const chave = tx(inf, 'chNFe') ?? '';
      const tpEvento = tx(inf, 'tpEvento') ?? '';
      const cStat = tx(el(doc, 'retEvento'), 'cStat') ?? '';
      if (!EVENTO_OK.has(cStat)) { c.eventosRejeitados.push({ arquivo: nome, chave, tpEvento, cStat }); conta('eventos_rejeitados'); continue; }
      if (tpEvento === '110111') cancelamentos.push({ arquivo: nome, chave });
      else if (tpEvento === '110110') cces.add(chave);
      else c.outros.push({ arquivo: nome, chave, cfops: [] });
      conta('eventos');
    } else if (/inut/i.test(raiz)) {
      const ped = el(el(doc, 'inutNFe'), 'infInut') ?? el(doc, 'infInut');
      const ret = el(el(doc, 'retInutNFe'), 'infInut');
      const cStat = tx(ret, 'cStat') ?? '';
      c.inutilizacoes.push({
        arquivo: nome, serie: tx(ped, 'serie') ?? '', inicio: tx(ped, 'nNFIni') ?? '', fim: tx(ped, 'nNFFin') ?? '',
        homologada: cStat === '102', cStat, motivo: tx(ret, 'xMotivo') ?? '',
      });
      conta('inutilizacoes');
    } else {
      c.outros.push({ arquivo: nome, chave: '', cfops: [] }); conta('outros');
    }
  }

  for (const k of cancelamentos) {
    const n = notas.get(k.chave);
    if (n) n.status = 'cancelada'; else c.cancelamentosOutroMes.push(k);
  }
  for (const n of notas.values()) n.cartaCorrecao = cces.has(n.chave);

  if (c.incompletos.length) c.motivosParcial.push(`${c.incompletos.length} arquivo(s) ilegível(is) ou incompleto(s)`);
  if (c.divergentes.length) c.motivosParcial.push(`${c.divergentes.length} chave(s) com conteúdo divergente`);
  c.parcial = c.motivosParcial.length > 0;

  const lista = [...notas.values()].sort((a, b) => a.instante - b.instante || a.chave.localeCompare(b.chave));
  return { notas: lista, conferencia: c, arquivos };
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/ler.test.ts`
Expected: PASS (15 testes). Se `CHAVE(n)` não gerar 44 dígitos, ajuste a fixture (não o código).

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/pacote-contador/
git commit -m "feat(adr-0181): leitura do zip de notas do ML para o pacote do contador"
```

---

### Task 2: Relatório xlsx (`relatorio-xlsx.ts`)

**Files:**
- Create: `src/lib/pacote-contador/cabecalho.ts`
- Create: `src/lib/pacote-contador/relatorio-xlsx.ts`
- Test: `src/lib/pacote-contador/__tests__/relatorio-xlsx.test.ts`

**Interfaces:**
- Consumes: `LeituraPacote`, `totaisPorGrupo`, `rotuloTipo`, `rotuloStatus`, `AVISOS_FIXOS` (Task 1).
- Produces: `interface Cabecalho { org: string; cnpj: string | null; contaMl: string; geradoEm: Date }`; `dataHoraBR(ms: number): string`; `linhasConferencia(l: LeituraPacote, cab: Cabecalho): string[][]`; `gerarRelatorioXlsx(l: LeituraPacote, cab: Cabecalho): Uint8Array`.

- [ ] **Step 1: Teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { gerarRelatorioXlsx } from '../relatorio-xlsx';
import { lerPacote, lerPacoteVazio } from '../ler';
import { nfe, zip, CHAVE } from './fixtures';

const CAB = { org: 'EMPRESA TESTE LTDA', cnpj: '11444777000161', contaMl: '123', geradoEm: new Date('2026-10-16T12:00:00-03:00') };
const AG = new Date('2026-10-16T12:00:00-03:00');
const abrir = (b: Uint8Array) => XLSX.read(b, { type: 'array' });

describe('gerarRelatorioXlsx', () => {
  it('abas Vendas e Conferência; chave como texto; ordem por data; totais', () => {
    const l = lerPacote(zip({ 'a.xml': nfe({ n: 2, dhEmi: '2026-09-20T10:00:00-03:00', vNF: '10.00' }),
      'b.xml': nfe({ n: 1, dhEmi: '2026-09-05T10:00:00-03:00', vNF: '20.50' }) }), '2026-09', AG);
    const wb = abrir(gerarRelatorioXlsx(l, CAB));
    expect(wb.SheetNames).toEqual(['Vendas', 'Conferência']);
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Vendas, { header: 1, raw: true });
    const iCab = rows.findIndex((r) => r[0] === 'Data de emissão');
    expect(rows[iCab]).toEqual(['Data de emissão', 'Tipo', 'Status', 'Número', 'Série', 'Chave', 'Produtos', 'Frete', 'Desconto', 'Total', 'Carta de correção']);
    expect(rows[iCab + 1][3]).toBe('1');
    expect(rows[iCab + 1][5]).toBe(CHAVE(1));
    expect(wb.Sheets.Vendas[XLSX.utils.encode_cell({ r: iCab + 1, c: 5 })].t).toBe('s');
    expect(rows[iCab + 1][9]).toBe(20.5);
    expect(rows.some((r) => r[0] === 'Vendas autorizadas' && r[1] === 2 && r[5] === 30.5)).toBe(true);
    const conf = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['Conferência'], { header: 1 }).flat().join(' | ');
    expect(conf).toContain('Conciliação com as vendas não incluída nesta versão.');
    expect(conf).toContain('11444777000161');
  });
  it('selo PACOTE PARCIAL no topo das duas abas', () => {
    const l = lerPacote(zip({ 'a.xml': '<x' }), '2026-09', AG);
    const wb = abrir(gerarRelatorioXlsx(l, CAB));
    for (const aba of ['Vendas', 'Conferência']) {
      expect(String(XLSX.utils.sheet_to_json<string[]>(wb.Sheets[aba], { header: 1 })[0][0])).toMatch(/^PACOTE PARCIAL/);
    }
  });
  it('mês vazio: "Nenhuma nota no mês" na Conferência', () => {
    const wb = abrir(gerarRelatorioXlsx(lerPacoteVazio('2026-09', AG), CAB));
    expect(XLSX.utils.sheet_to_json<string[]>(wb.Sheets['Conferência'], { header: 1 }).flat().join(' ')).toContain('Nenhuma nota no mês');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/relatorio-xlsx.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `cabecalho.ts`** (compartilhado com o PDF)

```ts
import { AVISOS_FIXOS, type LeituraPacote } from './tipos';

export interface Cabecalho { org: string; cnpj: string | null; contaMl: string; geradoEm: Date }

const FMT = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
export const dataHoraBR = (ms: number) => FMT.format(new Date(ms));
export const reais = (c: number) => c / 100;

/** Linhas da Conferência (aba do xlsx e página do PDF): [rótulo, valor]. */
export function linhasConferencia(l: LeituraPacote, cab: Cabecalho): string[][] {
  const c = l.conferencia;
  const out: string[][] = [];
  if (c.parcial) out.push([`PACOTE PARCIAL — ${c.motivosParcial.join('; ')}`]);
  out.push(['Organização', cab.org], ['CNPJ', cab.cnpj ?? '—'], ['Conta Mercado Livre', cab.contaMl],
    ['Mês', c.mes], ['Gerado em', dataHoraBR(cab.geradoEm.getTime())], ['Arquivos no download', String(c.totalArquivos)]);
  if (c.vazio) out.push(['Nenhuma nota no mês']);
  if (c.mesEmAndamento) out.push(['Mês em andamento — o pacote fica incompleto até o fim do mês.']);
  for (const a of AVISOS_FIXOS) out.push([a]);
  for (const [k, v] of Object.entries(c.contagem).sort()) out.push([`Quantidade: ${k}`, String(v)]);
  const secao = (titulo: string, itens: string[][]) => { if (itens.length) out.push([], [titulo], ...itens); };
  secao('Outros documentos fiscais (não são venda)', c.outros.map((o) => [o.chave || o.arquivo, o.cfops.join(', ')]));
  secao('Notas denegadas', c.denegadas.map((d) => [d.chave, `cStat ${d.cStat}`]));
  secao('Cancelamento de nota de outro mês', c.cancelamentosOutroMes.map((x) => [x.chave, x.arquivo]));
  secao('Eventos rejeitados', c.eventosRejeitados.map((e) => [e.chave, `evento ${e.tpEvento} · cStat ${e.cStat}`]));
  secao('Inutilizações', c.inutilizacoes.map((i) => [`série ${i.serie} · ${i.inicio}–${i.fim}`, `${i.homologada ? 'homologada' : 'rejeitada'} (cStat ${i.cStat}) ${i.motivo}`.trim()]));
  secao('Arquivos ilegíveis ou incompletos', c.incompletos.map((i) => [i.arquivo, i.motivo]));
  secao('Chaves com conteúdo divergente', c.divergentes.map((ch) => [ch]));
  secao('Notas fora do período', c.foraDoPeriodo.map((f) => [f.chave, f.competencia]));
  return out;
}
```

- [ ] **Step 4: Implementar `relatorio-xlsx.ts`**

```ts
// ADR-0181 Plano 2a — relatório de vendas (xlsx). Chave/número/série como texto; valores em reais (2 casas).
import * as XLSX from 'xlsx';
import { totaisPorGrupo, rotuloTipo, rotuloStatus, type LeituraPacote } from './tipos';
import { dataHoraBR, linhasConferencia, reais, type Cabecalho } from './cabecalho';

const CABECALHO = ['Data de emissão', 'Tipo', 'Status', 'Número', 'Série', 'Chave', 'Produtos', 'Frete', 'Desconto', 'Total', 'Carta de correção'];

export function gerarRelatorioXlsx(l: LeituraPacote, cab: Cabecalho): Uint8Array {
  const c = l.conferencia;
  const aoa: (string | number)[][] = [];
  if (c.parcial) aoa.push([`PACOTE PARCIAL — ${c.motivosParcial.join('; ')}`], []);
  aoa.push([`Relatório de vendas · ${cab.org} · ${c.mes}`], [], CABECALHO);
  for (const n of l.notas) {
    aoa.push([dataHoraBR(n.instante), rotuloTipo(n.tipo), rotuloStatus(n.status), n.numero, n.serie, n.chave,
      reais(n.produtosC), reais(n.freteC), reais(n.descontoC), reais(n.totalC), n.cartaCorrecao ? 'sim' : '']);
  }
  aoa.push([], ['Grupo', 'Quantidade', 'Produtos', 'Frete', 'Desconto', 'Total']);
  for (const t of totaisPorGrupo(l.notas)) {
    aoa.push([t.grupo, t.quantidade, reais(t.produtosC), reais(t.freteC), reais(t.descontoC), reais(t.totalC)]);
  }
  const vendas = XLSX.utils.aoa_to_sheet(aoa);
  // Força texto em Número/Série/Chave (aoa_to_sheet já grava string como 's'; garante formato '@').
  for (const ref of Object.keys(vendas)) {
    if (ref.startsWith('!')) continue;
    const cel = vendas[ref] as XLSX.CellObject;
    if (cel.t === 'n') cel.z = '#,##0.00';
  }
  vendas['!cols'] = [{ wch: 16 }, { wch: 13 }, { wch: 11 }, { wch: 10 }, { wch: 6 }, { wch: 46 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 }];

  const conf = XLSX.utils.aoa_to_sheet(linhasConferencia(l, cab));
  conf['!cols'] = [{ wch: 48 }, { wch: 60 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, vendas, 'Vendas');
  XLSX.utils.book_append_sheet(wb, conf, 'Conferência');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/relatorio-xlsx.test.ts`
Expected: PASS (3 testes). Nota: a quantidade no total é número (`2`), por isso o teste compara `r[1] === 2`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pacote-contador/
git commit -m "feat(adr-0181): relatório de vendas do pacote do contador em xlsx"
```

---

### Task 3: Relatório PDF (`relatorio-pdf.ts`)

**Files:**
- Create: `src/lib/pacote-contador/relatorio-pdf.ts`
- Test: `src/lib/pacote-contador/__tests__/relatorio-pdf.test.ts`

**Interfaces:**
- Consumes: `LeituraPacote`, `totaisPorGrupo`, rótulos (Task 1); `Cabecalho`, `dataHoraBR`, `linhasConferencia`, `reais` (Task 2).
- Produces: `montarRelatorioPdf(l: LeituraPacote, cab: Cabecalho): jsPDF`; `gerarRelatorioPdf(l: LeituraPacote, cab: Cabecalho): Uint8Array`.

- [ ] **Step 1: Teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { montarRelatorioPdf, gerarRelatorioPdf } from '../relatorio-pdf';
import { lerPacote } from '../ler';
import { nfe, zip } from './fixtures';

const CAB = { org: 'EMPRESA TESTE LTDA', cnpj: '11444777000161', contaMl: '123', geradoEm: new Date('2026-10-16T12:00:00-03:00') };
const AG = new Date('2026-10-16T12:00:00-03:00');

describe('relatório PDF', () => {
  it('300 notas: várias páginas, cabeçalho, totais e Conferência', () => {
    const arquivos: Record<string, string> = {};
    for (let i = 1; i <= 300; i++) arquivos[`n${i}.xml`] = nfe({ n: i, dhEmi: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T10:00:00-03:00` });
    const doc = montarRelatorioPdf(lerPacote(zip(arquivos), '2026-09', AG), CAB);
    expect(doc.getNumberOfPages()).toBeGreaterThan(5);
    const texto = doc.output();
    expect(texto).toContain('Data de emiss');
    expect(texto).toContain('Vendas autorizadas');
    expect(texto).toContain('Confer');
  });
  it('PACOTE PARCIAL aparece quando há arquivo ilegível; bytes começam com %PDF', () => {
    const l = lerPacote(zip({ 'a.xml': '<x' }), '2026-09', AG);
    expect(montarRelatorioPdf(l, CAB).output()).toContain('PACOTE PARCIAL');
    const b = gerarRelatorioPdf(l, CAB);
    expect(new TextDecoder().decode(b.slice(0, 4))).toBe('%PDF');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/relatorio-pdf.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```ts
// ADR-0181 Plano 2a — relatório de vendas (PDF, A4 paisagem). Tabela multipágina com cabeçalho repetido.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { totaisPorGrupo, rotuloTipo, rotuloStatus, type LeituraPacote } from './tipos';
import { dataHoraBR, linhasConferencia, reais, type Cabecalho } from './cabecalho';

const brl = (c: number) => reais(c).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function montarRelatorioPdf(l: LeituraPacote, cab: Cabecalho): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const c = l.conferencia;
  let y = 12;
  if (c.parcial) {
    doc.setTextColor(180, 0, 0); doc.setFontSize(11);
    doc.text(`PACOTE PARCIAL — ${c.motivosParcial.join('; ')}`, 10, y); y += 6;
    doc.setTextColor(0, 0, 0);
  }
  doc.setFontSize(12);
  doc.text(`Relatório de vendas · ${cab.org} · ${c.mes}`, 10, y); y += 4;

  autoTable(doc, {
    startY: y + 2,
    head: [['Data de emissão', 'Tipo', 'Status', 'Número', 'Série', 'Chave', 'Produtos', 'Frete', 'Desconto', 'Total', 'CC-e']],
    body: l.notas.map((n) => [dataHoraBR(n.instante), rotuloTipo(n.tipo), rotuloStatus(n.status), n.numero, n.serie, n.chave,
      brl(n.produtosC), brl(n.freteC), brl(n.descontoC), brl(n.totalC), n.cartaCorrecao ? 'sim' : '']),
    styles: { fontSize: 7, cellPadding: 1 },
    headStyles: { fillColor: [60, 60, 60] },
    columnStyles: { 5: { fontSize: 6, cellWidth: 78 }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' } },
    showHead: 'everyPage',
  });

  autoTable(doc, {
    head: [['Grupo', 'Quantidade', 'Produtos', 'Frete', 'Desconto', 'Total']],
    body: totaisPorGrupo(l.notas).map((t) => [t.grupo, String(t.quantidade), brl(t.produtosC), brl(t.freteC), brl(t.descontoC), brl(t.totalC)]),
    styles: { fontSize: 8 },
  });

  doc.addPage();
  doc.setFontSize(12);
  doc.text('Conferência', 10, 12);
  autoTable(doc, { startY: 16, body: linhasConferencia(l, cab), styles: { fontSize: 8 }, columnStyles: { 0: { cellWidth: 110 } } });
  return doc;
}

export function gerarRelatorioPdf(l: LeituraPacote, cab: Cabecalho): Uint8Array {
  return new Uint8Array(montarRelatorioPdf(l, cab).output('arraybuffer'));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/relatorio-pdf.test.ts`
Expected: PASS. Se `output()` vier comprimido e o `toContain` falhar, criar o doc com `compress: false` (é o padrão do jsPDF; não ligar compressão).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pacote-contador/
git commit -m "feat(adr-0181): relatório de vendas do pacote do contador em PDF"
```

---

### Task 4: Download no front e montagem do pacote (`baixar.ts`, `montar.ts`)

**Files:**
- Create: `src/lib/pacote-contador/baixar.ts`
- Create: `src/lib/pacote-contador/montar.ts`
- Test: `src/lib/pacote-contador/__tests__/baixar.test.ts`, `src/lib/pacote-contador/__tests__/montar.test.ts`

**Interfaces:**
- Consumes: `LeituraPacote` (Task 1).
- Produces:
  - `type ResultadoDownload = { tipo: 'zip'; bytes: Uint8Array; contaMl: string } | { tipo: 'vazio'; contaMl: string }`
  - `class ErroPacote extends Error { status: number }`
  - `baixarNotasMes(mes: string, orgEsperada: string, signal?: AbortSignal): Promise<ResultadoDownload>`
  - `montarPacote(l: LeituraPacote, xlsx: Uint8Array, pdf: Uint8Array): Uint8Array`
  - `nomePacote(mes: string): string` → `pacote-AAAA-MM.zip`
  - `salvarArquivo(nome: string, bytes: Uint8Array, tipo: string): void`
  - `mesesDisponiveis(agora: Date, n?: number): string[]` (mais recente primeiro, nunca futuro, em America/Sao_Paulo) e `mesAnteriorSP(agora: Date): string`

- [ ] **Step 1: Testes que falham**

`__tests__/baixar.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } } }));
import { baixarNotasMes, ErroPacote } from '../baixar';

const resp = (body: BodyInit | null, init: ResponseInit) => new Response(body, init);
beforeEach(() => { vi.unstubAllGlobals(); });

describe('baixarNotasMes', () => {
  it('preserva bytes binários e devolve a conta', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4, 0, 255, 128]);
    const f = vi.fn(async () => resp(bytes, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'X-Org-Id': 'org-1', 'X-Conta-Ml': '99' } }));
    vi.stubGlobal('fetch', f);
    const r = await baixarNotasMes('2026-09', 'org-1');
    expect(r).toEqual({ tipo: 'zip', bytes, contaMl: '99' });
    expect(f.mock.calls[0][0]).toMatch(/\/functions\/v1\/baixar-notas-venda$/);
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' });
  });
  it('org divergente recusa', async () => {
    vi.stubGlobal('fetch', async () => resp(new Uint8Array([1]), { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'X-Org-Id': 'org-2' } }));
    await expect(baixarNotasMes('2026-09', 'org-1')).rejects.toThrow('A organização mudou durante o download — gere o pacote de novo.');
  });
  it('vazio e erro com mensagem do servidor', async () => {
    vi.stubGlobal('fetch', async () => resp(JSON.stringify({ vazio: true }), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Org-Id': 'org-1', 'X-Conta-Ml': '99' } }));
    expect(await baixarNotasMes('2026-09', 'org-1')).toEqual({ tipo: 'vazio', contaMl: '99' });
    vi.stubGlobal('fetch', async () => resp(JSON.stringify({ error: 'limite' }), { status: 429, headers: { 'Content-Type': 'application/json' } }));
    const e = await baixarNotasMes('2026-09', 'org-1').catch((x) => x);
    expect(e).toBeInstanceOf(ErroPacote);
    expect(e).toMatchObject({ message: 'limite', status: 429 });
  });
});
```

`__tests__/montar.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { montarPacote, nomePacote, mesesDisponiveis, mesAnteriorSP } from '../montar';
import { lerPacote, lerPacoteVazio } from '../ler';
import { nfe, zip } from './fixtures';

const AG = new Date('2026-10-16T12:00:00-03:00');
describe('montarPacote', () => {
  it('XMLs originais em xmls/ + 2 relatórios', () => {
    const l = lerPacote(zip({ 'Emitidas/a.xml': nfe({ n: 1 }) }), '2026-09', AG);
    const z = unzipSync(montarPacote(l, new Uint8Array([1]), new Uint8Array([2])));
    expect(Object.keys(z).sort()).toEqual(['relatorio-vendas.pdf', 'relatorio-vendas.xlsx', 'xmls/Emitidas/a.xml']);
    expect(strFromU8(z['xmls/Emitidas/a.xml'])).toContain('nfeProc');
  });
  it('vazio: só relatórios', () => {
    const z = unzipSync(montarPacote(lerPacoteVazio('2026-09', AG), new Uint8Array([1]), new Uint8Array([2])));
    expect(Object.keys(z).sort()).toEqual(['relatorio-vendas.pdf', 'relatorio-vendas.xlsx']);
  });
  it('nome e meses (sem futuro, fuso de São Paulo)', () => {
    expect(nomePacote('2026-09')).toBe('pacote-2026-09.zip');
    const virada = new Date('2026-11-01T02:00:00Z'); // ainda 31/10 em São Paulo
    expect(mesesDisponiveis(virada, 3)).toEqual(['2026-10', '2026-09', '2026-08']);
    expect(mesAnteriorSP(virada)).toBe('2026-09');
    expect(mesesDisponiveis(new Date('2026-01-10T12:00:00-03:00'), 2)).toEqual(['2026-01', '2025-12']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/baixar.test.ts src/lib/pacote-contador/__tests__/montar.test.ts`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Implementar `baixar.ts`**

```ts
// ADR-0181 Plano 2a — download binário do zip do mês. NUNCA via functions.invoke(): functions-js 2.106.2
// lê application/zip como texto e corrompe os bytes.
import { supabase } from '@/lib/supabase';

export type ResultadoDownload = { tipo: 'zip'; bytes: Uint8Array; contaMl: string } | { tipo: 'vazio'; contaMl: string };
export class ErroPacote extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function baixarNotasMes(mes: string, orgEsperada: string, signal?: AbortSignal): Promise<ResultadoDownload> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new ErroPacote('Sessão expirada — entre de novo.', 401);
  const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/baixar-notas-venda`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ mes }),
  });
  const tipo = r.headers.get('Content-Type') ?? '';
  if (!r.ok || !r.headers.get('X-Org-Id')) {
    const j = tipo.includes('json') ? await r.json().catch(() => null) : null;
    throw new ErroPacote(j?.error ?? 'Não foi possível confirmar as notas do mês.', r.status);
  }
  if (r.headers.get('X-Org-Id') !== orgEsperada) {
    throw new ErroPacote('A organização mudou durante o download — gere o pacote de novo.', 409);
  }
  const contaMl = r.headers.get('X-Conta-Ml') ?? '';
  if (tipo.includes('json')) {
    const j = await r.json();
    if (j?.vazio === true) return { tipo: 'vazio', contaMl };
    throw new ErroPacote('Não foi possível confirmar as notas do mês.', 502);
  }
  return { tipo: 'zip', bytes: new Uint8Array(await r.arrayBuffer()), contaMl };
}
```

- [ ] **Step 4: Implementar `montar.ts`**

```ts
// ADR-0181 Plano 2a — pacote final: XMLs originais (xmls/<caminho do ML>) + relatórios.
import { zipSync } from 'fflate';
import type { LeituraPacote } from './tipos';

export function montarPacote(l: LeituraPacote, xlsx: Uint8Array, pdf: Uint8Array): Uint8Array {
  const arquivos: Record<string, Uint8Array> = { 'relatorio-vendas.xlsx': xlsx, 'relatorio-vendas.pdf': pdf };
  for (const [nome, dados] of Object.entries(l.arquivos)) arquivos[`xmls/${nome}`] = dados;
  return zipSync(arquivos, { level: 6 });
}

export const nomePacote = (mes: string) => `pacote-${mes}.zip`;

export function salvarArquivo(nome: string, bytes: Uint8Array, tipo: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' });
function anoMesSP(d: Date): [number, number] {
  const p = FMT.formatToParts(d);
  return [Number(p.find((x) => x.type === 'year')!.value), Number(p.find((x) => x.type === 'month')!.value)];
}
const fmt = (a: number, m: number) => `${a}-${String(m).padStart(2, '0')}`;

export function mesesDisponiveis(agora: Date, n = 12): string[] {
  let [a, m] = anoMesSP(agora);
  const out: string[] = [];
  for (let i = 0; i < n; i++) { out.push(fmt(a, m)); m -= 1; if (m === 0) { m = 12; a -= 1; } }
  return out;
}
export const mesAnteriorSP = (agora: Date) => mesesDisponiveis(agora, 2)[1];
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/baixar.test.ts src/lib/pacote-contador/__tests__/montar.test.ts`
Expected: PASS. Se `import.meta.env.VITE_SUPABASE_URL` vier vazio no teste, a regex do 1º teste ainda casa (`/functions/v1/baixar-notas-venda`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/pacote-contador/
git commit -m "feat(adr-0181): download binário e montagem do pacote do contador"
```

---

### Task 5: Edge `baixar-notas-venda`

**Files:**
- Create: `supabase/functions/baixar-notas-venda/processar.ts`
- Create: `supabase/functions/baixar-notas-venda/index.ts`
- Modify: `supabase/config.toml` (bloco novo, depois do de `importar-nota-compra`)
- Test: `supabase/functions/baixar-notas-venda/__tests__/processar.test.ts`

**Interfaces:**
- Produces (contrato HTTP consumido pela Task 4):
  - `POST { mes: 'AAAA-MM' }` → `200 application/octet-stream` (zip) **ou** `200 application/json {vazio:true}`, ambos com `X-Org-Id`, `X-Conta-Ml` e `Access-Control-Expose-Headers: X-Org-Id, X-Conta-Ml`; erro → JSON `{ error }` com 400/409/429/502.
  - `intervaloDoMes(mes: string, agora: Date): { start: string; end: string } | { erro: string }`
  - `urlLote(conta: string, start: string, end: string): string`
  - `baixarLoteMes(deps: DepsNotasVenda, p: { conexaoId: string; conta: string; mes: string; agora: Date; signal: AbortSignal }): Promise<SaidaNotas>`

- [ ] **Step 1: Teste que falha**

```ts
import { describe, it, expect, vi } from 'vitest';
import { intervaloDoMes, urlLote, baixarLoteMes, type DepsNotasVenda } from '../processar';

const AG = new Date('2026-10-16T12:00:00-03:00');
const deps = (r: Response | Error, travou = true): DepsNotasVenda => ({
  travar: vi.fn(async () => travou),
  token: vi.fn(async () => 'TOK'),
  fetchMl: vi.fn(async () => { if (r instanceof Error) throw r; return r; }),
});
const p = { conexaoId: 'cx1', conta: '123', mes: '2026-09', agora: AG, signal: new AbortController().signal };

describe('intervaloDoMes', () => {
  it('mês inteiro, fevereiro bissexto, futuro recusado no fuso de SP', () => {
    expect(intervaloDoMes('2026-09', AG)).toEqual({ start: '20260901', end: '20260930' });
    expect(intervaloDoMes('2028-02', new Date('2028-03-05T12:00:00-03:00'))).toEqual({ start: '20280201', end: '20280229' });
    expect(intervaloDoMes('2026-11', AG)).toEqual({ erro: 'Mês futuro não tem notas.' });
    expect(intervaloDoMes('2026-13', AG)).toEqual({ erro: 'Mês inválido.' });
    expect(intervaloDoMes('2026-11', new Date('2026-11-01T02:00:00Z'))).toEqual({ erro: 'Mês futuro não tem notas.' });
  });
  it('url com todos os filtros e sem CT-e', () => {
    expect(urlLote('123', '20260901', '20260930')).toBe('https://api.mercadolibre.com/users/123/invoices/sites/MLB/batch_request/period/stream?start=20260901&end=20260930&sale=all&return=all&full=all&others=correction_letter&file_types=xml&simple_folder=false');
  });
});

describe('baixarLoteMes', () => {
  it('trava ocupada → 429 local sem chamar o ML', async () => {
    const d = deps(new Response('x'), false);
    expect(await baixarLoteMes(d, p)).toEqual({ tipo: 'erro', status: 429, mensagem: 'Já há um download de notas desta conta em andamento ou recém-feito — aguarde 3 minutos.' });
    expect(d.fetchMl).not.toHaveBeenCalled();
    expect(d.travar).toHaveBeenCalledWith('lock:notas-venda:cx1', 180);
  });
  it('200 zip → stream', async () => {
    const r = await baixarLoteMes(deps(new Response(new Uint8Array([0x50, 0x4b]), { status: 200, headers: { 'Content-Type': 'application/zip' } })), p);
    expect(r.tipo).toBe('zip');
  });
  it('mapeia status do ML', async () => {
    const caso = async (r: Response | Error) => baixarLoteMes(deps(r), p);
    expect(await caso(new Response('', { status: 404 }))).toEqual({ tipo: 'vazio' });
    expect(await caso(new Response('{"x":1}', { status: 404 }))).toMatchObject({ tipo: 'erro', status: 502, mensagem: 'Não foi possível confirmar as notas do mês.' });
    expect(await caso(new Response('Invalid input.', { status: 400 }))).toMatchObject({ status: 502 });
    expect(await caso(new Response(null, { status: 200 }))).toMatchObject({ status: 502 });
    expect(await caso(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))).toMatchObject({ status: 502 });
    expect(await caso(new Response('', { status: 429 }))).toEqual({ tipo: 'erro', status: 429, mensagem: 'O Mercado Livre limitou os downloads — tente de novo em alguns minutos (cerca de 5).' });
    expect(await caso(new Response('', { status: 403 }))).toEqual({ tipo: 'erro', status: 409, mensagem: 'A conta do Mercado Livre não autorizou o download das notas.' });
    expect(await caso(new Response('', { status: 503 }))).toEqual({ tipo: 'erro', status: 502, mensagem: 'Mercado Livre indisponível — o pacote não foi gerado.' });
    expect(await caso(new Error('timeout'))).toEqual({ tipo: 'erro', status: 502, mensagem: 'Mercado Livre indisponível — o pacote não foi gerado.' });
  });
  it('mês inválido não trava nem chama o ML', async () => {
    const d = deps(new Response('x'));
    expect(await baixarLoteMes(d, { ...p, mes: '2026-12' })).toMatchObject({ tipo: 'erro', status: 400 });
    expect(d.travar).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run supabase/functions/baixar-notas-venda/__tests__/processar.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `processar.ts`** (sem `Deno`, sem imports de runtime — testável no vitest)

```ts
// ADR-0181 Plano 2a — download em lote das notas do mês no ML. Só repassa o zip (sem parse, sem gravar).
export interface DepsNotasVenda {
  travar(chave: string, ttlS: number): Promise<boolean>;
  token(): Promise<string>;
  fetchMl(url: string, token: string, signal: AbortSignal): Promise<Response>;
}
export type SaidaNotas =
  | { tipo: 'zip'; body: ReadableStream<Uint8Array> }
  | { tipo: 'vazio' }
  | { tipo: 'erro'; status: number; mensagem: string };

const INDISPONIVEL = 'Mercado Livre indisponível — o pacote não foi gerado.';
const AMBIGUO = 'Não foi possível confirmar as notas do mês.';
// ponytail: 120 s até os headers (o gateway corta em 150 s sem começar a responder). Medido: 30–56 s para
// ~1.400 vendas/mês. Loja bem maior → dividir o mês em quinzenas (o `stream` aceita), ao custo de mais cota.
const TTFB_MS = 120_000;
// ponytail: 1 download por conexão a cada 3 min, sem liberar (protege a cota do ML: 429 após 3–4 chamadas).
const TRAVA_S = 180;

const FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' });
function mesSP(d: Date): string {
  const x = FMT.formatToParts(d);
  return `${x.find((p) => p.type === 'year')!.value}-${x.find((p) => p.type === 'month')!.value}`;
}

export function intervaloDoMes(mes: string, agora: Date): { start: string; end: string } | { erro: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return { erro: 'Mês inválido.' };
  if (mes > mesSP(agora)) return { erro: 'Mês futuro não tem notas.' };
  const [a, m] = mes.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const base = `${a}${String(m).padStart(2, '0')}`;
  return { start: `${base}01`, end: `${base}${String(ultimo).padStart(2, '0')}` };
}

export const urlLote = (conta: string, start: string, end: string) =>
  `https://api.mercadolibre.com/users/${conta}/invoices/sites/MLB/batch_request/period/stream`
  + `?start=${start}&end=${end}&sale=all&return=all&full=all&others=correction_letter&file_types=xml&simple_folder=false`;

export async function baixarLoteMes(
  deps: DepsNotasVenda,
  p: { conexaoId: string; conta: string; mes: string; agora: Date; signal: AbortSignal },
): Promise<SaidaNotas> {
  const iv = intervaloDoMes(p.mes, p.agora);
  if ('erro' in iv) return { tipo: 'erro', status: 400, mensagem: iv.erro };
  if (!(await deps.travar(`lock:notas-venda:${p.conexaoId}`, TRAVA_S))) {
    return { tipo: 'erro', status: 429, mensagem: 'Já há um download de notas desta conta em andamento ou recém-feito — aguarde 3 minutos.' };
  }
  const ctl = new AbortController();
  const cancelar = () => ctl.abort();
  p.signal.addEventListener('abort', cancelar);          // navegador cancelou → aborta o ML (inclusive no corpo)
  const timer = setTimeout(cancelar, TTFB_MS);
  let r: Response;
  try {
    r = await deps.fetchMl(urlLote(p.conta, iv.start, iv.end), await deps.token(), ctl.signal);
  } catch {
    return { tipo: 'erro', status: 502, mensagem: INDISPONIVEL };
  } finally {
    clearTimeout(timer);
  }
  if (r.status === 200) {
    const tipo = r.headers.get('Content-Type') ?? '';
    if (r.body && /zip|octet-stream/.test(tipo)) return { tipo: 'zip', body: r.body };
    return { tipo: 'erro', status: 502, mensagem: AMBIGUO };
  }
  if (r.status === 404) return (await r.text().catch(() => 'x')) === '' ? { tipo: 'vazio' } : { tipo: 'erro', status: 502, mensagem: AMBIGUO };
  if (r.status === 429) return { tipo: 'erro', status: 429, mensagem: 'O Mercado Livre limitou os downloads — tente de novo em alguns minutos (cerca de 5).' };
  if (r.status === 401 || r.status === 403) return { tipo: 'erro', status: 409, mensagem: 'A conta do Mercado Livre não autorizou o download das notas.' };
  if (r.status >= 500) return { tipo: 'erro', status: 502, mensagem: INDISPONIVEL };
  return { tipo: 'erro', status: 502, mensagem: AMBIGUO };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run supabase/functions/baixar-notas-venda/__tests__/processar.test.ts`
Expected: PASS.

- [ ] **Step 5: Implementar `index.ts`**

```ts
// ADR-0181 Plano 2a — pacote do contador (vendas): repassa o zip de notas do mês do ML. JWT do app; gate estoque.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { redisSetNX } from '../_shared/redis/client.ts';
import { baixarLoteMes } from './processar.ts';

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extra } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let ctx: Awaited<ReturnType<typeof requireUserOrg>>;
  try { ctx = await requireUserOrg(req, { access: 'read' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const admin = adminClient();

  if (!(await exigirModulo(admin, ctx.orgId, 'estoque'))) return json({ error: 'Módulo de estoque não habilitado.' }, 403);
  const conexao = await resolverConexao(admin, ctx.orgId, 'mercado_livre');
  if (!conexao?.contaExternaId) return json({ error: 'Conecte a conta do Mercado Livre em Canais.' }, 409);

  const body = await req.json().catch(() => ({})) as { mes?: unknown };
  const mes = typeof body.mes === 'string' ? body.mes : '';
  const alvo = { type: 'notas_venda_mes', id: mes };

  const saida = await baixarLoteMes({
    travar: (chave, ttl) => redisSetNX(chave, '1', ttl),
    token: () => getValidAccessTokenConexao(conexao),
    fetchMl: (url, token, signal) => fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal }),
  }, { conexaoId: conexao.id, conta: conexao.contaExternaId, mes, agora: new Date(), signal: req.signal });

  if (saida.tipo === 'erro') {
    await auditarOperacaoSuporte(admin, ctx, alvo, 'failed');
    return json({ error: saida.mensagem }, saida.status);
  }
  await auditarOperacaoSuporte(admin, ctx, alvo, 'succeeded');   // antes de liberar os bytes
  const ident = {
    'X-Org-Id': ctx.orgId, 'X-Conta-Ml': conexao.contaExternaId,
    'Access-Control-Expose-Headers': 'X-Org-Id, X-Conta-Ml',
  };
  if (saida.tipo === 'vazio') return json({ vazio: true }, 200, ident);
  return new Response(saida.body, { status: 200, headers: { ...corsHeaders, ...ident, 'Content-Type': 'application/octet-stream' } });
});
```

- [ ] **Step 6: Bloco no `supabase/config.toml`** (logo após `[functions.importar-nota-compra]`)

```toml
# ADR-0181 Plano 2a — pacote do contador (vendas): repassa o zip de notas do ML (JWT do app, gate estoque).
[functions.baixar-notas-venda]
verify_jwt = true
```

- [ ] **Step 7: Checar tipos do Deno**

Run: `deno check --config supabase/functions/deno.json supabase/functions/baixar-notas-venda/index.ts supabase/functions/baixar-notas-venda/processar.ts && pnpm lint:functions`
Expected: sem erros. (O `check:functions` do `preflight` usa `git ls-files` — os arquivos novos só entram nele depois do `git add`.)

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/baixar-notas-venda/ supabase/config.toml
git commit -m "feat(adr-0181): edge baixar-notas-venda — repassa o zip de notas do mês do ML"
```

---

### Task 6: Card "Pacote do contador" em `/estoque`

**Files:**
- Create: `src/components/estoque/pacote-contador/card-pacote-contador.tsx`
- Modify: `src/pages/Estoque.tsx` (import + render logo antes de `<SecaoNotasCompra … />`, linha ~281)
- Test: `src/components/estoque/pacote-contador/__tests__/card-pacote-contador.test.tsx`

**Interfaces:**
- Consumes: `baixarNotasMes`, `ErroPacote` (Task 4); `lerPacote`, `lerPacoteVazio`, `ErroDownloadIncompleto` (Task 1); `gerarRelatorioXlsx` (Task 2); `gerarRelatorioPdf` (Task 3); `montarPacote`, `nomePacote`, `salvarArquivo`, `mesesDisponiveis`, `mesAnteriorSP` (Task 4); `effectiveOrgId()` de `src/stores/support-store.ts`.
- Produces: `<CardPacoteContador razaoSocial={string | null} cnpj={string | null} />`.

- [ ] **Step 1: Teste que falha**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/stores/support-store', () => ({ effectiveOrgId: () => 'org-1' }));
const baixar = vi.fn();
vi.mock('@/lib/pacote-contador/baixar', async (orig) => ({ ...(await orig<object>()), baixarNotasMes: (...a: unknown[]) => baixar(...a) }));
const salvar = vi.fn();
vi.mock('@/lib/pacote-contador/montar', async (orig) => ({ ...(await orig<object>()), salvarArquivo: (...a: unknown[]) => salvar(...a) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { toast } from 'sonner';
import { CardPacoteContador } from '../card-pacote-contador';
import { ErroPacote } from '@/lib/pacote-contador/baixar';

describe('CardPacoteContador', () => {
  it('padrão = mês anterior; sem mês futuro; vazio gera pacote', async () => {
    vi.setSystemTime(new Date('2026-10-16T12:00:00-03:00'));
    baixar.mockResolvedValueOnce({ tipo: 'vazio', contaMl: '99' });
    render(<CardPacoteContador razaoSocial="EMPRESA TESTE LTDA" cnpj="11444777000161" />);
    const sel = screen.getByLabelText('Mês') as HTMLSelectElement;
    expect(sel.value).toBe('2026-09');
    expect([...sel.options].map((o) => o.value)).not.toContain('2026-11');
    fireEvent.click(screen.getByRole('button', { name: 'Baixar pacote' }));
    await waitFor(() => expect(salvar).toHaveBeenCalledWith('pacote-2026-09.zip', expect.any(Uint8Array), 'application/zip'));
    expect(baixar).toHaveBeenCalledWith('2026-09', 'org-1', expect.any(AbortSignal));
    vi.useRealTimers();
  });
  it('erro do servidor vira toast com a mensagem', async () => {
    baixar.mockRejectedValueOnce(new ErroPacote('O Mercado Livre limitou os downloads — tente de novo em alguns minutos (cerca de 5).', 429));
    render(<CardPacoteContador razaoSocial={null} cnpj={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Baixar pacote' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('O Mercado Livre limitou os downloads — tente de novo em alguns minutos (cerca de 5).'));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/components/estoque/pacote-contador/__tests__/card-pacote-contador.test.tsx`
Expected: FAIL — módulo inexistente. (Se `vi.setSystemTime` exigir `vi.useFakeTimers({ toFake: ['Date'] })`, chame-o antes — só `Date`, para não travar o `waitFor`.)

- [ ] **Step 3: Implementar o card**

```tsx
// ADR-0181 Plano 2a — pacote do contador (vendas): XMLs do ML do mês + relatório xlsx/pdf, montado no navegador.
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { effectiveOrgId } from '@/stores/support-store';
import { baixarNotasMes } from '@/lib/pacote-contador/baixar';
import { lerPacote, lerPacoteVazio } from '@/lib/pacote-contador/ler';
import { gerarRelatorioXlsx } from '@/lib/pacote-contador/relatorio-xlsx';
import { gerarRelatorioPdf } from '@/lib/pacote-contador/relatorio-pdf';
import { montarPacote, nomePacote, salvarArquivo, mesesDisponiveis, mesAnteriorSP } from '@/lib/pacote-contador/montar';

type Etapa = 'ocioso' | 'baixando' | 'lendo' | 'montando';
const ROTULO: Record<Etapa, string> = { ocioso: '', baixando: 'Baixando do Mercado Livre…', lendo: 'Lendo as notas…', montando: 'Montando o pacote…' };
const respirar = () => new Promise((r) => setTimeout(r, 0));   // deixa a tela atualizar entre etapas pesadas

export function CardPacoteContador({ razaoSocial, cnpj }: { razaoSocial: string | null; cnpj: string | null }) {
  const agora = useMemo(() => new Date(), []);
  const meses = useMemo(() => mesesDisponiveis(agora), [agora]);
  const [mes, setMes] = useState(() => mesAnteriorSP(agora));
  const [etapa, setEtapa] = useState<Etapa>('ocioso');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  async function gerar() {
    const org = effectiveOrgId();
    if (!org) { toast.error('Organização não identificada — recarregue a página.'); return; }
    abort.current = new AbortController();
    try {
      setEtapa('baixando');
      const r = await baixarNotasMes(mes, org, abort.current.signal);
      setEtapa('lendo'); await respirar();
      const leitura = r.tipo === 'vazio' ? lerPacoteVazio(mes) : lerPacote(r.bytes, mes);
      setEtapa('montando'); await respirar();
      const cab = { org: razaoSocial ?? '—', cnpj, contaMl: r.contaMl, geradoEm: new Date() };
      const pacote = montarPacote(leitura, gerarRelatorioXlsx(leitura, cab), gerarRelatorioPdf(leitura, cab));
      salvarArquivo(nomePacote(mes), pacote, 'application/zip');
      if (leitura.conferencia.parcial) toast.error('Pacote gerado como PARCIAL — veja a aba Conferência.');
      else toast.success(leitura.conferencia.vazio ? 'Nenhuma nota no mês — pacote gerado com o relatório vazio.' : `Pacote de ${mes} gerado.`);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error(e instanceof Error ? e.message : 'Não foi possível gerar o pacote.');
    } finally {
      setEtapa('ocioso');
    }
  }

  const ocupado = etapa !== 'ocioso';
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pacote do contador</CardTitle>
        <CardDescription>XMLs de venda do Mercado Livre e o relatório nota a nota (Excel e PDF) de um mês.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <label htmlFor="pacote-mes" className="text-sm font-medium">Mês</label>
        <select id="pacote-mes" value={mes} disabled={ocupado} onChange={(e) => setMes(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm">
          {meses.map((m) => <option key={m} value={m}>{m.split('-').reverse().join('/')}</option>)}
        </select>
        <Button onClick={gerar} disabled={ocupado}>{ocupado ? 'Gerando…' : 'Baixar pacote'}</Button>
        {ocupado && <span className="text-sm text-muted-foreground" aria-live="polite">{ROTULO[etapa]}</span>}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Render no `Estoque.tsx`**

Adicionar o import junto aos de `importar-nota`:
```tsx
import { CardPacoteContador } from '@/components/estoque/pacote-contador/card-pacote-contador';
```
E logo antes de `<SecaoNotasCompra destacarChave={chaveDestacada} />`:
```tsx
<CardPacoteContador razaoSocial={empresaFiscal?.razao_social ?? null} cnpj={empresaFiscal?.cnpj ?? null} />
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm vitest run src/components/estoque/pacote-contador/__tests__/card-pacote-contador.test.tsx src/pages`
Expected: PASS (inclusive os testes já existentes de `Estoque`, se houver).

- [ ] **Step 6: Commit**

```bash
git add src/components/estoque/pacote-contador/ src/pages/Estoque.tsx
git commit -m "feat(adr-0181): card Pacote do contador em /estoque"
```

---

### Task 7: Docs e portão final

**Files:**
- Modify: `docs/decisions/0181-entrada-por-nota-de-compra-e-pacote-do-contador.md` (D-13: emendas 1 e 2; spike; Plano 2a implementado na branch)
- Modify: `docs/reference/edge-functions.md` (nova edge `baixar-notas-venda`: verify_jwt true, gate estoque, contrato HTTP)
- Modify: `docs/TASKS.md` (marcar o deploy do Plano 1 como feito; seção Plano 2a)
- Modify: `docs/project-status.md`, `obsidian-vault/03-Módulos/Fiscal.md`, `obsidian-vault/03-Módulos/Estoque.md`

- [ ] **Step 1: ADR-0181** — sob D-13, adicionar (redação neutra, repo público, sem dados de cliente):

```markdown
**Emendas de 2026-10-16 (Diego, após o spike da API):**
1. "Vendas sem nota" sai do Plano 2a e fica pendente até a primeira venda faturada pelo Faturador mostrar onde o
   pedido ML aparece no XML (o prefixo do nome do arquivo não é pedido, pack nem envio).
2. 1 lote = 1 mês: a API aceita no máximo ~1 mês por chamada e devolve 429 após 3–4 chamadas em poucos minutos,
   sem `Retry-After`. "Retomar" = baixar o mês de novo; o manifesto é a aba Conferência.
CT-e fica fora do download (`others=correction_letter`): documento de transporte, não de venda.
Plano 2a: spec `docs/superpowers/specs/2026-10-16-pacote-contador-vendas-design.md`.
```
e em "A verificar antes de codar" item 2, registrar o resultado do spike (endpoint, 1 mês, 404 vazio, 429, volumes).

- [ ] **Step 2: `edge-functions.md`, `TASKS.md`, `project-status.md`, vault** — uma entrada curta cada, no formato das vizinhas, citando ADR-0181 Plano 2a. Em `TASKS.md`, trocar `- [ ] Deploy das edges (...)` do Plano 1 por `- [x]`.

- [ ] **Step 3: Portão**

Run: `pnpm preflight`
Expected: verde (todos os testes; lint backend; build).

- [ ] **Step 4: Commit**

```bash
git add docs/ obsidian-vault/
git commit -m "docs(adr-0181): Plano 2a — pacote do contador (vendas)"
```

---

### Task 8 (pós-merge autorizado pelo Diego): deploy e validação em runtime

Só depois de "merge"/"deploy" explícito do Diego. Revisão pré-merge do Grok 4.7 xhigh antes.

- [ ] **Step 1:** `supabase functions deploy baixar-notas-venda --project-ref txvncrgkoynoxwopfkbp` (sem `--no-verify-jwt`); conferir `verify_jwt=true` e versão ACTIVE. Front sobe pelo Render após o merge.
- [ ] **Step 2:** org DSA, conta VALIDATION (já membro; nenhuma conexão alterada), app em produção: gerar setembro; anotar tempo até o primeiro byte e total (DevTools/`performance`); abrir o zip e o xlsx.
- [ ] **Step 3:** conferência independente: nº de NF-e de venda autorizadas × pedidos pagos de `ml_vendas` da DSA no mês (diferença explicada); 5 notas sorteadas conferidas campo a campo contra o XML.
- [ ] **Step 4:** duplo clique / segunda aba → mensagem da trava local.
- [ ] **Step 5:** filtro sem CT-e não perde nada fiscal: uma chamada direta (token, só GET) do mesmo mês com `others=all`, ≥ 5 min depois; mesmas NF-e, cancelamentos e CC-e, só CT-e a mais. Se divergir, voltar a `others=all` (ajuste na Task 5 + teste).
- [ ] **Step 6:** apagar todos os zips de teste do tmp (dados de clientes); registrar resultados no ADR-0181.
