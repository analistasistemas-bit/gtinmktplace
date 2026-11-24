// ADR-0210, Emenda 1: instruções prontas por cliente, mostradas uma vez ao criar a chave. Cada campo já vem no formato
// que o cliente aceitou no teste real de 2026-11-23 (docs/reference/acesso-de-agentes.md, "Como conectar").

export type Passo = { texto: string; valor?: string };
export type ClienteAgente = { id: string; nome: string; passos: Passo[] };

export function instrucoesPorCliente(chave: string, url: string): ClienteAgente[] {
  const bearer = `Bearer ${chave}`;
  return [
    {
      id: 'claude-ai', nome: 'claude.ai',
      passos: [
        { texto: 'Configurações › Conectores › Adicionar conector personalizado. Nome: PubliAI.' },
        { texto: 'URL do servidor:', valor: url },
        { texto: 'Autenticação: marque “Sem login” (o aviso de que o servidor exigiu login pode ser ignorado).' },
        { texto: 'Cabeçalhos de requisição › Adicionar cabeçalho. Nome:', valor: 'Authorization' },
        { texto: 'Valor:', valor: bearer },
        { texto: 'Vale também para o chat do Claude Desktop, que usa os conectores da conta.' },
      ],
    },
    {
      id: 'claude-code', nome: 'Claude Code',
      passos: [
        {
          texto: 'Rode no terminal e abra uma sessão nova:',
          valor: `claude mcp add --transport http -s user publiai ${url} --header "Authorization: ${bearer}"`,
        },
      ],
    },
    {
      id: 'grok', nome: 'Grok Bot',
      passos: [
        { texto: 'Adicionar um conector personalizado › Tipo: HTTPS remoto. Nome: PubliAI.' },
        { texto: 'URL do servidor:', valor: url },
        { texto: 'Cabeçalhos HTTP › Chave:', valor: 'Authorization' },
        { texto: 'Valor:', valor: bearer },
        { texto: 'Deixe “ID do cliente” vazio e clique em Adicionar plugin.' },
      ],
    },
    {
      id: 'openbot', nome: 'OpenBot',
      passos: [
        { texto: 'Conectar a um MCP personalizado › escolha Streamable HTTP. Nome: PubliAI.' },
        { texto: 'URL do servidor:', valor: url },
        { texto: 'Cabeçalhos › Chave:', valor: 'Authorization' },
        { texto: 'Valor:', valor: bearer },
        { texto: 'Deixe “App de login” vazio, clique em Testar conexão (4 ferramentas) e em Salvar.' },
      ],
    },
    {
      id: 'muse', nome: 'Muse',
      passos: [
        {
          texto: 'Cole esta mensagem no chat do Muse (ela não contém a chave):',
          valor: `Quero adicionar um MCP remoto. Nome: PubliAI. URL: ${url}. Transporte: streamable HTTP. ` +
            'Autenticação: cabeçalho Authorization; vou digitar o valor completo na página segura e você o envia ' +
            'exatamente como guardado, sem acrescentar nada. Sem OAuth. Depois teste chamando publiai_loja.',
        },
        { texto: 'Na página segura que o Muse abrir, cole (nunca no chat):', valor: bearer },
      ],
    },
  ];
}
