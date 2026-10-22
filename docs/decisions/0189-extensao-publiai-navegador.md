# ADR-0189 — Extensão PubliAI no navegador: análise no Mercado Livre sem base de mercado própria

**Status:** Proposto — design fechado em entrevista (grill-with-docs, 2026-10-21); revisado pelo Codex em 2026-10-22; aguardando aprovação do Diego
**Data:** 2026-10-21
**Decisores:** Diego
**Revoga:** o item "Extensão de navegador" da lista **Não fazer** de `docs/Roadmap/ROADMAP-MELHORIAS-PUBLIAI.md` (2026-09-21) e o "sem extensão Chrome no v1" da [ADR-0119](0119-pulse-inteligencia-de-mercado-dirigida.md) **apenas** no papel de interface de análise. A recusa da extensão como **coletora** continua (ADR-0119 v2 descartado; [ADR-0142](0142-vendas-mensais-por-vendedor.md), alternativa 5).
**Substitui:** [ADR-0118](0118-resolucao-em-massa-do-no-match-de-catalogo.md) (revogada em 2026-10-21; `extensao-ml/` removida).
**Relaciona:** [0119](0119-pulse-inteligencia-de-mercado-dirigida.md) (Pulse/radar), [0144](0144-serie-de-vendedores-como-base-de-mercado.md) (série de vendedores), [0130](0130-concorrentes-relevantes-pulse-viabilidade.md) (cálculo financeiro compartilhado Pulse × Viabilidade), [0055](0055-imposto-por-origem-nacional-importado.md) (imposto por origem), [0086](0086-configuracao-org-scoped.md) (config org-scoped), [0027](0027-multi-tenancy-organizations.md) (organização), [0092](0092-identidade-da-plataforma-e-acesso-super-admin.md) (super-admin e sessão de suporte), [0012](0012-refresh-token-oauth-ml-com-lock-redis.md) / [0171](0171-renovacao-proativa-token-ml.md) (token ML).
**Glossário:** `CONTEXT.md` § Extensão do navegador (Extensão PubliAI, Anúncio próprio, Anúncio de concorrente, Dado observado, Estimativa, Base de mercado, Acompanhamento de anúncio próprio, Vínculo de produto, Minha margem).

---

## Contexto

O operador decide preço e entrada em produto olhando o Mercado Livre. As ferramentas do mercado
(Avant Pro, JoomPulse) mostram números sobre anúncios de concorrente direto na página. Em
2026-10-21 fizemos engenharia reversa das duas (REA + validação visual no Chrome; relatórios fora
do repositório, que é público, em `~/Desktop/IA/publiai-extensao-re/`). Conclusões que sustentam
esta decisão:

1. **O que as duas têm de melhor depende de base de mercado própria** (histórico de preço, vendas
   de 365 dias, tendência e receita do vendedor, rankeamento por palavra-chave). Ambas a constroem
   por **crowdsourcing silencioso**: cada usuário envia ao backend o que vê (Avant:
   `PATCH /ml/items*`; Joom: `initialState` inteiro + interceptor de `fetch` com padrões remotos).
2. **Práticas inaceitáveis** encontradas: remoção do agente antibot do ML (Avant), `pageView` de
   toda URL visitada em qualquer site enviado à Amplitude com e-mail (Joom), `<all_urls>`, PDP de
   concorrente carregada em iframe invisível em lote, vencedor de catálogo **inferido por
   pontuação** e apresentado como dado da API (Avant), EAN aleatório com dígito válido (Avant).
3. **Teste real da API com token de vendedor (2026-10-21):** `/users/{id}`, `/products/{id}`,
   `/products/{id}/items`, `/sites/MLB/listing_prices`, `/trends/MLB/{cat}` e
   `/highlights/MLB/category/{id}` respondem 200; `/items/{id}` de terceiro, `/items?ids=`,
   `/users/{id}/items/search`, `/sites/MLB/search`, `/reviews/item/{id}` e `/visits/items` de
   terceiro dão **403**. `sold_quantity` de concorrente **não existe** na API; a página expõe só o
   **piso da faixa** pública ("+1000 vendidos" → 1000). **Nem a página nem `/products/{id}`
   expõem o GTIN**; expõem `catalog_product_id` e `UNITS_PER_PACK`.
