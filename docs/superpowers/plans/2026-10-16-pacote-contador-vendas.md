# Pacote do contador: vendas (Plano 2a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** em `/estoque`, o usuário escolhe um mês e baixa `pacote-AAAA-MM.zip` com os XMLs fiscais do Mercado Livre do mês + `relatorio-vendas.xlsx` + `relatorio-vendas.pdf`, sem gravar XML/relatório em lugar nenhum.

**Architecture:** uma edge nova (`baixar-notas-venda`) só autentica, trava a cota por conexão, chama o download em lote do ML e repassa o zip em stream. O navegador valida o zip inteiro (estrutura, tamanhos e CRC32), classifica cada XML pelo conteúdo, gera xlsx (SheetJS) e PDF (jsPDF + autotable) e monta o pacote final com `fflate`.

**Tech Stack:** React + TS (Vite), vitest 3.2.4 (jsdom, `TZ=America/Sao_Paulo`), Supabase Edge Functions (Deno), Upstash Redis, `xlsx` 0.20.3, `jspdf` 4.2.1, `jspdf-autotable` 5.0.8, `fflate` 0.8.3 (dependência direta nova).

**Spec:** `docs/superpowers/specs/2026-10-16-pacote-contador-vendas-design.md` (ADR-0181, D-13 parte vendas, com as emendas 1 e 2 do Diego).

**Revisão do plano:** Codex `gpt-6.1-sol` high (2026-10-16, rodada 1: 16 achados — 14 incorporados, 2 com ruling R4/R5).

## Global Constraints

- Nada de XML ou relatório é gravado (banco/storage). Únicas escritas: rotação de token (`getValidAccessTokenConexao`), trava Redis e `auditarOperacaoSuporte` em sessão de suporte.
- Endpoint ML (verbatim): `/users/{conta}/invoices/sites/MLB/batch_request/period/stream?start=AAAAMMDD&end=AAAAMMDD&sale=all&return=all&full=all&others=correction_letter&file_types=xml&simple_folder=false`.
- 1 lote = 1 mês. Sem retry automático. Classificação **pelo conteúdo** do XML, nunca pela pasta.
- Competência e datas exibidas em `America/Sao_Paulo`. Valores em **centavos inteiros** validados (formato fiscal `^\d{1,13}(\.\d{1,2})?$`); chave, número e série são **texto**.
- Gate da edge: `requireUserOrg(req, { access: 'read' })` + `exigirModulo(admin, orgId, 'estoque')` + `resolverConexao(admin, orgId, 'mercado_livre')`. `verify_jwt = true`.
- Download no front por `fetch` cru + `arrayBuffer()` — **nunca** `supabase.functions.invoke()` (functions-js 2.106.2 lê zip como texto).
- A resposta 200 expõe `X-Org-Id` e `X-Conta-Ml` via `Access-Control-Expose-Headers` (o `cors.ts` compartilhado não expõe nada).
- Mensagens (verbatim):
  - incompleto: `O download veio incompleto — gere o pacote de novo.`
  - trava local: `Já há um download de notas desta conta em andamento ou recém-feito — aguarde alguns minutos.`
  - 429 ML: `O Mercado Livre limitou os downloads — tente de novo em alguns minutos (cerca de 5).`
  - 401/403 ML: `A conta do Mercado Livre não autorizou o download das notas.`
  - sem conexão: `Conecte a conta do Mercado Livre em Canais.`
  - 5xx/timeout/cancelado: `Mercado Livre indisponível — o pacote não foi gerado.`
  - resposta ambígua: `Não foi possível confirmar as notas do mês.`
  - org divergente: `A organização mudou durante o download — gere o pacote de novo.`
- Avisos fixos na Conferência (verbatim): `Conciliação com as vendas não incluída nesta versão.` e `Notas emitidas fora do Mercado Livre e não enviadas a ele não aparecem aqui.`
- Repo público: fixtures só com CNPJs `11222333000181` / `11444777000161`; nunca XML real no repo.
- Testes: `pnpm vitest run <arquivo>`; portão de entrega `pnpm preflight` (inclui `tsc -b` sobre os testes — tipos dos testes têm de compilar).

**Rulings deste plano** (registrar no ledger):
- R1. Trava por conexão: `redisSetNX('lock:notas-venda:<conexaoId>', '1', 460)` no início (460 s > teto de 400 s de execução); ao **terminar** (stream lido até o fim, erro do stream, cancelamento, ou qualquer resposta não-zip depois de travar) → `redisSet(chave, '1', 60)` = cooldown de 60 s. Cumpre a spec ("em andamento + 60 s").
- R2. Integridade = `unzipSync` sem erro + tamanho descompactado = declarado + **CRC32 calculado = CRC32 do diretório central**. Sem ZIP64 (`// ponytail:` — zips do ML medidos ≤ 12 MB).
- R3. Totais: os 6 grupos (venda/complementar/devolução × autorizada/cancelada), mesmo com zero, em ordem fixa.
- R4. Suporte em modo **somente leitura** não exporta nesta versão: o `AppShell` envolve a página em `<fieldset disabled>` (`src/components/app-shell.tsx:27`) e tirar os controles dele mexe no shell inteiro. Suporte "full" exporta. Custo se errado: suporte read pede escalonamento para baixar o pacote.
- R5. `index.ts` (camada HTTP, `Deno.serve` + imports Deno) não ganha teste unitário; a lógica está em `processar.ts` (testado). Cobertura do handler: `deno check` + validação de runtime (Task 8). `x-region` não é enviado (nenhum `fetch` cru do app envia; a edge não exige região).
- R6. CFOP: listas **explícitas** (não faixas) — venda e devolução de venda; todo item da nota tem de pertencer à lista do tipo. Transferências (5151/5152/5408/5409/1208/1209…) e remessas vão para "outros".
- R7. CC-e: coluna booleana "sim" (a "maior sequência" da spec sai — o relatório não mostra o texto da correção, então a sequência não muda nada exibido).

## Review Focus

1. XML do ML com namespace (`xmlns="http://www.portalfiscal.inf.br/nfe"`) — leitura por `getElementsByTagNameNS('*', tag)` (Task 1, fixtures com namespace).
2. Nota de 30/09 23:30−03:00 (= 01/10 02:30 UTC) — competência setembro, ordenação por instante (Task 1).
3. Mês de 404 vazio → pacote só com relatórios e "Nenhuma nota no mês"; não vira erro (Tasks 1, 4, 5, 6).
4. Duplo clique / duas abas com o primeiro stream ainda aberto → segunda chamada barrada pela trava (Task 5, teste com stream aberto).
5. Chave de 44 dígitos no xlsx continua texto exato, sem notação científica (Task 2).

---

### Task 1: Tipos e leitura do zip do ML (`ler.ts`)

**Files:**
- Modify: `package.json` (dependência `fflate`)
- Create: `src/lib/pacote-contador/tipos.ts`
- Create: `src/lib/pacote-contador/zip-integro.ts`
- Create: `src/lib/pacote-contador/ler.ts`
- Test: `src/lib/pacote-contador/__tests__/fixtures.ts`, `src/lib/pacote-contador/__tests__/ler.test.ts`

**Interfaces:**
- Produces: tipos `NotaRelatorio`, `Conferencia`, `LeituraPacote`, `TotalGrupo`, `ErroDownloadIncompleto`, `AVISOS_FIXOS`, `rotuloTipo`, `rotuloStatus`, `totaisPorGrupo(notas)`; `abrirZipIntegro(bytes: Uint8Array): Record<string, Uint8Array>`; `crc32(d: Uint8Array): number`; `lerPacote(bytes: Uint8Array, mes: string, agora?: Date): LeituraPacote`; `lerPacoteVazio(mes: string, agora?: Date): LeituraPacote`; `competenciaSP(ms: number): string`.

- [ ] **Step 1: Instalar `fflate` como dependência direta**

Run: `pnpm add fflate@0.8.3`
Expected: `package.json` ganha `"fflate"`; lock atualizado.

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
  eventosNaoAplicados: Array<{ arquivo: string; chave: string; tpEvento: string; cStat: string }>;
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

export class ErroDownloadIncompleto extends Error {
  constructor() { super('O download veio incompleto — gere o pacote de novo.'); this.name = 'ErroDownloadIncompleto'; }
}

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
/** 44 dígitos: 25 fixos + nNF (9) + 1 + cNF (8) + DV fictício (1). */
export const CHAVE = (n: number) => `2626091122233300018155001${String(n).padStart(9, '0')}1${String(n).padStart(8, '0')}0`;

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

