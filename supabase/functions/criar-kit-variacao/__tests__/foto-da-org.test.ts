import { describe, expect, it } from 'vitest';
import { fotoDaOrg } from '../processar.ts';

// O storage-js monta a URL sem codificar o path e o fetch segue a WHATWG URL: `%2e%2e`/`.%2e`/`%2e.` viram `..` e
// `\` vira `/`. Qualquer coisa fora da lista de caracteres por segmento recusa (nunca lê objeto de outra org).
const usuarios = new Set(['u1']);
describe('fotoDaOrg', () => {
  it('nomes legítimos passam (lote, capa, upload do operador, kit-variacao-ia, prévia -tN, legado por usuário)', () => {
    for (const p of [
      'org-1/lote/00CODIGO.jpg', 'org-1/lote/CAPA_00CODIGO.jpeg', 'org-1/kits/Preto_e_Branco-foto_1.png',
      'org-1/kit-variacao-ia/11111111-1111-4111-8111-111111111111.png', 'org-1/kit-variacao-ia/11111111-1111-4111-8111-111111111111-t2.webp',
      'u1/9c1e8a12-0000-4000-8000-000000000000/CAPA2_00123.jpg', 'org-1/lote/foto (1).jpg', 'org-1/lote/a b.jpg',
    ]) expect(fotoDaOrg(p, 'org-1', usuarios), p).toBe(true);
  });

  it('travessia codificada, barra invertida, % e caracteres de controle recusam', () => {
    for (const p of [
      'org-1/../org-2/x.jpg', 'org-1/./x.jpg', 'org-1/%2e%2e/org-2/lote/x.jpg', 'org-1/%2E./org-2/x.jpg', 'org-1/.%2e/org-2/x.jpg',
      'org-1/..\\org-2\\x.jpg', 'org-1/a\\b.jpg', 'org-1/x%00.jpg', 'org-1/x\u0000.jpg', 'org-1/x\n.jpg', 'org-1/x\t.jpg',
      'org-1/%2F../x.jpg', 'org-1/x.jpg?y=1', 'org-1/x.jpg#z', 'org-1//x.jpg', '/org-1/x.jpg', 'org-1', 'org-2/lote/x.jpg',
      'org-1/lote/çã.jpg',
    ]) expect(fotoDaOrg(p, 'org-1', usuarios), JSON.stringify(p)).toBe(false);
  });
});
