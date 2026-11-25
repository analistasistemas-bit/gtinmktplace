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

- Conferir se `/items/bulk` devolve item de outro vendedor. **Fechada em 2026-11-24:** amostra medida e validação de `seller_id` no ar (Emenda 2).
- Qual cabeçalho de IP chega à edge, e se ele pode ser forjado na URL direta do Supabase. **Verificação do piloto encerrada em 2026-11-24**, sem mudança de código: cabeçalhos lidos dentro de uma função temporária e limite testado na `agentes` (ver "Cabeçalho de IP").
- O cache de comissão `promo:lp:v1` é compartilhado entre organizações. É anterior a este trabalho; pendência separada. Medido em 2026-11-23: a chave é categoria + tipo de anúncio + preço, sem vendedor, e guarda só a comissão (tarifa do ML), nenhum dado da loja. Zaven e Avil receberam do `/sites/MLB/listing_prices` a mesma comissão nos 4 casos testados (categoria MLB430391, clássico e premium, R$ 42,75 a R$ 150). O risco é de exatidão, não de vazamento: só apareceria se um vendedor tivesse tarifa própria (acordo comercial, loja oficial), o que não foi observado. Mantido sem mudança.
- Não há bloqueio por IP antes da consulta da chave. A sugestão de assinatura embutida na chave foi **avaliada e adiada em 2026-11-24** (Emenda 3): deixa de ser condição para abrir a outras lojas.
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

Não coberto neste aceite: comparação lado a lado com a aba Campanhas na tela (a conta é a mesma função, coberta por teste de paridade); leitura de anúncio de outro vendedor por `/items/bulk`; qual cabeçalho de IP chega à edge; criação de chave pela tela; conexão em cada cliente. Retomados em 2026-11-23, parte deles só parcialmente: ver a seção seguinte.

## Aceite em uso real (2026-11-23)

Conduzido pelo Diego na Zaven, com uma chave criada pela tela (prefixo `ad62ca5f`, 30 dias) e revogada ao fim. Somente leitura; nada escrito no Mercado Livre nem em dado de cliente.

**Confirmado:**

- **Tela de conexões:** a chave aparece uma única vez (com o endereço do servidor e o aviso), a lista mostra prefixo, validade e último uso, "Ver chamadas" mostra a auditoria traduzida, com alvo canônico ou "—". A seção só aparece para administrador da própria loja: em sessão de suporte ela some, como decidido.
- **Paridade com a aba Campanhas, por anúncio:** na Campanha ZAven (ativa), seis linhas da família de `MLB5563623367` foram vistas na tela com "até 42,5%" (`MLB7999179888`, `MLB7999083724`, `MLB5563669687`, `MLB5563669643`, `MLB5563669625`, `MLB5563623397`) e a API devolve `42,5848…` para cada uma (a tela trunca em uma casa). A linha do próprio `MLB5563623367` não foi vista na tela. Família `8632963637759506`: tela "até 44,5%", API `44,5332…`. Componentes da API fecham no preço (R$ 42,75 = comissão 5,99 + frete 6,85 + imposto 1,71 + líquido 28,21; custo 10,00).
- **Clientes:** funcionam Claude Code, claude.ai, Grok Bot, OpenBot e Muse; o ChatGPT não oferece chave nem cabeçalho (só OAuth). Tabela e passo a passo em `docs/reference/acesso-de-agentes.md`.
- **Revogação pela tela:** chamada seguinte com a mesma chave → `401 {"erro":"nao_autorizado"}`; nenhuma chamada auditada depois de `revogada_em`.
- **`/items/bulk` de outro vendedor:** com o token da Zaven, um anúncio próprio voltou `200` com o vendedor da Zaven e um anúncio da Avil voltou `403` sem corpo. O código descarta envelope que não é `200` com corpo, então esse caso viraria `anuncio_indisponivel`. É um único anúncio de um único vendedor: indício de isolamento, não prova. Amostra ampliada em 2026-11-24 (Emenda 2).
- **Cabeçalho de IP:** nos logs do gateway (76 requisições, 10 user-agents, parte delas scripts da própria validação), `cf-connecting-ip` aparece em todas, sempre igual ao `x-real-ip`. O log guarda só uma lista fixa de cabeçalhos, então a ausência de `x-forwarded-for` nele não prova nada, e o que a função recebe não foi lido de dentro dela. Lido em 2026-11-24 (ver "Cabeçalho de IP").

