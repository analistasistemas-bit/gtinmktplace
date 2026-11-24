# ADR-0210 — Acesso de agentes: servidor MCP, conexão por organização, leitura de margens, em três fatias

**Status:** Aceito — fatia 1 em produção, em piloto na Zaven (main `12d00860`, deploy e aceite em 2026-11-22); fatias 2 e 3 a implementar (aprovado pelo Diego em 2026-11-22, após entrevista grill-with-docs e revisão de Codex gpt-6.2-sol high e Grok 4.7 xhigh). Plano da fatia 1: `docs/superpowers/plans/2026-11-22-acesso-de-agentes-fatia-1.md`
**Data:** 2026-11-22
**Decisores:** Diego
**Relaciona:** [0027](0027-multi-tenancy-organizations.md) (organização), [0092](0092-identidade-da-plataforma-e-acesso-super-admin.md) (acesso da plataforma a dados de cliente), [0179](0179-painel-de-ads.md) (ACOS de equilíbrio pelo preço, emenda de 2026-10-20), [0170](0170-central-de-promocoes-ml.md) (projeção do líquido), [0055](0055-imposto-por-origem-nacional-importado.md) e [0208](0208-aliquota-com-vigencia.md) (imposto), [0189](0189-extensao-publiai-navegador.md) (precedente de cliente fora do app).
**Glossário:** `CONTEXT.md` § Acesso de agentes.

> O número 0209 não foi usado: já é citado no repositório como a decisão da capa de kit com modelos.

---

## Contexto

O PubliAI não tem API para terceiros: as edge functions atendem o front com o JWT do usuário. O Diego quer que agentes (claude.ai, ChatGPT, Grok, Hermes, OpenClaw, OpenBot, Muse) leiam e, mais tarde, escrevam. A necessidade imediata é o agente definir orçamento e ROAS no Mercado Ads sem passar da margem do produto.

Fatos levantados:

- **A RLS não protege este caminho.** Sem sessão de usuário, a edge roda com service role; o isolamento entre organizações depende do código.
- **O cálculo existe no backend:** `equilibrioDoMlb` (`supabase/functions/_shared/ads/campanhas.ts`). Recebe o preço por parâmetro, usa o custo resolvido do pacote (`resolverPack`, com escala de kit ou recusa `pacote_a_conferir`), a alíquota atual por origem e a tarifa do Mercado Livre. Devolve a margem **em pontos percentuais, sem arredondar**, da **pior cor de um anúncio**, ou um motivo quando falta dado.
- **O "ID do Product Ads" é o identificador de família do Mercado Livre**, já gravado em `ml_ads_grupo.external_id` (tipo FAMILY) e em `anuncios_externos_itens.family_id`. Conferido em produção com `8632963637759506` (Zaven): 16 anúncios, um por variação. Não é preciso rotina de sincronização.
- **Alíquota:** o cálculo usa a alíquota atual da organização, que é o que a ADR-0208 determina para precificação. Sem pendência.
- **Clientes:** chave fixa em cabeçalho é documentada em Hermes, OpenClaw, Grok (API e CLI), OpenBot e Muse Code; nos clientes de chat na web (claude.ai, ChatGPT, grok.com) as fontes se contradizem ou só listam OAuth.
- **O servidor OAuth 2.1 do Supabase Auth** (beta) não tem escopos próprios e emite um JWT de usuário com acesso de sessão completa.

## Decisões que valem para todas as fatias

1. **Identidade.** O agente age em nome de **uma única organização**, por uma **conexão de agente** criada e revogada por administrador ativo dela, sempre com validade. A organização vem **só do registro da conexão**. Nenhuma ferramenta recebe organização como parâmetro. A auditoria registra a conexão, não a pessoa.
2. **Interface.** Servidor **MCP remoto**, sem estado, numa edge function com `verify_jwt=false` e autenticação própria. A regra de negócio fica numa camada separada da casca MCP; REST entra depois se aparecer cliente que não fale MCP.
3. **Disponibilidade.** **Módulo "Acesso de agentes"** por organização, ligado na Central de controle, desligado por padrão. Não depende do módulo `ads`.
4. **Escrita (fora das três fatias).** O agente **prepara**; publicar ou alterar anúncio no canal (inclusive preço, pausa e promoção) é **Pedido de publicação**, que espera aprovação humana na fila do app. O escopo de escrita só passa a existir no banco quando a primeira fatia de escrita for construída.

