**Comece pela Extensão; deixe Cobrança por último, após os contratos de relatório e fechamento.**

**Etapa 4 de 4 concluída — somente leitura.** Análise do código e dos testes, com duas avaliações independentes. Nenhum arquivo alterado; testes não executados. O detector estático retornou zero alertas. Não houve inspeção da interface renderizada: problemas estruturais abaixo são verificáveis no código; contraste efetivo, foco e quebras de layout precisam de validação no navegador.

O [ADR-0193, D-12](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/docs/decisions/0193-relatorio-mensal-do-cliente-e-fechamento-automatico.md:42>) prevalece sobre sugestões anteriores: preservar conteúdo e funções, com os acréscimos expressamente aprovados em Cobrança e carteira.

### Base visual comum

Aplicar a linguagem do Ads: um destaque principal, superfícies neutras, números tabulares e metadados próximos do que explicam. A [StyleGuide:147](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/pages/StyleGuide.tsx:147>) reserva gradiente para hero/KPI de destaque; os tokens claro/escuro estão em [index.css:81](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/index.css:81>).

| Elemento | Componentes e props reais |
|---|---|
| Hierarquia de indicadores | `KpiCard size="default" variant="brand"` no destaque; `size="compact"` nos auxiliares; `loading`, `hint`, `valueClassName` |
| Superfícies e ações | `Card size="sm"`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`; `Button variant="outline"` para ações secundárias |
| Estados | `StatusPill tone="success\|warning\|danger\|info\|neutral"`; `Skeleton`; `EmptyState icon title description action` |
| Tabelas | `DataTable columns rows rowKey loading skeletonRows empty`; `Column.className` para quebra de texto; `stickyRight` quando necessário |
| Formulários e navegação | `Input`, `Textarea`, composição `Select`; `TabsList variant="line"`; `DialogContent processando destrutivo rotuloProcessando` |

Contratos conferidos em [kpi-card.tsx:13](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/ui/kpi-card.tsx:13>), [data-table.tsx:14](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/ui/data-table.tsx:14>) e [dialog.tsx:58](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/ui/dialog.tsx:58>).

**Dois cuidados comuns:**

- As tabelas já têm rolagem horizontal e região focável. O problema é largura/densidade de determinadas células; não ausência de rolagem.
- As melhorias de foco, contraste das pills e toque do Ads são **locais**. A Central não recebe automaticamente o acabamento documentado em [tela-ads.ts:5](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/ads/tela-ads.ts:5>). Aplicar acabamento equivalente no escopo da Central e validar ambos os temas, teclado e alvos de toque.

## 1. Cabeçalho e abas — `OrganizacaoDetalhe.tsx`

**Hoje — três linhas**

Mostra nome da organização, slug, modalidade e percentual da competência.  
Reúne mês, situação comercial, ambiente de teste e ações de suporte.  
Mantém seis abas na URL, incluindo badge de pendências em Cobrança.

**Problemas concretos**

1. **Hierarquia:** competência e suporte dividem a mesma área de ações; contrato, ambiente e suporte ativo aparecem na faixa inferior. Falta agrupamento visual entre identidade, período e operação. [OrganizacaoDetalhe.tsx:218](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/pages/OrganizacaoDetalhe.tsx:218>).
2. **Mobile:** `TabsList` já rola, mas oculta a barra; sua altura padrão é 32 px. Seis abas podem ficar fora da primeira área visível sem indicação clara. [tabs.tsx:28](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/ui/tabs.tsx:28>).
3. **Estados:** carregamento inicial, erro, contrato futuro e falha da prévia já têm tratamentos distintos. Preservá-los; a troca de mês mantém as abas montadas. [OrganizacaoDetalhe.tsx:60](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/pages/OrganizacaoDetalhe.tsx:60>).
4. **Controles:** o mês é `Input type="month"` **do DS**, não um `<input>` cru. Pode ganhar apresentação mais legível, mas não deve ser classificado como controle fora do DS. [OrganizacaoDetalhe.tsx:139](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/pages/OrganizacaoDetalhe.tsx:139>).

**Proposta visual**

Manter `PageHeader title actions`; aproximar o mês da identidade e separar visualmente suporte como ação secundária. Usar `TabsList variant="line"` com altura adaptável e `TabsTrigger` de 44 px em toque. Preservar ordem, valores das abas, URLs e badge.

O seletor pode continuar sendo `Input type="month"`. Se substituído por `Select`, manter o mesmo domínio de competências e serialização `YYYY-MM`, sem limitar arbitrariamente o histórico.

```text
← Organizações
[NOME DA ORGANIZAÇÃO]                 [Mês] [Ação de suporte]
slug · modalidade · percentual       [Teste] [Suporte ativo]

