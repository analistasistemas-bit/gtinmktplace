import { describe, it, expect } from 'vitest';
import { montarMensagemLead, leadValido } from '../mensagem.ts';

const base = {
  nome: 'Maria', email: 'maria@x.com', empresa: 'Loja X', whatsapp: '(81) 98342-6557', vende: 'Sim',
  produto_1_descricao: 'Garrafa térmica', produto_1_ean: '7891234567890', produto_1_custo: '32,90',
  produto_1_peso_gramas: '380', produto_1_altura_cm: '25', produto_1_largura_cm: '8', produto_1_comprimento_cm: '8',
  produto_2_descricao: 'Copo', produto_2_ean: '', produto_2_custo: '18,50',
  produto_2_peso_gramas: '', produto_2_altura_cm: '', produto_2_largura_cm: '', produto_2_comprimento_cm: '',
  produto_3_descricao: '', o_que_quer_descobrir: 'Margem',
};

describe('montarMensagemLead', () => {
  it('lista contato, link de WhatsApp com DDI e só os produtos preenchidos', () => {
    const m = montarMensagemLead(base);
    expect(m).toContain('Maria · Loja X');
    expect(m).toContain('https://wa.me/5581983426557');
    expect(m).toContain('1. Garrafa térmica · EAN 7891234567890 · R$ 32,90 · 380 g · 25×8×8 cm');
    expect(m).toContain('2. Copo · R$ 18,50');
    expect(m).not.toContain('3.');
    expect(m).toContain('Margem');
  });

  it('não duplica o DDI quando o número já vem com 55', () => {
    expect(montarMensagemLead({ ...base, whatsapp: '+55 81 98342-6557' })).toContain('https://wa.me/5581983426557');
  });
});

describe('leadValido', () => {
  it('exige nome, e-mail e ao menos o produto 1', () => {
    expect(leadValido(base)).toBe(true);
    expect(leadValido({ ...base, produto_1_descricao: ' ' })).toBe(false);
    expect(leadValido({ ...base, email: '' })).toBe(false);
  });
});