**Continua pendente:**

- Clientes não testados: OpenClaw (a CLI aceita `--header`), Hermes (servidor remoto) e Muse Code (não instalado).
- ChatGPT só conecta com a fatia 2.
- As pendências aceitas para o piloto listadas acima, menos as duas já fechadas (`/items/bulk`, Emenda 2; cabeçalho de IP, seção própria).
- A busca por título só olha `familias.nome_pai`: termo que só existe no título da variação (medido em 2026-11-24 com "Neon") responde `nao_encontrado`. Tratado na Emenda 4.

## Emenda 1 — conexão mais fácil sem OAuth (2026-11-23)

Aprovada pelo Diego em 2026-11-23, depois do aceite em uso real. A fatia 2 (OAuth) fica adiada; estas mudanças reduzem o trabalho de conectar com a chave da fatia 1.

1. **Validade opcional.** A decisão 1 ("sempre com validade") passa a ser: a conexão tem validade de 30, 90 ou 365 dias **ou vale até ser revogada** (`expira_em` nulo), escolha do administrador na criação; "Até revogar" é o padrão da tela. Motivo: o Diego conecta agentes de uso contínuo e não quer recriar chave; a revogação continua imediata e o "último uso" continua visível. Risco aceito: chave vazada sem data de fim vale até alguém revogar. Data presente continua limitada a 366 dias pelo banco; data inválida continua recusada.
2. **Credencial tolerante ao formato do cliente.** O cabeçalho `Authorization` aceita `Bearer <chave>`, com `Bearer` em qualquer caixa, ou a chave sozinha. O formato da chave (`pai_<8 hex>_<43>`) continua exigido; JWT e qualquer outro valor continuam recusados com 401. Motivo: no teste, um cliente mandou a chave sem o esquema. `Bearer Bearer pai_…` (relatado pelo Muse) **continua** recusado.
3. **Endereço com a marca.** `https://mcp.publiai.daludi.com.br` é um Worker da Cloudflare que só repassa o pedido para a edge `agentes` (mesmo método, corpo e cabeçalhos; sem lógica, sem guardar nem registrar cabeçalho). Dá URL curta. **Não** põe o ícone do PubliAI no claude.ai: em 2026-11-24 o conector mostrou o ícone de `daludi.com.br` (o domínio raiz), embora o Worker sirva o do PubliAI no subdomínio. É o mesmo padrão do `supabase.co`; a regra exata do claude.ai não é documentada. O endereço do Supabase continua funcionando.
4. **Instruções prontas por cliente** na tela, depois de criar a chave: cada campo já no formato do cliente, com botão Copiar.

Não muda: uma organização por chave, isolamento, limites, auditoria, somente leitura.

Revisão independente (Codex gpt-6.2-sol, high, 2026-11-23): (a) o comando do Claude Code deixava a chave no histórico do terminal: passou a ler a chave com `read -rs` e usar a variável; (b) a migration recriava o check sem necessidade: só o `NOT NULL` sai. (c) Aceito sem mudança: pelo Worker, o `cf-connecting-ip` que chega à edge é o da Cloudflare, então todas as falhas de credencial por esse endereço dividem um contador de IP (medido em 2026-11-24: um único IP, faixa `2a06:98c0:3600::/48`). Chave válida não passa por esse limite (`auth-agente.ts`), então só quem erra a chave enquanto outro também erra pode receber 429 em vez de 401. Encaminhar o IP original assinado pelo Worker fica para se isso aparecer. Segunda revisão independente (Grok 4.7 xhigh, 2026-11-24): sem bloqueadores; o mesmo item do IP, classificado como menor.