Resultados | Pulse | Extensão | Cobrança [2] | Auditoria | Configurações
──────────────────────────────────────────────────────────────────
```

**Conteúdo — precisa aprovação**

- Renomear “Pulse” para explicitar consumo/Sonar.
- Acrescentar novos resumos operacionais no cabeçalho.

**Testes e riscos**

[OrganizacaoDetalhe.test.tsx](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/pages/__tests__/OrganizacaoDetalhe.test.tsx:103>) cobre identidade, mês, aba na URL, carregamento inicial, preservação das abas durante troca de mês, erros, vigência futura, badge e suporte.

O redesenho pode quebrar parâmetros da URL, remontar formulários durante carregamento ou alterar indevidamente a disponibilidade de suporte. Não há comprovação visual de mobile/contraste nesses testes.

## 2. Pulse — `org-pulse.tsx`

**Hoje — três linhas**

Mostra unidades do cliente, consultas Daludi, falhas, reaberturas e custo medido.  
Lista data, consulta/tipo, pessoa, origem, resultado, unidades e isenção.  
Inclui início do rastreamento, paginação, carregamento, vazio e recuperação de erro.

**Problemas concretos**

1. **Hierarquia:** cinco KPIs `compact` têm peso semelhante; o grid de duas colunas deixa o quinto isolado no mobile. [org-pulse.tsx:78](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/org-pulse.tsx:78>).
2. **Tabela:** sete colunas, com consulta, identificação da pessoa e isenção potencialmente longas. A herança de `whitespace-nowrap` amplia a largura necessária. Tipo e resultado aparecem como valores técnicos. [org-pulse.tsx:21](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/org-pulse.tsx:21>).
3. **Metadados:** “Rastreado desde” fica solto entre indicadores e tabela, em texto pequeno. [org-pulse.tsx:103](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/org-pulse.tsx:103>).
4. **Estados:** erro inicial, falha de atualização com dados preservados e vazio já existem. Falta anúncio de carregamento no contêiner equivalente ao da Extensão. Não há controles nativos fora do DS. [org-pulse.tsx:56](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/org-pulse.tsx:56>).

**Proposta visual**

Dar destaque a “Unidades do cliente” com `KpiCard size="default" variant="brand"`. Manter quatro auxiliares compactos em linha responsiva. Integrar rastreamento ao cabeçalho da listagem.

Na `DataTable`, aplicar `Column.className="whitespace-normal break-words"` às colunas textuais, com largura controlada; números à direita. Preservar todas as colunas e paginação. Acrescentar `aria-busy` e status de carregamento sem substituir dados durante falha de atualização.

```text
[UNIDADES DO CLIENTE — destaque]
[Consultas Daludi] [Falhas] [Reaberturas] [Custo medido]

