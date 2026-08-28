# Plan: Refatoração de design e arquitetura de informação da tela Configurações

_Locked via grill-with-docs (Ato 1) — Claude + Diego, 2026-08-28._
_Revisado em 8 rodadas do Ato 2 (Codex adversarial) — ver `PLAN-REVIEW-LOG.md`._
_Modo frontend-design: **system work**. Sistema herdado: tokens oklch em `src/index.css`,
Geist Variable, shadcn em `src/components/ui/`, primitivos `Section`/`PageHeader`,
`src/pages/StyleGuide.tsx` como referência canônica._

## Goal

`/configuracoes` hoje é uma coluna `max-w-2xl` com 10 cards de peso visual idêntico, sem
hierarquia: fiscal (Empresa ~20 campos + Imposto por origem) ocupa ~60% da altura e esmaga
preferências de uma linha. A refatoração dá à tela uma sub-navegação por seção com rota
própria, um idioma único de item de configuração (rótulo à esquerda / controle à direita),
absorve `Usuários` como seção, e remove o controle que não persiste nada. **Nenhuma regra de
negócio muda**: os mesmos hooks, as mesmas mutations, os mesmos gates, os mesmos ADRs.

## Approach

### 1. Rotas e o guard de OAuth

- `src/App.tsx:57` vira `<Route path="/configuracoes/*" element={<Configuracoes />} />`.
  Sem o `/*`, `/configuracoes/fiscal` cai no `NotFound`.
- **Todas** as seções são filhas, com prefixo explícito: `/configuracoes/geral`,
  `/configuracoes/precos`, `/configuracoes/fiscal`, `/configuracoes/notificacoes`,
  `/configuracoes/ia`, `/configuracoes/membros`. Nenhum slug de topo — `menuKeyForPath`
  (`src/lib/menus.ts`) olha só o primeiro segmento, e um `/fiscal` de topo devolveria `null`,
  liberando o menu por engano.

**O guard de OAuth vira um componente próprio, `OAuthRedirectGate`**, e não uma condição
dentro do layout. Motivo: o `if` de hoje (`Configuracoes.tsx:167`) roda depois de ~15 hooks;
"colocar o guard primeiro" dentro do mesmo componente violaria as Rules of Hooks. O gate:

```
<Route path="/configuracoes/*" element={<OAuthRedirectGate><ConfiguracoesLayout /></OAuthRedirectGate>} />
```

- Usa só `useSearchParams`. Se houver `ml_conectado`, `ml_erro` ou `ml_claim`, navega para
  **`{ pathname: '/canais', search: searchParams.toString() }`** — preservando a query, como
  o código atual já faz. `Canais.tsx` lê esses parâmetros para chamar `confirmarConexaoML`;
  um `<Navigate to="/canais">` sem a search mata a confirmação da conexão em silêncio.
- Só depois do gate o layout decide a seção: slug ausente, desconhecido, ou de seção
  invisível ao perfil → `<Navigate replace>` para a primeira seção visível. Nunca renderizar
  campos desabilitados como fallback de permissão.
- Sem loop: o destino é sempre um slug da mesma lista visível calculada no mesmo render, e
  `/canais` não volta para Configurações. A garantia depende de o `MenuGuard` já ter
  carregado o perfil e de existir ao menos uma seção visível — a seção `Geral` não tem gate,
  então a lista nunca é vazia.

### 2. Registro de seções, visibilidade e edição

Um único array declarativo (`SECOES`) com `{ slug, titulo, descricao, icone, visivel,
Componente }`. Sub-nav, roteamento e gate leem todos desse array.

**Visibilidade ≠ edição, e cada seção declara as duas explicitamente.** Não existe um
predicado global: um `podeVer` genérico que liberasse toda seção restrita ao suporte vazaria
`Membros`, que o suporte **nunca** viu — `menus.ts:14` devolve `[...MENU_KEYS]` e
`MENU_KEYS` não contém `usuarios`. A matriz é por seção:

A tela escreve em **duas tabelas com policies diferentes**, então há dois predicados de
edição — não um. **Leitura não é gateada em nenhum dos dois casos:** o `SELECT` de
`configuracoes` e o de `empresa_fiscal` são liberados a qualquer membro da organização, e
este plano **não** introduz gate de leitura.

