// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';

it('selo some do card quando o resultado deixa de autorizar (ok → sem vínculo)', async () => {
  document.body.innerHTML = `<div class="poly-card">
    <a class="poly-component__title" href="https://www.mercadolivre.com.br/p/MLB100#wid=MLB5321956667">Sabonete</a>
    <div><div class="poly-component__price">R$ 19,90</div></div></div>`;
  let ouvinte: (m: unknown) => void = () => {};
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => {}), onMessage: { addListener: (f: typeof ouvinte) => { ouvinte = f; } } } });
  await import('../busca');
  const ok = { itemId: 'MLB5321956667', estado: 'ok', codigo: '81', margem: { classico: { estado: 'ok', valor: { margemPct: 10.9 } } } };
  ouvinte({ tipo: 'publiai:busca-resultados', resultados: { MLB5321956667: ok } });
  expect(document.querySelectorAll('.publiai-selo-busca')).toHaveLength(1);
  ouvinte({ tipo: 'publiai:busca-resultados', resultados: { MLB5321956667: { itemId: 'MLB5321956667', estado: 'sem_vinculo' } } });
  expect(document.querySelectorAll('.publiai-selo-busca')).toHaveLength(0);
});