4. Nenhuma das duas responde **"quanto eu ganho vendendo isto?"**, porque não conhece custo e
   imposto do vendedor. O PubliAI conhece (`variacoes.custo`, imposto por origem, comissão e frete
   já calculados para Pulse e Viabilidade).

## Decisão

Criar a **Extensão PubliAI**: uma extensão de navegador, exclusiva de contas PubliAI, que mostra
**minha margem** e **dados observados/estimativas rotuladas** sobre anúncios do Mercado Livre,
**sem criar nem alimentar base de mercado**.

| # | Decisão |
|---|---|
| D-1 | **Sem base de mercado.** A extensão não coleta nem envia ao servidor dados de anúncios de concorrente para acumular. Fontes permitidas: a página aberta, a API do ML com o token da organização (só os endpoints que respondem 200, item 3 do contexto), cálculo local e dados do próprio PubliAI. |
| D-2 | **Pulse como bônus, só leitura.** Funciona sem o Pulse. Se o produto aberto estiver no radar da organização (e o módulo Pulse estiver ligado), mostra histórico, preço para ganhar e alertas que o Pulse **já** coletou. Nunca envia dados de anúncio ao Pulse e **nunca dispara Sonar/Apify**, com uma única exceção (D-10: "Adicionar ao radar"); uma eventual consulta Sonar futura será botão explícito, faturável e avisado. |
| D-3 | **Só contas PubliAI.** Usa a organização do usuário (`profiles.org_id`) ou, para super-admin, a da sessão de suporte ativa (ADR-0092). Não há produto público para vendedores sem conta. |
| D-4 | **Conexão a partir do PubliAI.** Sem senha na extensão. O app web (`app.publiai.daludi.com.br`) é o **único dono do refresh token** Supabase: a cada `onAuthStateChange` ele empurra à extensão (via `externally_connectable`) só o **access token** e a validade; a extensão **nunca renova** sessão (dois donos do mesmo refresh token rotativo derrubariam uma das sessões). Token expirado sem novo envio → estado "Abra o PubliAI". Logout no app → "Desconectar" na extensão. **Identidade da sessão:** o app envia junto uma identidade sem segredo (`usuário:organização:suporte`), reenviada quando o token **ou** a identidade mudam (perfil carregado, início/fim de suporte). Estado por aba (análises, EAN da busca) e painel ficam presos a essa identidade: troca de usuário, organização ou contexto de suporte, logout, expiração e `sessao_suporte_expirada` limpam todas as abas e descartam respostas em voo (nunca chegam ao selo nem ao painel). A extensão recusa `publiai:sessao` sem identidade válida; sessão vencida apaga as análises e o selo sai da página — também sem interação: um `chrome.alarms` agendado para o fim da validade (e a conferência no boot do service worker) faz a limpeza. **Ordem de lançamento:** o app web com a ponte que envia `identidade` (e reenvia no início/fim de suporte, assinando os stores de auth e suporte) é publicado **antes** de distribuir a extensão, com smoke test de início/fim de suporte. |
| D-5 | **Superfícies da v1:** página do anúncio, busca/mais vendidos e catálogo. Páginas de gestão da própria conta (promoções, simulador de custos, lista de anúncios, Ads, publicar) ficam fora: o PubliAI web já cobre. No **anúncio próprio** (seller da página = `conta_externa_id` de uma conexão da organização) a extensão mostra atalho "Abrir no PubliAI" em vez de duplicar análise. |
| D-6 | **Topo do painel do anúncio = "minha margem a esse preço" + "quanto vende".** |
| D-7 | **Minha margem:** preço editável (padrão = preço da página); **Clássico e Premium lado a lado**; comissão por `listing_prices` (usa `sale_fee_amount` do ML quando o preço é o consultado; percentual + fixa ao simular); **frete calculado para a conta da organização** com as dimensões da embalagem do que o anúncio entrega (`DimensoesPacote`, `_shared/ml/pacote.ts`) — frete **oficial (sem rótulo) só com fator 1 em relação ao SKU analisado e as dimensões desse SKU**; qualquer outro caso é **rotulado "estimado (pacote padrão)"** — fator N cota com as dimensões próprias do kit vinculado vivo e canônico de N (`listarKitsVivos`), se houver um só, senão com o pacote padrão, e segue rotulado; sem variação/composição, pacote padrão rotulado. Cache do frete por conta ML + org; custo real do SKU e **imposto por origem** (ADR-0055). Cada componente é arredondado em centavos e `recebe = preço − Σ componentes`. Ausência de comissão, frete ou alíquota confirmada → tipo "indisponível" com o motivo, nunca zero. **Simulação:** enquanto o preço editado diverge do último preço confirmado pelo servidor, o resultado **inteiro** (comissão, frete e margem) leva o rótulo "Estimativa" — a comissão também muda por faixa de preço; confirmação que falha mantém o rótulo; respostas fora de ordem são descartadas. |
| D-8 | **Vínculo de produto**, nesta ordem: (1) `catalog_product_id` da página casa com variação da organização (`variacoes.catalog_product_id`); (2) EAN usado na busca do ML que levou ao anúncio, lembrado pela extensão na sessão; (3) **vínculo manual** escolhido pelo operador e **guardado pela organização**, chaveado por `catalog_product_id` ou, fora de catálogo, por `ml_item_id`; (4) custo digitado, **com origem (Nacional/Importado) escolhida pelo operador, sem padrão** (ADR-0055/0107: origem nunca presumida). Custo do pacote = `custo da variação × fator`, fator = `UNITS_PER_PACK do anúncio ÷ UNITS_PER_PACK do SKU`, **nunca presumido**: unidades do anúncio só de `/products/{id}` (fora de catálogo ou sem o atributo → "quantidade por anúncio não confirmada" e o painel pede "Unidades por anúncio", sem padrão); unidades do SKU = `UNITS_PER_PACK` que o próprio SKU declara em `familias.atributos_ml`; no kit vinculado = `kit_multiplicador × UNITS_PER_PACK da família-base` (o UPP gravado no kit é o próprio multiplicador e não prova a unidade-base — kit de 3 caixas de 24 = 72; base desconhecida → o painel pede "Unidades no SKU"); casado pelo catálogo = mesmo produto → fator 1, sem depender de `UNITS_PER_PACK`. Lado desconhecido → custo "indisponível: composição não confirmada"; a resposta diz qual lado falta (anúncio, SKU ou ambos) e traz o custo unitário do SKU, e o painel pede "Unidades por anúncio" e/ou "Unidades no SKU" (sem padrão) e recalcula localmente. Razão não inteira → "indisponível: composição diferente". A tela sempre diz de onde veio o custo e a conta feita. |
| D-9 | **Quanto vende = observado + estimativa rotulada.** Linha observada: faixa pública, data de criação, mínimo por mês (piso ÷ meses). Linha de estimativa (algoritmo estilo Avant: faixa × avaliações × idade × tipo), com rótulo "Estimativa" e método explicado. **A estimativa só é exibida depois de validada** contra vendas reais dos anúncios próprios (erro mediano ≤ 30%); senão, só a linha observada. |
| D-10 | **Restante do painel do anúncio:** idade com semáforo (≤180 / ≤365 / >365 dias), tipo, Full/Flex, frete grátis, catálogo, estoque exibido; vendedor via `/users` (reputação, medalha, `transactions.total`, UF, loja oficial) — `transactions.total` é janela móvel de ~365 dias (ADR-0142, errata; `_shared/ml/perfil-vendedor.ts`), **nunca "total histórico"**: exibir o período que o ML informa (`transactions.period`) ou, na ausência, rótulo neutro sem inferir duração; qualidade (sem Clips, < 5 fotos, descrição curta/ausente, sem garantia, estoque < 50, fotos < 1200 px com destaque); bloco do radar (D-2); ações: baixar mídia, "Abrir no PubliAI", "Adicionar ao radar" (se módulo Pulse ligado). **Exceção explícita a D-1/D-2:** "Adicionar ao radar" é ação **manual, iniciada pelo usuário**, que envia **somente o identificador de catálogo** ao `pulse-adicionar` já existente (o Pulse busca os demais dados pela API); exige módulo Pulse, permissão de escrita e auditoria de suporte. Fora isso, a extensão nunca envia dado de concorrente. Resumo de avaliações por IA e Excel de avaliações ficam para a v1.1. |
| D-11 | **Busca/mais vendidos:** só dados presentes nos cards carregados (sem abrir anúncios em iframe, sem API de busca). Em cada card: faixa de vendidos, avaliações, Full/frete grátis, tipo, oficial, catálogo e **minha margem ao preço daquele card** quando houver vínculo. Resumo lateral clicável (filtra) e ordenação por vendidos, preço e minha margem. Sem estimativa nem idade nos cards (o card não traz data). **Categoria** (necessária a comissão e frete): só a observada no card ou enriquecida pelo catálogo; sem categoria comprovada → margem indisponível, nunca a categoria genérica da busca. |
| D-12 | **Catálogo:** ofertas por `/products/{id}/items` + `/users`; minha margem ao preço do vencedor; vendas do catálogo (faixa observada); se a organização participa, posição e preço para ganhar; lista de vendedores e resumo (UF, medalhas, Full, menor/maior preço). **O vencedor só é exibido quando o ML o informa**; nunca inferido por pontuação. |
| D-13 | **Acompanhamento de anúncio próprio** (evolução diária e antes/depois de mudanças) fica **no PubliAI web**, como épico seguinte; guarda snapshots só de anúncios próprios escolhidos pela organização (não é base de mercado). A extensão mostra apenas selo "acompanhado" e atalho. |
| D-14 | **Distribuição:** Chrome Web Store, **não listada**, com atualização automática. Permissões mínimas: `sidePanel`, `storage`, `alarms` e `*.mercadolivre.com.br`; `externally_connectable` só para `https://app.publiai.daludi.com.br/*` (build de desenvolvimento acrescenta `http://localhost:5173/*`). A extensão é carregada a partir do build (`extensao/dist`), nunca da pasta-fonte (o Chrome recusa pastas iniciadas por `_`). Proibido: `<all_urls>`, remoção/alteração de antibot do ML, iframe invisível de páginas de concorrente, interceptação de `fetch`/XHR da página. |
| D-15 | **Uma extensão só.** A `extensao-ml/` (ADR-0118) foi removida em 2026-10-21; nada dela é reaproveitado. |
| D-16 | **Interface:** painel lateral nativo do Chrome (side panel) com a análise completa; na página do ML, apenas **selos** pequenos (junto ao preço no anúncio e em cada card da busca). Menos dependência do layout do ML. Painel e selos obedecem à identidade da sessão (D-4). |
| D-17 | **O token ML nunca vai ao navegador.** A extensão lê a página e envia os dados ao PubliAI (Edge Function autenticada pela sessão Supabase do usuário); o servidor checa módulo e organização, usa o token da organização **só em leituras**, junta custo, imposto, vínculo e radar, aplica cache de comissão/frete e devolve o resultado pronto. |
| D-18 | **Módulo por organização** (`modulos_habilitados`), desligado por padrão, checado no servidor; ligado na Central de controle. **Sem cobrança por análise** (custo marginal ≈ 0). Funções futuras com IA entram como consulta faturável. **Limite técnico** de 30 análises por minuto por usuário — na análise em lote (busca, fatia 3) debita **1 por item único analisado**, não por busca, com limite de concorrência agregado e backoff em 429; a simulação de preço é recalculada no painel com os parâmetros já recebidos e só confirma no servidor quando o operador para de editar. Erros com chave única `erro` (`modulo_desligado`, `sessao_expirada`, `sessao_suporte_expirada`, `limite`, `payload_invalido`). **Escritas de vínculo** (`salvar_vinculo`/`remover_vinculo`) exigem acesso de escrita e, em sessão de suporte, são auditadas com `auditarOperacaoSuporte` (`denied`/`succeeded`/`failed`; ADR-0092). **Cache** de comissão e frete inclui a conta ML da organização (as consultas usam a credencial da conta); unidades por pacote só cacheiam valor confirmado. |
| D-19 | **Registro de uso mínimo, só no PubliAI:** contagem de análises por usuário/organização/dia e tipo de página (incremento atômico); erros de leitura da página (com ID do anúncio) para detectar quebra de layout, **deduplicados por dia, tipo de página, versão e motivo**, com contador; versão da extensão. **Não registra** URLs navegadas, pesquisas, lista de concorrentes vistos nem nada fora do ML. Sem PostHog/Amplitude/Sentry de terceiros. |
| D-20 | **Entrega em 4 fatias:** (1) base + anúncio com minha margem e vínculo; (2) quanto vende (após validar a estimativa) + qualidade + vendedor + radar + mídia; (3) busca; (4) catálogo. Submissão à Web Store começa na fatia 1. |