Consultas                              Rastreado desde ...
[Data | Consulta/tipo | Pessoa | Origem | Resultado | Unidades | Isenção]
[Paginação]
```

**Conteúdo — precisa aprovação**

- Traduzir `query_type` e `result`, mantendo os códigos disponíveis.
- Corrigir o hint “Sem medição do fornecedor”: hoje ele aparece mesmo quando `measured_cost_cents` tem valor. [org-pulse.tsx:97](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/org-pulse.tsx:97>).

**Testes e riscos**

[org-pulse.test.tsx:32](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/__tests__/org-pulse.test.tsx:32>) verifica retorno à página 1 ao trocar mês.

A cobertura é estreita: não protege indicadores, indisponibilidade de custo nem estados de leitura. Preservar o reset por organização/mês e os parâmetros de paginação; acrescentar cobertura desses estados antes de reorganizar sua renderização.

## 3. Extensão — `org-extensao.tsx`

**Hoje — três linhas**

Mostra análises mensais, pessoas ativas, vínculos de produto e erros de leitura.  
Apresenta distribuição por tipo de página, início do uso e pessoas que utilizaram a extensão.  
Lista erros com motivo legível, código técnico, versão, ocorrências e último anúncio.

**Problemas concretos**

1. **Hierarquia:** quatro KPIs compactos dão o mesmo destaque a uso, adoção e erro. “Vínculos” é total da organização; essa diferença temporal aparece somente no hint. [org-extensao.tsx:81](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/org-extensao.tsx:81>).
2. **Densidade:** a tabela de erros possui seis colunas, e cada motivo ocupa descrição mais código. Textos extensos podem gerar bastante rolagem. [org-extensao.tsx:38](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/org-extensao.tsx:38>).
3. **Composição:** distribuição, pessoas e erros ficam empilhados mesmo em telas largas; a distribuição usa superfície construída manualmente. [org-extensao.tsx:92](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/org-extensao.tsx:92>).
4. **Estados/acessibilidade:** já há `aria-busy`, anúncio de carregamento, falha inicial, falha com cache e dois vazios explicativos. Os números acompanham as barras, evitando depender só de cor. Não há controle fora do DS. [org-extensao.tsx:73](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/org-extensao.tsx:73>).

**Proposta visual**

Destacar análises com `KpiCard size="default"`; manter auxiliares compactos e tornar o hint existente de vínculos mais perceptível. Distribuição e pessoas podem compartilhar duas colunas no desktop, usando `Card size="sm"`; erros permanecem em largura total.

Manter descrição e código visíveis, com quebra de texto. Preservar os dois vazios independentes: ausência de uso e ausência de erros significam coisas diferentes.

```text
[ANÁLISES NO MÊS] [Pessoas] [Vínculos / total da organização] [Erros]
[Análises por tipo de página]       [Quem usou]
[Erros: Data | Página | Motivo/código | Versão | Ocorrências | Anúncio]
```

**Conteúdo — precisa aprovação**

- Renomear “Vínculos de produto” para tornar explícito que é um total acumulado.
- Nenhum indicador novo é necessário ao redesenho.

**Testes e riscos**

[org-extensao.test.tsx](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/__tests__/org-extensao.test.tsx:28>) cobre indicadores, distribuição, pessoas, motivos legíveis, vazios, vínculos indisponíveis e falhas com/sem cache.

Preservar `null ≠ 0`, códigos técnicos e nome acessível da distribuição. As barras continuam usando `analises` como denominador. Faltam verificações específicas de carregamento e layout mobile.

## 4. Cobrança — três componentes

**Hoje — três linhas**

Exibe condições comerciais e histórico antes da prévia mensal.  
Mostra composição, pendências, conciliação de devolução e confirmação de fechamento.  
Lista demonstrativos fechados com exportação do snapshot.

**Problemas concretos**

1. **Hierarquia:** `CommercialTermsForm` renderiza formulário/resumo **e histórico** antes da prévia. A tarefa mensal principal fica abaixo da administração contratual. [org-billing.tsx:165](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/org-billing.tsx:165>), [commercial-terms-form.tsx:418](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/commercial-terms-form.tsx:418>).
2. **Estado financeiro:** a área principal sempre recebe `preview`; o demonstrativo fechado aparece separado na lista. `canClose` considera contrato, bloqueios e mês encerrado, sem consultar ali se a competência já possui demonstrativo. A UI não distingue claramente prévia e documento congelado do mês selecionado. [org-billing.tsx:103](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/org-billing.tsx:103>).
3. **Mobile:** ações no `CardAction`, pendências com botão lateral e linhas do histórico financeiro usam composição horizontal sem adaptação explícita para empilhamento. É risco de compressão, ainda não quebra observada. [org-billing.tsx:181](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/org-billing.tsx:181>).
4. **Controles/foco:** existem dois `<textarea>` fora do DS: [commercial-terms-form.tsx:361](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/commercial-terms-form.tsx:361>) e [revenue-reconciliation.tsx:103](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/revenue-reconciliation.tsx:103>). Substituir por `Textarea`, preservando labels, valores e handlers. Modalidade/vigência já usam `Select`; implantação já usa `Input type="month"` do DS.
5. **Estados:** prévia e demonstrativos têm skeleton, erro e recuperação. O histórico de condições, isoladamente, trata loading/vazio sem ramo próprio de erro; o componente pai atualmente intercepta a falha de termos. Preservar essa proteção ao reorganizar os blocos. [commercial-terms-form.tsx:420](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/commercial-terms-form.tsx:420>).

**Proposta visual**

Priorizar competência, situação e valor mensal; contrato e histórico ficam abaixo. Quando não há primeiro contrato, manter o formulário aberto e acessível como ação necessária.

Usar `Card`, `StatusPill`, composição financeira em `dl`, total com tipografia maior e ações que empilham no mobile. Manter os diálogos existentes; aplicar `DialogContent processando={...}` e associar erros aos respectivos campos com `aria-invalid`/`aria-describedby`.

```text
COBRANÇA · competência                         [Gerar relatório mensal]
[Demonstrativo: aberto/fechado]  [Estado do fechamento automático]

