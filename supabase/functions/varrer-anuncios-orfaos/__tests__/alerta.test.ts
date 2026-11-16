import { describe, expect, it } from 'vitest';
import { montarAlertaOrfaos, type OrfaoBruto } from '../alerta.ts';

const item = (id: string, classe: OrfaoBruto['classe'], extra: Partial<OrfaoBruto> = {}): OrfaoBruto => ({
  ml_item_id: id, titulo: `Produto ${id}`, status: 'active', permalink: `https://ml/${id}`,
  classe, provavel_remocao_pelo_app: false, ...extra,
});

describe('montarAlertaOrfaos', () => {
  it('sem divergência → null (externo, catálogo e provável Remover não avisam)', () => {
    const orfaos = [
      item('MLB1', 'externo'),
      item('MLB2', 'catalogo_sem_vinculo'),
      item('MLB3', 'perdido_do_app', { status: 'paused', provavel_remocao_pelo_app: true }),
    ];
    expect(montarAlertaOrfaos('Zaven', { orfaos, total_no_ml: 50, truncado: false })).toBeNull();
  });

  it('lista só os perdidos do app, com org, id, título e link', () => {
    const orfaos = [item('MLB10', 'perdido_do_app'), item('MLB11', 'perdido_do_app'), item('MLB12', 'externo')];
    const texto = montarAlertaOrfaos('Zaven', { orfaos, total_no_ml: 80, truncado: false })!;
    expect(texto).toContain('Zaven');
    expect(texto).toContain('2 anúncios');
    for (const id of ['MLB10', 'MLB11']) {
      expect(texto).toContain(id);
      expect(texto).toContain(`Produto ${id}`);
      expect(texto).toContain(`https://ml/${id}`);
    }
    expect(texto).not.toContain('MLB12');
    expect(texto).not.toContain('parcial');
  });

  it('varredura truncada avisa que foi parcial', () => {
    const texto = montarAlertaOrfaos('Avil', { orfaos: [item('MLB20', 'perdido_do_app')], total_no_ml: 1000, truncado: true })!;
    expect(texto).toContain('1 anúncio');
    expect(texto).toContain('parcial');
  });
});