## Critérios de sucesso (30 dias após a fatia 4)

- Operadores de Avil e DSA abrem análises toda semana sem cobrança do Diego.
- Minha margem bate com Viabilidade/Revisão para o mesmo produto e preço (diferença ≤ R$ 0,05).
- Estimativa com erro mediano ≤ 30% contra vendas reais; acima disso, não é exibida.
- Quebra de layout do ML aparece no registro de erros em menos de 24 h.
- **Fracasso mesmo funcionando:** operador volta ao Avant para decidir preço.

## Alternativas consideradas

- **Extensão coletora para o Pulse (visão original da ADR-0119 v2).** Daria cobertura e histórico,
  mas é crowdsourcing — contraria D-1 (decisão do Diego, 2026-10-21).
- **Ignorar o Pulse.** Desperdiça histórico e preço para ganhar já coletados via API, sem custo
  novo (o coletor do radar não usa Apify; só o Sonar usa).
- **Produto público para qualquer vendedor (modelo Avant).** Exige cadastro, cobrança, LGPD e loja
  pública; o diferencial (custo real) só existe com conta PubliAI.
- **Painel injetado na página (modelo Avant).** Mais visível, mas quebra a cada mudança de layout.
- **Token ML no navegador.** Mais simples; expõe credencial de escrita da organização.
- **Estimativa composta sem validação.** As constantes do Avant (×15 avaliações, +15% Premium,
  ajustes de idade) não têm validação pública.