[Composição financeira                         TOTAL]
[Ponte para faturamento da loja]
[Pendências + conciliar]              [Fechar demonstrativo]

[Condições comerciais / Renegociar]
[Histórico de condições]       [Demonstrativos fechados / Exportar]
```

**Os três acréscimos já aprovados pelo ADR**

| Acréscimo | Posição e comportamento |
|---|---|
| **“Gerar relatório mensal”** | No topo da área mensal, ligado à organização e competência selecionadas. `Button disabled` enquanto não houver demonstrativo fechado confirmado; motivo visível associado por `aria-describedby`, sem depender apenas de `title`/hover. Erro de consulta não pode virar “não fechado”. |
| **Fechamento automático** | Faixa abaixo do título: agenda **dia 01, às 06h BRT, para a competência anterior**, mais resultado real da execução. Representar fechada/já fechada, pendência/mês anterior aberto e conflito/erro. Usar `StatusPill` com texto e ligação à Auditoria; não inferir execução pelo calendário. |
| **Ponte do cupom — D-4** | Dentro da composição, abaixo da comparação de faturamento/base e antes do total. Exibir a diferença assinada para o faturamento da loja, explicada por cupons e ajustes posteriores ao fechamento. Todos os valores de cobrança continuam vindo do snapshot. |

Fontes normativas: [ADR-0193 D-1:16](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/docs/decisions/0193-relatorio-mensal-do-cliente-e-fechamento-automatico.md:16>), [D-4:26](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/docs/decisions/0193-relatorio-mensal-do-cliente-e-fechamento-automatico.md:26>) e [D-10:38](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/docs/decisions/0193-relatorio-mensal-do-cliente-e-fechamento-automatico.md:38>).

**Dependências concretas:** os tipos atuais não trazem total de cupons nem resultado do fechamento automático. Isso exige contrato de dados, não apenas CSS. [types.ts:45](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/supabase/functions/_shared/platform-admin/types.ts:45>).

Também é necessário resolver o demonstrativo **exato** da competência: `usePlatformStatements(orgId)` consulta uma lista, e o repositório pagina os resultados. Ausência na página carregada não prova ausência de demonstrativo. [usePlatformAdmin.ts:151](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/hooks/usePlatformAdmin.ts:151>), [repository.ts:185](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/supabase/functions/_shared/platform-admin/repository.ts:185>).

Na ponte, não descontar cupom novamente da base nem recalcular total no front. Snapshot antigo sem detalhamento de cupons deve indicar ausência desse detalhamento, sem inventar zero.

**Conteúdo — precisa aprovação**

- Renomear “Ajustes da base” para explicitar devoluções.
- Humanizar as datas técnicas na conciliação.
- Acrescentar explicações comerciais além do texto exigido pelo ADR.

**Testes e riscos**

| Testes existentes | O que protegem |
|---|---|
| [org-billing.test.tsx](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/__tests__/org-billing.test.tsx:146>) | Organização/mês/revisão no fechamento, confirmação, conflito com nova revisão, conciliação sem editar bruto, snapshot exportado, mês atual, crédito e ausência de contrato |
| [commercial-terms-form.test.tsx](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/__tests__/commercial-terms-form.test.tsx:60>) | Primeiro contrato, renegociação, virada de mês, implantação, modalidades, zeros, percentuais digitados e histórico |
| [platform-billing.test.ts](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/lib/export/__tests__/platform-billing.test.ts:96>) | Exportação direta do snapshot e estabilidade perante mudança contratual |

Os testes existentes não cobrem os três acréscimos do ADR. Acrescentar competência fechada fora da primeira página, relatório desabilitado com motivo acessível, estados reais do automático, cupons e snapshot antigo.

Maior risco: misturar prévia com snapshot, perder `expected_revision`/`source_updated_at`, alterar centavos ou flexibilizar regras contratuais durante uma mudança visual.

## 5. Auditoria — `org-audit.tsx`

**Hoje — três linhas**

Filtra eventos por categoria, UUID exato do responsável e resultado.  
Lista data, categoria, ação, responsável, resultado, alvo e detalhes.  
Abre payload sanitizado em Popover e oferece motivo, paginação e recuperação de erro.

**Problemas concretos**

1. **Filtros:** já são `Select`/`Input` do DS, porém sem labels visíveis, com alturas de 32 px e larguras fixas. [org-audit.tsx:114](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/org-audit.tsx:114>).
2. **Teclado/toque:** descobrir o UUID depende do `title` de um `span`; a instrução também está no `title` do campo. Não há descoberta equivalente por foco/toque. [org-audit.tsx:80](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/org-audit.tsx:80>).
3. **Densidade:** sete colunas, ações em código pequeno e botões chamados apenas “Ver”. O `pre` do payload não tem limite vertical. [org-audit.tsx:74](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/org-audit.tsx:74>).
4. **Estados:** falha sem dados renderiza alerta e também “Nenhum evento encontrado”. `loading` considera apenas `isLoading`, diferente da proteção existente em Pulse/Extensão. [org-audit.tsx:153](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/org-audit.tsx:153>).

**Proposta visual**

Manter filtros, valores e tabela. Adicionar labels visíveis; `SelectTrigger className="w-full sm:w-[...]"` e campos com tamanho de toque adequado. Tornar a instrução atual visível e o UUID consultável por controle focável.

Manter `Popover`, com `PopoverContent className="max-h-[60vh] overflow-y-auto"`; dar nome acessível contextual a “Ver”. Erro sem dados deve ocupar o estado da tabela; vazio fica reservado à consulta bem-sucedida sem eventos.

```text
Categoria             Responsável — UUID           Resultado
[Select]              [Input]                      [Select]
[Instrução existente para localizar o UUID]

