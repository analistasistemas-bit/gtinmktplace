# ADR-0132 — Análise Avançada com JoomPulse

**Status:** Aceito com bloqueios, **em revisão** — direção arquitetural aprovada; implementação não iniciada. Spike parcial executado em 2026-08-28 fechou as questões #1–#3 e produziu resultado **incompatível com a D-3**, o que aciona a revisão prevista na D-17. Questões #4–#15 (mais a nova #16) seguem bloqueando
**Data:** 2026-08-23
**Decisores:** Diego
**Relaciona:** [0119](0119-pulse-inteligencia-de-mercado-dirigida.md) (Pulse; o 403 de vendas por anúncio de terceiro), [0120](0120-pulse-sonar-garimpo-por-termo.md) / [0122](0122-sonar-vendas-estimadas-via-apify.md) (Sonar + Apify, fora do v1), [0130](0130-concorrentes-relevantes-pulse-viabilidade.md) (mercado relevante), [0086](0086-configuracao-org-scoped.md) (módulos), [0024](0024-camada-de-abstracao-de-canais.md) (Canal ≠ provedor de análise), [0027](0027-multi-tenancy-organizations.md) (multi-tenancy), [0043](0043-fluxo-canonico-de-migrations.md) (migrations canal único)

> **2026-08-28 — a JoomPulse confirmou que a parceria cobre uso server-to-server por um Gateway
> do PubliAI, e que as respostas podem ser cacheadas.** Isso fecha a questão #16 (levantada pelo
> Spike 038) e a #10. Com as decisões da ADR-0141, **as questões #7, #8, #10, #13, #14, #15 e #16
> estão fechadas** e a integração está **liberada para implementação**. Continuam pendentes apenas
> #4, #5, #6, #9, #11 e #12 — trabalho técnico contra o ambiente real, não decisão.
>
> **Revisão concluída 2026-08-28 → [ADR-0141](0141-analise-publiai-joompulse-radar-e-sonar.md).**
> A revisão exigida pela D-17 foi feita em entrevista com Diego e produziu a ADR-0141, que
> **supersede a D-3** (escopo do v1) e **emenda a D-7** (padrão de chamada). Todo o resto desta
> ADR permanece em vigor: Gateway como único cliente MCP (D-2), módulo desligado por padrão
> (D-4), OAuth por organização (D-5), conexão em Canais (D-6, com o rótulo renomeado para
> "Análise PubliAI"), allowlist fechada (D-9), isolamento por organização (D-15). As questões
> #4–#16 continuam bloqueando a implementação.
>
> **Adendo 2026-08-28 — spike parcial executado.** As questões #1, #2 e #3 estão fechadas;
> **#4–#15 continuam bloqueando** e uma questão nova (#16) foi levantada. O resultado é
> **incompatível com a D-3** e exige revisão da decisão antes de qualquer código, conforme a
> D-17. Ver a seção "Adendo — resultado do spike parcial" no fim deste documento e o
> [Spike 038](../spikes/038-joompulse-parcial-correlacao-e-semantica.md).
> A tabela de decisões abaixo **não foi alterada** — permanece como aprovada em 2026-08-23.

## Problema

O Radar não vê vendas por anúncio de concorrente porque a API do Mercado Livre devolve 403. A Viabilidade calcula margem sem demanda. A JoomPulse tem esse histórico e existe parceria formal autorizando a integração.

O PubliAI não deve falar MCP nem expor ferramentas, tokens ou detalhes do provedor ao operador. O enriquecimento também não pode vir ligado para todos os clientes, contaminar margem, piso, semáforo ou reprecificação, nem criar vazamento de dados entre organizações.

A integração introduz o primeiro backend próprio do PubliAI: hoje o Render serve apenas o frontend estático. Antes da implementação ainda é necessário validar, contra a JoomPulse real, OAuth multi-conta, refresh, ferramentas MCP disponíveis, schemas, identificadores, quotas, latência e o significado exato das estimativas.

## Decisão