## Consequências

- Nasce uma Edge Function de análise para a extensão e uma tabela org-scoped de **vínculo de
  produto** (catálogo ML → SKU), com RLS por organização, e um registro mínimo de uso/erros.
- Manutenção recorrente: seletores dos selos e parser da página do ML; mitigada pelo side panel e
  pelo registro de erros de leitura.
- O épico "Acompanhamento de anúncio próprio" entra no roadmap depois da v1.
- O `docs/Roadmap/ROADMAP-MELHORIAS-PUBLIAI.md` (fora do git) precisa refletir a revogação do
  "Não fazer" para extensão.

## Processo de revisão

- ADR e plano de implementação: revisão do **Codex `gpt-6.1-sol`, effort high** (read-only) antes
  da aprovação do Diego.
- Ao fim da implementação: o **diff da branch é revisado pelo Grok 4.7 xhigh** antes do merge
  (pedido explícito do Diego em 2026-10-21).
- **Revisão de 2026-10-21 (Kimi K3 Max, read-only; Codex sem cota):** VERDICT REVISE, 21 achados.
  Incorporados: dono único do refresh token (D-4), origem real do app (D-14), arredondamento por
  componente e `sale_fee_amount` (D-7), origem obrigatória no custo digitado e normalização de kit
  (D-8), frete com dimensões ou rotulado estimado (D-7), vínculo por `ml_item_id` (D-8), simulação
  no cliente e contrato de erro (D-18), dedupe de erros e incremento atômico (D-19). Recusado: "a
  ADR-0142 não cita extensão" — cita (alternativa 5); a referência foi completada com a ADR-0119.
