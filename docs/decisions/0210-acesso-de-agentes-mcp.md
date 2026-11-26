# ADR-0210 — Acesso de agentes: servidor MCP, conexão por organização, leitura de margens, em três fatias

**Status:** Aceito — fatia 1 em produção, em piloto na Zaven (main `12d00860`, deploy e aceite em 2026-11-22; emendas 1 a 4 no ar, `agentes` v8 em 2026-11-25); fatias 2 e 3 a implementar (aprovado pelo Diego em 2026-11-22, após entrevista grill-with-docs e revisão de Codex gpt-6.2-sol high e Grok 4.7 xhigh). Plano da fatia 1: `docs/superpowers/plans/2026-11-22-acesso-de-agentes-fatia-1.md`
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

**Gatilho para reabrir:** mais de 1.000 recusas por dia (00h às 24h de Brasília) na função `agentes`, e não em `agente-conexoes`, somando 401, 429 e 503, ou lentidão do banco atribuída à autenticação. É um indicador bruto: inclui chave malformada (que não chega ao banco) e chave válida acima da própria cota. Só o 401 contaria de menos, porque, esgotada a cota de falhas do IP, a recusa de credencial vira 429 e a consulta já foi feita. O valor é um ponto de revisão escolhido, sem relação demonstrada com a capacidade do banco, e o indicador não foi medido nesse recorte (a amostra acima usa outra janela e outro filtro e serve só de contexto). **Não havia alarme nesta data** (construído na Emenda 4). Conferência manual do log do gateway, pelo Diego: ao ligar cada loja, uma vez por semana enquanto houver mais de uma loja com o módulo, e em caso de lentidão (a parte semanal foi trocada pelo alarme, Emenda 4). Um pico entre conferências pode passar despercebido.

**Opções não escolhidas:**

- **HMAC no mesmo formato** (22 bytes aleatórios e 10 de assinatura nos 43 caracteres finais, com segredo novo): as chaves antigas cairiam e teriam de ser recriadas, porque aceitá-las em paralelo manteria aberto o caminho sem assinatura; com um segredo único e sem período de transição, perdê-lo ou trocá-lo derruba as chaves de todas as lojas. A chance de forjar passaria a depender da assinatura de 80 bits e do segredo. Em troca, quem gravasse no banco não fabricaria uma chave nova sem o segredo (ainda poderia associar uma chave já assinada a outra organização, se a assinatura cobrir só a chave). Quanto mais chaves existirem, maior o custo de adotar depois.
- **Conferir o limite de IP antes do banco:** se clientes diferentes compartilham o IP visto pela função, falhas de um bloqueariam chaves válidas de outros. Pelo Worker foi medido um único IP (Emenda 1); o compartilhamento entre clientes distintos não foi medido.
- **Descartadas sem detalhar:** verificador sem segredo (qualquer um calcula) e token autocontido (revogação imediata ainda exige consultar um estado atualizado).

Revisão independente do texto (Codex gpt-6.2-sol, high, 2026-11-24, três rodadas): considerou defensável adiar no piloto e pediu que o gatilho contasse também 429 e 503, que o risco de indisponibilidade ficasse escrito e que a conferência tivesse responsável e frequência. Aplicado; as três terminaram em "revisar", e os últimos ajustes não passaram por nova rodada.

## Emenda 4 — busca por palavras, com cor e tamanho; alarme antes da segunda loja (2026-11-24)

Aprovada pelo Diego em 2026-11-24.

**Decisão 1, busca.** O texto livre passa a casar por palavras, e não por frase: todas precisam casar, em qualquer ordem, sem acento, no nome ou título do código pai; as que faltarem, numa mesma variação do anúncio (nome, cor ou tamanho). Continua **sem escolher sozinho**: devolve candidatos, mesmo com um só. `candidatos` ganha `variacoes` (opcional) e a resposta ganha `lista_cortada`, porque antes o corte era silencioso. Regra e limites em `docs/reference/api-agentes.md`, seção 5.2. Sem migration e sem chamada ao Mercado Livre. Toda leitura leva a organização da conexão (na variação, também a da família) e só considera anúncio publicado e item não retirado.