[Data | Categoria | Ação | Responsável | Resultado | Alvo | Ver]
[Paginação]
```

**Conteúdo/função — precisa aprovação**

- Traduzir nomes técnicos de ações.
- Trocar UUID por busca nominal.
- Corrigir o reset de página na troca de organização/mês: hoje há reset nos filtros, mas não nessas props. É correção funcional separada do visual. [org-audit.tsx:58](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/org-audit.tsx:58>).

**Testes e riscos**

[org-audit.test.tsx](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/__tests__/org-audit.test.tsx:45>) cobre nome/Sistema, Popover, erro/refetch, vazio, seleção por teclado, tradução/tons de resultados e filtro UUID. O teste de erro não impede a exibição simultânea do vazio.

Preservar payload sanitizado e valores técnicos enviados: `success` e `succeeded` não podem ser fundidos porque possuem rótulos parecidos.

## 6. Configurações e diálogo de arquivamento

**Hoje — três linhas**

Configura PF/PJ, canais, módulos, tipos de produto e marca própria.  
Cada um dos cinco cards salva separadamente, com erro local e sucesso inline/toast.  
O diálogo de arquivamento confirma consequências e exige o slug exato.

**Localização importante:** o diálogo é acionado **na carteira**, não nesta aba: [Organizacoes.tsx:484](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/pages/Organizacoes.tsx:484>), montagem em `:673`. Movê-lo seria mudança de navegação.

**Problemas concretos**

1. **Hierarquia/densidade:** cinco cards equivalentes em duas colunas misturam um cadastro com apenas um campo e listas maiores. O quinto fica sozinho; os botões estão em `div`s sem rodapé padronizado. [org-settings.tsx:131](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/org-settings.tsx:131>).
2. **Carregamento:** são quatro skeletons para cinco cards reais, sem anúncio de carregamento no contêiner. Erro e organização inexistente já são diferenciados. [org-settings.tsx:108](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/org-settings.tsx:108>).
3. **Controles:** todos já pertencem ao DS e possuem associação de rótulos. Mercado Livre está desabilitado como canal obrigatório; não há `<select>`/`textarea` cru a substituir. [org-settings.tsx:135](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/org-settings.tsx:135>).
4. **Arquivamento:** o botão mantém “Arquivar” enquanto aguarda; o diálogo não utiliza os props de processamento do DS. As consequências estão concentradas num parágrafo. [dialog-arquivar-org.tsx:35](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/dialog-arquivar-org.tsx:35>).

**Proposta visual**

Usar cinco `Card size="sm"` com `CardFooter`, preservando os salvamentos independentes. Uma coluna no mobile e duas no desktop; marca pode ocupar a largura completa. Organizar checkboxes em linhas com área clicável mais confortável, mantendo descrições.

No diálogo, separar visualmente as consequências existentes. Usar `DialogContent processando={enviando} destrutivo={arquivar} rotuloProcessando={...}` e feedback durante processamento; manter slug e `Button variant="destructive"`.

```text
[Cadastro             ] [Canais               ]
[Salvar cadastro      ] [Salvar canais        ]
[Módulos              ] [Tipo de produto      ]
[Salvar módulos       ] [Salvar tipo          ]
[Marca própria + nome                         ]
[Salvar marca                                 ]

