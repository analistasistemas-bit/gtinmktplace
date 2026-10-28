// Montagem do chat estilo WhatsApp da aba Mensagens: separadores de dia e cauda do balão.

type MsgChat = { direcao: 'recebida' | 'enviada'; data_ml: string | null };

export type LinhaChat<M extends MsgChat> =
  | { tipo: 'dia'; chave: string; rotulo: string }
  | { tipo: 'msg'; m: M; cauda: boolean };

const chaveDia = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** "Hoje", "Ontem" ou dd/mm/aaaa, no fuso do navegador. */
export function rotuloDia(iso: string, agora: Date = new Date()): string {
  const d = new Date(iso);
  const ontem = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 1);
  if (chaveDia(d) === chaveDia(agora)) return 'Hoje';
  if (chaveDia(d) === chaveDia(ontem)) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Mensagens em ordem cronológica → linhas do chat. A cauda marca a 1ª de cada sequência do
 *  mesmo lado; um dia novo reinicia a sequência, como no WhatsApp. */
export function linhasDoChat<M extends MsgChat>(mensagens: M[], agora: Date = new Date()): LinhaChat<M>[] {
  const linhas: LinhaChat<M>[] = [];
  let dia: string | null = null;
  let anterior: M['direcao'] | null = null;
  for (const m of mensagens) {
    if (m.data_ml) {
      const k = chaveDia(new Date(m.data_ml));
      if (k !== dia) {
        dia = k;
        anterior = null;
        linhas.push({ tipo: 'dia', chave: k, rotulo: rotuloDia(m.data_ml, agora) });
      }
    }
    linhas.push({ tipo: 'msg', m, cauda: m.direcao !== anterior });
    anterior = m.direcao;
  }
  return linhas;
}

/** Nome do comprador para o cabeçalho. Conta PJ/MEI no ML costuma vir com nome = sobrenome =
 *  razão social, e o sync concatena os dois: "X X" vira "X". */
export function nomeComprador(nome: string | null, nick: string | null): string {
  const n = nome?.trim().replace(/\s+/g, ' ') ?? '';
  const metade = n.length % 2 === 1 ? n.slice(0, (n.length - 1) / 2) : '';
  if (metade && n === `${metade} ${metade}`) return metade;
  return n || nick?.trim() || 'Comprador';
}