| # | Decisão |
|---|---|
| D-1 | JoomPulse é provedor de dado, não copiloto. Margem, piso, semáforo e reprecificar continuam só no PubliAI. Nenhum dado da JoomPulse entra nesses cálculos, direta ou indiretamente. |
| D-2 | PubliAI nunca chama `https://joompulse.com/mcp`. Um Gateway de mercado, como Web Service separado no Render, é o único cliente MCP + OAuth. No v1, o browser chama a API HTTP do Gateway; não há Edge Function intermediando consultas de análise. O Gateway chama apenas a JoomPulse e os serviços necessários para autenticação, autorização e gate do módulo. |
| D-3 | O v1 só enriquece Radar com vendas e receita estimadas do rival e Viabilidade com demanda ao lado do semáforo. Sem dado não significa zero: a UI mostra travessão e estado explicativo. Falha nunca produz número inventado nem fallback para o menor preço observado, conforme ADR-0130. |
| D-4 | O módulo usa o slug `analise_avancada` em `/admin` → Módulos e fica desligado por padrão. O frontend não é autoridade: Gateway e qualquer Edge envolvida checam server-side `modulos_habilitados_da_org()`. Desligado significa telas e Canais iguais aos de hoje, ausência de novas chamadas ao Gateway e rejeição server-side caso alguém tente chamá-lo diretamente. Desligar não apaga ativamente dados já gravados nem a credencial da organização; caches continuam sujeitos ao TTL normal. |
| D-5 | Cada organização conecta a própria conta JoomPulse por OAuth no browser, com callback processado pelo Gateway. Só admin da organização pode conectar ou desconectar; super-admin apenas habilita o módulo. Access token e refresh token ficam exclusivamente no limite do Gateway, nunca no browser, Supabase ou payload do PubliAI. O storage definitivo das credenciais e a revogação remota no ato de desconectar permanecem **A definir**. |
| D-6 | Conectar mora em `/canais`, no bloco Análise Avançada, visível somente com o módulo ligado: JoomPulse ativo; Hunter Spy e Avant PRO "Em breve". São provedores de análise, não Canal, e ficam fora de `canais_habilitados` e do `ChannelConnector`. |
| D-7 | Pedido à JoomPulse ocorre somente no uso: abrir o detalhe de um concorrente no Radar ou rodar a Viabilidade. O cron do Pulse não chama o Gateway. Prefetch automático, enriquecimento em lote e Sonar ficam fora do v1. |
| D-8 | A API do Gateway é versionada sob `/v1` e expõe operações de domínio, nunca `tool` + `args`. Endpoints, schemas JSON, envelope de erro e limites máximos de payload devem ser fechados no contrato antes da implementação. Quebra de contrato exige nova versão. |
| D-9 | O Gateway mantém allowlist explícita de ferramentas MCP e parâmetros, somente para leitura e apenas nos scopes mínimos. Não existe proxy MCP genérico. Toda resposta do provedor é validada por schema, tipo e tamanho antes de sair do Gateway; resposta inválida é falha do provedor, não dado parcial confiável. |
| D-10 | A correlação não será presumida por GTIN. Radar parte de `MLB` e/ou `catalog_product_id`, enquanto alguns anúncios não têm GTIN. A chave canônica e a estratégia determinística de correlação permanecem **A definir** pelo spike. Até isso ser fechado, não haverá implementação nem fallback por título, texto ou similaridade. |
| D-11 | Cache é segregado primeiro por organização e credencial JoomPulse. A chave inclui versão do contrato, operação, identificador opaco da credencial, chave de correlação e janela consultada. Backend, TTLs e política de dado expirado permanecem **A definir**. Cache global por GTIN só poderá existir se a parceria permitir e o spike provar que a resposta é invariável entre contas. |
| D-12 | O Gateway terá rate limit por organização, por credencial/conta JoomPulse, por endpoint e global, além de single-flight para consultas simultâneas da mesma chave de correlação. Limites numéricos e timeouts permanecem **A definir** após medir quotas e latência. Como não há Edge→Gateway no v1, não existe timeout de Edge nesse fluxo; adotar essa topologia exigirá revisão desta ADR e definição explícita do orçamento de timeout. |
| D-13 | Módulo, conexão, saúde da credencial, plano/quota, disponibilidade do provedor e existência de dado para o item são estados distintos. Backend e UI não podem reduzi-los ao mesmo travessão ou ao mesmo erro genérico. |
| D-14 | O Gateway terá configuração declarativa em `render.yaml`, pipeline de CI, health check e deploy independente do frontend estático. Cold start e latência serão medidos no spike; metas e eventual mitigação permanecem **A definir**. |
| D-15 | Credenciais, caches, auditoria e qualquer persistência são isolados por organização. Postgres usa RLS; Redis ou cofre de segredos usa namespace e política equivalente. `org_id` nunca vem de payload, query string ou header controlado pelo cliente. Offboarding de organização ou término da parceria exige expurgo; prazos e o comportamento quando o usuário que conectou sai da organização permanecem **A definir**. |
| D-16 | O Gateway emite métricas por organização e credencial opaca, sem tokens: latência, cache hit, erros por classe, throttling, indisponibilidade, falhas de schema e falhas de refresh. Logs removem tokens, authorization codes, headers de autorização e payloads sensíveis. Alertas, redaction testada e procedimento de revogação em massa são pré-requisitos de produção. |
| D-17 | Um spike contra o ambiente real da JoomPulse é obrigatório antes de qualquer implementação. Resultado incompatível com esta ADR interrompe o trabalho e exige revisão da decisão; não autoriza troca silenciosa de topologia, identificador ou semântica. |
| D-18 | Termos de uso não são bloqueante: existe parceria formal para a integração. A parceria não elimina os bloqueios técnicos, de segurança e de semântica desta ADR. |

## Topologia e autenticação

O fluxo do v1 é:

1. Browser autentica normalmente no Supabase.
2. Browser chama a API HTTP `/v1` do Gateway com o JWT Supabase.
3. Gateway valida assinatura, issuer, audience, expiração e demais claims exigidas.
4. Gateway deriva usuário e organização a partir do token e da associação server-side; nunca aceita `org_id` enviado no payload.
5. Gateway verifica o módulo `analise_avancada` e, nas operações de conexão, o papel de admin da organização.
6. Gateway consulta a ferramenta MCP permitida, valida a resposta e devolve somente o schema do PubliAI.

CORS permite apenas as origens explícitas do PubliAI por ambiente; wildcard não é permitido. CORS não substitui autenticação.

Não haverá Edge→Gateway no v1. Se a chamada direta do browser se mostrar inviável no spike, esta ADR deve ser reaberta antes de adotar uma Edge como proxy.

### Contrato HTTP

Todos os endpoints ficam sob `/v1`. Antes da implementação, o contrato deve definir:

- caminhos e métodos;
- schemas de request e response;
- campos obrigatórios e nulabilidade;
- limites máximos de payload e resposta;
- timeouts e comportamento de cancelamento;
- paginação, se necessária;
- códigos HTTP e códigos estáveis de domínio;
- distinção entre ausência de dado e falha;
- identificador de correlação para suporte e observabilidade.

Os valores e schemas exatos estão **A definir** no spike. O contrato não pode aceitar nomes arbitrários de ferramenta MCP nem parâmetros livres.

## OAuth e credenciais

A autorização usa Authorization Code com:

- `state` imprevisível, de uso único e com expiração;
- PKCE;
- `nonce`;
- redirect URI fixa e previamente registrada;
- scopes mínimos e somente leitura;
- validação do usuário, organização e papel tanto no início quanto no callback;
- vínculo explícito entre usuário autenticado, organização, conta JoomPulse e credencial criada.

Somente admin da organização conecta ou desconecta. O Gateway registra auditoria com ator, organização, conta JoomPulse vinculada, instante e resultado, sem guardar token ou authorization code no log.

A credencial pertence à organização, não ao usuário que iniciou o OAuth. O comportamento quando esse usuário deixa a organização está **A definir** e deve ser fechado antes da produção.

Access e refresh tokens:

- permanecem apenas no Gateway;
- são cifrados em repouso;
- usam chave separada do banco;
- nunca aparecem em logs, métricas ou respostas;
- exigem procedimento de rotação de chave e revogação em massa;
- deixam de ser utilizáveis imediatamente após a desconexão local.

Permanecem **A definir**:

- Postgres gerenciado do Render, Vault ou solução equivalente;
- mecanismo exato de envelope encryption e rotação;
- suporte da JoomPulse a refresh token rotation;
- suporte a revogação remota;
- se "Desconectar" revoga na JoomPulse e apaga localmente ou, na ausência de endpoint de revogação, apenas inutiliza e apaga a credencial local.

Se o provedor não oferecer revogação, a limitação deve ser documentada na UI e no procedimento operacional; não pode ser ocultada.

## Gateway MCP fechado

O Gateway só pode executar ferramentas aprovadas após o spike. Para cada ferramenta haverá:

- nome fixo;
- finalidade de domínio;
- schema fechado de parâmetros;
- limites de tamanho e cardinalidade;
- scopes OAuth necessários;
- schema fechado da resposta;
- timeout;
- classificação dos erros;
- indicação de quais campos são estimativas.

Operações de escrita, descoberta arbitrária de ferramentas e repasse de parâmetros desconhecidos são proibidos. Resposta com tipo, tamanho ou schema inesperado é descartada e registrada como erro de integração, com conteúdo sensível removido do log.

A allowlist definitiva está **A definir** porque depende das ferramentas e schemas reais encontrados no spike.

## Semântica do dado