| Predicado | Tabela | Regra RLS replicada |
|---|---|---|
| `podeEditarConfig` | `configuracoes` — descontos, ancorar piso, mostrar lucro, modelos de IA, Telegram, **alíquotas** | `is_admin() OR current_support_scope() = 'full'` (`support_access.sql:285-298`) |
| `podeEditarEmpresa` | `empresa_fiscal` — os ~20 campos do cadastro da empresa | `is_admin()` apenas, **sem** escape de suporte (`adr135_cadastro_fiscal.sql:49-57`) |

Os dois recebem **`canWrite()` como conjunto adicional**: `podeEditarConfig =
canWrite() && (isAdmin || escopoSuporte === 'full')` e `podeEditarEmpresa =
canWrite() && isAdmin`. `canWrite()` é `false` numa sessão de suporte com escopo `read`, e o
super-admin que abre essa sessão carrega `profiles.is_admin = true` (o backfill de
`profiles_e_helpers.sql:71-76` marcou o usuário existente como admin, e `is_admin()` lê essa
mesma coluna). Sem o conjunto, uma sessão de suporte **somente leitura** apareceria com os
controles habilitados. Usado sozinho `canWrite()` seria permissivo demais (§ abaixo); usado
como conjunto ele só **restringe**, com código que já existe.

| Seção | Conteúdo | Quem vê | Quem edita |
|---|---|---|---|
| Geral | Card "Canais conectados" (link p/ `/canais`); Mostrar lucro no card do Dashboard | todos | `podeEditarConfig` |
| Preços | Desconto de marketing; Desconto sobre concorrência; Ancorar no piso dos MercadoLíderes | todos | `podeEditarConfig` |
| Fiscal | Imposto por origem (+ venda dentro do estado) | todos | `podeEditarConfig` |
| Fiscal | Empresa (Identidade, Endereço, Operação fiscal, Emissão) | todos | `podeEditarEmpresa` |
| Notificações | `ConfigTelegram` | todos | `podeEditarConfig` |
| IA | Modelo de texto; Modelo de imagem | todos | `podeEditarConfig` |
| Membros e acessos | a página `Usuarios` atual, sem alteração de lógica | **só admin** (via `visibleMenus`) | `canWrite() && isAdmin` |

**Só `Membros` tem gate de visibilidade**, e esse gate **não é re-derivado de `isAdmin`** — é
lido da fonte de verdade que já existe: `visibleMenus(profile, !!context).includes('usuarios')`,
a mesma chamada do `sidebar.tsx:41`. Re-derivar por `isAdmin` divergiria justamente na sessão
de suporte, onde `visibleMenus(p, true)` devolve `MENU_KEYS` (sem `usuarios`) mas o
super-admin que abre a sessão tem `profiles.is_admin = true` — `Membros` reapareceria para o
suporte, que nunca o viu. Reusar a função elimina a classe inteira do erro.

Todo o resto é visível a qualquer membro que já tenha o menu `configuracoes`, exatamente como
hoje: o `SELECT` das duas tabelas é liberado na org, e esconder a alíquota vigente de quem
precifica seria esconder dado que ele tem direito de ver.

A seção Fiscal é a única que cruza os dois predicados de edição: numa sessão de suporte
`full`, as alíquotas são editáveis e o cadastro da empresa não. O aviso de leitura é **por
bloco**, não por tela.

Isso corrige um **defeito pré-existente**, não introduz um: hoje Geral, Preços e Notificações
não têm gate nenhum na UI, então um operador não-admin vê os controles habilitados, digita,
o blur dispara o save, o RLS recusa — e como não há ramo de erro na tela, ele acha que salvou.

- **`canWrite()` nunca sozinho.** `canWrite()` (`support-store.ts:56`) devolve `true` para
  qualquer membro com `org_id`; usado como único gate seria mais permissivo que as duas
  policies e reproduziria o defeito. Ele entra só como conjunto restritivo, para fechar a
  sessão de suporte em escopo `read`.