## Fatia 1 — chave de agente e leitura de margens

**Conexão por chave de agente:** segredo de alta entropia, exibido uma vez, guardado só como hash; tela no app para o administrador criar, listar e revogar.

**Quatro ferramentas, somente leitura:**

1. **Loja da conexão:** nome da organização e apelido da conta no Mercado Livre.
2. **Margem de um anúncio:** aceita MLB, produto do ML (MLBU), família do ML (o número do painel de Ads) ou SKU. Trecho de título devolve candidatos, nunca escolhe sozinho.
3. **Margens do catálogo:** paginadas (cerca de 50 anúncios por página), com indicação explícita de resultado parcial.
4. **Simulação** com outro preço, sem gravar.

**Contrato do número:**

- Por anúncio, é exatamente o que `equilibrioDoMlb` devolve: margem s/ venda em pontos percentuais, sem arredondar. É o mesmo número do ACOS de equilíbrio pelo preço; um campo só.
- **ROAS mínimo = 100 ÷ margem**, quando a margem é positiva. Margem ≤ 0 → ROAS mínimo vazio, "sem espaço para Ads".
- **Consulta por família do ML tem regra própria da API:** devolve cada anúncio da família com seu número e, como referência, a pior margem **só se todos tiverem número**; faltando um, a referência fica vazia com o motivo. A resposta indica qual anúncio determinou o mínimo. **Não promete igualdade com a aba Campanhas nesse agregado**, que agrupa pela família do PubliAI dentro de cada campanha e só cobre anúncios em campanha ativa. A igualdade com a tela vale por anúncio.
- O detalhe em reais (custo, comissão, frete, imposto, líquido) usa os mesmos insumos do cálculo, inclusive o custo resolvido do pacote, para a soma fechar. Nunca `familias.custo_centavos`.
- Traz preço atual (`price`), preço de tabela (`original_price`, a acrescentar à leitura), se está em promoção, e **a idade do preço e da tarifa** (a tarifa fica em cache por até 8 horas; a tela, 10 minutos).
- Vínculo ambíguo, pacote a conferir, custo, origem, dimensão ou tarifa ausentes → sem número, com o motivo. As recusas atuais do cálculo são mantidas.
- Sem ACOS alvo: não existe "margem desejada" por organização.

**Salvaguardas obrigatórias:**

- Ordem fixa: hash da credencial → linha da conexão → organização dessa linha → toda consulta, cache e cursor com essa organização. Validação (revogação, validade, organização ativa, módulo, administrador criador ainda ativo na emissão) antes de qualquer leitura de negócio; 401 genérico; erro interno nunca devolve a mensagem crua.
- Testes de isolamento em **todas** as entradas: MLB, MLBU, família, SKU, título, página do catálogo, cursor, simulação, cache quente e conexão revogada. Alvo de outra organização responde igual a alvo inexistente.
- **Limite de chamadas próprio, que recusa quando o Redis falha** (o contador existente `redisIncrComTTL` libera nesse caso e não serve como está): incremento atômico, por conexão; por IP só em pedido sem credencial válida; 429 para cota e 503 para Redis fora, antes de ler cache de negócio ou chamar o Mercado Livre.
- **Teto diário de consultas de tarifa ao Mercado Livre por organização**, separado do limite HTTP, com recusa.
- Uma linha de auditoria por chamada (organização, conexão, ferramenta, alvo, resultado), visível ao administrador da loja.
- Efeito interno declarado: a leitura pode renovar e regravar a credencial do Mercado Livre da organização, como o app já faz.
- Títulos e textos de produto saem como dado estruturado; a descrição das ferramentas declara que são dado não confiável.
- Nunca devolver dados de comprador, credenciais do Mercado Livre nem dados de fornecedor.

**Aceite:** mesmo número da aba Campanhas para o mesmo anúncio com os mesmos insumos; consulta pela família `8632963637759506`; teste real de conexão em cada cliente que aceita cabeçalho, com o resultado registrado por cliente (inclusive claude.ai, para saber se a fatia 2 é necessária para ele).

## Fatia 2 — conexão por autorização (OAuth 2.1 próprio)

O login é o do app; **só administrador** aprova, numa tela de consentimento do PubliAI. **O PubliAI emite o próprio token, opaco, guardado como hash, que só vale na API de agentes.** O servidor OAuth do Supabase Auth foi descartado porque seu token abriria o app inteiro. Depois de criada, a conexão se comporta como a da fatia 1.