**Decisão 2, alarme.** O Diego pretende ligar mais de uma loja. Um alarme automático de recusas na `agentes` (o gatilho da Emenda 3) é condição para ligar a segunda loja, no lugar da conferência semanal. Cada resposta 401, 429 ou 503 soma num contador diário no Redis (dia de Brasília); a 1.001ª reserva, no mesmo comando atômico, o direito de avisar por 60 s e manda **um** aviso por dia ao dono do SaaS, pelo bot da Daludi e o chat que a varredura de órfãos já usa. Falhou o envio, a primeira recusa depois dos 60 s tenta de novo; confirmado, a reserva vale 48 h. A contagem sai por `waitUntil`, depois da resposta, que não muda. Mensagem fixa, sem chave, IP ou organização. Sem migration e sem segredo novo (`_shared/agentes/recusas.ts`).

Melhor esforço: Redis fora não conta, o aviso pode repetir se a confirmação se perder, e a lentidão do banco sem recusas não dispara nada. Custa um comando a mais no Redis por recusa, inclusive sob ataque. Desenho com consultoria do Codex gpt-6.2-sol (high), que trocou a reserva de 48 h antes do envio pela reserva curta confirmada depois.

**Medido** (2026-11-24, cadastro real lido por SQL só leitura e passado pelo código num cliente de banco simulado; 24 buscas: 16 na Zaven, 5 e 3 em outras duas lojas):

- `neon` acha as 3 variações; `neon 4` e `conjunto neon tamanho 4`, 1; `blusa preta M`, 4 produtos na cor Preto; `calça 4` e `tamanho 4`, nenhum; `caqui` acha `Caqui` e `Cáqui`.
- Custo por busca: 4 a 7 leituras e até 460 linhas na Zaven; até 9 leituras e 2.222 linhas na loja maior (170 códigos publicados), com até 6 ms de CPU fora da simulação, numa máquina de desenvolvimento. O código para em 40 leituras por busca e avisa em `lista_cortada`.
- A sintaxe do filtro foi aceita pelo PostgREST de produção (um pedido com a chave anônima, que não lê linhas: 200 e lista vazia).
- Cadastro: tamanho preenchido em 323 de 323 variações da Zaven e em nenhuma das 14.954 linhas da loja maior.

**Não medido:** outras lojas pela edge. **Limites conhecidos:** sem sinônimo nem correção de digitação; tamanho depende do cadastro; cor com `ñ` ou acento decomposto só na variação não é achada (nenhuma das 15.551 variações do banco tem um ou outro); com mais de cerca de 1.500 códigos publicados o teto esgota antes das variações, e a resposta avisa; linha apagada no meio de uma leitura paginada pode fazer a busca pular outra; palavra que está no título não filtra cor (por exemplo, "short preto" num produto cujo nome já traz "Preto" devolve todas as cores).

Revisão independente do código (Codex gpt-6.2-sol, high, 2026-11-24, cinco rodadas, nenhuma com vazamento entre organizações ou injeção). Corrigido com teste: a variação vale pelo lote mais recente do SKU, e não por um lote velho que o filtro trouxesse; tamanho por letras ou com número é exato, inclusive no nome, e sozinho não busca; teto global de leituras; cada produto só é filtrado pela palavra que falta nele; plural de cor. As cinco terminaram em "revisar"; o ajuste da última não passou por nova rodada. Não aceito:

- filtro de organização também no pai embutido da resolução por SKU: anterior a esta emenda, com chave composta com a organização e conferência contra os publicados da loja;
- preferir no legado um rascunho mais novo sem MLB: o que está no ar é o lote publicado;
- paginar por chave em vez de posição, e desempatar pela data da família em vez da data da variação (lote antigo reprocessado depois do novo): improváveis, e o resultado é só uma lista para o usuário escolher;
- escapar aspas em SKU no filtro: nenhum SKU ou código pai do banco tem aspas, barra invertida, vírgula ou parêntese (0 de 15.551 variações). Se vier a ter, a busca responde `indisponivel`.