- **Armadilha:** o escopo de suporte vem do store; ler por função pura não re-renderiza. O
  componente usa `useSupportStore((s) => s.context)`.
- **Ajuste consciente da decisão original.** Diego escolheu "esconder a seção do não-admin"
  quando a alternativa era a parede de inputs cinzas. Com o modo leitura desenhado e o RLS
  medido, esconder perde o motivo e passa a ter custo: **nenhuma** seção é editável por
  membro comum (`configuracoes` aceita admin ou suporte `full`; `empresa_fiscal` e `Membros`,
  só admin), então esconder toda seção não editável deixaria `/configuracoes` vazio para o
  operador — e ele deixaria de enxergar qual desconto e qual alíquota estão valendo.
- `Membros` é **admin-only para ver e para editar**, sem exceção de suporte, com visibilidade
  lida de `visibleMenus`. Isso preserva o gate atual e o ADR-0068, que define a gestão de
  notificações por destinatário como ação de admin na tela Usuários. Diagnóstico de membros
  pelo suporte, se um dia for necessário, é feature separada — não efeito colateral de um
  refactor de layout.

**Gate fiscal preservado como está.** O ADR-0135 condiciona o módulo fiscal a
`organizations.tipo_pessoa = 'pj'` + `'fiscal' ∈ modulos_habilitados` (com constraint no
banco), e a UI já tem `useModulosHabilitados`. Este plano **não** introduz esse gate: hoje o
card aparece para qualquer org, e mudar isso é regra de negócio. Fica como pergunta aberta.

### 3. Usuários vira seção (decisão de 2026-08-28)

Motivo: o menu tem 12 itens e gestão de acesso é canonicamente uma seção de configurações.
`Canais` **não** se move — é operação (destino do callback OAuth, reconexão de token) e vai
ganhar peso com o E5/Shopee, conforme ADR-0077, que desenhou a UI multicanal para escalar até
5 marketplaces.

- `Usuarios.tsx` vira o `Componente` da seção `membros`. **Zero mudança na lógica da página**
  — só perde o próprio `PageHeader`, que passa a ser o cabeçalho da seção. Nenhuma prop nova
  obrigatória: `Usuarios.test.tsx:30` renderiza `<Usuarios />` direto e deve continuar
  passando sem alteração. Se um dia precisar de prop, ela nasce opcional com default seguro.
- O `lazy(() => import('./pages/Usuarios'))` sai de `App.tsx:14` e vai para o registro de
  seções — senão fica uma declaração não usada e o ESLint reprova.
- `NAV_ITEMS` perde a entrada `usuarios`, e o import `Users` do lucide sai junto
  (`sidebar.tsx:2`) — import órfão é erro de lint, não aviso.
- `MENU_KEYS`/`MenuKey`/`visibleMenus` ficam **intactos**: a chave `usuarios` continua
  existindo e continua sendo dada só ao admin, e `menuKeyForPath('/usuarios')` continua
  resolvendo — mexer nisso rippla no `MenuGuard`.
- `/usuarios` continua existindo como rota, redirecionando (`replace`) para
  `/configuracoes/membros`. O `MenuGuard` intercepta antes: admin passa e é redirecionado;
  quem não tem a chave `usuarios` (inclusive sessão de suporte) é mandado para o primeiro
  menu permitido, **exatamente como hoje**. Não há `navigate('/usuarios')` no código — as
  referências vivem na rota, na sidebar e nos testes.

### 4. Layout

- Duas colunas: sub-nav sticky à esquerda (`w-56`), painel da seção à direita, largura de
  leitura limitada (`max-w-3xl`) para o texto de apoio não passar de ~75 caracteres. A seção
  `membros` usa largura cheia — é tabela, não formulário.
- Item ativo marcado por fundo `bg-accent` + peso, seguindo o idioma do `sidebar.tsx`.
- Abaixo de `sm:`, a sub-nav vira um `Select` no topo ("Seção: Preços ▾").
- Espaçamento só em passos de 4px.
- `useAliquotas()` é chamado **no layout pai**: o marcador de "alíquotas não confirmadas" na
  sub-nav precisa existir enquanto o operador está em outra seção, e o hook só roda onde está
  montado. Mesma `queryKey`, então o react-query dedupe com a leitura da seção Fiscal.