## Emenda 2 — o agente só recebe anúncio da conta da conexão (2026-11-24)

Aprovada pelo Diego em 2026-11-24, depois da amostra abaixo.

**Decisão.** Nas leituras do `/items/bulk` feitas pela edge `agentes`, o pedido inclui `seller_id` e todo envelope com corpo cujo vendedor não seja a conta ML da conexão (`marketplace_connections.conta_externa_id`), ou sem vendedor, vira 403 sem corpo, na mesma posição. O resultado continua `anuncio_indisponivel`, sem dado vindo do anúncio recusado; o MLB continua na resposta, porque vem do cadastro da própria organização; a contagem vai ao log, sem identificar o anúncio. Um ponto só cobre item e preço, inclusive na simulação (`_shared/agentes/so-do-vendedor.ts`, aplicado no `get` de `agentes/index.ts`). Os leitores compartilhados (`_shared/promocoes`, `_shared/ads`) não mudam.

**Medido** (2026-11-24, 17:16 de Brasília, só GET, token da Zaven salvo indicação, duas seleções de campos do app com `seller_id`; em blocos de controle de 20 anúncios, a seleção exata do app deu os mesmos códigos):

| Grupo | Amostra | Resultado |
|---|---|---|
| Terceiros de três lojas conectadas ao mesmo aplicativo | 120 anúncios (40 por loja) | 120 envelopes 403 sem corpo |
| Terceiros não conectados | 120 anúncios de 120 vendedores, 20 categorias, 53 produtos de catálogo | 120 envelopes 403 sem corpo |
| Próprios da Zaven | 247 vigentes + 64 retirados | 311 envelopes 200, vendedor igual à conta |
| Vínculos publicados de outra loja, com o token dela (28 de 29 anteriores à conexão atual) | 29 anúncios | 29 envelopes 200, vendedor igual à conta |
| Lotes mistos | 3 de 20 e 1 de 3 anúncios | Lote 200; próprio 200, terceiro 403, inexistente 404, na posição pedida |

Status no ML dos 340 próprios: Zaven 174 ativos, 73 pausados (67 sem estoque, 6 pelo vendedor) e 64 encerrados; outra loja 24 pausados e 5 em revisão. Nenhum MLB está vinculado a mais de uma organização (consulta a todos os vínculos ML).

As linhas acima medem o ML, não o filtro: nenhum caso real devolveu 200 de outro vendedor, e esse cenário só está coberto por teste automático (margem, simulação, catálogo e família).

**Não medido:** anúncio de catálogo próprio (nenhum entre os 340); status dos terceiros (o ML não informa; 30 dos 120 não conectados estavam inativos no registro do Radar); leitura de terceiro com token de outra loja; amostra aleatória do ML (esta não é).

**Inferência:** a recusa do ML é forte indício de isolamento, mas é comportamento sem contrato conhecido e pode mudar; por isso a validação entra mesmo com zero vazamento na amostra. O caminho que ela fecha é o vínculo velho de uma conta trocada. Os outros leitores do `/items/bulk` que não conferem o vendedor (promoções, operações em massa, reajuste, Ads) teriam a mesma exposição: pendência separada, fora desta ADR.

**Ao ligar outra loja:** conferir no catálogo do agente que os anúncios próprios, inclusive um de catálogo se houver, não voltam `anuncio_indisponivel`. O filtro falha fechado: `seller_id` ausente esconde o anúncio e, se `conta_externa_id` divergir da conta do token, esconde a loja inteira.