Diálogo na carteira: consequências → [Digite slug] → [Arquivar]
```

**Conteúdo/função — precisa aprovação**

- Explicar por que Mercado Livre é obrigatório.
- Trazer arquivamento para Configurações.
- Criar “Salvar tudo”, aviso de alterações pendentes ou proteção adicional de rascunhos.

**Testes e riscos**

- [org-settings.test.tsx](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/__tests__/org-settings.test.tsx:49>): sucesso, erro local, Select do DS, marca e validação.
- [org-settings-tipos-produto.test.tsx](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/__tests__/org-settings-tipos-produto.test.tsx:50>): separação de módulos/tipos, estado inicial e ordem canônica do payload.
- [Organizacoes.test.tsx:327](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/pages/__tests__/Organizacoes.test.tsx:327>): arquivar/desarquivar, slug, payload, filtros e ajuste de página.

Preservar independência dos salvamentos. Há risco existente de refetch reinicializar rascunhos: salvar invalida `organizacoes`, e `useEffect([org])` repõe todos os campos. Não reproduzido nesta análise; evitar alterar esse fluxo sob justificativa visual. [org-settings.tsx:71](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/org-settings.tsx:71>).

## 7. Carteira — `Organizacoes.tsx`

**Hoje — três linhas**

Mostra faturamento agregado, previsão, pendências e quantidade de organizações.  
Oferece faixa de atenção, busca, filtros, tabela e paginação.  
Permite navegar mantendo a competência e acessar suporte, criação e arquivamento.

**Problemas concretos**

1. **Bug confirmado da variação:** `HeroCarteira` calcula percentual a partir de `orgs`; o valor principal vem de `totals`. São universos diferentes. [Organizacoes.tsx:107](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/pages/Organizacoes.tsx:107>).
2. **A paginação ocorre antes:** `pageRows` faz `slice`; `orgs` deriva desse recorte; o hero recebe esse array em `:522`. O bug ocorre também com até 200 organizações, quando o servidor devolve tudo e o cliente pagina localmente. [Organizacoes.tsx:205](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/pages/Organizacoes.tsx:205>).
3. **Mobile/densidade:** várias colunas são ocultadas por breakpoint; ações de suporte podem ficar extensas na coluna fixa. O filtro “Todas/Com pendências” força altura de 28 px. [Organizacoes.tsx:399](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/pages/Organizacoes.tsx:399>), [Organizacoes.tsx:586](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/pages/Organizacoes.tsx:586>).
4. **Estados/controles:** já diferencia loading, erro e vazio e evita anunciar contagem falsa. O mês usa `Input` do DS. O diálogo “Nova empresa”, porém, depende de placeholders nos cinco campos, sem labels persistentes. [Organizacoes.tsx:619](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/pages/Organizacoes.tsx:619>), [Organizacoes.tsx:731](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/pages/Organizacoes.tsx:731>).

**Correção proposta para a variação**

Calcular o agregado anterior **no backend, antes da paginação**, sobre as mesmas organizações ativas que compõem `totals.gross_cents`. O repositório já possui esse universo em `ativas`. [repository.ts:153](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/supabase/functions/_shared/platform-admin/repository.ts:153>).

O contrato `WalletTotals` deve carregar total anterior e indicação de disponibilidade; o hero passa a depender somente dos totais.

```text
variação = (total_atual − total_anterior) ÷ total_anterior × 100
```

Regras:

- Mesmos filtros, organizações e recorte temporal nos dois agregados; arquivadas continuam fora dos totais.
- Uma organização com anterior zero não invalida a comparação se o agregado anterior for positivo.
- Métrica ausente torna a comparação indisponível; ausência não vira zero.
- Agregado anterior zero não produz percentual.
- Paginar ou ordenar não altera valor nem variação do hero.

Não resolver somando `wallet.data.rows`: acima de 200 organizações a resposta é paginada no servidor.

**Proposta visual**

Preservar o hero como único destaque; organizar atenção, filtros e tabela em sequência clara. Ampliar os controles de toque, acrescentar labels no diálogo e manter ações alcançáveis durante rolagem.

O **estado do fechamento**, já aprovado em D-12, entra na identificação financeira de cada organização com `StatusPill` e acesso à Cobrança da mesma competência. No mobile, pode ficar abaixo do nome para não criar mais uma coluna obrigatória.

```text
Organizações                                  [Mês] [Nova empresa]
[FATURAMENTO + variação global] [Previsão] [Pendências] [Organizações]