### 5. Primitivos novos — em `src/components/configuracoes/`, não em `ui/`

Ficam em `src/components/configuracoes/settings-row.tsx`. Só promovem para
`src/components/ui/` (e para o `StyleGuide`) depois de um segundo consumidor real fora de
Configurações — primitivo público com um único uso é API prematura.

- `SettingsGroup` — card com título opcional, itens separados por `divide-y`.
- `SettingsRow` — grid de 2 colunas: `{ titulo, descricao, children (controle), estado }`.
  Rótulo/descrição à esquerda, controle alinhado à direita e ao topo; abaixo de `sm:` colapsa
  para uma coluna. `htmlFor`/`id` amarrando rótulo e controle.
- `EstadoSalvo` — `Salvando… / ✓ Salvo / erro`, com `role="status" aria-live="polite"`; o erro
  da linha é ligado ao input por `aria-describedby` e o input recebe `aria-invalid`.
  `CampoEmpresa` precisa ser estendido para expor `id` de erro, `aria-describedby` e
  `aria-invalid` — hoje só renderiza um `<p>` solto.
- **Sem card aninhado:** `ConfigTelegram` hoje retorna um `Card` próprio. Ele passa a aceitar
  renderização sem card quando montado dentro de um `SettingsGroup`. Card dentro de card é
  exatamente o ruído visual que esta refatoração existe para remover.
- Alvo de toque ≥44px na linha inteira; `:focus-visible` visível em todos os controles.

### 6. Estado de salvamento por linha

`useSalvarEmpresaFiscal` e `useSalvarAliquotas` são mutations **compartilhadas** por vários
campos: hoje um `isSuccess` acende o `✓ Salvo` de todas as linhas.

Derivar de `mutation.variables` **não resolve**: `salvarAliquotas.mutate()` sempre envia
`nacional`, `importado`, `ufEmpresa` e `internaPct` juntos, então "o patch contém a chave
desta linha" é verdade para todas; e em v5 `variables` reflete só a última chamada.

Solução em três partes:

1. **Estado:** um mapa por campo, `Map<campo, 'salvando' | 'salvo' | 'erro'>`, alimentado por
   `mutateAsync()` com `try/catch/finally` — não pelos callbacks do segundo argumento de
   `mutate()`, que em v5 podem não disparar em chamadas consecutivas e deixariam a primeira
   linha presa em "salvando".
2. **Sequência por campo:** cada `mutateAsync` carrega um id de operação incremental por
   campo; o `finally` só escreve no mapa se o id ainda for o mais recente daquele campo. Sem
   isso, dois blurs seguidos **no mesmo campo** deixam o `finally` do primeiro sobrescrever o
   resultado do segundo.
3. **Serialização — corrida de dados, não só visual.** `upsertAliquotas`
   (`queries.ts:632`) grava o snapshot inteiro (`nacional`, `importado`, `ufEmpresa`,
   `internaPct`) a cada chamada, e `upsertEmpresaFiscal` faz patch por campo mas sem
   ordenação garantida. Em ambos, duas chamadas resolvendo fora de ordem fazem a mais
   **velha** sobrescrever o valor mais novo no banco — o dado fica errado mesmo com o estado
   visual correto.

   Os saves passam a ser **single-flight por tabela** — uma fila para `configuracoes`, outra
   para `empresa_fiscal`, independentes entre si (uma gravação de cada pode estar em voo ao
   mesmo tempo; o que não pode é duas da mesma tabela). Dentro de uma fila, a próxima só parte
   quando a anterior termina, no `finally`, **inclusive após erro**: uma falha não descarta o
   que está enfileirado atrás.

   **A fonte do payload enfileirado não é o cache do react-query.** `invalidateQueries` não
   atualiza `useAliquotas().data` / `useEmpresaFiscal().data` de forma síncrona, então
   remontar o patch a partir do cache reenviaria um snapshot velho. Cada fila mantém um
   **snapshot desejado mutável**, atualizado no momento em que a edição entra na fila; é dele
   que sai o payload. Como consequência, a fila e o snapshot vivem no contêiner da seção, um
   por tabela — **não** um `useMutation` por campo, que quebraria o compartilhamento da fila.

   **Inicialização do snapshot é parte da trava, não detalhe.** `upsertAliquotas` grava as
   quatro chaves de uma vez: se a fila aceitar uma edição antes de o snapshot estar carregado,
   ou o inicializar com defaults, um save de `nacional` apaga `ufEmpresa`/`internaPct` que o
   operador nunca tocou — a mesma classe de falha silenciosa que o ADR-0112 existe para
   impedir. O snapshot é semeado **uma vez**, com o resultado bem-sucedido de `useAliquotas()`
   (idem `useEmpresaFiscal()`), e a seção não aceita edição antes disso: enquanto carrega, as
   linhas ficam em skeleton (§10), não em input vazio.

   Como só há uma chamada em voo por tabela, respostas fora de ordem deixam de ser possíveis
   por construção. O que os testes provam é a garantia real: a segunda chamada **começa**
   depois de a primeira terminar, e leva o valor mais recente.

