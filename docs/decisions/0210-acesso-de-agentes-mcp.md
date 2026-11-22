# ADR-0210 — Acesso de agentes: servidor MCP, conexão por chave ou por autorização, v1 só leitura de margens

**Status:** Proposta (entrevista grill-with-docs de 2026-11-22; aguarda aprovação do Diego)
**Data:** 2026-11-22
**Decisores:** Diego
**Emenda:** [0092](0092-identidade-da-plataforma-e-acesso-super-admin.md) — a chave de plataforma é exceção declarada à exigência de sessão de suporte para leitura (decisão 3).
**Relaciona:** [0027](0027-multi-tenancy-organizations.md) (organização), [0179](0179-painel-de-ads.md) (ACOS de equilíbrio pelo preço, emenda de 2026-10-20), [0170](0170-central-de-promocoes-ml.md) (projeção do líquido), [0055](0055-imposto-por-origem-nacional-importado.md) e [0208](0208-aliquota-com-vigencia.md) (imposto), [0165](0165-faixas-regressivas-por-organizacao.md) (modalidade comercial), [0189](0189-extensao-publiai-navegador.md) (precedente de cliente fora do app).
**Glossário:** `CONTEXT.md` § Acesso de agentes.

> O número 0209 não foi usado: já é citado no repositório como a decisão da capa de kit com modelos.

---

## Contexto

O PubliAI não tem API para terceiros: as edge functions atendem o front com o JWT do usuário. O Diego quer que agentes (claude.ai, ChatGPT, Grok, Hermes, OpenClaw, OpenBot, Muse) leiam e, mais tarde, escrevam. A necessidade imediata é o agente definir orçamento e ROAS no Mercado Ads sem passar da margem do produto.

Fatos levantados na entrevista:

- **A RLS não protege este caminho.** Uma chamada sem sessão de usuário roda com service role; o isolamento entre organizações passa a depender do código.
- **O cálculo já existe no backend:** `equilibrioDoMlb` (`supabase/functions/_shared/ads/campanhas.ts`), com preço por parâmetro, custo de `variacoes.custo` e alíquota por origem lida da organização.
- **O "ID do Product Ads" é o identificador de família do Mercado Livre**, já gravado em `ml_ads_grupo.external_id` (tipo FAMILY) e em `anuncios_externos_itens.family_id`. Conferido em produção com o exemplo `8632963637759506`: 16 anúncios, um por variação. Não é preciso rotina de sincronização.
- **Clientes:** chave fixa em cabeçalho é documentada em Hermes, OpenClaw, Grok (API e CLI), OpenBot e Muse Code; nos clientes de chat na web (claude.ai, ChatGPT, grok.com) as fontes se contradizem ou só listam OAuth.
- **O servidor OAuth 2.1 do Supabase Auth** (beta) não tem escopos próprios e emite um JWT de usuário com acesso igual ao de uma sessão normal.

## Decisão

1. **Identidade.** O agente age em nome de **uma organização**, por uma **conexão de agente** criada e revogada por administrador dela, sempre com validade. A organização vem **só do registro da conexão**, nunca do pedido. A auditoria registra a conexão, não a pessoa.
2. **Duas formas de criar a conexão, mesmo comportamento depois:**
   - **Chave de agente:** segredo de alta entropia, exibido uma vez, guardado só como hash.
   - **Autorização (OAuth 2.1):** registro dinâmico de cliente, código de autorização com PKCE, renovação. O login é o do app; **só administrador** aprova, numa tela de consentimento do PubliAI. **O PubliAI emite o próprio token, opaco, guardado como hash, que só vale na API de agentes.** O servidor OAuth do Supabase Auth foi descartado porque seu token abriria o app inteiro.