Precisa da sua atenção
[Busca] [Todas / Com pendências] [Incluir testes] [Incluir arquivadas]

[Organização + fechamento | Faturamento | ... | Previsão | Pendências | Ações]
[Paginação]
```

**Conteúdo/função — precisa aprovação**

- Renomear “Previsão” para “Previsão de cobrança” na tabela.
- Alterar quais informações ficam visíveis no mobile.
- Ampliar a faixa de atenção para um resumo global com novas contagens.

**Testes e riscos**

[Organizacoes.test.tsx](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/pages/__tests__/Organizacoes.test.tsx:155>) cobre carteira, markup, navegação/mês, filtros, erros, estados comerciais, pendências, carregamento, debounce, suporte e arquivamento.

[repository.test.ts:62](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/supabase/functions/_shared/platform-admin/__tests__/repository.test.ts:62>) protege totais anteriores à paginação; também há casos de arquivadas e mais de 200 organizações. **Não há teste que assegure a variação global independente da página.**

Acrescentar casos com 11 organizações e com mais de 200, páginas com tendências opostas, anterior zero, dado ausente e arquivadas. Preservar ordenação global, debounce e distinção entre previsão indisponível e zero real.

**Cuidado de implementação:** não tornar o KPI de pendências um `KpiCard` default clicável sem verificar o DS. Hoje `onClick`/`ativo` são aplicados no ramo compacto; o ramo default não aplica esses mesmos controles. [kpi-card.tsx:177](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/ui/kpi-card.tsx:177>).

## Ordem de implementação — menor risco primeiro

Estimativas de engenharia para o escopo visual e suas verificações; PDF, job agendado e novos contratos financeiros exigem estimativa própria.

| Ordem | Superfície | Tempo estimado | Critério de saída |
|---|---|---:|---|
| 1 | **Extensão** | 3–5 h | Mesmos dados, vazios e indisponibilidades; layout desktop/mobile conferido |
| 2 | **Pulse** | 3–5 h | Hierarquia nova, tabela legível e paginação preservada |
| 3 | **Auditoria** | 4–6 h | Filtros/payload intactos; UUID acessível; erro distinto de vazio |
| 4 | **Configurações** | 4–6 h | Cinco salvamentos independentes; arquivamento permanece na carteira |
| 5 | **Cabeçalho/abas** | 3–5 h | URL, suporte e preservação das abas durante leitura mantidos |
| 6 | **Carteira** | 6–10 h | Variação global corrigida no contrato; paginação não muda o hero |
| 7 | **Cobrança** | 8–16 h de UI | Snapshot por competência, três acréscimos do ADR e travas financeiras verificados |

**Próxima ação — 2 minutos:** abra [org-extensao.tsx:81](</Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/central-premium-relatorio/src/components/platform-admin/org-extensao.tsx:81>) e use essa aba como primeiro piloto visual.