### 7. Seção Fiscal

- O alerta "Alíquotas não confirmadas" fica **fixo no topo da seção**, com a mesma
  intensidade visual de hoje (borda/fundo `warning`, botão Confirmar). A trava é do
  **ADR-0086** ("Configuração org-scoped — imposto LOUD"), que refina o ADR-0055 no ponto do
  default silencioso: a publicação falha enquanto as alíquotas não forem confirmadas. O
  ADR-0055 define a regra tributária em si (8%/16% por origem), não o bloqueio. O comentário
  inline atual em `Configuracoes.tsx` cita 0055 para a trava — corrigir a citação junto.
  Rebaixar o alerta a um selo discreto é regressão, não polimento.
- A seção Fiscal recebe também um marcador na sub-nav enquanto não confirmadas (dado do
  `useAliquotas` do layout pai, §4).
- Os 4 subgrupos (Identidade, Endereço, Operação fiscal, Emissão) continuam visíveis em
  sequência, cada um com contador de preenchimento (ex.: "Endereço · 6 de 8"). Denominador =
  só os obrigatórios listados no ADR-0135, conferidos campo a campo contra o ADR;
  `cfop_fora_uf_contribuinte` é opcional e fica fora. O contador é informativo — não bloqueia
  nada, não muda validação.
- `CampoEmpresa` mantém buffer local + patch individual no blur (ADR-0135), e a trava de
  meia-configuração da alíquota interna (ADR-0112) segue intacta.

### 8. Seção Notificações

`ConfigTelegram` **não** é autosave-on-blur: tem botão explícito "Salvar configurações",
habilitado só quando há alteração, e `config-telegram.test.tsx` trava esse comportamento. O
botão fica, junto com "Enviar teste" e "Verificar agora". A conversão é só de moldura visual.
Uniformizar para autosave quebraria um teste que existe por motivo: token de bot não deve ser
gravado a cada blur.

### 9. Remoções

- **`Estratégia de preço`** sai. UI morta: `RadioGroup` com `defaultValue="condicional"`, sem
  `value`, sem `onValueChange`, sem hook, sem mutation (`Configuracoes.tsx:311`;
  `useConfiguracoes.ts` não tem hook de estratégia). O enum real é
  `familias.estrategia_preco: 'proprio' | 'competitivo' | 'manual'`, **por família**, decidido
  pelo motor (`queries.ts:512`) — não é config de organização, e "condicional" nem existe no
  enum. Não contraria o ADR-0008: aquele ADR descreve a política que o motor aplica sozinho, e
  a política não muda. Verificado de forma independente pelo Codex nas duas rodadas.
- Permanecem por decisão explícita do Diego: `Modelo de imagem` e o card `Canais conectados`.

### 10. Estados

Cada seção cobre: carregando (skeleton nas linhas, não spinner de página), salvando, salvo,
erro de salvamento por linha, e o vazio do Fiscal (nenhum campo preenchido → chamada para
ação, não uma grade de inputs em branco).

### 11. Verificação