Revisor definido pelo Diego (Grok 4.7 xhigh, 2026-11-25, uma rodada dividida em três; as duas primeiras tentativas, com tudo junto, não responderam em 25 e 30 min). Corrigido com teste: a palavra casa pelo começo e não pelo meio (`tênis` achava `sustentável`); tamanho por extenso aceita gênero e plural; acima de 20 palavras valem as mais longas; pai com MLB e filho ativo do mesmo SKU trazem os dois; no alarme, envio com prazo de 10 s (menor que a reserva) e sem mensagem crua no log. Não aceito: SKU que mudou de cor entre lotes (vale o mais recente) e títulos de lotes diferentes do mesmo código somados. Com o travamento, o Fable 5.2 foi consultado: sem bloqueador; sugeriu o plural em `-ões`, aplicado. Rodada final do Grok 4.7 xhigh sobre o código no ar (2026-11-25, três partes): alarme **aprovado**; busca com um defeito, o singular não achava o plural (`botão` × `Botões`, `floral` × `Florais`), corrigido com teste; as demais correções confirmadas, sem vazamento nem injeção. O ajuste foi revisado pelo Grok 4.7 xhigh antes de publicar: **aprovado**, sem bloqueador.

Pendência separada (anterior, fora desta ADR): `enviarTelegram` (`_shared/notificacoes/telegram.ts`), usado por várias edges, registra a mensagem crua do erro de rede, que no Deno pode trazer a URL com o token do bot. Observado na leitura do código; não verificado em log real.

**Deploy e aceite (2026-11-25):** main `f72ea1cb`, `agentes` v6 (47 de 47 arquivos baixados iguais ao commit, `verify_jwt` falso). Na Zaven, pelo conector do claude.ai:

- Busca: `neon` → 3 variações; `neon 4` → `MLB5563623367`; `blusa preta M` → 4 produtos; `tamanho 4` → `nao_encontrado`; `MLB5563623367` → 42,5848%, como em 23/11. Com a chave da Zaven, `croche rosa` e `fita cetim azul` (que acham produto na simulação com o cadastro de outra loja), um MLB e um SKU publicados dela → `nao_encontrado`. `linha preta` devolveu só produtos da própria Zaven, porque a raiz de `linha` casa com "linho": ruído esperado do gênero. A consulta inversa (chave da outra loja) fica para o roteiro.
- Tempo na edge (log do gateway): as 8 primeiras chamadas do aceite, incluindo a margem e a loja, entre 353 e 1.801 ms, a mais lenta sendo a primeira.
- Alarme: 1.010 pedidos sem chave em 47 s, de um único IP: 20 respostas 401 e 990 respostas 429, mediana de 0,22 s. Contador em 1.010 e envio aceito pelo Telegram (a validade de 48 h só é gravada nesse caso). Uma chamada com chave válida logo depois respondeu normalmente. O Diego recebeu a mensagem às 06:24 de 2026-11-25 e confirmou (captura de tela). Cobriu uma rajada de um IP. Com o envio confirmado, o desenho não repete o aviso de 25/11.
- Não verificado ao vivo: o texto novo de `instructions` (coberto por teste e pela igualdade do código) e o script do alarme fora do caminho acima.

**Segundo deploy (2026-11-25):** main `380e23df`, `agentes` v7 (47 de 47 arquivos iguais), só com o ajuste de singular e plural. Na Zaven: `blusas pretas M`, `jaquetas azuis G` e `regata marrons M` acham as cores no singular; `neon 4`, o isolamento (`croche rosa`) e a margem de `MLB5563623367` iguais ao aceite acima.