export function evento(o: { n: number; tpEvento: '110111' | '110110'; cStat?: string; seq?: number; chaveRet?: string; semRet?: boolean }): string {
  const ch = CHAVE(o.n);
  const ret = o.semRet ? '' : `<retEvento versao="1.00"><infEvento><tpEvento>${o.tpEvento}</tpEvento><nSeqEvento>${o.seq ?? 1}</nSeqEvento>`
    + `<cStat>${o.cStat ?? '135'}</cStat><chNFe>${o.chaveRet ?? ch}</chNFe></infEvento></retEvento>`;
  return `<?xml version="1.0"?><procEventoNFe ${NS} versao="1.00"><evento versao="1.00"><infEvento>`
    + `<chNFe>${ch}</chNFe><tpEvento>${o.tpEvento}</tpEvento><nSeqEvento>${o.seq ?? 1}</nSeqEvento></infEvento></evento>${ret}</procEventoNFe>`;
}

export function inut(o: { ini: number; fim: number; cStat?: string; semRet?: boolean }): string {
  const ret = o.semRet ? '' : `<retInutNFe versao="4.00"><infInut><cStat>${o.cStat}</cStat><xMotivo>motivo ${o.cStat}</xMotivo></infInut></retInutNFe>`;
  return `<?xml version="1.0"?><procInutNFe ${NS} versao="4.00"><inutNFe versao="4.00"><infInut>`
    + `<serie>1</serie><nNFIni>${o.ini}</nNFIni><nNFFin>${o.fim}</nNFFin><xJust>Numero nao utilizado</xJust></infInut></inutNFe>${ret}</procInutNFe>`;
}

export const zip = (arquivos: Record<string, string>, level: 0 | 6 = 6) =>
  zipSync(Object.fromEntries(Object.entries(arquivos).map(([k, v]) => [k, strToU8(v)])), { level });
```

- [ ] **Step 4: Escrever os testes que falham** (`__tests__/ler.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { strToU8 } from 'fflate';
import { lerPacote, lerPacoteVazio } from '../ler';
import { crc32 } from '../zip-integro';
import { ErroDownloadIncompleto, totaisPorGrupo } from '../tipos';
import { nfe, evento, inut, zip, CHAVE } from './fixtures';

const SET = '2026-09';
const AGORA = new Date('2026-10-16T12:00:00-03:00');
const ler = (a: Record<string, string>, mes = SET) => lerPacote(zip(a), mes, AGORA);

describe('zip íntegro', () => {
  it('crc32 conhecido', () => { expect(crc32(strToU8('123456789'))).toBe(0xcbf43926); });
  it('zip truncado é rejeitado inteiro', () => {
    const z = zip({ 'x/a.xml': nfe({ n: 1 }) });
    expect(() => lerPacote(z.slice(0, z.length - 30), SET, AGORA)).toThrow(ErroDownloadIncompleto);
  });
  it('byte alterado com mesmo tamanho (zip sem compressão) é rejeitado pelo CRC', () => {
    const z = zip({ 'x/a.xml': nfe({ n: 1, vNF: '100.00' }) }, 0);
    const alvo = strToU8('<vNF>100.00');
    const i = z.findIndex((_, k) => alvo.every((b, j) => z[k + j] === b));
    expect(i).toBeGreaterThan(0);
    const corrompido = z.slice(); corrompido[i + 5] = '9'.charCodeAt(0);
    expect(() => lerPacote(corrompido, SET, AGORA)).toThrow(ErroDownloadIncompleto);
  });
  it('dois formatos reais de pasta, sem documentos fiscais', () => {
    const l = ler({ 'Emitidas_Mercado_Livre/NF-e de venda/XML/Autorizadas/a.xml': nfe({ n: 1 }),
      'Emitidas_ERP/NF-e de venda/XML/Autorizadas/b.xml': nfe({ n: 2 }) });
    expect(l.notas).toHaveLength(2);
    expect(lerPacote(zip({}), SET, AGORA).conferencia).toMatchObject({ totalArquivos: 0, vazio: false });
  });
});