- `pnpm lint` + `pnpm test` verdes; `npx tsc -b --force` antes do push (o build local
  incremental passa com `tsbuildinfo` velho enquanto o `tsc -b` do CI reprova).
- Testes **novos** (não existe teste da página `Configuracoes` hoje; `config-telegram.test.tsx`
  deve continuar passando **sem alteração**). Todos asseguram a **URL final**, não só o texto
  renderizado:
  1. `/configuracoes?ml_claim=X` → URL final `/canais?ml_claim=X`, com a query preservada, e
     `confirmarConexaoML` recebe o claim.
  2. `/configuracoes` sem slug → primeira seção visível.
  3. Não-admin em `/configuracoes/membros` → é redirecionado, na sub-nav e por deep-link.
     `Fiscal` e `IA` **não** redirecionam: aparecem em leitura, com os valores vigentes.
  4. Sessão de suporte não-admin **vê** Fiscal e IA, e **não vê `Membros`** — nem na sub-nav,
     nem por deep-link em `/configuracoes/membros`.
  5. Sessão de suporte com escopo `read` não consegue editar nada — Telegram, alíquotas e
     Empresa inclusos — **mesmo que o perfil do super-admin traga `is_admin = true`**.
  6. Operador não-admin vê os valores das seções em leitura e **não consegue digitar** em
     nenhum controle — o gate da UI bate com a policy RLS, sem save que falha em silêncio.
  7. Salvar um campo de Empresa acende `✓ Salvo` só naquela linha.
  8. Dois blurs em campos diferentes produzem dois estados de linha independentes, e um erro
     num deles não apaga o sucesso do outro nem deixa a outra linha presa em "salvando".
  9. Dois blurs no **mesmo** campo: vence o mais recente; o `finally` do primeiro não
     sobrescreve o resultado do segundo.
  10. Single-flight, um caso por tabela (`configuracoes` e `empresa_fiscal`): o segundo save
      só **inicia** depois de o primeiro terminar, e seu payload carrega o valor mais recente
      — tirado do snapshot da fila, não do cache do react-query. Vale também quando o primeiro
      **falha**: a fila não é descartada. E as duas filas são independentes: um save de cada
      tabela pode estar em voo ao mesmo tempo.
  11. Salvar **um** campo de alíquota preserva os outros três: com `ufEmpresa`/`internaPct`
      já configurados, alterar `nacional` não os apaga. O snapshot foi semeado do
      `useAliquotas()` carregado, não de defaults.
  12. Sessão de suporte `full` na seção Fiscal: alíquotas editáveis, cadastro da empresa em
      leitura — as duas policies são distintas.
  13. `/usuarios` como admin redireciona para `/configuracoes/membros`; como não-admin, cai no
      `MenuGuard` e vai para o primeiro menu permitido — igual a hoje.
  14. `Usuarios.test.tsx` continua passando sem alteração.
- Validação de runtime com Playwright em sessão isolada, com screenshot real em 1440px e
  360px (snapshot de acessibilidade não pega bug de layout CSS).

## Key decisions & tradeoffs

