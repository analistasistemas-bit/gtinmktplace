export const dataBR = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

// Calendário fixo de São Paulo (os blocos novos): um instante às 02:00Z ainda é o dia anterior.
const DIA_MES = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
const DIA_MES_HORA = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
export const diaMesBRT = (d: string | Date = new Date()) => DIA_MES.format(new Date(d));
export const diaMesHoraBRT = (d: string) => DIA_MES_HORA.format(new Date(d));
export const pctBR = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')}%`;
const DIA = 86_400_000;

/** Tempo desde a 1ª venda: dias até 2 meses, depois meses, depois anos e meses. */
export function idadeComercial(desde: string, agora = Date.now()): string {
  const dias = Math.max(0, Math.floor((agora - Date.parse(desde)) / DIA));
  if (dias < 1) return 'desde hoje';
  if (dias < 60) return `${dias} ${dias === 1 ? 'dia' : 'dias'}`;
  const meses = Math.floor(dias / 30.44);
  if (meses < 12) return `${meses} meses`;
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  const a = `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
  return resto ? `${a} e ${resto} ${resto === 1 ? 'mês' : 'meses'}` : a;
}