**Falha pontual de tarifa (2026-11-25).** Medido na família `8632963637759506` (16 anúncios de mesmo preço e categoria), em quatro séries com preço provavelmente ainda sem cache (o acerto de cache não foi registrado): preço real 56,45 → 1 anúncio em `erro_tarifa` (o 4º) e 16 de 16 na reconsulta segundos depois; simulação 57,13 → 2 (o 1º e o 4º); 58,27 e 59,41 → 16 de 16. As três falhas caíram nos quatro primeiros, consultados ao mesmo tempo. A resposta falhou fechada: sem número e com a referência vazia. Os arquivos de tarifa não mudaram desde antes deste trabalho (`b43664bc`), mas a versão anterior do código não foi testada sob essa carga.

**Inferência:** o padrão é compatível com a rajada de consultas idênticas antes de o cache ser gravado, sem retentativa de comissão (desligada para o teto de cota ser real). O `erro_tarifa` não diz se a falha foi comissão, frete ou validação, e o log não registrou o motivo. Consultoria do Codex gpt-6.2-sol (high): não impede encerrar nem ligar outra loja em somente leitura; investigar registrando componente, classe do erro, status e acerto de cache, sem mexer no teto de duas consultas por cor.

**Diagnóstico (2026-11-25).** Com OK do Diego, a edge passou a registrar o componente (comissão, frete ou outro), a classe do erro e o status HTTP quando a tarifa falha, sem mensagem, URL, corpo nem token (`_shared/agentes/diagnostico-tarifa.ts`; main `f595b45a`, `agentes` v8, 48 de 48 arquivos iguais; Grok 4.7 xhigh: aprovado). Seis novas séries com preços inéditos (60,17 a 65,61) vieram completas, 96 de 96 anúncios, e o log não teve registro. Somando, 2 de 10 séries falharam. **A causa segue não medida**: o registro fica ligado e mostra o motivo na próxima ocorrência; ele não foi exercitado por uma falha real. Nenhuma correção foi feita.

## Emenda 5 — preço que o comprador paga (2026-11-25)

**Status:** Aprovada pelo Diego em 2026-11-25, com as mudanças da consulta ao GPT 6.2 Sol (high). No ar desde 2026-11-25 (main `46f04c11`, `agentes` v9, `ads-campanhas` v35).

**Defeito.** `preco_brl` vem de `price` do `/items/bulk` (`agentes/index.ts`, `lerPrecos`; `_shared/ads/campanhas.ts`, `CAMPOS_ITEM_AGORA`), que não acompanhou as promoções ativas. A fórmula está certa; o preço de entrada, não. A aba Campanhas usa a mesma leitura. O glossário já define o número como "preço vivo, com promoção ativa": o código descumpre a definição. O mesmo defeito foi corrigido em Publicados em 2026-10-20 (ADR-0170).

**Medido (Zaven, 2026-11-25, 17h51 a 18h, só leitura, 127 chamadas).**

- 5 casos do relato, os 5 reproduzidos: `price` 56,90 (4) e 42,75 (1); `sale_price` 53,59 (3), 53,99 (1) e 36,09 (1), iguais ao que o relato viu na página. Os 5 com `promotion_type: lightning`.
- Amostra aleatória de 100 anúncios dos 285 com foto de preço no dia (48 ativos, 26 pausados, 26 encerrados): 61 com `price` acima do `sale_price`, 39 iguais, nenhum abaixo. Desvio nos 61: de 0,4% a 133,8%, mediana 18,5%. `em_promocao` errado em 40. O recorte só dos ativos não foi separado.
- **Só ativos** (segunda amostra aleatória, 80 dos 158 ativos de 285; 95 chamadas, 18h06): 79 com `price` acima, 1 igual; mediana 18,4%, até 77,6%; `em_promocao` errado em 50. Tipos: `lightning` 49, `campaign` 27, `marketplace_campaign` 3, nenhum 1. Dos 285, nenhum tem variações dentro do MLB.
- **SMART** (`marketplace_campaign`; vendas no banco desde o início de cada campanha, consulta limitada a 40 linhas, com repetição por venda que está em mais de uma campanha): nas vendas em que o preço vendido é o promocional, a comissão ficou em 9,9% a 14%, nunca acima de 14%; nas com desconto bancado pelo ML a diferença aparece como comissão menor. A conta sem subsídio é conservadora nessas vendas. Não foi provado em outras categorias nem lojas.
- `sale_price` respondeu 200 nos 100; com 8 em paralelo, 3,2 s no total (metade das chamadas em até 0,24 s; máxima 0,56 s).
- `/prices`: a linha cujo `id` é o `price_id` do `sale_price` traz `conditions.end_time` (3 de 3; fim em 2026-11-26 00h BRT).
- O Conjunto UV já aparecia a 37,19 na foto diária de `sale_price` desde 21/11. Não é cache: o preço é lido a cada chamada.
- Os 5 casos e os 100 da amostra são um MLB por SKU, sem variações dentro: a faixa de preço do painel corresponde a duas promoções do mesmo MLB (Black Friday e Relâmpago), e MLB com variações não foi testado.