| Decisão | Alternativas descartadas | Por quê |
|---|---|---|
| Sub-nav lateral com rota por seção | Abas horizontais; coluna única agrupada | Deep-link e escala; abas não passam de ~6 itens e somem no estreito |
| Fiscal como seção dentro de Configurações | Rota `/fiscal` no menu; aba em `/faturamento` | Não mexe no menu nem no guard de OAuth; não exige ADR novo |
| Rótulo/controle em duas colunas | Card por opção (hoje); lista empilhada | A coluna de controles vira eixo de varredura; o texto longo desta tela não empurra mais o input |
| Sub-nav vira `Select` no mobile | Abas roláveis; página única com âncoras | Sempre cabe em 360px; Fiscal sozinho tornaria a página única um scroll enorme |
| **Usuários** vira seção; **Canais** fica no menu | Mover os dois; mover só Canais; não mover nada | Encurta o menu pelo item que é config de verdade; Canais é operação (OAuth, reconexão) e cresce com o E5/Shopee (ADR-0077) |
| Capacidade declarada por seção | Um `podeVer`/`podeEditar` global | Um predicado global que libera "seção restrita" ao suporte vaza `Membros`, que o suporte nunca viu (`MENU_KEYS` não contém `usuarios`) |
| `podeEditarConfig` replica a policy RLS | `canWrite()`; só `isAdmin` | `canWrite()` é mais permissivo que o RLS de `configuracoes` e reproduz o save que falha em silêncio para não-admin |
| Não-admin vê em leitura; só `Membros` esconde | Esconder toda seção não editável | O `SELECT` das duas tabelas é liberado na org, e nenhuma seção é editável por membro comum (`configuracoes`: admin ou suporte `full`; `empresa_fiscal` e `Membros`: só admin) — esconder o não editável deixaria `/configuracoes` vazio e tiraria do operador o desconto e a alíquota vigentes |
| `Membros` admin-only, sem exceção de suporte | Visível ao suporte em leitura | Preserva o gate atual e o ADR-0068; diagnóstico pelo suporte é feature, não efeito colateral |
| Mapa por campo via `mutateAsync` + `finally` | `mutation.variables`; callbacks de `mutate()`; N mutations | `variables` envia todas as chaves nas alíquotas; callbacks de `mutate()` podem não disparar em chamadas consecutivas e travam a linha em "salvando" |
| Telegram mantém botão Salvar explícito | Uniformizar para autosave-on-blur | Comportamento travado por teste; token de bot não deve gravar a cada blur |
| Primitivos em `components/configuracoes/` | Direto em `components/ui/` | API pública com um consumidor só é prematura; promove no segundo uso |
| Gate fiscal do ADR-0135 preservado | Aplicar o gate na seção | Mudança de regra de negócio dentro de refactor de layout |

**ADR:** nenhum. Layout e arquitetura de informação, reversível por commit. A movimentação de
`Usuários` não cria nem remove permissão — a chave de menu e o gate de admin continuam iguais.

## Risks / open questions

- O guard de OAuth é o ponto de maior risco, em dois pontos: rodar antes do redirecionamento
  de seção **e** preservar a query. Teste §11.1 cobre os dois.
- Pergunta aberta, **fora do escopo deste plano**: a seção Fiscal deveria respeitar o gate do
  ADR-0135 (`tipo_pessoa = 'pj'` + módulo `fiscal`)? Hoje o cadastro aparece para qualquer
  org, inclusive PF, que não emite nota. Se sim, é trabalho separado.
- O contador "N de M" depende da lista de obrigatórios do ADR-0135; conferir campo a campo
  contra o ADR, não por inferência do formulário.
- **Questão de backend levantada na revisão, fora do escopo:** o helper RLS `is_admin()`
  (`profiles_e_helpers.sql:20-25`) lê `profiles.is_admin`, e um super-admin de plataforma
  carrega essa flag. Numa sessão de suporte, o banco portanto trata o super-admin como admin
  da organização visitada — a UI deste plano fecha isso pelo conjunto `canWrite()`, mas o RLS
  continua permitindo. Distinguir "admin da plataforma" de "admin do tenant" nas policies é
  trabalho de backend com ADR próprio, não de um refactor de layout.
- **Defeito pré-existente encontrado durante a revisão** (`support_access.sql:285-298`):
  escrever em `configuracoes` exige `is_admin() OR current_support_scope() = 'full'`, mas
  Geral, Preços e Notificações não têm gate na UI — o membro comum digita, o RLS recusa, e a
  tela não mostra erro. Este plano fecha o buraco na UI. Fica a pergunta para o Diego,
  **fora do escopo**: a policy deveria ser afrouxada para
  membro comum editar preferências não-sensíveis (desconto de marketing, mostrar lucro)? Se
  sim, é mudança de regra de negócio, com ADR e migration próprios.

## Out of scope

- Implementar de verdade a escolha de estratégia de preço.
- Aplicar o gate fiscal do ADR-0135 na UI.
- Mover `Canais` para dentro de Configurações; mexer em `/faturamento`.
- Mudar quem pode editar a configuração do Telegram.
- Qualquer mudança de regra de negócio: alíquotas, markup, descontos, fluxo fiscal.
- Trocar tokens, tipografia ou paleta do design system.