- **Revisão Codex 2026-10-22** (`gpt-6.1-sol` high, com o código): REVISE, 17 achados; Diego mandou corrigir tudo antes do merge. Mudou: identidade da sessão e limpeza de estado (D-4/D-16, #1); auditoria de escritas de vínculo em suporte (D-18, #2); composição do pacote nunca presumida, com unidades do anúncio só de `/products/{id}`, do SKU em `familias.atributos_ml` e catálogo = fator 1 (D-8, #3/#4); frete oficial só com fator 1 (D-7, #5); orçamento por item único na análise em lote (D-18, #6); exceção explícita de "Adicionar ao radar" (D-2/D-10, #9); categoria dos cards (D-11, #10); resultado simulado rotulado "Estimativa" (D-7, #11); cache com conta ML (D-18, #13); período de `transactions.total` (D-10, #16). Só no plano: ordem revisão → deploy → ativação (#7), critérios de validação da estimativa (#8), build real da Task 7 (#12), validação SQL × `db:check` (#14), testes de handler e paridade financeira (#15), origem de `DimensoesPacote` (#17).

## Emenda 2026-10-22 — data de criação do anúncio (D-9, D-14)

A página do anúncio (`/p/`, `/up/`) não expõe a data de criação, e `/items/{id}` de terceiro é 403 com o
token da organização. Engenharia reversa: o Avant lê `gtm_event.startTime` do HTML de
`https://produto.mercadolivre.com.br/MLB-{id}` buscado em segundo plano com a sessão do usuário; a JoomPulse
usa o próprio dataset (vetado por D-1). Medido em 2026-10-22: esse HTML traz `startTime` só com o cookie do
usuário (deslogado não traz), e o valor bate com a publicação (MLB4982690837: `startTime` 13:30:56.845Z ×
`familias.publicado_em` 13:30:57.392).

- **D-9:** "criado em", idade (semáforo de D-10) e o mínimo por mês/dia vêm desse `startTime`, e a faixa usada no
  ritmo vem do mesmo HTML (`subtitle_label`, faixa **do anúncio**). A faixa das páginas `/p/` (catálogo, todos os
  vendedores) e `/up/` (soma dos anúncios do produto do vendedor) é agregada — medido: anúncio com 45 vendas mostra
  "+50" no `/up/` e "+25" no HTML do anúncio; concorrente com "+1.000" no catálogo tem "2 vendidos" no anúncio — e
  aparece à parte, sem ritmo. Sem os dados do anúncio, só a faixa da página, rotulada (nunca data ou ritmo presumidos).
- **D-14:** permitido **um GET** por anúncio analisado, feito pelo service worker (host permission do ML),
  ao `produto.mercadolivre.com.br/MLB-{id}` do anúncio que o usuário abriu: só lê o `startTime`, com timeout
  e cache por sessão do navegador; nada é gravado no servidor nem enviado a ele. Continua proibido iframe,
  interceptação de `fetch`/XHR e qualquer requisição a anúncio que o usuário não abriu. Captcha ou falha →
  data indisponível, sem nova tentativa automática.

- **Captcha (medido em 2026-10-22, validação no Chrome do Diego):** o antibot do ML redireciona a requisição da
  extensão a `produto.mercadolivre.com.br` para `/captcha/wall`, enquanto a mesma requisição feita de uma aba
  passa; nenhuma página do `www` traz a data. Contornar é proibido (D-14): no primeiro captcha a extensão para de
  buscar o HTML do anúncio pelo resto da sessão do navegador e o painel diz que o ML não libera essa leitura.
- **Ritmo do catálogo (decisão do Diego, 2026-10-22):** em `/p/`, faixa da página (todos os vendedores) ÷ idade do
  produto de catálogo, com `date_created` de `/products/{id}` (endpoint já permitido em D-1), devolvido pela edge
  em `catalogoCriadoEm` e cacheado. Ex.: "+1.000 desde 07/2020 → ≥ 13/mês, ≥ 0,4/dia". Fora de catálogo, sem a
  leitura do anúncio, fica só a faixa.

## Errata 2026-10-22 — estimativa de vendas reprovada (D-9, Task 13)

**Patamares da faixa pública (medidos em 2026-10-22):** total exato dos anúncios próprios × texto da página: 5–24 →
"+5", 25–49 → "+25", 50–99 → "+50", 100–499 → "+100", 500–999 → "+500"; buscas mostram ainda +1000, +5mil,
+10mil, +50mil, +100mil, +250mil, +500mil e +750mil. A lista do Avant (10/20/200/20mil, sem 25/750mil) não é a do
ML — com ela o Avant nem estima "+25". Em página de catálogo (`/p/`) a faixa é do **produto**, não do anúncio
(MLB6976955534: 10 vendidos no anúncio, página "+25").

`scripts/validar-estimativa-vendas.ts`, critérios fixados no plano antes de medir, modelo do Avant com os
patamares reais: na amostra de validação (n = 102 anúncios ativos próprios com ≥ 5 vendas, 4 contas) o **erro
mediano foi 90,9%** (P75 200%), muito acima do gate de 30% e pior que as referências ingênuas (centro da faixa
50,0%, piso 37,5%). A faixa "+5" cobre 5 a 24 vendas e domina a amostra (78 de 102); a amostra também é dominada
por uma conta (90 de 102). Com a lista do Avant a mediana fora 40,9% — ainda reprovada.

Decisão (regra de D-9): **a estimativa fica desligada**; o painel mostra só a linha observada (faixa, criado
há, mínimo por mês). `estimarVendas` (`extensao/src/compartilhado/estimativa.ts`) fica só para o script, que pode
ser rodado de novo quando houver mais contas/faixas; qualquer recalibração usa a amostra de ajuste e é
validada na de validação, com o mesmo gate.