Toda métrica exibida deve informar obrigatoriamente:

- fonte: JoomPulse;
- `coletado_em`;
- janela temporal ou período de referência;
- unidade;
- moeda, quando aplicável;
- indicação explícita de estimativa;
- identificador usado na correlação.

A UI não exibe um número sem sua janela temporal. Se a JoomPulse fornecer apenas janela móvel, o rótulo deve informar isso. Janelas incompatíveis não são comparadas como se representassem o mesmo período.

Ausência de dado não vira `0`. Resposta vazia válida, credencial inválida, quota insuficiente, indisponibilidade e falha de schema são resultados diferentes.

Permanecem **A definir** após validação com a JoomPulse:

- janela disponível para vendas;
- janela disponível para receita;
- instante de corte e timezone;
- se a janela é fechada ou móvel;
- unidade e moeda da receita;
- regra de arredondamento;
- precisão armazenada e precisão exibida;
- significado estatístico e limitações das estimativas;
- política de exibição de cache expirado.

Independentemente dessas definições, dados JoomPulse são apenas informativos. Eles não entram em:

- margem;
- piso;
- semáforo;
- preço recomendado;
- reprecificação;
- seleção do menor preço observado;
- publicação ou atualização de anúncio.

Essa separação deve existir também no backend e nos testes, não apenas no layout.

## Correlação de itens

"Demanda por GTIN" não é contrato suficiente:

- Viabilidade pode partir de GTIN;
- Radar trabalha com anúncio `MLB` e/ou `catalog_product_id`;
- nem todo anúncio possui GTIN;
- um GTIN pode não representar sozinho o mesmo anúncio, kit ou variação;
- as ferramentas JoomPulse podem usar identificadores diferentes.

O spike deve produzir uma matriz verificável entre os identificadores aceitos pela JoomPulse e os disponíveis no PubliAI. A decisão final deve definir:

- chave canônica por caso de uso;
- transformações permitidas;
- prioridade entre `MLB`, `catalog_product_id` e GTIN;
- comportamento para kit, variação e item sem GTIN;
- resultado quando não existe correlação determinística.

Até essa decisão, não há fallback por título, descrição, categoria ou similaridade. Correlação ambígua resulta em "sem dado para este item", nunca em associação provável silenciosa.

## Persistência e cache

A implementação escolherá entre tabela persistida, Redis ou combinação dos dois somente após o spike medir custo, latência e repetição das consultas.

Regras independentes da tecnologia escolhida:

- isolamento por organização e credencial;
- nenhuma chave contém token bruto;
- chave versionada pelo contrato;
- TTL explícito por tipo de resposta;
- invalidação ou isolamento após troca de conta;
- single-flight para consultas concorrentes equivalentes;
- RLS em tabelas Postgres;
- namespace e política equivalente em Redis;
- limpeza no offboarding;
- não compartilhar cache entre organizações por padrão.

Cache global por GTIN só será permitido se:

1. a parceria autorizar o reaproveitamento;
2. a resposta não variar por conta, plano, região ou credencial;
3. a semântica e a janela forem idênticas;
4. essa invariância for comprovada no spike.

Backend, TTLs, política de stale data e esquema de persistência estão **A definir**.

## Rate limits, quotas e timeouts

Existem quatro limites independentes:

- por organização PubliAI;
- por credencial/conta JoomPulse;
- por endpoint;
- global do Gateway.

O Gateway também aplica single-flight para a mesma combinação de organização, credencial, operação, chave de correlação, janela e versão.

Uma resposta de quota ou throttling não é tratada como "sem dado". O Gateway evita retries em tempestade e retorna estado específico.

Permanecem **A definir**:

- limites numéricos;
- burst permitido;
- duração da janela;
- política de retry e backoff;
- timeout de conexão e resposta da JoomPulse;
- timeout total do Gateway;
- orçamento do browser;
- metas de latência;
- comportamento diante de cold start.

Como a topologia v1 não usa Edge, timeout de Edge não se aplica. Uma futura Edge→Gateway exige revisão desta ADR.

## Máquina de estados

Os estados são avaliados separadamente e não podem ser condensados em um booleano "JoomPulse disponível".

| Estado | Comportamento server-side | UI |
|---|---|---|
| Módulo desligado | Gateway rejeita a operação; nenhuma nova chamada à JoomPulse | Bloco Análise Avançada oculto e telas iguais às atuais |
| Módulo ligado, conta não conectada | Consulta não é executada | CTA para conectar a JoomPulse |
| OAuth em andamento | Estado e callback são validados | Estado de conexão em andamento; nova tentativa controlada |
| Conta conectada e credencial saudável | Consulta pode prosseguir | Estado conectado |
| Credencial expirada ou revogada | Consulta bloqueada; retry de refresh não entra em loop | "Reconectar" |
| Plano ou quota insuficiente | Consulta bloqueada ou limitada, sem retry automático contínuo | Mensagem específica de plano/quota |
| Provedor indisponível | Falha transitória, observável e sujeita à política de retry | Aviso de indisponibilidade e opção de tentar novamente |
| Resposta inválida | Dado descartado; erro de schema/tipo/tamanho | Aviso de indisponibilidade do dado |
| Sem dado para este item | Resposta válida e vazia; nunca convertida em zero | Travessão e mensagem "Sem dado para este item" |
| Dado disponível | Resposta validada | Valor com fonte, janela e `coletado_em` |

Transições mínimas:

- super-admin liga o módulo → organização volta ao estado real da credencial preservada ou "não conectada";
- super-admin desliga o módulo → estado funcional "módulo desligado", sem apagar ativamente a credencial;
- admin conclui OAuth → conta conectada;
- refresh retorna erro definitivo → credencial expirada;
- provedor retorna quota/plano → quota insuficiente;
- timeout, 5xx ou resposta inválida → provedor indisponível;
- resposta válida vazia → sem dado para o item;
- admin desconecta → não conectado;
- offboarding → credenciais e dados expurgados segundo política ainda **A definir**.

## Infraestrutura e operação

O Gateway é um novo Web Service no Render, separado do frontend estático. Antes de produção deve existir:

- `render.yaml` declarativo;
- build reproduzível;
- CI com lint, testes e validação do contrato;
- health check;
- configuração de ambientes;
- deploy e rollback independentes;
- gestão de segredos fora do repositório;
- medição de cold start;
- limites de CPU, memória e concorrência definidos após o spike;
- procedimento operacional para indisponibilidade da JoomPulse;
- procedimento de rotação e revogação em massa de credenciais.

O health check prova que o processo consegue atender requisições e acessar suas dependências internas. Ele não deve transformar uma indisponibilidade da JoomPulse em reinício contínuo do Gateway.

Metas numéricas de disponibilidade, latência e cold start estão **A definir**.