**Não medido:** documentação oficial do ML (o site recusou acesso automatizado, 403); preço por nível de fidelidade e cupom; promoção encerrando durante a leitura; outras lojas. Os 56,90 serem resto de preço anterior é inferência.

**Mudanças da consulta (GPT 6.2 Sol, high, sem ver o repositório; aceitas):** prazo total de 20 s e timeout de 5 s por leitura; `429` para as leituras restantes, sem repetir, inclusive as de `/prices`; cache da aba Campanhas com versão e conta ML na chave; `preco_lido_em` por anúncio; `em_promocao` nulo quando metadado e valores divergem; `promocao_fim` só com `price_id` e preço iguais e data futura; vendedor conferido também na aba Campanhas; margem rotulada como do momento. **Recusadas:** margem pelo preço base (o base da calça é 89,90, mas sem a Relâmpago o preço volta a 54,90: a margem base sairia otimista), meta semanal, apagar número de pausado ou de promoção ainda não validada, testes de carga.

**Decisão.**

1. Preço = `GET /items/{id}/sale_price?context=channel_marketplace` por MLB, sem cache, na API **e** na aba Campanhas. `preco_brl` = `amount`; `preco_tabela_brl` = `regular_amount` quando maior; `em_promocao` sai dos dois. `price` e `original_price` deixam de entrar na conta.
2. Só lê `sale_price` de MLB que passou pelo `/items/bulk` com `seller_id` da conexão (Emenda 2). O caminho novo é uma leitura própria; `soDoVendedor` continua recusando tudo que não é bulk.
3. Falha fechada: sem `sale_price` legível, sem número e `motivo: preco_nao_verificado`, sem recorrer a `price`. Na simulação, `preco_atual_brl: null` e a conta com o preço simulado segue.
4. Campos novos: `promocao_tipo` (`metadata.promotion_type`, texto do ML, `null` sem promoção) nas três ferramentas de margem; `promocao_fim` só em `publiai_margem_anuncio`, por `/prices` e `price_id`, `null` quando não souber. Não derruba o preço se falhar.
5. Entra `preco_lido_em`. Não entram `preco_comprador_brl` e `preco_base_brl`: seriam cópia de `preco_brl` e `preco_tabela_brl`.
6. Cota `leiturasDia` (3.000) conta as leituras novas: 1 por MLB, mais 1 por MLB em promoção na consulta pontual. O multiget de preço sai: página do catálogo passa de 6 para até 53; uma varredura da Zaven (285 MLBs) custa cerca de 303. O teto não muda.
7. Na aba Campanhas, `sale_price` só dos anúncios que entram no cálculo (teto 200, 8 em paralelo; cerca de 6 s pela amostra). Os demais seguem sem equilíbrio, como hoje, e sem preço exibido, para não mostrar número que pode estar errado.
8. Fórmula, imposto, tarifa e o limite do cupom do vendedor não mudam. `meli_percentage` continua fora (ADR-0170, decisão 7).