Revisão independente (Codex gpt-6.2-sol, high, 2026-11-24): (a) resposta fora do formato de lista passou a virar lista vazia; (b) entrou teste do fluxo completo com vínculo velho; (c) o texto passou a separar o que mede o ML do que só o teste cobre. Segunda rodada: (d) `seller_id` numérico acima do inteiro seguro é recusado; (e) o teste confere a linha recusada inteira. O MLB do vínculo recusado no catálogo e no cursor, objeção da primeira rodada, foi retirado na segunda: é dado do cadastro da própria organização. Sem mudança: `seller_id` ausente continua escondendo o anúncio, e o cache de comissão compartilhado segue nas pendências aceitas.

**Deploy e aceite (2026-11-24):** main `ff4e7729`, `agentes` v5 (45 de 45 arquivos baixados iguais ao commit, `verify_jwt` falso). Pelo endereço público, na Zaven: `publiai_loja`; `publiai_margem_anuncio` de `MLB5563623367` com a mesma margem do aceite de 23/11 (42,5848%); primeira página do catálogo com 50 de 50 anúncios com número e `parcial` falso. O aceite mostra que o filtro não esconde anúncio próprio nessa página (50 anúncios); o descarte de outro vendedor continua coberto só por teste automático.

## Cabeçalho de IP (2026-11-24)

Autorizado pelo Diego. Sem decisão nova e sem mudança de código.

**Medido dentro da função.** Edge temporária `diag-ip`, separada, sem banco nem segredo, publicada e apagada no mesmo teste (a exclusão foi confirmada pela lista de funções e por 404). 18 pedidos de uma única máquina, um IP de origem IPv4, HTTP/2, 9 variações em cada um dos dois endereços diretos (`<ref>.supabase.co/functions/v1/…` e `<ref>.functions.supabase.co/…`), com o mesmo resultado nos dois:

| O cliente enviou | O que aconteceu |
|---|---|
| Nada | `cf-connecting-ip` = IP real; `x-forwarded-for` = real, real e um terceiro endereço, que mudou entre os pedidos (9 valores em 12 pedidos); `x-real-ip` não chega |
| `CF-Connecting-IP` com valor, sozinho, repetido ou com `X-Forwarded-For` (3 variações) | 403 `error code: 1000`, em vez da resposta da função |
| `CF-Connecting-IP` vazio | Chega o IP real |
| `X-Forwarded-For`, simples ou repetido | O valor enviado some; o que chega mantém o formato de quando nada é enviado, com o terceiro endereço variando |
| `X-Real-IP` | Não chega |
| `True-Client-IP`, `Forwarded`, `X-Client-IP`, `CF-Connecting-IPv6` e `CF-Pseudo-IPv4`, juntos | Os três primeiros **chegam como enviados** (forjáveis; `ipDoCliente` não usa nenhum); os dois `CF-*` não chegam |

**Medido na `agentes`** (status e corpo da resposta; 30 pedidos sem chave, no mesmo minuto, sem usar o Worker): 20 respostas 401, depois nove 429 e um 403. O 21º pedido, sem nada forjado, deu 429. Em seguida, em `<ref>.supabase.co`: `X-Forwarded-For` (uma e duas entradas), `X-Real-IP`, os três forjáveis juntos e `CF-Connecting-IP` vazio; em `<ref>.functions.supabase.co`, só dois pedidos (sem nada e com `X-Forwarded-For`); e um controle final. Todos deram 429; `CF-Connecting-IP` com valor deu 403 `error code: 1000`. Nenhuma variação testada voltou a receber 401. A chave do contador no Redis não foi observada.

**Inferência:** os dois resultados são compatíveis com o limite por IP que o código descreve e com ele não ser contornável pelos cabeçalhos testados. O 403 é compatível com rejeição na borda da Cloudflare, não confirmada diretamente. Nos 12 pedidos que chegaram à `diag-ip`, o último item de `x-forwarded-for` diferiu do IP de origem, então o ramo de reserva de `ipDoCliente` não identificaria o cliente; ele não seria usado, porque `cf-connecting-ip` veio em todos e tem precedência.

