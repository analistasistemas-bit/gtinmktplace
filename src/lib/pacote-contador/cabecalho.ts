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
  if (c.indisponivel) out.push([c.indisponivel, '']);
  if (c.mesEmAndamento) out.push(['Mês em andamento — o pacote fica incompleto até o fim do mês.', '']);
  for (const a of AVISOS_FIXOS) out.push([a, '']);
  for (const a of c.avisos ?? []) out.push([a, '']);
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