describe('lerPacote', () => {
  it('lê venda com namespace, valores em centavos e chave como texto', () => {
    const l = ler({ 'p/a.xml': nfe({ n: 1, vProd: '62.19', vFrete: '5.10', vDesc: '1.00', vNF: '66.29' }) });
    expect(l.notas[0]).toMatchObject({ chave: CHAVE(1), numero: '1', serie: '1', tipo: 'venda', status: 'autorizada',
      produtosC: 6219, freteC: 510, descontoC: 100, totalC: 6629, competencia: SET, cartaCorrecao: false });
    expect(CHAVE(1)).toHaveLength(44);
    expect(l.conferencia.parcial).toBe(false);
  });
  it('complementar (finNFe 2) e devolução de venda (tpNF 0, finNFe 4, CFOP 1202, refNFe)', () => {
    const l = ler({ 'x/a.xml': nfe({ n: 1, finNFe: '2' }), 'x/b.xml': nfe({ n: 2, tpNF: '0', finNFe: '4', cfops: ['1202'], refNFe: CHAVE(9) }) });
    expect(l.notas.map((n) => n.tipo)).toEqual(['complementar', 'devolucao']);
  });
  it('transferências, remessas e CFOP misto vão para "outros"', () => {
    const l = ler({
      'x/a.xml': nfe({ n: 1, cfops: ['5949'] }), 'x/b.xml': nfe({ n: 2, cfops: ['5102', '5949'] }),
      'x/c.xml': nfe({ n: 3, cfops: ['5151'] }), 'x/d.xml': nfe({ n: 4, cfops: ['5408'] }), 'x/e.xml': nfe({ n: 5, cfops: ['5410'] }),
      'x/f.xml': nfe({ n: 6, tpNF: '0', finNFe: '4', cfops: ['1208'], refNFe: CHAVE(9) }), 'x/g.xml': nfe({ n: 7, cfops: ['5102', '5152'] }),
    });
    expect(l.notas).toHaveLength(0);
    expect(l.conferencia.outros).toHaveLength(7);
  });
  it('cancelamento homologado marca a nota; rejeitado e 136 (sem vínculo) não alteram', () => {
    const l = ler({ 'x/a.xml': nfe({ n: 1 }), 'x/b.xml': nfe({ n: 2 }), 'x/c.xml': nfe({ n: 3 }),
      'x/d.xml': evento({ n: 1, tpEvento: '110111', cStat: '135' }), 'x/e.xml': evento({ n: 2, tpEvento: '110111', cStat: '573' }),
      'x/f.xml': evento({ n: 3, tpEvento: '110111', cStat: '136' }) });
    expect(l.notas.map((n) => n.status)).toEqual(['cancelada', 'autorizada', 'autorizada']);
    expect(l.conferencia.eventosNaoAplicados.map((e) => e.cStat)).toEqual(['573', '136']);
  });
  it('evento sem retorno, ou com chave do retorno diferente, é incompleto (PARCIAL)', () => {
    const l = ler({ 'x/a.xml': nfe({ n: 1 }), 'x/b.xml': evento({ n: 1, tpEvento: '110111', semRet: true }),
      'x/c.xml': evento({ n: 1, tpEvento: '110111', chaveRet: CHAVE(8) }) });
    expect(l.notas[0].status).toBe('autorizada');
    expect(l.conferencia.incompletos.map((i) => i.arquivo)).toEqual(['x/b.xml', 'x/c.xml']);
    expect(l.conferencia.parcial).toBe(true);
  });
  it('cancelamento de nota que não está no zip vai para "cancelamento de nota de outro mês"', () => {
    const l = ler({ 'x/c.xml': evento({ n: 7, tpEvento: '110111' }) });
    expect(l.conferencia.cancelamentosOutroMes).toEqual([{ arquivo: 'x/c.xml', chave: CHAVE(7) }]);
  });
  it('CC-e só com 135; 155 em CC-e não vale', () => {
    const l = ler({ 'x/a.xml': nfe({ n: 1 }), 'x/b.xml': nfe({ n: 2 }),
      'x/c.xml': evento({ n: 1, tpEvento: '110110', seq: 2 }), 'x/d.xml': evento({ n: 2, tpEvento: '110110', cStat: '155' }) });
    expect(l.notas.map((n) => n.cartaCorrecao)).toEqual([true, false]);
  });
  it('inutilização homologada (102), rejeitada (203) e sem retorno (incompleta)', () => {
    const l = ler({ 'x/a.xml': inut({ ini: 1, fim: 1, cStat: '102' }), 'x/b.xml': inut({ ini: 2, fim: 2, cStat: '203' }),
      'x/c.xml': inut({ ini: 3, fim: 3, semRet: true }) });
    expect(l.conferencia.inutilizacoes.map((i) => [i.inicio, i.homologada, i.cStat])).toEqual([['1', true, '102'], ['2', false, '203']]);
    expect(l.conferencia.incompletos.map((i) => i.arquivo)).toEqual(['x/c.xml']);
  });
  it('denegada (cStat 110) vai para denegadas', () => {
    const l = ler({ 'x/a.xml': nfe({ n: 1, cStat: '110' }) });
    expect(l.notas).toHaveLength(0);
    expect(l.conferencia.denegadas[0].cStat).toBe('110');
  });
  it('chave repetida igual conta uma vez; divergente marca PARCIAL mesmo se a 2ª for outra classificação', () => {
    const a = nfe({ n: 1 });
    expect(ler({ 'p1/a.xml': a, 'p2/a.xml': a }).notas).toHaveLength(1);
    for (const outra of [nfe({ n: 1, vNF: '999.00' }), nfe({ n: 1, cfops: ['5949'] }), nfe({ n: 1, cStat: '110' })]) {
      const d = ler({ 'p1/a.xml': a, 'p2/a.xml': outra });
      expect(d.conferencia.divergentes).toEqual([CHAVE(1)]);
      expect(d.conferencia.parcial).toBe(true);
    }
  });
  it('XML ilegível, campo ausente e valor inválido marcam PARCIAL', () => {
    const l = ler({ 'x/a.xml': '<nfeProc><quebrado', 'x/b.xml': nfe({ n: 2, semCampo: 'vNF' }),
      'x/c.xml': nfe({ n: 3, vNF: 'abc' }), 'x/d.xml': nfe({ n: 4, vProd: '1.234' }), 'x/e.xml': nfe({ n: 5, vNF: '99999999999999.00' }) });
    expect(l.notas).toHaveLength(0);
    expect(l.conferencia.incompletos.map((i) => i.arquivo)).toEqual(['x/a.xml', 'x/b.xml', 'x/c.xml', 'x/d.xml', 'x/e.xml']);
    expect(l.conferencia.parcial).toBe(true);
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

- [ ] **Step 6: Implementar `zip-integro.ts`**

```ts
// ADR-0181 Plano 2a — abre o zip inteiro e confere estrutura, tamanho e CRC32 de cada entrada.
// fflate não confere CRC no unzip: CRC esperado vem do diretório central, lido aqui.
import { unzipSync } from 'fflate';
import { ErroDownloadIncompleto } from './tipos';

const TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(d: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = TABELA[(c ^ d[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const latin1 = (b: Uint8Array) => String.fromCharCode(...b);

/** nome → CRC32 do diretório central. Nome decodificado como o fflate: UTF-8 com o bit 11, senão latin1. */
// ponytail: sem ZIP64 (zips do ML medidos ≤ 12 MB / ~2.700 entradas). Upgrade: ler o EOCD64 se aparecer.
function crcsDoDiretorio(b: Uint8Array): Map<string, number> {
  const utf8 = new TextDecoder();
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (u32(b, i) !== 0x06054b50) continue;
    const total = u16(b, i + 10);
    let p = u32(b, i + 16);
    const m = new Map<string, number>();
    for (let k = 0; k < total; k++) {
      if (p + 46 > b.length || u32(b, p) !== 0x02014b50) throw new ErroDownloadIncompleto();
      const flags = u16(b, p + 8), crc = u32(b, p + 16), ln = u16(b, p + 28), le = u16(b, p + 30), lc = u16(b, p + 32);
      const bytesNome = b.subarray(p + 46, p + 46 + ln);
      m.set(flags & 0x800 ? utf8.decode(bytesNome) : latin1(bytesNome), crc);
      p += 46 + ln + le + lc;
    }
    return m;
  }
  throw new ErroDownloadIncompleto();
}

export function abrirZipIntegro(bytes: Uint8Array): Record<string, Uint8Array> {
  const crcs = crcsDoDiretorio(bytes);
  const declarado: Record<string, number> = {};
  let arquivos: Record<string, Uint8Array>;
  try {
    arquivos = unzipSync(bytes, { filter: (f) => { declarado[f.name] = f.originalSize; return true; } });
  } catch {
    throw new ErroDownloadIncompleto();
  }
  for (const [nome, dados] of Object.entries(arquivos)) {
    if (dados.length !== declarado[nome] || crcs.get(nome) !== crc32(dados)) throw new ErroDownloadIncompleto();
  }
  return Object.fromEntries(Object.entries(arquivos).filter(([n]) => !n.endsWith('/')));
}
```

- [ ] **Step 7: Implementar `ler.ts`**

```ts
// ADR-0181 Plano 2a — lê o zip do download em lote do ML. Classifica pelo CONTEÚDO (pastas variam).
import { abrirZipIntegro } from './zip-integro';
import type { Conferencia, LeituraPacote, NotaRelatorio } from './tipos';

// R6: listas explícitas. Venda de mercadoria (inclui ST 54xx/64xx de venda) e devolução de venda.
const CFOP_VENDA = new Set([
  '5101', '5102', '5103', '5104', '5105', '5106', '5109', '5110', '5111', '5112', '5113', '5114', '5115', '5116', '5117', '5118', '5119', '5120', '5122', '5123',
  '5401', '5402', '5403', '5405',
  '6101', '6102', '6103', '6104', '6105', '6106', '6107', '6108', '6109', '6110', '6111', '6112', '6113', '6114', '6115', '6116', '6117', '6118', '6119', '6120', '6122', '6123',
  '6401', '6402', '6403', '6404',
  '7101', '7102', '7105', '7106', '7127',
]);
const CFOP_DEVOLUCAO_VENDA = new Set(['1201', '1202', '1203', '1204', '1410', '1411', '2201', '2202', '2203', '2204', '2410', '2411']);
const AUTORIZADA = new Set(['100', '150']);
const DENEGADA = new Set(['110', '301', '302', '303']);
const OK_CANCELAMENTO = new Set(['135', '155']);
const OK_CCE = new Set(['135']);
const VALOR = /^\d{1,13}(\.\d{1,2})?$/;

const el = (n: Document | Element | null, tag: string): Element | null =>
  n ? n.getElementsByTagNameNS('*', tag)[0] ?? null : null;
const tx = (n: Document | Element | null, tag: string): string | null => el(n, tag)?.textContent?.trim() || null;

/** Decimal fiscal → centavos exatos (sem float). Ausente → 0; inválido → null. */
function centavos(s: string | null): number | null {
  if (s == null) return 0;
  if (!VALOR.test(s)) return null;
  const [int, dec = ''] = s.split('.');
  return Number(int) * 100 + Number(dec.padEnd(2, '0'));
}

const FMT_MES = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' });
export function competenciaSP(ms: number): string {
  const p = FMT_MES.formatToParts(new Date(ms));
  return `${p.find((x) => x.type === 'year')!.value}-${p.find((x) => x.type === 'month')!.value}`;
}

function conferenciaVazia(mes: string, agora: Date, vazio: boolean): Conferencia {
  return {
    mes, vazio, mesEmAndamento: competenciaSP(agora.getTime()) === mes, parcial: false, motivosParcial: [],
    totalArquivos: 0, contagem: {}, outros: [], denegadas: [], cancelamentosOutroMes: [], eventosNaoAplicados: [],
    inutilizacoes: [], incompletos: [], divergentes: [], foraDoPeriodo: [],
  };
}

export function lerPacoteVazio(mes: string, agora: Date = new Date()): LeituraPacote {
  return { notas: [], conferencia: conferenciaVazia(mes, agora, true), arquivos: {} };
}

export function lerPacote(bytes: Uint8Array, mes: string, agora: Date = new Date()): LeituraPacote {
  const arquivos = abrirZipIntegro(bytes);
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
    const doc = parser.parseFromString(texto, 'application/xml');   // um DOM por vez; sai de escopo a cada volta
    if (doc.getElementsByTagName('parsererror').length > 0) { incompleto(nome, 'XML ilegível'); continue; }
    const raiz = doc.documentElement.localName;

    if (raiz === 'nfeProc') {
      const ide = el(doc, 'ide');
      const tot = el(doc, 'ICMSTot');
      const chave = tx(el(doc, 'protNFe'), 'chNFe') ?? el(doc, 'infNFe')?.getAttribute('Id')?.replace(/^NFe/, '') ?? null;
      if (!chave || !/^\d{44}$/.test(chave)) { incompleto(nome, 'chave ausente ou inválida'); continue; }
      // Deduplica ANTES de qualquer desvio: a mesma chave com conteúdo diferente é sempre divergência.
      if (textoPorChave.has(chave)) {
        if (textoPorChave.get(chave) !== texto && !c.divergentes.includes(chave)) c.divergentes.push(chave);
        conta('duplicadas');
        continue;
      }
      textoPorChave.set(chave, texto);

      const campos = { dhEmi: tx(ide, 'dhEmi'), nNF: tx(ide, 'nNF'), serie: tx(ide, 'serie'), vNF: tx(tot, 'vNF') };
      const falta = (Object.keys(campos) as Array<keyof typeof campos>).filter((k) => !campos[k]);
      if (falta.length) { incompleto(nome, `campo ausente: ${falta.join(', ')}`); continue; }
      const cStat = tx(el(doc, 'protNFe'), 'cStat') ?? '';
      if (DENEGADA.has(cStat)) { c.denegadas.push({ arquivo: nome, chave, cStat }); conta('denegadas'); continue; }
      if (!AUTORIZADA.has(cStat)) { incompleto(nome, `nota sem autorização (cStat ${cStat || 'ausente'})`); continue; }
      const instante = Date.parse(campos.dhEmi!);
      if (Number.isNaN(instante)) { incompleto(nome, 'dhEmi inválida'); continue; }
      const valores = { produtosC: centavos(tx(tot, 'vProd')), freteC: centavos(tx(tot, 'vFrete')), descontoC: centavos(tx(tot, 'vDesc')), totalC: centavos(campos.vNF) };
      if (Object.values(valores).some((v) => v === null)) { incompleto(nome, 'valor fora do formato fiscal'); continue; }

      const tpNF = tx(ide, 'tpNF'); const fin = tx(ide, 'finNFe');
      const cfops = Array.from(doc.getElementsByTagNameNS('*', 'CFOP'), (e) => e.textContent?.trim() ?? '');
      const todos = (lista: Set<string>) => cfops.length > 0 && cfops.every((x) => lista.has(x));
      let tipo: NotaRelatorio['tipo'] | null = null;
      if (tpNF === '1' && (fin === '1' || fin === '2') && todos(CFOP_VENDA)) tipo = fin === '2' ? 'complementar' : 'venda';
      else if (tpNF === '0' && fin === '4' && el(ide, 'refNFe') && todos(CFOP_DEVOLUCAO_VENDA)) tipo = 'devolucao';
      if (!tipo) { c.outros.push({ arquivo: nome, chave, cfops }); conta('outros'); continue; }

      const competencia = competenciaSP(instante);
      if (competencia !== mes) { c.foraDoPeriodo.push({ chave, competencia }); conta('fora_do_periodo'); continue; }
      notas.set(chave, {
        chave, numero: campos.nNF!, serie: campos.serie!, emissao: campos.dhEmi!, instante, competencia, tipo,
        status: 'autorizada', produtosC: valores.produtosC!, freteC: valores.freteC!, descontoC: valores.descontoC!,
        totalC: valores.totalC!, cartaCorrecao: false, arquivo: nome,
      });
      conta(tipo);
    } else if (raiz === 'procEventoNFe') {
      const ped = el(el(doc, 'evento'), 'infEvento');
      const ret = el(el(doc, 'retEvento'), 'infEvento');
      const chave = tx(ped, 'chNFe') ?? '';
      const tpEvento = tx(ped, 'tpEvento') ?? '';
      if (!ret || !/^\d{44}$/.test(chave) || tx(ret, 'chNFe') !== chave || !tpEvento) { incompleto(nome, 'evento sem retorno ou com chave inconsistente'); continue; }
      const cStat = tx(ret, 'cStat') ?? '';
      if (tpEvento === '110111' && OK_CANCELAMENTO.has(cStat)) cancelamentos.push({ arquivo: nome, chave });
      else if (tpEvento === '110110' && OK_CCE.has(cStat)) cces.add(chave);
      else if (tpEvento === '110111' || tpEvento === '110110') { c.eventosNaoAplicados.push({ arquivo: nome, chave, tpEvento, cStat }); conta('eventos_nao_aplicados'); continue; }
      else c.outros.push({ arquivo: nome, chave, cfops: [] });
      conta('eventos');
    } else if (/inut/i.test(raiz)) {
      const ped = el(el(doc, 'inutNFe'), 'infInut');
      const ret = el(el(doc, 'retInutNFe'), 'infInut');
      const cStat = tx(ret, 'cStat');
      const campos = { serie: tx(ped, 'serie'), inicio: tx(ped, 'nNFIni'), fim: tx(ped, 'nNFFin') };
      if (!ret || !cStat || !campos.serie || !campos.inicio || !campos.fim) { incompleto(nome, 'inutilização sem retorno ou campos'); continue; }
      c.inutilizacoes.push({ arquivo: nome, serie: campos.serie, inicio: campos.inicio, fim: campos.fim,
        homologada: cStat === '102', cStat, motivo: tx(ret, 'xMotivo') ?? '' });
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

- [ ] **Step 8: Rodar e ver passar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/ler.test.ts`
Expected: PASS (todos). Ajustes só na fixture, nunca na regra.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/pacote-contador/
git commit -m "feat(adr-0181): leitura íntegra do zip de notas do ML para o pacote do contador"
```

---

### Task 2: Relatório xlsx (`relatorio-xlsx.ts`)

**Files:**
- Create: `src/lib/pacote-contador/cabecalho.ts`
- Create: `src/lib/pacote-contador/relatorio-xlsx.ts`
- Test: `src/lib/pacote-contador/__tests__/relatorio-xlsx.test.ts`

**Interfaces:**
- Consumes: `LeituraPacote`, `totaisPorGrupo`, `rotuloTipo`, `rotuloStatus`, `AVISOS_FIXOS` (Task 1).
- Produces: `interface Cabecalho { org: string; cnpj: string | null; contaMl: string; geradoEm: Date }`; `dataHoraBR(ms: number): string`; `reais(c: number): number`; `linhasConferencia(l: LeituraPacote, cab: Cabecalho): Array<[string, string]>`; `gerarRelatorioXlsx(l: LeituraPacote, cab: Cabecalho): Uint8Array`.

- [ ] **Step 1: Teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { gerarRelatorioXlsx } from '../relatorio-xlsx';
import { lerPacote, lerPacoteVazio } from '../ler';
import { nfe, zip, CHAVE } from './fixtures';

type Linha = Array<string | number>;
const CAB = { org: 'EMPRESA TESTE LTDA', cnpj: '11444777000161', contaMl: '123', geradoEm: new Date('2026-10-16T12:00:00-03:00') };
const AG = new Date('2026-10-16T12:00:00-03:00');
const abrir = (b: Uint8Array) => XLSX.read(b, { type: 'array' });
const linhas = (wb: XLSX.WorkBook, aba: string) => XLSX.utils.sheet_to_json<Linha>(wb.Sheets[aba], { header: 1, raw: true });

describe('gerarRelatorioXlsx', () => {
  it('abas Vendas e Conferência; chave como texto; ordem por data; totais', () => {
    const l = lerPacote(zip({ 'a.xml': nfe({ n: 2, dhEmi: '2026-09-20T10:00:00-03:00', vNF: '10.00' }),
      'b.xml': nfe({ n: 1, dhEmi: '2026-09-05T10:00:00-03:00', vNF: '20.50' }) }), '2026-09', AG);
    const wb = abrir(gerarRelatorioXlsx(l, CAB));
    expect(wb.SheetNames).toEqual(['Vendas', 'Conferência']);
    const rows = linhas(wb, 'Vendas');
    const iCab = rows.findIndex((r) => r[0] === 'Data de emissão');
    expect(rows[iCab]).toEqual(['Data de emissão', 'Tipo', 'Status', 'Número', 'Série', 'Chave', 'Produtos', 'Frete', 'Desconto', 'Total', 'Carta de correção']);
    expect(rows[iCab + 1][3]).toBe('1');
    expect(rows[iCab + 1][5]).toBe(CHAVE(1));
    expect(wb.Sheets.Vendas[XLSX.utils.encode_cell({ r: iCab + 1, c: 5 })].t).toBe('s');
    expect(rows[iCab + 1][9]).toBe(20.5);
    expect(rows.some((r) => r[0] === 'Vendas autorizadas' && r[1] === 2 && r[5] === 30.5)).toBe(true);
    const conf = linhas(wb, 'Conferência').flat().join(' | ');
    expect(conf).toContain('Conciliação com as vendas não incluída nesta versão.');
    expect(conf).toContain('11444777000161');
  });
  it('selo PACOTE PARCIAL no topo das duas abas', () => {
    const wb = abrir(gerarRelatorioXlsx(lerPacote(zip({ 'a.xml': '<x' }), '2026-09', AG), CAB));
    for (const aba of ['Vendas', 'Conferência']) expect(String(linhas(wb, aba)[0][0])).toMatch(/^PACOTE PARCIAL/);
  });
  it('mês vazio: "Nenhuma nota no mês" na Conferência', () => {
    const wb = abrir(gerarRelatorioXlsx(lerPacoteVazio('2026-09', AG), CAB));
    expect(linhas(wb, 'Conferência').flat().join(' ')).toContain('Nenhuma nota no mês');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/relatorio-xlsx.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `cabecalho.ts`** (compartilhado com o PDF; toda linha tem 2 colunas)

```ts
import { AVISOS_FIXOS, type LeituraPacote } from './tipos';

export interface Cabecalho { org: string; cnpj: string | null; contaMl: string; geradoEm: Date }

const FMT = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
export const dataHoraBR = (ms: number) => FMT.format(new Date(ms));
export const reais = (c: number) => c / 100;

/** Linhas da Conferência (aba do xlsx e página do PDF). Sempre [rótulo, valor] — o PDF depende das 2 colunas. */
export function linhasConferencia(l: LeituraPacote, cab: Cabecalho): Array<[string, string]> {
  const c = l.conferencia;
  const out: Array<[string, string]> = [];
  if (c.parcial) out.push([`PACOTE PARCIAL — ${c.motivosParcial.join('; ')}`, '']);
  out.push(['Organização', cab.org], ['CNPJ', cab.cnpj ?? '—'], ['Conta Mercado Livre', cab.contaMl],
    ['Mês', c.mes], ['Gerado em', dataHoraBR(cab.geradoEm.getTime())], ['Arquivos no download', String(c.totalArquivos)]);
  if (c.vazio) out.push(['Nenhuma nota no mês', '']);
  if (c.mesEmAndamento) out.push(['Mês em andamento — o pacote fica incompleto até o fim do mês.', '']);
  for (const a of AVISOS_FIXOS) out.push([a, '']);
  for (const [k, v] of Object.entries(c.contagem).sort()) out.push([`Quantidade: ${k}`, String(v)]);
  const secao = (titulo: string, itens: Array<[string, string]>) => { if (itens.length) out.push(['', ''], [titulo, ''], ...itens); };
  secao('Outros documentos fiscais (não são venda)', c.outros.map((o) => [o.chave || o.arquivo, o.cfops.join(', ')]));
  secao('Notas denegadas', c.denegadas.map((d) => [d.chave, `cStat ${d.cStat}`]));
  secao('Cancelamento de nota de outro mês', c.cancelamentosOutroMes.map((x) => [x.chave, x.arquivo]));
  secao('Eventos não aplicados', c.eventosNaoAplicados.map((e) => [e.chave, `evento ${e.tpEvento} · cStat ${e.cStat}`]));
  secao('Inutilizações', c.inutilizacoes.map((i) => [`série ${i.serie} · ${i.inicio}–${i.fim}`, `${i.homologada ? 'homologada' : 'rejeitada'} (cStat ${i.cStat}) ${i.motivo}`.trim()]));
  secao('Arquivos ilegíveis ou incompletos', c.incompletos.map((i) => [i.arquivo, i.motivo]));
  secao('Chaves com conteúdo divergente', c.divergentes.map((ch) => [ch, '']));
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
  const aoa: Array<Array<string | number>> = [];
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
  const vendas = XLSX.utils.aoa_to_sheet(aoa);   // strings viram células 't: s' — chave de 44 dígitos fica texto
  for (const ref of Object.keys(vendas)) {
    if (ref.startsWith('!')) continue;
    const cel = vendas[ref] as XLSX.CellObject;
    if (cel.t === 'n' && !Number.isInteger(cel.v)) cel.z = '#,##0.00';
  }
  vendas['!cols'] = [{ wch: 16 }, { wch: 13 }, { wch: 11 }, { wch: 10 }, { wch: 6 }, { wch: 46 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 }];

  const conf = XLSX.utils.aoa_to_sheet(linhasConferencia(l, cab));
  conf['!cols'] = [{ wch: 60 }, { wch: 60 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, vendas, 'Vendas');
  XLSX.utils.book_append_sheet(wb, conf, 'Conferência');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/relatorio-xlsx.test.ts`
Expected: PASS (3 testes).

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

const CAB = { org: 'EMPRESA TESTE LTDA', cnpj: '11444777000161', contaMl: '98765', geradoEm: new Date('2026-10-16T12:00:00-03:00') };
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
  it('parcial: selo, motivo, CNPJ e conta ML continuam na Conferência; bytes %PDF', () => {
    const l = lerPacote(zip({ 'quebrado.xml': '<x' }), '2026-09', AG);
    const texto = montarRelatorioPdf(l, CAB).output();
    expect(texto).toContain('PACOTE PARCIAL');
    expect(texto).toContain('11444777000161');
    expect(texto).toContain('98765');
    expect(texto).toContain('quebrado.xml');
    expect(new TextDecoder().decode(gerarRelatorioPdf(l, CAB).slice(0, 4))).toBe('%PDF');
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
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });   // compress: false (padrão)
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
  // 2 colunas explícitas: se a 1ª linha (selo PARCIAL) tivesse 1 célula, o autotable inferiria 1 coluna e cortaria os valores.
  autoTable(doc, {
    startY: 16,
    columns: [{ header: '', dataKey: 0 }, { header: '', dataKey: 1 }],
    showHead: 'never',
    body: linhasConferencia(l, cab),
    styles: { fontSize: 8 },
    columnStyles: { 0: { cellWidth: 140 } },
  });
  return doc;
}

export function gerarRelatorioPdf(l: LeituraPacote, cab: Cabecalho): Uint8Array {
  return new Uint8Array(montarRelatorioPdf(l, cab).output('arraybuffer'));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/lib/pacote-contador/__tests__/relatorio-pdf.test.ts`
Expected: PASS. Se a tipagem de `columns`/`dataKey` numérico não compilar no `tsc`, troque por `body: linhas.map(([a, b]) => ({ a, b }))` com `columns: [{ dataKey: 'a' }, { dataKey: 'b' }]` — mantendo o teste.

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
- Consumes: `LeituraPacote`, `ErroDownloadIncompleto` (Task 1).
- Produces:
  - `type ResultadoDownload = { tipo: 'zip'; bytes: Uint8Array; contaMl: string } | { tipo: 'vazio'; contaMl: string }`
  - `class ErroPacote extends Error { status: number }`
  - `baixarNotasMes(mes: string, orgEsperada: string, signal?: AbortSignal): Promise<ResultadoDownload>` — corpo cortado → `ErroDownloadIncompleto`; `AbortError` repassado.
  - `montarPacote(l: LeituraPacote, xlsx: Uint8Array, pdf: Uint8Array): Uint8Array`; `nomePacote(mes: string): string`; `salvarArquivo(nome: string, bytes: Uint8Array, tipo: string): void`; `mesesDisponiveis(agora: Date, n?: number): string[]`; `mesAnteriorSP(agora: Date): string`

- [ ] **Step 1: Testes que falham**

`__tests__/baixar.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } } }));
import { baixarNotasMes, ErroPacote } from '../baixar';
import { ErroDownloadIncompleto } from '../tipos';
import { zip, nfe } from './fixtures';

const resp = (body: BodyInit | null, init: ResponseInit) => new Response(body, init);
const ZIPH = (org = 'org-1') => ({ 'Content-Type': 'application/octet-stream', 'X-Org-Id': org, 'X-Conta-Ml': '99' });
beforeEach(() => { vi.unstubAllGlobals(); });

describe('baixarNotasMes', () => {
  it('preserva os bytes de um zip real e devolve a conta', async () => {
    const bytes = zip({ 'a.xml': nfe({ n: 1 }) });
    const f = vi.fn<typeof fetch>(async () => resp(bytes, { status: 200, headers: ZIPH() }));
    vi.stubGlobal('fetch', f);
    const r = await baixarNotasMes('2026-09', 'org-1');
    expect(r).toEqual({ tipo: 'zip', bytes, contaMl: '99' });
    expect(String(f.mock.calls[0][0])).toMatch(/\/functions\/v1\/baixar-notas-venda$/);
    expect(f.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer tok' });
  });
  it('org divergente recusa', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => resp(new Uint8Array([1]), { status: 200, headers: ZIPH('org-2') })));
    await expect(baixarNotasMes('2026-09', 'org-1')).rejects.toThrow('A organização mudou durante o download — gere o pacote de novo.');
  });
  it('vazio e erro com mensagem do servidor', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => resp(JSON.stringify({ vazio: true }), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Org-Id': 'org-1', 'X-Conta-Ml': '99' } })));
    expect(await baixarNotasMes('2026-09', 'org-1')).toEqual({ tipo: 'vazio', contaMl: '99' });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => resp(JSON.stringify({ error: 'limite' }), { status: 429, headers: { 'Content-Type': 'application/json' } })));
    const e = await baixarNotasMes('2026-09', 'org-1').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroPacote);
    expect(e).toMatchObject({ message: 'limite', status: 429 });
  });
  it('corpo cortado no meio vira ErroDownloadIncompleto; cancelamento continua AbortError', async () => {
    const quebrado = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([0x50, 0x4b])); c.error(new TypeError('terminated')); } });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => resp(quebrado, { status: 200, headers: ZIPH() })));
    await expect(baixarNotasMes('2026-09', 'org-1')).rejects.toBeInstanceOf(ErroDownloadIncompleto);
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new DOMException('cancelado', 'AbortError'); }));
    await expect(baixarNotasMes('2026-09', 'org-1')).rejects.toMatchObject({ name: 'AbortError' });
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
import { ErroDownloadIncompleto } from './tipos';

export type ResultadoDownload = { tipo: 'zip'; bytes: Uint8Array; contaMl: string } | { tipo: 'vazio'; contaMl: string };
export class ErroPacote extends Error {
  constructor(message: string, public status: number) { super(message); this.name = 'ErroPacote'; }
}
const ehAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError';

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
    const j = await r.json().catch(() => null);
    if (j?.vazio === true) return { tipo: 'vazio', contaMl };
    throw new ErroPacote('Não foi possível confirmar as notas do mês.', 502);
  }
  try {
    return { tipo: 'zip', bytes: new Uint8Array(await r.arrayBuffer()), contaMl };
  } catch (e) {
    if (ehAbort(e)) throw e;
    throw new ErroDownloadIncompleto();   // stream cortado depois do 200
  }
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
Expected: PASS.

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
  - `POST { mes: 'AAAA-MM' }` → `200 application/octet-stream` (zip) **ou** `200 application/json {vazio:true}`, ambos com `X-Org-Id`, `X-Conta-Ml` e `Access-Control-Expose-Headers: X-Org-Id, X-Conta-Ml`; erro → JSON `{ error }` com CORS e status 400/401/403/409/429/502.
  - `intervaloDoMes(mes: string, agora: Date): { start: string; end: string } | { erro: string }`
  - `urlLote(conta: string, start: string, end: string): string`
  - `interface DepsNotasVenda { travar(chave, ttlS): Promise<boolean>; liberar(chave, cooldownS): Promise<void>; token(): Promise<string>; fetchMl(url, token, signal): Promise<Response> }`
  - `baixarLoteMes(deps, p: { conexaoId: string; conta: string; mes: string; agora: Date; signal: AbortSignal; prazoMs?: number }): Promise<SaidaNotas>`

- [ ] **Step 1: Teste que falha**

```ts
import { describe, it, expect, vi } from 'vitest';
import { intervaloDoMes, urlLote, baixarLoteMes, type DepsNotasVenda } from '../processar';

const AG = new Date('2026-10-16T12:00:00-03:00');
const INDISP = 'Mercado Livre indisponível — o pacote não foi gerado.';
const AMBIG = 'Não foi possível confirmar as notas do mês.';

/** Trava em memória com a mesma semântica do Redis (SET NX / SET EX). */
function deps(resposta: () => Promise<Response>, token: () => Promise<string> = async () => 'TOK') {
  const chaves = new Map<string, number>();
  const d = {
    travar: vi.fn(async (k: string, ttl: number) => { if (chaves.has(k)) return false; chaves.set(k, ttl); return true; }),
    liberar: vi.fn(async (k: string, s: number) => { chaves.set(k, s); }),
    token: vi.fn(token),
    fetchMl: vi.fn(async (_u: string, _t: string, _s: AbortSignal) => resposta()),
  } satisfies DepsNotasVenda;
  return { d, chaves };
}
const p = (extra: Partial<Parameters<typeof baixarLoteMes>[1]> = {}) =>
  ({ conexaoId: 'cx1', conta: '123', mes: '2026-09', agora: AG, signal: new AbortController().signal, ...extra });
const zipResp = () => new Response(new Uint8Array([0x50, 0x4b, 3, 4]), { status: 200, headers: { 'Content-Type': 'application/zip' } });
const ler = async (s: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(s).arrayBuffer());

describe('intervaloDoMes e urlLote', () => {
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
  it('trava durante o stream inteiro; cooldown de 60 s só ao terminar', async () => {
    const { d, chaves } = deps(async () => zipResp());
    const r1 = await baixarLoteMes(d, p());
    expect(r1.tipo).toBe('zip');
    expect(d.travar).toHaveBeenCalledWith('lock:notas-venda:cx1', 460);
    const r2 = await baixarLoteMes(d, p());       // primeiro stream ainda aberto
    expect(r2).toEqual({ tipo: 'erro', status: 429, mensagem: 'Já há um download de notas desta conta em andamento ou recém-feito — aguarde alguns minutos.' });
    expect(d.fetchMl).toHaveBeenCalledTimes(1);
    expect(d.liberar).not.toHaveBeenCalled();
    if (r1.tipo !== 'zip') throw new Error('esperava zip');
    expect(await ler(r1.body)).toEqual(new Uint8Array([0x50, 0x4b, 3, 4]));
    expect(d.liberar).toHaveBeenCalledWith('lock:notas-venda:cx1', 60);
    expect(chaves.get('lock:notas-venda:cx1')).toBe(60);
  });
  it('resposta não-zip depois de travar também deixa cooldown', async () => {
    const { d } = deps(async () => new Response('', { status: 404 }));
    expect(await baixarLoteMes(d, p())).toEqual({ tipo: 'vazio' });
    expect(d.liberar).toHaveBeenCalledWith('lock:notas-venda:cx1', 60);
  });
  it('mapeia status do ML', async () => {
    const caso = async (r: () => Promise<Response>) => baixarLoteMes(deps(r).d, p());
    expect(await caso(async () => new Response('{"x":1}', { status: 404 }))).toEqual({ tipo: 'erro', status: 502, mensagem: AMBIG });
    expect(await caso(async () => new Response('Invalid input.', { status: 400 }))).toEqual({ tipo: 'erro', status: 502, mensagem: AMBIG });
    expect(await caso(async () => new Response(null, { status: 200, headers: { 'Content-Type': 'application/zip' } }))).toEqual({ tipo: 'erro', status: 502, mensagem: AMBIG });
    expect(await caso(async () => new Response('', { status: 200, headers: { 'Content-Type': 'application/zip' } }))).toEqual({ tipo: 'erro', status: 502, mensagem: AMBIG });
    expect(await caso(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))).toEqual({ tipo: 'erro', status: 502, mensagem: AMBIG });
    expect(await caso(async () => new Response('', { status: 429 }))).toEqual({ tipo: 'erro', status: 429, mensagem: 'O Mercado Livre limitou os downloads — tente de novo em alguns minutos (cerca de 5).' });
    expect(await caso(async () => new Response('', { status: 403 }))).toEqual({ tipo: 'erro', status: 409, mensagem: 'A conta do Mercado Livre não autorizou o download das notas.' });
    expect(await caso(async () => new Response('', { status: 503 }))).toEqual({ tipo: 'erro', status: 502, mensagem: INDISP });
    expect(await caso(async () => { throw new Error('rede'); })).toEqual({ tipo: 'erro', status: 502, mensagem: INDISP });
  });
  it('sinal já abortado: não trava nem chama o ML', async () => {
    const { d } = deps(async () => zipResp());
    const ac = new AbortController(); ac.abort();
    expect(await baixarLoteMes(d, p({ signal: ac.signal }))).toEqual({ tipo: 'erro', status: 502, mensagem: INDISP });
    expect(d.travar).not.toHaveBeenCalled();
    expect(d.fetchMl).not.toHaveBeenCalled();
  });
  it('prazo cobre token pendente, headers sem bytes e 404 sem fim', async () => {
    const nunca = () => new Promise<never>(() => {});
    const semBytes = () => Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200, headers: { 'Content-Type': 'application/zip' } }));
    const corpo404 = () => Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 404 }));
    for (const [resp, tok] of [[async () => zipResp(), nunca], [semBytes, undefined], [corpo404, undefined]] as const) {
      const { d } = deps(resp, tok);
      expect(await baixarLoteMes(d, p({ prazoMs: 30 }))).toEqual({ tipo: 'erro', status: 502, mensagem: INDISP });
      expect(d.liberar).toHaveBeenCalledWith('lock:notas-venda:cx1', 60);
    }
  });
  it('cancelar o corpo libera a trava com cooldown', async () => {
    const { d } = deps(async () => new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1])); } }), { status: 200, headers: { 'Content-Type': 'application/zip' } }));
    const r = await baixarLoteMes(d, p());
    if (r.tipo !== 'zip') throw new Error('esperava zip');
    await r.body.cancel('cliente saiu');
    expect(d.liberar).toHaveBeenCalledWith('lock:notas-venda:cx1', 60);
  });
  it('mês inválido não trava nem chama o ML', async () => {
    const { d } = deps(async () => zipResp());
    expect(await baixarLoteMes(d, p({ mes: '2026-12' }))).toMatchObject({ tipo: 'erro', status: 400 });
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
  liberar(chave: string, cooldownS: number): Promise<void>;
  token(): Promise<string>;
  fetchMl(url: string, token: string, signal: AbortSignal): Promise<Response>;
}
export type SaidaNotas =
  | { tipo: 'zip'; body: ReadableStream<Uint8Array> }
  | { tipo: 'vazio' }
  | { tipo: 'erro'; status: number; mensagem: string };

const INDISPONIVEL = 'Mercado Livre indisponível — o pacote não foi gerado.';
const AMBIGUO = 'Não foi possível confirmar as notas do mês.';
// ponytail: 120 s para token + headers + 1º chunk (o gateway corta em 150 s sem começar a responder). Medido: 30–56 s
// para ~1.400 vendas/mês. Loja bem maior → dividir o mês em quinzenas (o `stream` aceita), ao custo de mais cota.
const PRAZO_MS = 120_000;
// R1: trava enquanto houver download (460 s > teto de 400 s da edge) e 60 s de cooldown ao terminar.
const TRAVA_S = 460;
const COOLDOWN_S = 60;

const FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' });
function mesSP(d: Date): string {
  const x = FMT.formatToParts(d);
  return `${x.find((q) => q.type === 'year')!.value}-${x.find((q) => q.type === 'month')!.value}`;
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

/** Repassa o corpo já com o 1º chunk lido; `fim` roda uma vez (fim, erro ou cancelamento). */
function encadear(primeiro: Uint8Array, reader: ReadableStreamDefaultReader<Uint8Array>, fim: () => Promise<void>): ReadableStream<Uint8Array> {
  let enviado = false;
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      if (!enviado) { enviado = true; c.enqueue(primeiro); return; }
      try {
        const { done, value } = await reader.read();
        if (done) { await fim(); c.close(); } else c.enqueue(value);
      } catch (e) { await fim(); c.error(e); }
    },
    async cancel(motivo) { await reader.cancel(motivo).catch(() => {}); await fim(); },
  });
}