**Não medido:** origem IPv6 (em 2026-11-24, `txvncrgkoynoxwopfkbp.supabase.co` e `txvncrgkoynoxwopfkbp.functions.supabase.co` não tinham registro AAAA; `mcp.publiai.daludi.com.br` tinha dois); HTTP/1.1; mais de uma origem; tráfego pelo Worker neste ensaio (a medição anterior, de um único IP, está na Emenda 1); um Worker de terceiro chamando a URL direta. Consequência esperada da chave do contador: quem tem muitos IPs de verdade tem um limite para cada um; a assinatura na chave, mitigação proposta, foi adiada (Emenda 3).

Revisão independente do texto (Codex gpt-6.2-sol, high, 2026-11-24, três rodadas): considerou defensável manter o código e pediu só ajustes de redação, aplicados; as três rodadas terminaram em "revisar", e os ajustes da última não passaram por nova rodada.

## Emenda 3 — assinatura na chave adiada, com gatilho (2026-11-24)

Aprovada pelo Diego em 2026-11-24 entre três opções. Sem mudança de código; as chaves existentes seguem valendo.

**Decisão.** Não embutir assinatura na chave agora. Ela deixa de ser condição para ligar o módulo em outra loja.

**O que ela resolveria.** Chave inventada no formato certo custa uma consulta ao banco por tentativa, inclusive acima do limite de falhas por IP, que só é debitado depois da consulta (`auth-agente.ts`). Com assinatura, a edge recusaria antes do banco. Não é defesa contra adivinhação, já inviável com 32 bytes aleatórios, nem contra chave vazada.

**Medido em 2026-11-24:** 1 conexão ativa, de 3 criadas, em todas as organizações. Nas 24 horas até 18h05 de Brasília, o log do gateway contou 69 respostas 401 para endereços que contêm `/agentes`, 20 delas do ensaio da seção "Cabeçalho de IP"; as outras 49 não foram classificadas. `supabase/config.toml` tem 56 entradas `verify_jwt = false`. A chave é buscada por igualdade em coluna com índice único (migration `20261122203018`).

**Inferência e risco aceito:** o custo da consulta sob carga não foi medido, e uma conexão ativa com índice único não mostra a capacidade do banco. Chave inventada no formato certo continua chegando a ele depois do limite por IP (sem linha, a função ainda chama o Redis; se a busca falha, responde 503 e registra um aviso sem debitar o IP), e uma carga alta afetaria **todas as lojas, que dividem o mesmo banco**. O risco é de indisponibilidade, não de acesso a dados, e abrir a outras lojas o aceita também abaixo do gatilho. As 56 entradas acima só dizem que o gateway não exige JWT nessas funções, não quais chegam ao banco sem credencial própria, e por isso não sustentam a decisão.

**Gatilho para reabrir:** mais de 1.000 recusas por dia (00h às 24h de Brasília) na função `agentes`, e não em `agente-conexoes`, somando 401, 429 e 503, ou lentidão do banco atribuída à autenticação. É um indicador bruto: inclui chave malformada (que não chega ao banco) e chave válida acima da própria cota. Só o 401 contaria de menos, porque, esgotada a cota de falhas do IP, a recusa de credencial vira 429 e a consulta já foi feita. O valor é um ponto de revisão escolhido, sem relação demonstrada com a capacidade do banco, e o indicador não foi medido nesse recorte (a amostra acima usa outra janela e outro filtro e serve só de contexto). **Não há alarme.** Conferência manual do log do gateway, pelo Diego: ao ligar cada loja, uma vez por semana enquanto houver mais de uma loja com o módulo, e em caso de lentidão (a parte semanal foi trocada pelo alarme, Emenda 4). Um pico entre conferências pode passar despercebido.

**Opções não escolhidas:**

