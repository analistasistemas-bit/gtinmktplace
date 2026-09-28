import { describe, expect, it } from 'vitest';
import { formatarNomeProduto, normalizarParaBusca } from '../texto';

describe('formatarNomeProduto', () => {
  it('nome todo em maiúsculas vira iniciais maiúsculas, conectivos em minúscula', () => {
    expect(formatarNomeProduto('LAPIS COMUM FANTASIA POTE C/72UND')).toBe('Lapis Comum Fantasia Pote C/72UND');
    expect(formatarNomeProduto('FRANJA 5CM 100%FIBRA DE POLI 5MT OURO')).toBe('Franja 5CM 100%FIBRA de Poli 5MT Ouro');
    expect(formatarNomeProduto('FITA DE CETIM P/ PRESENTE AZUL-MARINHO')).toBe('Fita de Cetim p/ Presente Azul-Marinho');
    expect(formatarNomeProduto('ÁGUA E SABÃO')).toBe('Água e Sabão');
  });
  it('siglas conhecidas ficam em maiúsculas; conectivo no início é capitalizado', () => {
    expect(formatarNomeProduto('PLACA DE EVA COM LED')).toBe('Placa de EVA com LED');
    expect(formatarNomeProduto('DE VOLTA AO LAR')).toBe('De Volta ao Lar');
  });
  it('nome que já tem minúsculas fica como está', () => {
    expect(formatarNomeProduto('Tecido Oxford Liso de 10m PVC')).toBe('Tecido Oxford Liso de 10m PVC');
    expect(formatarNomeProduto('Verde Musgo')).toBe('Verde Musgo');
  });
  it('vazio e nulo', () => {
    expect(formatarNomeProduto(null)).toBe('');
    expect(formatarNomeProduto('')).toBe('');
    expect(formatarNomeProduto('123')).toBe('123');
  });
});

describe('normalizarParaBusca', () => {
  it('remove acentos comuns do português e converte para minúsculas', () => {
    expect(normalizarParaBusca('Macarrão')).toBe('macarrao');
    expect(normalizarParaBusca('CALÇA')).toBe('calca');
    expect(normalizarParaBusca('Órgão Público')).toBe('orgao publico');
    expect(normalizarParaBusca('Épico')).toBe('epico');
    expect(normalizarParaBusca('Açaí com Granola')).toBe('acai com granola');
  });

  it('lida com strings sem acento mantendo o conteúdo em minúsculas', () => {
    expect(normalizarParaBusca('macarrao')).toBe('macarrao');
    expect(normalizarParaBusca('TESTE')).toBe('teste');
  });

  it('trata nulo, indefinido e vazio com segurança', () => {
    expect(normalizarParaBusca('')).toBe('');
    expect(normalizarParaBusca(null)).toBe('');
    expect(normalizarParaBusca(undefined)).toBe('');
    expect(normalizarParaBusca('   ')).toBe('');
  });

  it('faz trim de espaços externos mas preserva internos', () => {
    expect(normalizarParaBusca('  Fita Métrica  ')).toBe('fita metrica');
  });

  it('é idempotente (normalizar duas vezes produz o mesmo resultado)', () => {
    const texto = 'Toalha de Algodão Felpuda 100% Bebê';
    const umaVez = normalizarParaBusca(texto);
    expect(normalizarParaBusca(umaVez)).toBe(umaVez);
  });
});