Exigências mínimas, a detalhar em plano próprio antes do código:

- `redirect_uri` com comparação exata, só HTTPS ou loopback; o consentimento mostra a origem real, não o nome que o cliente registrou.
- Consentimento por POST com proteção CSRF presa à sessão; reconfirmação de administrador ativo e organização.
- Código de autorização curto, de uso único, consumido atomicamente, amarrado a cliente, `redirect_uri`, PKCE S256, recurso e organização.
- Registro dinâmico com limite por origem e global, teto de clientes e expiração.
- Metadados do servidor de autorização (RFC 8414) e do recurso protegido (RFC 9728), com `resource_metadata` no `WWW-Authenticate`; validação de `resource` e audiência (RFC 8707). Não verificado: se o endereço das edge functions consegue servir os caminhos de descoberta que os clientes esperam.
- Token de acesso curto; token de renovação de uso único, com detecção de reuso derrubando a cadeia.
- Código, tokens e clientes no Postgres, como hash; nada em memória da função.
- Validado primeiro num cliente web antes de ligar para todas as organizações.

## Fatia 3 — chave de plataforma (ADR própria)

O Diego quer uma conexão da administração da plataforma, somente leitura, para as lojas que ele gere. Fica **fora desta ADR**. Pontos que a ADR futura precisa resolver:

- A ADR-0092 (decisões 8 e 11) exige autorização do cliente, com motivo, prazo e revogação, até para leitura. "Modalidade comercial vigente" é termo de cobrança e não basta como autorização: é preciso um consentimento explícito por loja, revogável pela loja sem encerrar o contrato.
- Com a organização como parâmetro do agente, um texto malicioso lido numa loja pode induzi-lo a consultar outra. Alternativa a avaliar: N conexões de uma loja cada, sem parâmetro de organização.
- O custo de tarifas do Mercado Livre se multiplica por todas as lojas.

Até lá, o Diego usa uma conexão por loja.

## Alternativas descartadas

- **Chave, OAuth e chave de plataforma juntos na primeira entrega:** três revisões independentes apontaram que concentra o risco e atrasa o primeiro uso.
- **OAuth pelo Supabase Auth:** token com alcance de sessão completa e sem escopo.
- **MCP e REST juntos:** nenhum cliente da lista precisa de REST hoje.
- **Reimplementar as fórmulas da spec recebida:** a conta já existe e é a que a tela mostra.

## Limitações conhecidas

- Cupom do vendedor não entra na margem.
- Não verificado: se a alíquota interna (`interna_pct`, ADR-0112) deveria entrar neste cálculo; hoje não entra, nem na aba Campanhas.

## Implementação da fatia 1 (2026-11-22)

Migration aplicada, merge na `main` e deploy feitos em 2026-11-22 (ver "Aceite da fatia 1"). Guia de uso: `docs/reference/acesso-de-agentes.md`; contrato técnico: `docs/reference/api-agentes.md`. O que mudou em relação ao texto aprovado:

- Ferramentas com prefixo: `publiai_loja`, `publiai_margem_anuncio`, `publiai_margens_catalogo`, `publiai_simular_margem`.
- Segundo teto diário por organização, além do de tarifas: **leituras** de item e preço no ML (3.000 por dia; 2 por bloco de 20 anúncios). Estado `limite_leituras`.
- A busca por SKU cobre os dois modelos de anúncio (legado e user products).
- A auditoria grava só identificador canônico (MLB, MLBU, família ou SKU resolvido); o resto vira `texto_livre`.
- `agente_conexoes.criada_por` pode ficar nulo se o usuário for excluído (a conexão é da organização).

### Pendências aceitas para o piloto

- ~~Conferir no aceite se `/items/bulk` devolve item de outro vendedor.~~ Fechada em 2026-11-23: não devolve (ver "Aceite em uso real").
- O cache de comissão `promo:lp:v1` é compartilhado entre organizações. É anterior a este trabalho; pendência separada. Medido em 2026-11-23: a chave é categoria + tipo de anúncio + preço, sem vendedor, e guarda só a comissão (tarifa do ML), nenhum dado da loja. Zaven e Avil receberam do `/sites/MLB/listing_prices` a mesma comissão nos 4 casos testados (categoria MLB430391, clássico e premium, R$ 42,75 a R$ 150). O risco é de exatidão, não de vazamento: só apareceria se um vendedor tivesse tarifa própria (acordo comercial, loja oficial), o que não foi observado. Mantido sem mudança.
- Não há bloqueio por IP antes da consulta da chave. Sugestão registrada: assinatura embutida na chave antes de abrir a mais lojas.
- Sem revalidação da conexão depois da leitura do corpo (janela de até 10 s).
- O limite de 10 conexões ativas não é atômico (contar e inserir são passos separados).

