import { describe, expect, it } from 'vitest';
import { instrucoesPorCliente } from '../agentes-clientes';

const CHAVE = `pai_ab12cd34_${'x'.repeat(43)}`;
const URL = 'https://mcp.exemplo.test';

describe('instrucoesPorCliente', () => {
  const clientes = instrucoesPorCliente(CHAVE, URL);
  const valores = (id: string) => clientes.find((c) => c.id === id)!.passos.flatMap((p) => (p.valor ? [p.valor] : []));

  it('cobre os 5 clientes validados, sem ChatGPT (só OAuth)', () => {
    expect(clientes.map((c) => c.id)).toEqual(['claude-ai', 'claude-code', 'grok', 'openbot', 'muse']);
  });

  it('clientes de formulário recebem URL, nome do cabeçalho e o valor com Bearer prontos', () => {
    for (const id of ['claude-ai', 'grok', 'openbot']) {
      expect(valores(id)).toEqual([URL, 'Authorization', `Bearer ${CHAVE}`]);
    }
  });

  it('Claude Code: a chave entra por leitura oculta, nunca no comando (não vai para o histórico do terminal)', () => {
    const [ler, comando, chave] = valores('claude-code');
    expect(ler).toBe('read -rs PUBLIAI_CHAVE');
    expect(comando).toBe(`claude mcp add --transport http -s user publiai ${URL} --header "Authorization: Bearer $PUBLIAI_CHAVE" && unset PUBLIAI_CHAVE`);
    expect(comando).not.toContain(CHAVE);
    expect(chave).toBe(CHAVE);
  });

  it('Muse: a mensagem do chat nunca leva a chave; o valor vai só para a página segura', () => {
    const [mensagem, valor] = valores('muse');
    expect(mensagem).toContain(URL);
    expect(mensagem).not.toContain(CHAVE);
    expect(valor).toBe(`Bearer ${CHAVE}`);
  });
});