async function interpretar(r: Response, fim: () => Promise<void>): Promise<SaidaNotas> {
  if (r.status === 200) {
    const tipo = r.headers.get('Content-Type') ?? '';
    if (!r.body || !/zip|octet-stream/.test(tipo)) { await r.body?.cancel().catch(() => {}); return { tipo: 'erro', status: 502, mensagem: AMBIGUO }; }
    const reader = r.body.getReader();
    const { done, value } = await reader.read();
    if (done || !value || value.length === 0) { await reader.cancel().catch(() => {}); return { tipo: 'erro', status: 502, mensagem: AMBIGUO }; }
    return { tipo: 'zip', body: encadear(value, reader, fim) };
  }
  if (r.status === 404) return (await r.text()) === '' ? { tipo: 'vazio' } : { tipo: 'erro', status: 502, mensagem: AMBIGUO };
  await r.body?.cancel().catch(() => {});
  if (r.status === 429) return { tipo: 'erro', status: 429, mensagem: 'O Mercado Livre limitou os downloads — tente de novo em alguns minutos (cerca de 5).' };
  if (r.status === 401 || r.status === 403) return { tipo: 'erro', status: 409, mensagem: 'A conta do Mercado Livre não autorizou o download das notas.' };
  if (r.status >= 500) return { tipo: 'erro', status: 502, mensagem: INDISPONIVEL };
  return { tipo: 'erro', status: 502, mensagem: AMBIGUO };
}

