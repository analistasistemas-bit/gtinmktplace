# ADR-0189 — Extensão PubliAI no navegador: análise no Mercado Livre sem base de mercado própria

**Status:** Proposto — design fechado em entrevista (grill-with-docs, 2026-10-21); aguardando revisão do Codex e aprovação do Diego
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
| D-2 | **Pulse como bônus, só leitura.** Funciona sem o Pulse. Se o produto aberto estiver no radar da organização (e o módulo Pulse estiver ligado), mostra histórico, preço para ganhar e alertas que o Pulse **já** coletou. Nunca envia dados ao Pulse e **nunca dispara Sonar/Apify**; uma eventual consulta Sonar futura será botão explícito, faturável e avisado. |
| D-3 | **Só contas PubliAI.** Usa a organização do usuário (`profiles.org_id`) ou, para super-admin, a da sessão de suporte ativa (ADR-0092). Não há produto público para vendedores sem conta. |
| D-4 | **Conexão a partir do PubliAI.** Sem senha na extensão. O app web (`app.publiai.daludi.com.br`) é o **único dono do refresh token** Supabase: a cada `onAuthStateChange` ele empurra à extensão (via `externally_connectable`) só o **access token** e a validade; a extensão **nunca renova** sessão (dois donos do mesmo refresh token rotativo derrubariam uma das sessões). Token expirado sem novo envio → estado "Abra o PubliAI". Logout no app → "Desconectar" na extensão. |
| D-5 | **Superfícies da v1:** página do anúncio, busca/mais vendidos e catálogo. Páginas de gestão da própria conta (promoções, simulador de custos, lista de anúncios, Ads, publicar) ficam fora: o PubliAI web já cobre. No **anúncio próprio** (seller da página = `conta_externa_id` de uma conexão da organização) a extensão mostra atalho "Abrir no PubliAI" em vez de duplicar análise. |
| D-6 | **Topo do painel do anúncio = "minha margem a esse preço" + "quanto vende".** |
| D-7 | **Minha margem:** preço editável (padrão = preço da página); **Clássico e Premium lado a lado**; comissão por `listing_prices` (usa `sale_fee_amount` do ML quando o preço é o consultado; percentual + fixa ao simular); **frete calculado para a conta da organização** com as dimensões da embalagem do que o anúncio entrega — fator 1 → dimensões do SKU; fator N → dimensões próprias do kit vinculado de N, se existir; sem isso (ou sem variação/composição), frete com pacote padrão **rotulado "estimado"**; custo real do SKU e **imposto por origem** (ADR-0055). Cada componente é arredondado em centavos e `recebe = preço − Σ componentes`. Ausência de comissão, frete ou alíquota confirmada → tipo "indisponível" com o motivo, nunca zero. |
| D-8 | **Vínculo de produto**, nesta ordem: (1) `catalog_product_id` da página casa com variação da organização (`variacoes.catalog_product_id`); (2) EAN usado na busca do ML que levou ao anúncio, lembrado pela extensão na sessão; (3) **vínculo manual** escolhido pelo operador e **guardado pela organização**, chaveado por `catalog_product_id` ou, fora de catálogo, por `ml_item_id`; (4) custo digitado, **com origem (Nacional/Importado) escolhida pelo operador, sem padrão** (ADR-0055/0107: origem nunca presumida). Custo do pacote = `custo da variação × fator`, fator = `UNITS_PER_PACK do anúncio ÷ UNITS_PER_PACK do SKU`, **nunca presumido**: unidades do anúncio só de `/products/{id}` (fora de catálogo ou sem o atributo → "quantidade por anúncio não confirmada" e o painel pede "Unidades por anúncio", sem padrão); unidades do SKU = `UNITS_PER_PACK` que o próprio SKU declara em `familias.atributos_ml` (kit vinculado: precisa coincidir com `kit_multiplicador`); casado pelo catálogo = mesmo produto → fator 1, sem depender de `UNITS_PER_PACK`. Lado desconhecido → custo "indisponível: composição não confirmada"; a resposta diz qual lado falta (anúncio, SKU ou ambos) e traz o custo unitário do SKU, e o painel pede "Unidades por anúncio" e/ou "Unidades no SKU" (sem padrão) e recalcula localmente. Razão não inteira → "indisponível: composição diferente". A tela sempre diz de onde veio o custo e a conta feita. |
| D-9 | **Quanto vende = observado + estimativa rotulada.** Linha observada: faixa pública, data de criação, mínimo por mês (piso ÷ meses). Linha de estimativa (algoritmo estilo Avant: faixa × avaliações × idade × tipo), com rótulo "Estimativa" e método explicado. **A estimativa só é exibida depois de validada** contra vendas reais dos anúncios próprios (erro mediano ≤ 30%); senão, só a linha observada. |
| D-10 | **Restante do painel do anúncio:** idade com semáforo (≤180 / ≤365 / >365 dias), tipo, Full/Flex, frete grátis, catálogo, estoque exibido; vendedor via `/users` (reputação, medalha, total histórico, UF, loja oficial); qualidade (sem Clips, < 5 fotos, descrição curta/ausente, sem garantia, estoque < 50, fotos < 1200 px com destaque); bloco do radar (D-2); ações: baixar mídia, "Abrir no PubliAI", "Adicionar ao radar" (se módulo Pulse ligado). Resumo de avaliações por IA e Excel de avaliações ficam para a v1.1. |
| D-11 | **Busca/mais vendidos:** só dados presentes nos cards carregados (sem abrir anúncios em iframe, sem API de busca). Em cada card: faixa de vendidos, avaliações, Full/frete grátis, tipo, oficial, catálogo e **minha margem ao preço daquele card** quando houver vínculo. Resumo lateral clicável (filtra) e ordenação por vendidos, preço e minha margem. Sem estimativa nem idade nos cards (o card não traz data). |
| D-12 | **Catálogo:** ofertas por `/products/{id}/items` + `/users`; minha margem ao preço do vencedor; vendas do catálogo (faixa observada); se a organização participa, posição e preço para ganhar; lista de vendedores e resumo (UF, medalhas, Full, menor/maior preço). **O vencedor só é exibido quando o ML o informa**; nunca inferido por pontuação. |
| D-13 | **Acompanhamento de anúncio próprio** (evolução diária e antes/depois de mudanças) fica **no PubliAI web**, como épico seguinte; guarda snapshots só de anúncios próprios escolhidos pela organização (não é base de mercado). A extensão mostra apenas selo "acompanhado" e atalho. |
| D-14 | **Distribuição:** Chrome Web Store, **não listada**, com atualização automática. Permissões mínimas: `*.mercadolivre.com.br`; `externally_connectable` só para `https://app.publiai.daludi.com.br/*` (build de desenvolvimento acrescenta `http://localhost:5173/*`). A extensão é carregada a partir do build (`extensao/dist`), nunca da pasta-fonte (o Chrome recusa pastas iniciadas por `_`). Proibido: `<all_urls>`, remoção/alteração de antibot do ML, iframe invisível de páginas de concorrente, interceptação de `fetch`/XHR da página. |
| D-15 | **Uma extensão só.** A `extensao-ml/` (ADR-0118) foi removida em 2026-10-21; nada dela é reaproveitado. |
| D-16 | **Interface:** painel lateral nativo do Chrome (side panel) com a análise completa; na página do ML, apenas **selos** pequenos (junto ao preço no anúncio e em cada card da busca). Menos dependência do layout do ML. |
| D-17 | **O token ML nunca vai ao navegador.** A extensão lê a página e envia os dados ao PubliAI (Edge Function autenticada pela sessão Supabase do usuário); o servidor checa módulo e organização, usa o token da organização **só em leituras**, junta custo, imposto, vínculo e radar, aplica cache de comissão/frete e devolve o resultado pronto. |
| D-18 | **Módulo por organização** (`modulos_habilitados`), desligado por padrão, checado no servidor; ligado na Central de controle. **Sem cobrança por análise** (custo marginal ≈ 0). Funções futuras com IA entram como consulta faturável. **Limite técnico** de 30 análises por minuto por usuário; a simulação de preço é recalculada no painel com os parâmetros já recebidos e só confirma no servidor quando o operador para de editar. Erros com chave única `erro` (`modulo_desligado`, `sessao_expirada`, `sessao_suporte_expirada`, `limite`, `payload_invalido`). |
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