## Multi-tenancy e ciclo de vida

Toda autorização parte da identidade autenticada e da associação server-side à organização. O cliente nunca escolhe livremente a organização consultada.

Regras:

- módulo validado por organização;
- credencial vinculada à organização;
- cache e persistência vinculados à organização e à credencial;
- RLS em todo dado relacional persistido;
- nenhum token em tabela acessível pelo frontend;
- nenhuma resposta ou métrica expõe token;
- troca de conta não reaproveita cache de outra credencial sem prova de invariância;
- auditoria registra ator e conta vinculada;
- exclusão da organização e término da parceria disparam offboarding e expurgo.

Permanecem **A definir**:

- comportamento quando o usuário que conectou perde o papel de admin;
- comportamento quando esse usuário deixa a organização;
- possibilidade de uma conta JoomPulse ser vinculada a mais de uma organização;
- prazo de retenção de cache, auditoria e metadados;
- prazo e confirmação do expurgo;
- tratamento de organização suspensa, mas não excluída;
- processo de offboarding quando a parceria for encerrada globalmente.

## Observabilidade e resposta a incidente

Métricas mínimas:

- requisições e latência por endpoint;
- cache hit/miss;
- throttling por classe;
- quota insuficiente;
- falhas de autenticação e autorização;
- falhas de refresh;
- credenciais em estado expirado;
- erros e latência da JoomPulse;
- respostas rejeitadas por schema, tipo ou tamanho;
- cold starts;
- single-flight aplicado.

Organização e credencial aparecem apenas por identificadores internos ou opacos. Tokens, authorization codes, headers de autorização, parâmetros sensíveis e respostas integrais do MCP não entram em logs.

Antes da produção devem existir:

- testes de redaction;
- alertas para falha de refresh, aumento de erros, throttling e indisponibilidade;
- thresholds definidos;
- correlação entre request do PubliAI e chamada ao provedor;
- runbook de indisponibilidade;
- runbook de comprometimento de credencial;
- procedimento de revogação em massa;
- responsável operacional definido.

Thresholds e canal dos alertas estão **A definir**.

## Spike obrigatório

Nenhuma implementação de produção começa antes de um spike comprovar e registrar:

1. fluxo OAuth com múltiplas contas e organizações;
2. suporte a `state`, PKCE, `nonce` e redirect URI fixa;
3. expiração, refresh, refresh token rotation e revogação;
4. scopes mínimos disponíveis;
5. ferramentas MCP necessárias e confirmação de que são somente leitura;
6. schemas reais de request e response;
7. limites de tamanho;
8. identificadores aceitos e estratégia de correlação;
9. janela, timezone, arredondamento e significado das estimativas;
10. diferença ou invariância das respostas entre contas e planos;
11. quotas e rate limits;
12. latência, timeout e cold start;
13. comportamento de erro, resposta vazia e dado parcial;
14. compatibilidade da topologia browser→Gateway com JWT Supabase e CORS restrito;
15. storage de credenciais, cifragem e rotação;
16. requisitos de cache e TTL;
17. condições operacionais da parceria formal.

O spike deve usar pelo menos duas organizações e duas credenciais distintas para validar isolamento. Tokens e respostas sensíveis não entram no relatório.

Se qualquer premissa estrutural falhar, a ADR volta para decisão antes de código de produção.

## Questões abertas

As seguintes questões bloqueiam a implementação:

1. Qual identificador fecha deterministicamente Radar e Viabilidade com as ferramentas JoomPulse?
2. Quais ferramentas MCP entram na allowlist e quais são seus schemas?
3. Quais são as janelas, timezone, precisão, arredondamento e limitações das estimativas?
4. Qual é o contrato HTTP completo de `/v1`, incluindo endpoints, schemas, erros e limites?
5. Credenciais ficam em Postgres gerenciado, Vault ou solução equivalente?
6. Como funcionam cifragem, backup e rotação das chaves?
7. A JoomPulse oferece revogação e refresh token rotation?
8. O que "Desconectar" executa remotamente e quais dados locais remove?
9. Cache usa tabela, Redis ou ambos? Quais TTLs e política de dado expirado?
10. O contrato permite cache global e a resposta é invariável entre contas?
11. Quais são os rate limits, timeouts, retries e metas de latência?
12. Qual cold start é aceitável e qual mitigação será necessária?
13. O que ocorre quando quem conectou perde o papel ou deixa a organização?
14. Quais são os prazos de retenção e expurgo no offboarding?
15. Quais alertas, thresholds e responsáveis operacionais serão adotados?

## Critérios de aceite

A implementação só pode ser considerada pronta quando:

- [ ] O spike foi concluído e todas as questões bloqueantes foram fechadas nesta ADR ou em ADR sucessora.
- [ ] A parceria formal está registrada como autorização para o uso acordado.
- [ ] O Gateway possui `render.yaml`, CI verde, health check, deploy e rollback documentados.
- [ ] Browser→Gateway usa JWT Supabase válido, CORS restrito e nunca aceita `org_id` do cliente.
- [ ] Tentativas de acesso cruzado entre duas organizações são rejeitadas em teste contra runtime real.
- [ ] Gateway e qualquer Edge envolvida verificam `analise_avancada` server-side.
- [ ] Módulo desligado preserva a experiência atual e produz zero chamadas novas à JoomPulse.
- [ ] Somente admin da organização conecta e desconecta.
- [ ] OAuth valida `state`, PKCE, `nonce`, redirect URI, usuário, organização e conta.
- [ ] Tokens ficam somente no Gateway, cifrados e ausentes de logs, respostas e métricas.
- [ ] Allowlist MCP contém somente ferramentas e parâmetros de leitura necessários.
- [ ] Requests e responses são validados por schema, tipo e tamanho.
- [ ] Correlação funciona para os casos suportados e falha de forma explícita nos não suportados.
- [ ] Toda métrica mostra fonte, janela e `coletado_em`.
- [ ] Ausência de dado não vira zero.
- [ ] Dados JoomPulse não alteram margem, piso, semáforo, preço recomendado ou reprecificação, comprovado por testes.
- [ ] Estados desligado, não conectado, expirado, quota insuficiente, indisponível e sem dado têm respostas e UI distintas.
- [ ] Credencial expirada mostra "Reconectar".
- [ ] Rate limits, single-flight, timeouts e política de retry foram testados.
- [ ] Cache não cruza organizações ou credenciais.
- [ ] Persistência relacional possui RLS e foi validada em Postgres real.
- [ ] Logs passam por teste de redaction.
- [ ] Métricas, alertas e runbook de revogação em massa estão ativos.
- [ ] Fluxo completo foi validado com duas organizações e credenciais diferentes contra a JoomPulse real.
- [ ] Falha ou indisponibilidade mantém Radar e Viabilidade utilizáveis sem dado inventado.