## Aceite da fatia 1 (2026-11-22)

Chamadas reais ao servidor em produção, com uma conexão temporária da Zaven (revogada ao fim):

- Família do ML `8632963637759506`: 16 anúncios, todos com número; referência pela pior margem.
- O mesmo anúncio encontrado por MLB (inclusive em minúsculas), por MLBU e por SKU; trecho de título devolve candidatos.
- Margem conferida contra o cadastro: custo da variação, alíquota confirmada da organização, comissão e frete lidos do Mercado Livre; a soma dos componentes fecha no preço.
- Catálogo em páginas de 50 com cursor; cursor inválido recusado; simulação com outro preço; preço inválido recusado sem consulta.
- Anúncio publicado de outra organização: "não encontrado", igual a um anúncio inexistente.
- Conexão revogada: 401 na chamada seguinte. Sem chave: 401. GET: 405.
- Auditoria: uma linha por chamada de ferramenta, com alvo canônico (`texto_livre` para a busca por título).

Não coberto neste aceite: comparação lado a lado com a aba Campanhas na tela (a conta é a mesma função, coberta por teste de paridade); leitura de anúncio de outro vendedor por `/items/bulk`; qual cabeçalho de IP chega à edge; criação de chave pela tela; conexão em cada cliente. Todos cobertos em 2026-11-23 (seção seguinte), exceto os clientes marcados como não testados.

## Aceite em uso real (2026-11-23)

Conduzido pelo Diego na Zaven, com uma chave criada pela tela (prefixo `ad62ca5f`, 30 dias) e revogada ao fim. Somente leitura; nada escrito no Mercado Livre nem em dado de cliente.

**Confirmado:**

- **Tela de conexões:** a chave aparece uma única vez (com o endereço do servidor e o aviso), a lista mostra prefixo, validade e último uso, "Ver chamadas" mostra a auditoria traduzida, com alvo canônico ou "—". A seção só aparece para administrador da própria loja: em sessão de suporte ela some, como decidido.
- **Paridade com a aba Campanhas, por anúncio:** `MLB5563623367` (Campanha ZAven, ativa) e os outros 8 anúncios da mesma família: tela "até 42,5%", API `42,5848…` (a tela trunca em uma casa). Família `8632963637759506`: tela "até 44,5%", API `44,5332…`. Componentes da API fecham no preço (R$ 42,75 = comissão 5,99 + frete 6,85 + imposto 1,71 + líquido 28,21; custo 10,00).
- **Clientes:** funcionam Claude Code, claude.ai, Grok Bot, OpenBot e Muse; o ChatGPT não oferece chave nem cabeçalho (só OAuth). Tabela e passo a passo em `docs/reference/acesso-de-agentes.md`.
- **Revogação pela tela:** chamada seguinte com a mesma chave → `401 {"erro":"nao_autorizado"}`; nenhuma chamada auditada depois de `revogada_em`.
- **`/items/bulk` de outro vendedor:** com o token da Zaven, um anúncio próprio voltou `200` com o vendedor da Zaven e um anúncio da Avil voltou `403` sem corpo. O código descarta envelope que não é `200` com corpo, então um MLB alheio viraria `anuncio_indisponivel`, nunca um número. Não é preciso validar `seller_id`.
- **Cabeçalho de IP:** nos logs da edge (77 requisições de 9 clientes diferentes), `cf-connecting-ip` chegou em todas, sempre igual ao `x-real-ip` do gateway; `x-forwarded-for` não chegou em nenhuma. O `ipDoCliente` já prefere `cf-connecting-ip`; o limite de falhas por IP funciona como desenhado.

**Continua pendente:**

- Clientes não testados: OpenClaw (a CLI aceita `--header`), Hermes (servidor remoto) e Muse Code (não instalado).
- ChatGPT só conecta com a fatia 2.
- As pendências aceitas para o piloto listadas acima, exceto a do `/items/bulk`.