3. **Chave de plataforma.** A administração da plataforma pode ter conexão que enxerga várias organizações, com estas travas: **somente leitura para sempre**; validade obrigatória; alcance restrito às **lojas geridas** (organização com modalidade comercial vigente — o contrato de gestão é a autorização); cada consulta informa a organização, a resposta traz o nome dela e o registro fica visível ao administrador da loja.
4. **Interface.** Um **servidor MCP remoto**, sem estado, numa edge function com `verify_jwt=false` e autenticação própria. A regra de negócio fica numa camada separada da casca MCP; REST entra depois se aparecer cliente que não fale MCP.
5. **Disponibilidade.** **Módulo "Acesso de agentes"** por organização, ligado na Central de controle, desligado por padrão. Não depende do módulo `ads`. Não condiciona a chave de plataforma.
6. **v1 = leitura de margens, quatro ferramentas:**
   1. lojas ao alcance da conexão (com o apelido da conta no Mercado Livre);
   2. margem de um anúncio, aceitando MLB, produto do ML (MLBU), família do ML (o número do painel de Ads) ou SKU; trecho de título devolve candidatos, nunca escolhe sozinho;
   3. margens do catálogo, paginadas (cerca de 50 anúncios por página), com indicação explícita de resultado parcial;
   4. simulação com outro preço, sem gravar.
7. **Conteúdo da resposta.** Reusa `equilibrioDoMlb`, estendido para devolver o detalhe (custo, comissão, frete, imposto, líquido) em reais. **Margem s/ venda e ACOS de equilíbrio pelo preço são o mesmo número**: um campo só, mais o ROAS mínimo (1 ÷ margem). Margem ≤ 0 → ROAS mínimo vazio, "sem espaço para Ads". Consulta por família responde pela **pior margem** entre os anúncios, como a aba Campanhas. Traz preço atual, preço de tabela, se está em promoção e o horário da leitura. Dado ausente (custo, origem, alíquota, tarifa) → campo vazio com o motivo, sem margem. Nunca `familias.custo_centavos`. Sem ACOS alvo: não existe "margem desejada" por organização.
8. **Escrita (fora do v1).** O agente **prepara**; publicar ou alterar anúncio no canal (inclusive preço, pausa e promoção) é **Pedido de publicação**, que espera aprovação humana na fila do app. O escopo de escrita só passa a existir no banco quando a primeira fatia de escrita for construída.

## Salvaguardas obrigatórias

- Validação da conexão (hash, revogação, validade, organização ativa, módulo) antes de qualquer leitura; resposta 401 genérica.
- Limite de chamadas por conexão e por IP nas falhas, com o contador já existente no Redis; **Redis indisponível fecha o acesso**.
- Uma linha de auditoria por chamada: organização, conexão, ferramenta, alvo, resultado.
- Teste automatizado: conexão da organização A pedindo anúncio da organização B recebe "não encontrado".
- Títulos e textos de produto são dado não confiável para o agente que os lê; a documentação das ferramentas declara isso.
- Nunca devolver dados de comprador, credenciais do Mercado Livre nem dados de fornecedor.

## Alternativas descartadas

- **Só chave fixa no v1:** os clientes de chat na web são uso previsto desde o início e a aceitação de cabeçalho neles não é confirmada.
- **OAuth pelo Supabase Auth:** token com alcance de sessão completa e sem escopo.
- **Chave de plataforma sem restrição de alcance:** leria custo e margem de clientes que não contrataram a gestão.
- **MCP e REST juntos:** nenhum cliente da lista precisa de REST hoje.
- **Reimplementar as fórmulas da spec recebida:** a conta já existe e é a que a tela mostra.

## Limitações conhecidas

- Cupom do vendedor não entra na margem.
- A leitura da aba Campanhas usa cache de 10 minutos; em oferta relâmpago o preço pode mudar dentro dessa janela (por isso o horário da leitura vai na resposta).
- Cada anúncio consulta tarifas e gasta o limite de chamadas da conta do Mercado Livre da organização.
- Não verificado: se a leitura de alíquotas usada pelo cálculo respeita a vigência da ADR-0208.

## Aceite

Mesmo número da aba Campanhas para o mesmo anúncio; consulta pela família `8632963637759506` da Zaven; teste real de conexão em cada cliente da lista, com o resultado registrado por cliente.