## Plano de reversão

A reversão funcional usa os mecanismos já definidos:

1. desligar `analise_avancada` para as organizações afetadas;
2. confirmar que o Gateway rejeita novas consultas e que as telas voltaram ao comportamento atual;
3. interromper ou reverter o deploy do Gateway sem alterar o frontend estático;
4. preservar credenciais e dados quando a reversão for apenas funcional, conforme D-4;
5. em incidente de segurança, inutilizar credenciais locais, executar revogação em massa quando suportada e expurgar material comprometido;
6. reverter alterações de banco por nova migration, nunca por DDL manual, conforme ADR-0043;
7. não reutilizar dados coletados durante janela suspeita até sua validade ser confirmada.

Se a causa for incompatibilidade de contrato, identificador ou semântica, o módulo permanece desligado até revisão desta ADR. Não haverá fallback para integração direta, proxy MCP genérico, conta compartilhada ou dado estimado localmente.

## Alternativas descartadas

- Chat/MCP dentro do Pulse
- PubliAI chamando o MCP direto
- Browser chamando a JoomPulse diretamente
- Proxy fino `tool` + `args`
- Edge→Gateway no v1
- Conta JoomPulse compartilhada entre organizações
- Token JoomPulse no frontend ou Supabase
- Ligar no checkbox Pulse
- Bloco Análise Avançada sempre visível no Canais
- Enriquecer o Sonar no v1
- Pedir no ciclo automático do Radar
- Prefetch ou coleta em lote no v1
- Tratar ausência de dado como zero
- Usar menor preço observado como fallback
- Correlacionar silenciosamente por título ou similaridade
- Cache global por GTIN sem autorização e prova de invariância

## Consequências

- O diferencial do Pulse permanece; a JoomPulse cobre a lacuna criada pelo 403 sem assumir decisões do PubliAI.
- Análise Avançada exige dois interruptores: módulo habilitado pelo super-admin e conexão JoomPulse administrada pela organização.
- A integração cria o primeiro backend próprio e aumenta a superfície operacional, de segurança e observabilidade.
- Browser→Gateway evita uma Edge intermediária no v1, mas exige JWT, CORS e autorização server-side corretos no Gateway.
- Token e refresh ficam fora do PubliAI e exigem storage, cifragem, rotação e offboarding próprios.
- Hunter Spy e Avant PRO no mesmo bloco estabelecem o lugar de futuros provedores sem transformá-los em Canal.
- A parceria formal remove o bloqueio de termos de uso, mas não substitui o spike nem resolve identificadores, semântica, quotas ou ciclo de vida.
- Enquanto as questões abertas não forem fechadas, a direção arquitetural está aceita, mas a implementação permanece bloqueada.

---

## Adendo — resultado do spike parcial (2026-08-28)

Fonte: [Spike 038](../spikes/038-joompulse-parcial-correlacao-e-semantica.md), executado contra o
MCP real da JoomPulse. Este adendo **registra achados e aponta o que precisa de revisão**; ele
não altera nenhuma decisão `D-*`, conforme o procedimento da D-17.

### Questões fechadas

| # | Resposta |
|---|---|
| 1 | **Não existe GTIN nos cubos da JoomPulse.** As chaves são `id` (listagem `MLB…`) e `productId` (catálogo; stub `MLB-…` para não-catálogo). Ambas **já existem** no PubliAI como `ml_item_id` e `catalog_product_id`; a Viabilidade já carrega o `product_id` resolvido e já falha explicitamente quando ele é nulo. Nenhum mecanismo novo de correlação precisa ser criado. |
| 2 | Uma única ferramenta no v1: `query_cubejs_meli`. Ela **não expõe operações de domínio** — recebe uma string JSON no formato CubeJS `/load`. A allowlist da D-9 é, portanto, de **cubos/dimensões/measures/filtros**, montados pelo Gateway; nunca fragmento vindo do cliente. Reforço concreto: a chave `segments` é **descartada em silêncio e devolve linhas sem filtro, sem erro**. |
| 3 | `orderCount*`/`orderGmv*`/`catalog*` são estimativas (divulgação obrigatória pela própria fonte); `priceAmount` é real; `sold`/`soldItem`/`catalogSales` são faixas vitalícias do selo do ML; `conversionRate` não é populado. Janelas `1d/1w/1m` são **móveis**, ancoradas no snapshot D-1 (coleta ~03:25 UTC, lag ~24h). `orderCountMin/Max` são agregadores do slice, **não banda de confiança** — a estimativa é rótulo, não faixa. |

### Achado que exige revisão da D-3 e da D-10

`orderCount1m` **concentra-se no ganhador do buy-box**; as demais listagens do mesmo catálogo
devolvem `0`. Verificado em 3 catálogos com 15 listagens, e confirmado pela regra `SN-10` da
própria JoomPulse. Num catálogo com 15–18 concorrentes, 14 a 17 devolvem `0` — e esse `0`
significa "não atribuído a esta listagem", não "não vendeu".

A D-3 promete "vendas e receita estimadas **do rival**". A fonte entrega a estimativa **do
ganhador do buy-box** mais a demanda **do catálogo**. São coisas diferentes, e exibir o `0` como
venda do rival seria dado inventado — o inverso exato do que a D-3 proíbe.

A máquina de estados também fica curta: "Sem dado para este item" precisa virar quatro estados
distintos (não rastreado / ganhador com estimativa / não-ganhador com demanda de catálogo /
catálogo sem venda estimada). Tabela-verdade no Spike 038.

### Questão nova

**#16 — a superfície entregue é um assistente analítico voltado a agente, não uma API de dados**
(scripts de recusa, divulgação obrigatória, e roteamento explícito da análise de concorrentes
para a UI da JoomPulse). A D-18 foi escrita antes de alguém ver essa superfície. Falta confirmar
com a JoomPulse se a parceria cobre uso server-to-server por um Gateway do PubliAI, ou se existe
API de dados própria para esse fim.

### Continua bloqueado

Questões **#4–#15** — nenhuma delas é testável a partir desta superfície: OAuth multi-conta,
refresh, revogação, storage/cifragem de credencial, cache e invariância entre contas, quotas,
latência, cold start, ciclo de vida, expurgo e alertas. A cobertura real (quantos anúncios do
PubliAI existem no snapshot da JoomPulse) também **não foi medida** e precisa de sonda em
produção.

---

## Errata 1 (2026-08-29) — o Gateway existe: contrato inicial, onde mora e como é testado

Fecha a **questão #4** (contrato HTTP) e decide a colocação do serviço, que a ADR não tinha
tratado. Não fecha #5/#6 (credencial), #9 (cache) nem #11/#12 (limites) — nada disso está
implementado, e a Errata diz o que ficou de fora justamente para não parecer pronto.