**Alternativas descartadas.** Ler promoções e escolher a vencedora: refaz a regra do ML e a visão por item atrasa (a Relâmpago ativa não veio como `started`). Foto diária do banco: perde Relâmpago. Só a API: divergiria da aba Campanhas. Cache de 15 min: sem cache já cabe na cota.

**Aceite.** Os 5 MLBs com `preco_brl` igual ao `sale_price` na hora (tolerância 0,01) e o mesmo número na aba Campanhas para anúncio em campanha ativa; amostra nova comparada com `sale_price`; Relâmpago com `promocao_tipo` e `promocao_fim`; depois das 00h de 26/11, preço de volta ao da promoção que sobrar; testes com respostas gravadas para: promoção, sem promoção, falha, anúncio de terceiro, cota.

**Aceite (2026-11-25, 19h46 BRT, Zaven).** Arquivos implantados das duas funções iguais ao commit (51 e 43). Os 5 MLBs do relato: `preco_brl` igual ao `sale_price` lido no mesmo minuto (53,59, 53,99 e 36,09), `promocao_tipo: lightning`, `promocao_fim` 2026-11-26 00h BRT; margem da calça Classic 16,4% e ROAS mínimo 6,09, iguais à simulação feita antes da correção. Primeira página do catálogo: 50 anúncios, 0 sem número, `parcial: false`, os 50 iguais ao `sale_price` (tolerância 0,005). 55 chamadas de conferência. **Fim da Relâmpago (2026-11-26, 00h05 BRT):** os 5 voltaram ao preço da Black Friday no ML (54,90 nas 4 calças, 37,19 no conjunto, `campaign`), e a API devolveu o mesmo na hora, com `promocao_fim` 2026-12-01 00h BRT; calça Classic 18,0% e ROAS mínimo 5,56. **Falta:** a aba Campanhas aberta por um usuário (precisa de sessão; não foi chamada).

**Revisão de código (GPT 6.2 Sol, high, duas rodadas).** Corrigidos: cache por conta ML, prazo e parada por 429 divididos com `/prices`, falha na reserva do complemento, relógio do fim. Mantidos por decisão: linha fora do cálculo sem preço na aba Campanhas; a cota do complemento pode ser reservada depois de um 429 sem leitura (até 60 de 3.000; a cota é teto de reserva, como a de tarifas). Veredito final do revisor: REVISAR, só por este último ponto.

**Ajuste pedido no aceite (2026-11-25): status do anúncio.** O aceite do Diego notou um anúncio pausado sem aviso. As três ferramentas de margem passam a trazer `status` (texto do ML: `active`, `paused`, `closed`...), lido num multiget próprio `id,status` pelo mesmo filtro de vendedor; falha deixa `status: null` sem tirar a margem nem marcar `parcial`. Pausado mantém a margem (decisão da consulta: não apagar número correto); as instruções do `initialize` mandam avisar. Custo: +1 leitura por bloco de 20 (página do catálogo de 53 para 56). Leitura separada para não mexer em `buscarItensML`, usado por outras cinco funções.

## Pode ligar em outra loja? (2026-11-25)

**Recomendação: sim, uma segunda loja em piloto, e depois uma por vez, com o roteiro abaixo.** As duas condições do piloto que bloqueavam (vendedor do anúncio e cabeçalho de IP) estão fechadas, o alarme está no ar e a assinatura na chave deixou de ser condição (Emenda 3). Se forem várias lojas em pouco tempo, reavaliar a assinatura **antes** de criar as chaves: hoje só 1 precisaria ser refeita.

Roteiro por loja, com o OK do Diego e autorização do administrador dela:

1. Alíquota confirmada, custo e origem preenchidos (sem isso a resposta é `sem_aliquota`, `sem_custo` ou `sem_origem`, em vez de número).
2. Ligar o módulo `agentes`; o administrador da loja cria a chave.
3. `publiai_loja` confere a conta; a primeira página do catálogo não pode vir com anúncio próprio em `anuncio_indisponivel`. Se houver anúncio de catálogo do Mercado Livre, conferir um: é o caso que a amostra da Emenda 2 não cobriu.
4. Comparar um anúncio com a aba Campanhas; testar SKU e palavra; um MLB dela responde com a chave dela e dá `nao_encontrado` com a chave de outra loja, e vice-versa.

Continua aceito: cache de comissão `promo:lp:v1` compartilhado (exatidão, não vazamento), conexão não revalidada depois da leitura do corpo, limite de 10 conexões não atômico, ChatGPT só com a fatia 2, OpenClaw, Hermes e Muse Code não testados.

## Emenda 6 — v2 (solicitações), passo 1: recorte, comparação de preços, sem número e permissões por chave (PROPOSTA, 2026-11-26)

**Status:** proposta, **aguardando aprovação do Diego**. Sem código, sem migration, sem chamada ao Mercado Livre. Origem: `docs/superpowers/specs/2026-11-25-api-agentes-v2-solicitacoes-ideias.md` (ideias 2, 7 e 8 e permissões por chave). "Fatia 2 da API", no vocabulário do Diego, é esta v2; a fatia 2 desta ADR continua sendo o OAuth.

**Decisões do Diego (2026-11-26), registradas para as próximas fatias:**

1. Faturamento e lucro só em chave marcada para isso (permissão `vendas`, criada junto com a ferramenta "meu dia", passo 2).
2. Pedido de preço sem piso de margem: recusa só margem zero ou negativa, mostrando o número (ADR própria do pedido).
3. Pedido futuro aprovado só por administrador da loja.

### Ferramentas (somente leitura, mesma conta de `equilibrioDoMlb`, sem fórmula nova)

1. **Recorte e sem número no catálogo.** `publiai_margens_catalogo` ganha dois argumentos opcionais, excludentes:
   - `abaixo_de_pct` (número entre −100 e 100): devolve só anúncios com `margem_pct` menor que o valor (inclui negativos);
   - `sem_numero: true`: devolve só anúncios sem número (`margem_pct` nulo), com o `motivo` de cada um (`sem_custo`, `sem_origem`, `sem_dimensao`, `pacote_a_conferir`, `preco_nao_verificado`...).

   A varredura e o custo são os da página atual (mesmo cursor, mesma ordem por MLB): o filtro reduz a resposta, não a cota. A resposta ganha `examinados` (quantos anúncios a página leu) e `contagem_por_motivo` (contagem da página, para o agente não recalcular). Sem filtro, nada muda. Escolha por estender em vez de ferramenta nova: é a mesma varredura; uma ferramenta a mais seria o mesmo código com outro nome.
   **Tamanho da página com filtro:** 50, como hoje, até a medição abaixo. Se a medição mostrar folga de tempo, a página filtrada pode crescer (alvo: a loja inteira numa chamada até ~400 MLBs); isso só entra no texto depois de medido.
2. **`publiai_comparar_precos`** (nova): `identificador` (igual à margem) e `precos_brl` (2 a 5 preços, cada um válido como na simulação). Devolve, por preço, os anúncios e a `referencia` (pior margem do alvo), na mesma forma de `publiai_simular_margem`. Item, status e preço atual são lidos **uma vez**; a tarifa é consultada por preço (comissão e frete mudam por faixa). Alvo limitado a 20 anúncios (e não 60): 20 × 5 preços × 2 tarifas = 200 consultas por chamada no pior caso sem variações dentro do MLB. Sem "preço para atingir X%": com tarifa por faixa, achar o preço exige busca e muitas consultas; o agente compara a tabela.
3. **Instruções do `initialize`:** "abaixo de X%" → catálogo com `abaixo_de_pct`; "o que está sem margem e por quê" → catálogo com `sem_numero`; "entre A, B e C" → `publiai_comparar_precos`. Teste e guia (`docs/reference/acesso-de-agentes.md`, `docs/reference/api-agentes.md`) no mesmo commit.