- **HMAC no mesmo formato** (22 bytes aleatórios e 10 de assinatura nos 43 caracteres finais, com segredo novo): as chaves antigas cairiam e teriam de ser recriadas, porque aceitá-las em paralelo manteria aberto o caminho sem assinatura; com um segredo único e sem período de transição, perdê-lo ou trocá-lo derruba as chaves de todas as lojas. A chance de forjar passaria a depender da assinatura de 80 bits e do segredo. Em troca, quem gravasse no banco não fabricaria uma chave nova sem o segredo (ainda poderia associar uma chave já assinada a outra organização, se a assinatura cobrir só a chave). Quanto mais chaves existirem, maior o custo de adotar depois.
- **Conferir o limite de IP antes do banco:** se clientes diferentes compartilham o IP visto pela função, falhas de um bloqueariam chaves válidas de outros. Pelo Worker foi medido um único IP (Emenda 1); o compartilhamento entre clientes distintos não foi medido.
- **Descartadas sem detalhar:** verificador sem segredo (qualquer um calcula) e token autocontido (revogação imediata ainda exige consultar um estado atualizado).

Revisão independente do texto (Codex gpt-6.2-sol, high, 2026-11-24, três rodadas): considerou defensável adiar no piloto e pediu que o gatilho contasse também 429 e 503, que o risco de indisponibilidade ficasse escrito e que a conferência tivesse responsável e frequência. Aplicado; as três terminaram em "revisar", e os últimos ajustes não passaram por nova rodada.

## Emenda 4 — busca por palavras, com cor e tamanho; alarme antes da segunda loja (2026-11-24)

Aprovada pelo Diego em 2026-11-24.

**Decisão 1, busca.** O texto livre passa a casar por palavras, e não por frase: todas precisam casar, em qualquer ordem, sem acento, no nome ou título do código pai; as que faltarem, numa mesma variação do anúncio (nome, cor ou tamanho). Continua **sem escolher sozinho**: devolve candidatos, mesmo com um só. `candidatos` ganha `variacoes` (opcional) e a resposta ganha `lista_cortada`, porque antes o corte era silencioso. Regra e limites em `docs/reference/api-agentes.md`, seção 5.2. Sem migration e sem chamada ao Mercado Livre. Toda leitura leva a organização da conexão (na variação, também a da família) e só considera anúncio publicado e item não retirado.

**Decisão 2, alarme.** O Diego pretende ligar mais de uma loja. Um alarme automático de recusas na `agentes` (o gatilho da Emenda 3) passa a ser condição para ligar a segunda loja, no lugar da conferência semanal. Até lá, conferência a pedido dele. Ainda não construído; plano próprio.

**Medido** (2026-11-24, cadastro real lido por SQL só leitura e passado pelo código num cliente de banco simulado; 24 buscas: 16 na Zaven, 5 e 3 em outras duas lojas):

- `neon` acha as 3 variações; `neon 4` e `conjunto neon tamanho 4`, 1; `blusa preta M`, 4 produtos na cor Preto; `calça 4` e `tamanho 4`, nenhum; `caqui` acha `Caqui` e `Cáqui`.
- Custo por busca: 4 leituras e até 488 linhas na Zaven; até 12 leituras e 6.748 linhas na loja maior (170 códigos publicados), com até 6 ms de CPU fora da simulação, numa máquina de desenvolvimento.
- A sintaxe do filtro foi aceita pelo PostgREST de produção (um pedido com a chave anônima, que não lê linhas: 200 e lista vazia).
- Cadastro: tamanho preenchido em 323 de 323 variações da Zaven e em nenhuma das 14.954 linhas da loja maior.

**Não medido:** a busca pela edge em produção, o tempo de resposta e outras lojas. **Limites conhecidos:** sem sinônimo nem correção de digitação; `G` depende do cadastro; palavra que está no título não filtra cor (por exemplo, "short preto" num produto cujo nome já traz "Preto" devolve todas as cores).