### E-1 — O Gateway mora em `gateway/`, sob o tooling da raiz

Não é pacote pnpm separado, e isso é decisão de **cobertura de CI**, não de gosto.

O CI da raiz roda `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm build` (`tsc -b`) e a
suíte do vitest. Um `gateway/` com `package.json` e lockfile próprios não seria alcançado por
nenhum desses: ficaria sem lint, sem type check e sem teste — no serviço que guarda credencial
OAuth de todas as organizações e aplica o gate do módulo. Seria o código menos verificado do repo
protegendo o dado mais sensível, com os checks obrigatórios verdes o tempo todo.

A colocação sob a raiz resolve isso sem tocar em `pnpm-workspace.yaml` nem no lockfile:

| Amarra | Como o gateway entra |
|---|---|
| Type check | `gateway/tsconfig.json` referenciado por `tsconfig.json` → entra no `tsc -b` do `pnpm build` |
| Lint | `eslint .` já varre `gateway/` (verificado com erro proposital: acusou) |
| Testes | `./gateway/__tests__/**/*.test.ts` no `include` do `vitest.config.ts` |
| Deploy | segundo serviço no `render.yaml`, `rootDir: .`, `pnpm gateway:build` / `pnpm gateway:start` |

Os três primeiros alimentam o gate `frontend`, que é check exigido pela proteção da `main`. Job
novo de CI teria sido inútil: sem ser adicionado à proteção, não bloqueia nada.

### E-2 — Contrato `/v1`: operações de domínio e envelope de erro com código

Mantém a D-8 e a instancia. Rotas desta entrega:

| Rota | Auth | Resposta |
|---|---|---|
| `GET /health` | pública | `{ ok, versao, contrato }` |
| `GET /v1/sessao` | Bearer | `{ org_id, is_admin, modulo_habilitado }` |

`/health` é público de propósito: o Render precisa dele antes de qualquer credencial existir, e
ele não revela nada de organização nenhuma.

Erro tem envelope único, `{ erro: { codigo, mensagem } }`. **O código é a parte que importa** — a
D-13 exige estados distintos, e a UI precisa diferenciar "seu token venceu" de "sua organização
não tem o módulo". Códigos: `sem_token`, `token_invalido`, `perfil_ausente`, `perfil_inativo`,
`sem_org`, `modulo_desligado`, `rota_desconhecida`, `metodo_nao_suportado`, `erro_interno`.

Falta de identidade responde **401**; falta de permissão, **403**.

### E-3 — A ordem das verificações é regra, não acaso

Token → usuário → perfil → ativo → org → módulo. Um token inválido **nunca** pode produzir
"módulo desligado", que mandaria o operador procurar problema na configuração da organização
quando o problema é a sessão dele. Há teste que prova a ordem: com token inválido, a consulta de
módulos nem é chamada.

### E-4 — `org_id` sai do token, e o Gateway usa service role para isso

A D-15 diz que `org_id` nunca vem de payload. Em consequência, o Gateway **verifica o JWT** e lê
`profiles` e `organizations.modulos_habilitados` por conta própria, com service role. Com o token
do chamador ele leria pelas mesmas lentes de quem pergunta, e o gate da D-4 deixaria de ser
server-side.

Service role ignora RLS, então a contrapartida está no código: toda consulta filtra pelo `org_id`
já derivado do token. **Não se usa `resolverOrgPorUserId`** (`_shared/faturamento/io.ts`), que
resolve org por `marketplace_connections` — é o padrão que causou o incidente de 2026-08-11, em
que um membro cadastrou e outro era dono da conexão.

`is_active` nulo é tratado como **inativo**: perfil sem a flag preenchida não prova acesso.

### E-5 — CORS com allowlist explícita, sem curinga

A D-2 põe o browser chamando o Gateway direto, o que torna o CORS superfície de segurança. A
origem vem de `ORIGENS_PERMITIDAS` (lista por vírgula) e `*` é proibido: curinga somado a
`Authorization` é exatamente o que o navegador tenta impedir. `Vary: Origin` sempre presente, para
um proxy não servir a uma origem a resposta liberada para outra.

### O que esta entrega NÃO faz