### Permissões por chave

- Coluna `permissoes text[]` em `agente_conexoes` (migration, com OK). Valores agora: **`margens`** (`publiai_margem_anuncio`, `publiai_simular_margem`, `publiai_comparar_precos`) e **`catalogo`** (`publiai_margens_catalogo` com ou sem filtro: é o que consome cota em volume). `publiai_loja` vale para toda chave. `vendas` só nasce no passo 2, com a ferramenta.
- Chaves existentes recebem as duas (comportamento atual). Chave nova: as duas marcadas por padrão; o administrador desmarca na criação. Mudar depois: o administrador edita na tela, sem recriar a chave.
- `tools/list` mostra só as ferramentas permitidas. Chamada a ferramenta não permitida responde `estado: "sem_permissao"` (não 401: a chave é válida) e vai à auditoria com esse resultado. A permissão é lida na mesma consulta da conexão (`buscarConexaoPorHash`), antes de qualquer leitura de negócio; mudança vale na chamada seguinte.
- Não muda: organização só da conexão, isolamento, limites, auditoria, somente leitura. Nenhuma permissão dá escrita.

### Cota e tempo (o que já se sabe e o que falta medir)

**Medido (2026-11-26, SQL só leitura em produção, sem chamada ao ML):** MLBs publicados por loja, pai e filhos, distintos: Avil 374, Zaven 247, Daludi Shop 113, Hairfly Cosmeticos 84, DSA 29, Hairflay 5. Só um MLB (Avil) é do modelo legado com variações no cadastro (17 linhas). Só a Zaven tem o módulo ligado.

**Inferência pela fórmula do código** (`calcular` em `_shared/agentes/margens.ts`; não medido): uma varredura completa custa `2 × ⌈N/20⌉ + N` leituras e `2 × cores` tarifas. Avil: cerca de 412 leituras (de 3.000/dia) e cerca de 780 tarifas (de 5.000/dia), ou seja, umas 7 varreduras completas por dia pelo teto de leituras. Zaven: cerca de 272 leituras e 494 tarifas. A cota não parece ser o gargalo nas lojas atuais; uma loja com mais de ~2.700 MLBs não caberia numa varredura por dia.

**Não medido, e condição para prometer o recorte:** tempo de uma página de 50 na edge e de uma varredura completa, por página e no total; quantas tarifas vêm do cache; se uma chamada com 150 a 400 MLBs cabe no prazo da edge. Referência anterior: 100 leituras de `sale_price` com 8 em paralelo levaram 3,2 s (Emenda 5), mas a tarifa e o cadastro não entraram nesse número.

**Medição proposta (depende de OK):** ver "Pedido de OK" no fim desta emenda.

### Pedido de OK (antes de qualquer código)

1. **Aprovar esta emenda** (ou ajustar: permissões `margens`/`catalogo`, alvo de 20 na comparação, filtro no catálogo em vez de ferramenta nova).
2. **Medição M1, Zaven** (já autorizada no piloto): varrer o catálogo inteiro pela chave da Zaven, 5 páginas, e ler o tempo de cada chamada no log do gateway. Custo estimado: ~272 leituras e até ~494 tarifas no ML, todas GET, com o token da Zaven pela própria edge `agentes`. Nada escrito.
3. **Medição M2, Avil (opcional, a loja grande):** exige ligar o módulo e criar chave na Avil, ou uma edge temporária de diagnóstico (deploy). As duas escrevem configuração da loja ou publicam função, e a ADR-0092 exige autorização do cliente para a plataforma ler dado dele. Recomendação: fazer M1 e extrapolar para a Avil, marcando como inferência; M2 só quando a Avil ligar o módulo pelo roteiro de "Pode ligar em outra loja?".

Classificação: **crítica** (autorização por chave e migration). Depois da aprovação: plano curto, worktree, TDD, revisão independente do código (Codex Sol high) antes do merge; Grok para o que for só documentação.