export async function baixarLoteMes(
  deps: DepsNotasVenda,
  p: { conexaoId: string; conta: string; mes: string; agora: Date; signal: AbortSignal; prazoMs?: number },
): Promise<SaidaNotas> {
  const iv = intervaloDoMes(p.mes, p.agora);
  if ('erro' in iv) return { tipo: 'erro', status: 400, mensagem: iv.erro };
  if (p.signal.aborted) return { tipo: 'erro', status: 502, mensagem: INDISPONIVEL };
  const chave = `lock:notas-venda:${p.conexaoId}`;
  if (!(await deps.travar(chave, TRAVA_S))) {
    return { tipo: 'erro', status: 429, mensagem: 'Já há um download de notas desta conta em andamento ou recém-feito — aguarde alguns minutos.' };
  }

  const ctl = new AbortController();
  const cancelar = () => ctl.abort();
  p.signal.addEventListener('abort', cancelar, { once: true });   // navegador cancelou → aborta o ML, inclusive no corpo
  let encerrado = false;
  const fim = async () => {
    if (encerrado) return;
    encerrado = true;
    p.signal.removeEventListener('abort', cancelar);
    await deps.liberar(chave, COOLDOWN_S).catch(() => {});
  };
  const abortado = new Promise<never>((_, rej) => ctl.signal.addEventListener('abort', () => rej(new Error('abortado')), { once: true }));
  abortado.catch(() => {});
  const prazo = setTimeout(cancelar, p.prazoMs ?? PRAZO_MS);

  try {
    const token = await Promise.race([deps.token(), abortado]);
    const r = await Promise.race([deps.fetchMl(urlLote(p.conta, iv.start, iv.end), token, ctl.signal), abortado]);
    const saida = await Promise.race([interpretar(r, fim), abortado]);
    clearTimeout(prazo);
    if (saida.tipo !== 'zip') { ctl.abort(); await fim(); }
    return saida;
  } catch {
    clearTimeout(prazo);
    ctl.abort();
    await fim();
    return { tipo: 'erro', status: 502, mensagem: INDISPONIVEL };
  }
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
import { redisSet, redisSetNX } from '../_shared/redis/client.ts';
import { baixarLoteMes } from './processar.ts';

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extra } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let ctx: Awaited<ReturnType<typeof requireUserOrg>>;
  try { ctx = await requireUserOrg(req, { access: 'read' }); }
  catch (resp) {
    if (resp instanceof Response) {   // requireUserOrg devolve sem CORS — o navegador precisa ler o erro
      return new Response(resp.body, { status: resp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    throw resp;
  }
  const admin = adminClient();

  try {
    if (!(await exigirModulo(admin, ctx.orgId, 'estoque'))) return json({ error: 'Módulo de estoque não habilitado.' }, 403);
    const conexao = await resolverConexao(admin, ctx.orgId, 'mercado_livre');
    if (!conexao?.contaExternaId) return json({ error: 'Conecte a conta do Mercado Livre em Canais.' }, 409);

    const body: unknown = await req.json().catch(() => null);
    const mes = body && typeof body === 'object' && typeof (body as { mes?: unknown }).mes === 'string' ? (body as { mes: string }).mes : '';
    const alvo = { type: 'notas_venda_mes', id: mes || 'invalido' };

    const saida = await baixarLoteMes({
      travar: (chave, ttl) => redisSetNX(chave, '1', ttl),
      liberar: (chave, s) => redisSet(chave, '1', s),
      token: () => getValidAccessTokenConexao(conexao),
      fetchMl: (url, token, signal) => fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal }),
    }, { conexaoId: conexao.id, conta: conexao.contaExternaId, mes, agora: new Date(), signal: req.signal });

    if (saida.tipo === 'erro') {
      await auditarOperacaoSuporte(admin, ctx, alvo, 'failed').catch(() => {});
      return json({ error: saida.mensagem }, saida.status);
    }
    try {
      await auditarOperacaoSuporte(admin, ctx, alvo, 'succeeded');   // antes de liberar os bytes
    } catch {
      if (saida.tipo === 'zip') await saida.body.cancel('auditoria falhou').catch(() => {});
      return json({ error: 'Não foi possível registrar a auditoria do suporte — o pacote não foi liberado.' }, 502);
    }
    const ident = {
      'X-Org-Id': ctx.orgId, 'X-Conta-Ml': conexao.contaExternaId,
      'Access-Control-Expose-Headers': 'X-Org-Id, X-Conta-Ml',
    };
    if (saida.tipo === 'vazio') return json({ vazio: true }, 200, ident);
    return new Response(saida.body, { status: 200, headers: { ...corsHeaders, ...ident, 'Content-Type': 'application/octet-stream' } });
  } catch (e) {
    console.error('baixar_notas_venda_falhou', String(e));   // Redis, banco ou token fora do caminho previsto
    return json({ error: 'Mercado Livre indisponível — o pacote não foi gerado.' }, 502);
  }
});
```

- [ ] **Step 6: Bloco no `supabase/config.toml`** (logo após `[functions.importar-nota-compra]`)

```toml
# ADR-0181 Plano 2a — pacote do contador (vendas): repassa o zip de notas do ML (JWT do app, gate estoque).
[functions.baixar-notas-venda]
verify_jwt = true
```

- [ ] **Step 7: Checar tipos e lint do Deno**

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
- Consumes: `baixarNotasMes`, `ErroPacote` (Task 4); `lerPacote`, `lerPacoteVazio` (Task 1); `gerarRelatorioXlsx` (Task 2); `gerarRelatorioPdf` (Task 3); `montarPacote`, `nomePacote`, `salvarArquivo`, `mesesDisponiveis`, `mesAnteriorSP` (Task 4); `effectiveOrgId()` de `src/stores/support-store.ts`.
- Produces: `<CardPacoteContador razaoSocial={string | null} cnpj={string | null} />`.

- [ ] **Step 1: Teste que falha**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

let orgAtual = 'org-1';
vi.mock('@/stores/support-store', () => ({ effectiveOrgId: () => orgAtual }));
const baixar = vi.fn();
vi.mock('@/lib/pacote-contador/baixar', async (orig) => ({ ...(await orig<object>()), baixarNotasMes: (...a: unknown[]) => baixar(...a) }));
const salvar = vi.fn();
vi.mock('@/lib/pacote-contador/montar', async (orig) => ({ ...(await orig<object>()), salvarArquivo: (...a: unknown[]) => salvar(...a) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { toast } from 'sonner';
import { CardPacoteContador } from '../card-pacote-contador';
import { ErroPacote } from '@/lib/pacote-contador/baixar';

beforeEach(() => { orgAtual = 'org-1'; baixar.mockReset(); salvar.mockReset(); vi.mocked(toast.error).mockReset(); });

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
  it('org trocada durante o download não salva', async () => {
    baixar.mockImplementationOnce(async () => { orgAtual = 'org-2'; return { tipo: 'vazio', contaMl: '99' }; });
    render(<CardPacoteContador razaoSocial={null} cnpj={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Baixar pacote' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('A organização mudou durante o download — gere o pacote de novo.'));
    expect(salvar).not.toHaveBeenCalled();
  });
  it('desmontar durante o processamento não salva', async () => {
    let soltar: (v: unknown) => void = () => {};
    baixar.mockImplementationOnce(() => new Promise((r) => { soltar = r; }));
    const { unmount } = render(<CardPacoteContador razaoSocial={null} cnpj={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Baixar pacote' }));
    unmount();
    soltar({ tipo: 'vazio', contaMl: '99' });
    await new Promise((r) => setTimeout(r, 20));
    expect(salvar).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/components/estoque/pacote-contador/__tests__/card-pacote-contador.test.tsx`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar o card**