- **Não fala com a JoomPulse.** Nenhuma chamada MCP, nenhuma allowlist de ferramenta (D-9).
- **Não guarda credencial** (#5/#6) nem implementa o OAuth da D-5.
- **Não tem cache** (#9, D-11) nem rate limit (#11/#12, D-12).
- **Não tem métricas** (D-16) além de log de erro.

Verificado antes do commit: 16 testes verdes, `tsc -b` limpo, `eslint` sem erro, e smoke real com
o serviço no ar — `/health` 200, `/v1/sessao` 401 com `sem_token`, 404, 405, preflight 204, origem
fora da allowlist sem cabeçalho de CORS, e boot recusado sem variável obrigatória.

---

## Errata 2 (2026-08-29) — OAuth e credencial: endpoints medidos, PKCE, cifragem e a confirmação da D-27

Fecha as questões **#5** (storage da credencial) e **#6** (cifragem), e implementa o OAuth da D-5.
Continua sem fechar #9 (cache) e #11/#12 (limites).

### E-6 — Os endpoints do provedor foram MEDIDOS, não presumidos

Lidos em `https://joompulse.com/.well-known/oauth-authorization-server` em 2026-08-29:

| Campo | Valor |
|---|---|
| `authorization_endpoint` | `https://joompulse.com/oauth2/authorize` |
| `token_endpoint` | `https://joompulse.com/noauth/oauth2/token` |
| `introspection_endpoint` | `https://joompulse.com/noauth/oauth2/introspect` |
| `grant_types_supported` | `authorization_code`, `refresh_token` |
| `code_challenge_methods_supported` | `S256` |
| `token_endpoint_auth_methods_supported` | `client_secret_post`, `client_secret_basic`, `none` |
| `scopes_supported` | `mcp` |

`POST /mcp` sem token responde `401` com
`WWW-Authenticate: Bearer resource_metadata="https://joompulse.com/.well-known/oauth-protected-resource"`,
confirmando o par recurso/servidor de autorização.

**A ADR-0141 D-27 fica confirmada tecnicamente.** Ela adotava o pior caso — "revogação remota é
inexistente até prova em contrário" — porque o suporte não soube informar. O metadado do próprio
servidor de autorização **não anuncia `revocation_endpoint`**: não existe revogação padronizada a
chamar. A UI deve continuar dizendo que a autorização pode seguir ativa do lado da JoomPulse.

Existe, em compensação, `introspection_endpoint`: dá para **detectar** credencial já inválida.
Detectar, não causar. Isso vira insumo do estado de saúde da credencial (D-13), não uma promessa
de revogação.

E `refresh_token` está em `grant_types_supported`, o que responde metade da questão #7: renovação
existe. Se há **rotação** do refresh a cada uso, só o uso real dirá — por isso `renovarComRefresh`
preserva o refresh antigo quando o provedor não devolve um novo. Descartá-lo desconectaria a
organização no ciclo seguinte.

### E-7 — PKCE S256 sempre, e o `code_verifier` nunca sai do servidor

O provedor suporta `S256` e aceita client público (`none`). O Gateway usa PKCE **mesmo quando há
client secret**: protege o `code` em trânsito, e torna o serviço utilizável antes de a JoomPulse
emitir um segredo — `JOOMPULSE_CLIENT_SECRET` é opcional por isso.

O `code_verifier` fica no banco, ligado ao `state`. Se trafegasse pelo browser junto do state, o
PKCE deixaria de proteger contra interceptação do code. Há teste que prova que a URL de
autorização não contém o verifier.

### E-8 — O `state` é a única prova de identidade no callback

O redirect da JoomPulse chega ao Gateway **sem o JWT do usuário**. Em consequência, o `state`:

- é aleatório de 32 bytes (`randomBytes`, url-safe);
- vale **10 minutos**;
- é de **uso único**, marcado por `UPDATE ... WHERE usado_em IS NULL` — não por ler-e-depois-escrever,
  porque duas requisições simultâneas com o mesmo state precisam que exatamente uma vença;
- é comparado em tempo constante, defesa contra um repositório que faça match frouxo.

Quatro recusas distintas, todas com teste: `desconhecido`, `expirado`, `ja_usado`, `nao_confere`.
Nenhuma delas chama o provedor.

### E-9 — Cifragem: AES-256-GCM, chave fora do banco

Envelope `base64(iv[12] || tag[16] || ciphertext)`, IV aleatório por operação.

**GCM e não CBC porque autentica:** ciphertext adulterado falha ao abrir, em vez de devolver lixo
que o resto do código trataria como token. Há teste virando um bit do ciphertext e outro virando
um bit da tag; os dois têm de falhar.

A chave (`CREDENCIAL_CHAVE_BASE64`, 32 bytes) vive na env do Web Service e **nunca no banco**. Um
dump do Postgres, sozinho, não dá acesso à JoomPulse — é o ponto de cifrar em vez de confiar só na
RLS. Chave ausente ou de tamanho errado **derruba o boot**: não pode degradar para "guardar sem
cifrar".

`versao_chave` na tabela permite rotacionar sem reconectar todas as orgs de uma vez. Credencial
gravada com versão diferente da atual **falha e pede reconexão**, em vez de decifrar com a chave
errada e tratar o resultado como token.

### E-10 — Schema: duas tabelas, nenhum grant a `authenticated`

`joompulse_credenciais` (uma linha por org, vive até o "Desconectar") e `joompulse_oauth_estados`
(uma por tentativa, vive 10 minutos).

Diferente das tabelas do Pulse, **nem o membro da própria organização recebe `select`**: o
conteúdo é credencial, não dado de tela. RLS ligada e nenhuma policy permissiva — o acesso é do
Gateway, com service role. As policies ausentes e o `revoke` são duas trancas independentes, o
mesmo raciocínio já registrado na migration do Pulse.

### E-11 — Rotas novas

| Rota | Método | Quem pode | O que faz |
|---|---|---|---|
| `/v1/oauth/iniciar` | POST | **admin da org** (D-5) | gera state+PKCE, guarda no servidor, devolve a URL de autorização |
| `/v1/oauth/callback` | GET | ninguém autenticado — o `state` é a prova | troca o code, grava cifrado, redireciona ao app |
| `/v1/oauth/conexao` | DELETE | **admin da org** (D-5) | apaga a credencial |
| `/v1/sessao` | GET | qualquer membro | agora informa `conectado` e `expira_em` |

O callback **sempre** termina em redirect para a tela de Canais com `?joompulse=<resultado>`: o
usuário está numa janela de navegador, e JSON cru ali seria um beco sem saída. Falha na troca do
code redireciona com `falha_troca` e **não** ecoa o erro do provedor na URL, que pode carregar
fragmento do code.

`DELETE /v1/oauth/conexao` responde `{ desconectado: true, revogado_no_provedor: false }`. O
segundo campo é honestidade obrigatória pela E-6: o Gateway apagou a credencial local e **não**
revogou nada na JoomPulse.

### O que esta entrega ainda NÃO faz

- **Não consulta o MCP.** Nenhuma chamada de ferramenta, nenhuma allowlist (D-9).
- **Não tem cache** (#9, D-11) nem rate limit (#11/#12, D-12).
- **Não renova sozinho:** `renovarComRefresh` existe e está testado, mas nada o chama ainda — o
  laço de renovação entra junto da primeira consulta real.
- **A migration não foi aplicada em produção.** O arquivo está no repo; `supabase db push` é passo
  separado, com o Diego.

Verificado antes do commit: 54 testes no gateway, `tsc -b` limpo, `eslint` sem erro, e smoke com o
serviço no ar — `/health` 200, `iniciar` sem token 401, 405 em método errado, callback com state
desconhecido e com recusa do usuário redirecionando corretamente, `DELETE` sem token 401, e boot
recusado tanto sem a chave quanto com chave de 16 bytes.

---

## Errata 3 (2026-08-29) — o Gateway dispensa o `client_id` da JoomPulse (modo CIMD)

Responde a pergunta "dá para funcionar sem a JoomPulse fornecer o `client_id`?". **Provavelmente
sim**, e o Gateway agora está pronto para os dois caminhos.

### E-12 — O provedor declara suporte a Client ID Metadata Document

Do metadado lido na Errata 2, duas linhas decidem:

- `client_id_metadata_document_supported: true`
- **não existe** `registration_endpoint`

A ausência de `registration_endpoint` fecha o registro dinâmico. A presença do CIMD abre outra
porta: o `client_id` pode ser uma **URL HTTPS que serve um documento descrevendo o próprio
cliente**. Em vez de a JoomPulse emitir um identificador, o Gateway **publica um documento e o
endereço dele vira o identificador**.

O Gateway passa a servir esse documento em **`GET /v1/client-metadata.json`**, público — quem o
busca é o servidor de autorização, server-to-server, antes de qualquer usuário existir. Exigir
token ali quebraria o fluxo inteiro.

Conteúdo: `client_id` (idêntico à URL de publicação), `client_name`, `redirect_uris` com **um só**
endereço, `grant_types` exatamente os que a JoomPulse anuncia (`authorization_code`,
`refresh_token`), `response_types: [code]`, `scope: mcp` e `token_endpoint_auth_method` — `none`
sem secret, `client_secret_basic` com secret. Nenhum segredo entra num documento que é público por
construção; há teste que verifica isso.

### E-13 — Coerência do `client_id` é conferida no boot

A especificação exige que o `client_id` **dentro** do documento seja idêntico à URL de onde ele foi
servido. Como o Gateway publica num caminho fixo, um `client_id` HTTPS apontando para outro lugar
jamais funcionaria — e o erro apareceria no meio da conexão de um cliente, não no deploy.

Por isso o boot recusa: `JOOMPULSE_CLIENT_ID` começando com `https://` **precisa** terminar em
`/v1/client-metadata.json`. Identificador opaco (caminho registrado) passa sem checagem, porque
não há o que conferir.

### O que NÃO foi provado

Testei o `authorize` com um `client_id` inventado e com um em forma de URL: **os dois responderam a
mesma coisa** — redirect para a tela de login da JoomPulse. O servidor só valida o cliente depois
que o usuário autentica, então sem sessão os dois casos são indistinguíveis e o teste não conclui
nada.

Um `POST /oauth2/register` não anunciado devolveu **429**, não 404. Rate limit não é evidência nem
de existir nem de não existir, e insistir num provedor parceiro seria má prática — o probe parou aí.

**O teste que resolve exige uma conta JoomPulse logada:** com o Gateway no ar, abrir a URL de
autorização usando a própria URL do serviço como `client_id` e ver se o provedor aceita. Só o
Diego pode fazer.

**Consequência prática:** o `client_id` da JoomPulse deixa de ser bloqueio para *subir e testar*.
Se o CIMD funcionar, ele deixa de ser necessário; se não funcionar, o campo continua aceitando o
identificador opaco sem nenhuma mudança de código.

Verificado antes do commit: 68 testes no gateway, e smoke com o serviço no ar — documento servido
em 200 sem token, `client_id` batendo com a URL de publicação, `token_endpoint_auth_method: none`
sem secret, nenhum segredo no corpo, `POST` no mesmo caminho devolvendo 404, e boot recusando um
`client_id` HTTPS incoerente.

---

## Errata 4 (2026-08-29) — o login da JoomPulse é por telefone e chave, e isso muda a janela do OAuth

### E-14 — A autenticação acontece INTEIRA na JoomPulse, e o PubliAI nunca vê telefone nem chave

Informado por Diego: a JoomPulse não usa usuário e senha. O operador informa o **telefone** e
recebe uma **chave por mensagem**.

Isso **não muda nada** no desenho, e é exatamente o motivo de o fluxo ser OAuth: o navegador é
enviado para a tela da própria JoomPulse, o operador se autentica lá do jeito que eles definirem,
e o PubliAI recebe apenas a credencial no final. **Telefone e chave nunca passam pelo PubliAI.**

Fica registrado como restrição para quem for mexer depois: **nunca** construir uma tela de login
da JoomPulse dentro do PubliAI. Pedir o telefone ou a chave do operador na nossa interface seria
coletar credencial de terceiro — e destruiria a razão de existir do OAuth. Se um dia a tela deles
mudar de método, o PubliAI não precisa saber.

### E-15 — A janela do `state` subiu de 10 para 20 minutos

Consequência prática do E-14. O `state` precisa sobreviver ao caminho inteiro:

> clicar em Conectar → tela da JoomPulse → digitar telefone → **esperar a mensagem chegar** →
> digitar a chave → aprovar o acesso → voltar ao PubliAI

Os 10 minutos originais foram dimensionados para "ida e volta ao provedor", que é o caso de um
login com senha. Com espera de mensagem no meio, uma entrega lenta ou uma distração estouram a
janela, e o operador volta para **"estado expirado" tendo feito tudo certo** — o pior tipo de
erro, porque não indica o que corrigir.

20 minutos cobrem a espera com folga e continuam curtos para um segredo de uso único, que segue
protegido por 32 bytes de aleatoriedade, uso único e PKCE.

Há teste travando o piso em 15 minutos e o teto em 60, para que ninguém encurte a janela sem
perceber e para que ela nunca vire sessão. Verificado em RED: com 10 minutos, o teste reprova.

---

## Errata 5 (2026-08-29) — o CIMD é anunciado mas não funciona: precisamos do `client_id` da JoomPulse

Fecha a hipótese aberta na Errata 3. **A resposta é não:** o `client_id` da JoomPulse **é
necessário**.

### E-16 — Medido: o provedor recusa o cliente sem sequer buscar o documento

Com o Gateway no ar (`https://publiai-gateway-mercado.onrender.com`) e o documento publicado e
acessível, Diego abriu a URL de autorização usando a URL do documento como `client_id`. Resultado:

```json
{"error":"invalid_client","error_description":"client authentication failed"}
```

O navegador exibiu, junto, um diálogo de usuário e senha — que **não é** a tela de login da
JoomPulse (que é por telefone + chave, ver Errata 4). É o prompt nativo do Chrome para HTTP Basic,
disparado pelo `401` + `WWW-Authenticate: Basic` que a RFC 6749 §5.2 manda emitir em
`invalid_client`. Vale registrar para ninguém reabrir esse diagnóstico do zero: **o diálogo é
sintoma do erro OAuth, não um método de login alternativo.**

**O que decide a questão** é o log de acesso do Gateway (introduzido justamente para isso): na
janela que cobre a tentativa, **não houve nenhuma requisição da JoomPulse ao
`/v1/client-metadata.json`**. As únicas leituras do documento foram um teste nosso e os health
checks do Render.

Ou seja: o servidor de autorização **recusou o cliente sem tentar resolvê-lo**. O
`client_id_metadata_document_supported: true` do metadado (Errata 2) **não corresponde ao
comportamento** do endpoint de autorização.

### E-17 — Consequência: pedir o `client_id`, e o código não muda

O campo `JOOMPULSE_CLIENT_ID` já aceita as duas formas (Errata 3), então adotar o identificador
emitido por eles é **trocar o valor de uma variável de ambiente** — nenhuma alteração de código, e
o PKCE continua valendo.

Dados a informar à JoomPulse:

| Campo | Valor |
|---|---|
| Redirect URI | `https://publiai-gateway-mercado.onrender.com/v1/oauth/callback` |
| Escopo | `mcp` |
| Fluxo | authorization code + PKCE (S256) |
| Client secret | opcional — `none` está em `token_endpoint_auth_methods_supported` |

Vale mencionar a eles que o metadado anuncia suporte a Client ID Metadata Document e o
`/oauth2/authorize` não o honra — pode ser defeito do lado deles, e a informação é útil.

**Ressalva honesta:** a primeira tentativa de Diego ocorreu quando o serviço podia estar hibernando
(plano free, Errata do `render.yaml`). Se a JoomPulse tentou buscar o documento naquele momento,
falhou e guardou um resultado negativo em cache, o comportamento observado depois seria o mesmo. O
código do CIMD **fica onde está** — custa nada e volta a valer se eles corrigirem ou se a hipótese
do cache se confirmar.
