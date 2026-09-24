import { describe, expect, it } from 'vitest';
import {
  abaDa, ateQuantoDaLinha, corDeReferencia, descontoPct, ehCupom, emLeitura, filtrarItens, prazoUrgente,
  rotuloSemLiquido, rotuloTipo, sincronizandoAgora, type CorProjetada, type ItemPromocao,
} from '../promocoes';

const agora = Date.parse('2026-10-06T12:00:00Z');
const dia = 86_400_000;
const cor = (o: Partial<CorProjetada>): CorProjetada => ({
  variation_id: null, cor: null, sku: null, custo: 10, piso: 20, origem: 'nacional', liquido: 25,
  ate_quanto: null, ate_quanto_motivo: null, semaforo: 'verde', motivo: null, ...o,
});
const item = (projecao: CorProjetada[], pior: ItemPromocao['pior_semaforo']) =>
  ({ projecao, pior_semaforo: pior }) as ItemPromocao;

describe('abas', () => {
  it('started → ativas, pending → futuras, finished nos últimos 30 dias → encerradas', () => {
    expect(abaDa({ status: 'started', fim: null }, agora)).toBe('ativas');
    expect(abaDa({ status: 'pending', fim: null }, agora)).toBe('futuras');
    expect(abaDa({ status: 'finished', fim: new Date(agora - 10 * dia).toISOString() }, agora)).toBe('encerradas');
    expect(abaDa({ status: 'finished', fim: new Date(agora - 31 * dia).toISOString() }, agora)).toBeNull();
  });
  it('fim já passou vira encerrada mesmo com status velho', () => {
    expect(abaDa({ status: 'started', fim: new Date(agora - dia).toISOString() }, agora)).toBe('encerradas');
  });
  it('leitura em curso só vale por 30 min (a reserva do worker)', () => {
    expect(emLeitura({ rodada_em_curso: new Date(agora - 60_000).toISOString() }, agora)).toBe(true);
    expect(emLeitura({ rodada_em_curso: new Date(agora - 31 * 60_000).toISOString() }, agora)).toBe(false);
    expect(emLeitura({ rodada_em_curso: null }, agora)).toBe(false);
  });
});

describe('rótulos e números', () => {
  it('cupom e tipos', () => {
    expect(ehCupom('SELLER_COUPON_CAMPAIGN')).toBe(true);
    expect(rotuloTipo('LIGHTNING')).toBe('Relâmpago');
    expect(rotuloTipo('XYZ')).toBe('XYZ');
  });
  it('desconto % arredondado', () => {
    expect(descontoPct(59.9, 49.9)).toBe(17);
    expect(descontoPct(null, 49.9)).toBeNull();
  });
  it('prazo urgente = adesão em até 48 h e ainda aberta', () => {
    expect(prazoUrgente(new Date(agora + 47 * 3_600_000).toISOString(), agora)).toBe(true);
    expect(prazoUrgente(new Date(agora + 49 * 3_600_000).toISOString(), agora)).toBe(false);
    expect(prazoUrgente(new Date(agora - 1000).toISOString(), agora)).toBe(false);
    expect(prazoUrgente(null, agora)).toBe(false);
  });
});

describe('linha da tabela', () => {
  it('cor de referência = a pior cor com líquido (menor líquido no empate)', () => {
    const it0 = item([cor({ cor: 'Azul', liquido: 30 }), cor({ cor: 'Rosa', liquido: 5, semaforo: 'vermelho' }), cor({ cor: 'Verde', liquido: null, semaforo: 'indisponivel' })], 'vermelho');
    expect(corDeReferencia(it0)?.cor).toBe('Rosa');
    expect(corDeReferencia(item([cor({ liquido: null, semaforo: 'indisponivel' })], 'indisponivel'))).toBeNull();
  });
  it('até quanto do anúncio = o maior entre as cores (tem que servir a todas)', () => {
    expect(ateQuantoDaLinha(item([cor({ ate_quanto: 40 }), cor({ ate_quanto: 44 })], 'verde'))).toEqual({ valor: 44, motivo: null });
    expect(ateQuantoDaLinha(item([cor({ ate_quanto: 40 }), cor({ ate_quanto_motivo: 'nenhum' })], 'verde'))).toEqual({ valor: null, motivo: 'nenhum' });
    expect(ateQuantoDaLinha(item([cor({ ate_quanto_motivo: 'qualquer' }), cor({ ate_quanto_motivo: 'qualquer' })], 'verde'))).toEqual({ valor: null, motivo: 'qualquer' });
    expect(ateQuantoDaLinha(item([cor({ ate_quanto_motivo: 'qualquer' }), cor({ ate_quanto: 41 })], 'verde'))).toEqual({ valor: 41, motivo: null });
    expect(ateQuantoDaLinha(item([cor({})], 'verde'))).toEqual({ valor: null, motivo: null });
  });
  it('rótulo sem líquido: "Sem custo" só quando falta cadastro/custo em todas as cores', () => {
    expect(rotuloSemLiquido(item([cor({ liquido: null, motivo: 'sem_cadastro' })], 'indisponivel'))).toBe('Sem custo no PubliAI');
    expect(rotuloSemLiquido(item([cor({ liquido: null, motivo: 'erro_tarifa' })], 'indisponivel'))).toBe('Sem líquido');
  });
});

describe('filtrarItens', () => {
  const it2 = (id: string, status: string, pior: ItemPromocao['pior_semaforo']) =>
    ({ ml_item_id: id, status, pior_semaforo: pior, projecao: [] }) as unknown as ItemPromocao;
  const itens = [it2('A', 'candidate', 'verde'), it2('B', 'started', 'vermelho'), it2('C', 'candidate', 'vermelho'), it2('D', 'pending', 'verde')];
  it('convidados × participando e semáforo', () => {
    expect(filtrarItens(itens, { semaforo: null, participando: false }).map((i) => i.ml_item_id)).toEqual(['A', 'C']);
    expect(filtrarItens(itens, { semaforo: null, participando: true }).map((i) => i.ml_item_id)).toEqual(['B', 'D']);
    expect(filtrarItens(itens, { semaforo: 'vermelho', participando: false }).map((i) => i.ml_item_id)).toEqual(['C']);
  });
});

describe('sincronizandoAgora', () => {
  const e = (estado: 'sincronizando' | 'ok', iniciado_em: string | null) =>
    ({ estado, iniciado_em, ultimo_ok_em: null, ultimo_erro_em: null, erro: null });
  it('só vale se começou há < 5 min', () => {
    expect(sincronizandoAgora(e('sincronizando', new Date(agora - 4 * 60_000).toISOString()), agora)).toBe(true);
    expect(sincronizandoAgora(e('sincronizando', new Date(agora - 6 * 60_000).toISOString()), agora)).toBe(false);
    expect(sincronizandoAgora(e('sincronizando', null), agora)).toBe(false);
    expect(sincronizandoAgora(e('ok', new Date(agora).toISOString()), agora)).toBe(false);
    expect(sincronizandoAgora(null, agora)).toBe(false);
  });
});