```tsx
// ADR-0181 Plano 2a — pacote do contador (vendas): XMLs do ML do mês + relatório xlsx/pdf, montado no navegador.
// R4: em suporte somente leitura o AppShell desabilita os controles (fieldset) — exportar exige suporte "full".
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { effectiveOrgId } from '@/stores/support-store';
import { baixarNotasMes, ErroPacote } from '@/lib/pacote-contador/baixar';
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
  const atual = useRef<AbortController | null>(null);
  useEffect(() => () => atual.current?.abort(), []);

  async function gerar() {
    const org = effectiveOrgId();
    if (!org) { toast.error('Organização não identificada — recarregue a página.'); return; }
    const ctl = new AbortController();
    atual.current = ctl;
    // Depois de cada espera: componente desmontado → para; org trocada (suporte) → recusa.
    const conferir = () => {
      ctl.signal.throwIfAborted();
      if (effectiveOrgId() !== org) throw new ErroPacote('A organização mudou durante o download — gere o pacote de novo.', 409);
    };
    try {
      setEtapa('baixando');
      const r = await baixarNotasMes(mes, org, ctl.signal);
      conferir();
      setEtapa('lendo'); await respirar(); conferir();
      const leitura = r.tipo === 'vazio' ? lerPacoteVazio(mes) : lerPacote(r.bytes, mes);
      setEtapa('montando'); await respirar(); conferir();
      const cab = { org: razaoSocial ?? `Organização ${org}`, cnpj, contaMl: r.contaMl, geradoEm: new Date() };
      const pacote = montarPacote(leitura, gerarRelatorioXlsx(leitura, cab), gerarRelatorioPdf(leitura, cab));
      conferir();
      salvarArquivo(nomePacote(mes), pacote, 'application/zip');
      if (leitura.conferencia.parcial) toast.error('Pacote gerado como PARCIAL — veja a aba Conferência.');
      else toast.success(leitura.conferencia.vazio ? 'Nenhuma nota no mês — pacote gerado com o relatório vazio.' : `Pacote de ${mes} gerado.`);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') toast.error(e instanceof Error ? e.message : 'Não foi possível gerar o pacote.');
    } finally {
      if (!ctl.signal.aborted) setEtapa('ocioso');
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

Import junto aos de `importar-nota`:
```tsx
import { CardPacoteContador } from '@/components/estoque/pacote-contador/card-pacote-contador';
```
E logo antes de `<SecaoNotasCompra destacarChave={chaveDestacada} />`:
```tsx
<CardPacoteContador razaoSocial={empresaFiscal?.razao_social ?? null} cnpj={empresaFiscal?.cnpj ?? null} />
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm vitest run src/components/estoque/pacote-contador/__tests__/card-pacote-contador.test.tsx src/pages`
Expected: PASS (inclusive testes já existentes de `Estoque`, se houver).

- [ ] **Step 6: Commit**

```bash
git add src/components/estoque/pacote-contador/ src/pages/Estoque.tsx
git commit -m "feat(adr-0181): card Pacote do contador em /estoque"
```

---

### Task 7: Docs, spec reconciliada e portão final

**Files:**
- Modify: `docs/superpowers/specs/2026-10-16-pacote-contador-vendas-design.md` (reconciliar com R1, R2, R4–R7)
- Modify: `docs/decisions/0181-entrada-por-nota-de-compra-e-pacote-do-contador.md`
- Modify: `docs/reference/edge-functions.md`, `docs/TASKS.md`, `docs/project-status.md`, `obsidian-vault/03-Módulos/Fiscal.md`, `obsidian-vault/03-Módulos/Estoque.md`

- [ ] **Step 1: Spec** — trocar as regras pelas do plano: trava "460 s + cooldown 60 s ao terminar" (R1); CRC32 do diretório central (R2); suporte read não exporta (R4); `x-region` não enviado (R5); listas explícitas de CFOP de venda e de devolução de venda (R6, copiar as duas listas de `ler.ts`); CC-e booleana, só cStat 135 (R7); cancelamento aceito 135/155; 136 = evento não aplicado; inutilização/evento sem retorno = incompleto; valores no formato `^\d{1,13}(\.\d{1,2})?$`.

- [ ] **Step 2: ADR-0181** — sob D-13, adicionar (redação neutra, repo público, sem dados de cliente):

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

- [ ] **Step 3: `edge-functions.md`, `TASKS.md`, `project-status.md`, vault** — uma entrada curta cada, no formato das vizinhas, citando ADR-0181 Plano 2a. Em `TASKS.md`, trocar `- [ ] Deploy das edges (...)` do Plano 1 por `- [x]`.

- [ ] **Step 4: Portão**

Run: `pnpm preflight`
Expected: verde (testes; lint/check do backend; `tsc -b`; build).

- [ ] **Step 5: Commit**

```bash
git add docs/ obsidian-vault/
git commit -m "docs(adr-0181): Plano 2a — pacote do contador (vendas)"
```

---

### Task 8 (pós-merge autorizado pelo Diego): deploy e validação em runtime

Só depois de "merge"/"deploy" explícito do Diego. Revisão pré-merge do Grok 4.7 xhigh antes.

- [ ] **Step 1:** `supabase functions deploy baixar-notas-venda --project-ref txvncrgkoynoxwopfkbp` (sem `--no-verify-jwt`); conferir `verify_jwt=true` e versão ACTIVE; `curl` sem Authorization → 401. Front sobe pelo Render após o merge.
- [ ] **Step 2:** org DSA, conta VALIDATION (já membro; nenhuma conexão alterada), app em produção: gerar setembro; anotar tempo até o primeiro byte e total; abrir o zip e o xlsx; erro de autenticação visível na tela (CORS nos erros).
- [ ] **Step 3:** conferência independente: nº de NF-e de venda autorizadas × pedidos pagos de `ml_vendas` da DSA no mês (diferença explicada); 5 notas sorteadas conferidas campo a campo contra o XML.
- [ ] **Step 4:** duplo clique / segunda aba durante o download → mensagem da trava local; depois de terminar, nova tentativa antes de 60 s → trava; depois de 60 s → libera.
- [ ] **Step 5:** filtro sem CT-e não perde nada fiscal: uma chamada direta (token, só GET) do mesmo mês com `others=all`, ≥ 5 min depois; mesmas NF-e, cancelamentos e CC-e, só CT-e a mais. Se divergir, voltar a `others=all` (ajuste na Task 5 + teste).
- [ ] **Step 6:** segunda loja (leitura direta autorizada, token só GET, sem login): `lerPacote` sobre o zip de um mês real → contagens por classificação coerentes com a pasta do ML e tempo de leitura no navegador anotado.
- [ ] **Step 7:** apagar todos os zips de teste do tmp (dados de clientes); registrar resultados no ADR-0181.
