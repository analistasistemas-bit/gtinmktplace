// "Minha margem" da Extensão PubliAI (ADR-0189 D-7). Função pura, sem I/O.
import { round2 } from '../dinheiro.ts';
import type { Disponivel, EntradaMargem, EntradaMargemTipo, MargemTipo, MinhaMargem } from './tipos.ts';

function calcularTipo(e: EntradaMargem, t: EntradaMargemTipo): Disponivel<MargemTipo> {
  const { aliquotaPct, custoPacote, preco } = e;
  if (aliquotaPct.estado === 'indisponivel') return aliquotaPct;
  if (t.comissao.estado === 'indisponivel') return t.comissao;
  if (t.frete.estado === 'indisponivel') return t.frete;

  const c = t.comissao.valor;
  // Valor pronto do ML só se for número de verdade: null/NaN cairia em round2 → comissão zero.
  const comissao = typeof c.saleFeeAmount === 'number' && Number.isFinite(c.saleFeeAmount) && c.precoConsultado === preco
    ? round2(c.saleFeeAmount)
    : round2(preco * c.percentual / 100 + c.fixa);
  const imposto = round2(preco * aliquotaPct.valor / 100);
  const frete = round2(t.frete.valor);
  const recebe = round2(preco - comissao - imposto - frete);

  const avisos = [aliquotaPct.aviso, t.comissao.aviso, t.frete.aviso].filter((a): a is string => !!a);
  let custo: number | null = null;
  if (custoPacote?.estado === 'ok') {
    custo = custoPacote.valor;
    if (custoPacote.aviso) avisos.push(custoPacote.aviso);
  } else if (custoPacote?.estado === 'indisponivel') {
    avisos.push(custoPacote.motivo);
  }
  const lucro = custo === null ? null : round2(recebe - custo);
  const margemPct = lucro === null ? null : round2(lucro / preco * 100);

  return { estado: 'ok', valor: { comissao, imposto, frete, custo, recebe, lucro, margemPct, avisos } };
}

export function calcularMinhaMargem(e: EntradaMargem): MinhaMargem {
  return { preco: e.preco, classico: calcularTipo(e, e.classico), premium: calcularTipo(e, e.premium) };
}
