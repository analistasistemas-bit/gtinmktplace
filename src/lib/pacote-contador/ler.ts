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
const CFOP_DEVOLUCAO_VENDA = new Set(['1201', '1202', '1203', '1204', '1410', '1411', '2201', '2202', '2203', '2204', '2410', '2411', '3201', '3202', '3211']);
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
      const seq = tx(ped, 'nSeqEvento');
      const cStat = tx(ret, 'cStat');
      // tpEvento/nSeqEvento do retorno são conferidos quando presentes (o leiaute permite omiti-los).
      const tpRet = tx(ret, 'tpEvento'), seqRet = tx(ret, 'nSeqEvento');
      if (!ret || !/^\d{44}$/.test(chave) || tx(ret, 'chNFe') !== chave || !tpEvento || !seq || !cStat
        || (tpRet !== null && tpRet !== tpEvento) || (seqRet !== null && seqRet !== seq)) {
        incompleto(nome, 'evento sem retorno ou inconsistente com o pedido'); continue;
      }
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
