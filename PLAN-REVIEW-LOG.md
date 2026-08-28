# Plan Review Log: Refatoração da tela Configurações

Ato 1 (grill-with-docs) completo — plano travado. Sem ADR novo, sem termo novo de glossário
(a decisão foi de arquitetura de informação, não de linguagem de domínio). MAX_ROUNDS=3.
Thread Codex: `01a04836-f4e7-7f41-b4b4-93e95eca4a68`.

## Round 1 — Codex

**VERDICT: REVISE.** 5 bloqueantes, 5 materiais.

Bloqueantes:
1. `App.tsx:57` casa só `/configuracoes`; `/configuracoes/fiscal` cairia no `NotFound`.
2. O plano misturava slugs filhos e de topo (`/fiscal`); um `/fiscal` de topo faz
   `menuKeyForPath` devolver `null` e liberar o menu.
3. Guard de OAuth frágil se virar redirecionamento de índice no App.
4. `menus.ts:14` devolve todos os menus em sessão de suporte; gate por `isAdmin` cegaria o
   suporte em Fiscal/IA.
5. Marcador de alíquotas na sub-nav não funciona se `useAliquotas` só montar na seção Fiscal.

Materiais:
1. `✓ Salvo` por linha é impossível com mutation compartilhada — `isSuccess` acende linhas erradas.
2. `ConfigTelegram` não é autosave; tem botão explícito travado por teste.
3. Não existe teste da página `Configuracoes` — o plano assumia que sim.
4. ADR-0135 tem gates além de `isAdmin` (`tipo_pessoa`, `modulos_habilitados`).
5. Feedback de autosave sem `aria-live` é inacessível.

Verificação independente pedida: o Codex confirmou que a `Estratégia de preço` não persiste
nada (`Configuracoes.tsx:311`, sem hook em `useConfiguracoes.ts`, enum em `familias`).

### Claude's response

Os 10 achados foram conferidos no código antes de aceitar. Todos procedem — nenhum rejeitado.

- (B1, B2) Rota vira `/configuracoes/*`; todos os slugs passam a ter prefixo explícito. §1.
- (B3) A ordem virou norma numerada em §1: guard de OAuth primeiro, redirecionamento de
  seção só depois. Teste dedicado em §9.1.
- (B4) Separei **visibilidade** de **edição**: visível para `isAdmin || sessão de suporte`,
  editável só para `isAdmin` (o `disabled={!isAdmin}` de hoje, preservado). Muda a resposta
  do Diego ("esconder do não-admin") apenas para o modo de suporte, que não é operador
  comum — registrado como decisão explícita.
- (B5) `useAliquotas` sobe para o layout pai; dedupe do react-query mantém uma requisição. §3.
- (M1) Estado da linha derivado de `mutation.variables` em vez de N mutations — menor diff. §4.
- (M2) `ConfigTelegram` mantém o botão Salvar explícito; a conversão é só de moldura. Nova §6.
- (M3) §9 reescrita: cinco testes novos, `config-telegram.test.tsx` intocado.
  **Errata (2026-08-28):** o achado M3 do Codex ("não existe teste da página Configuracoes")
  estava ERRADO, e eu o aceitei sem verificar. Existem dois em `tests/pages/`. Minha própria
  conferência repetiu o erro: o grep de triagem estava ancorado em `src/`, cego para a segunda
  árvore de testes do repo. Foi o único achado das 8 rodadas que não deveria ter sido aceito —
  e o único que exigia checar, não confiar.
- (M4) Gate fiscal do ADR-0135 **preservado como está** e movido para "pergunta aberta" +
  "out of scope". Aplicá-lo seria mudança de regra de negócio dentro de um refactor de
  layout — exatamente a classe de incidente que o CLAUDE.md proíbe.
- (M5) `EstadoSalvo` ganha `role="status" aria-live="polite"` e `aria-describedby` no erro. §4.

## Round 2 — Codex

**VERDICT: REVISE.** Confirmou 8 dos 10 achados da rodada 1 como endereçados. Novos:
guard de OAuth perdendo `searchParams` (mata `confirmarConexaoML`); Rules of Hooks impedem
"guard primeiro" no mesmo componente; `mutation.variables` não identifica a linha em
alíquotas; atribuição do bloqueio a ADR-0055 em vez de ADR-0086; card aninhado com
`ConfigTelegram`; primitivo prematuro em `components/ui/`; `CampoEmpresa` sem
`aria-describedby`/`aria-invalid`.

### Claude's response

Todos aceitos, nenhum contestado. Verifiquei a atribuição do ADR: 0086 é "Configuração
org-scoped — imposto LOUD" e refina o 0055 no ponto do default silencioso — o Codex está
certo e o comentário inline do código está impreciso. `OAuthRedirectGate` virou componente
separado; mapa de estado por campo; primitivos para `components/configuracoes/`.

## Round 3 — Codex

**VERDICT: REVISE.** Causa raiz única: o `podeVer` genérico que eu havia escrito tornava
seções restritas visíveis ao suporte — e isso vazava `Membros`, que o suporte nunca viu
(`visibleMenus(p, true)` devolve `MENU_KEYS`, que não contém `usuarios`). Também: callbacks
de `mutate()` em v5 podem travar a linha em "salvando"; import `Users` órfão; lazy import de
`Usuarios` órfão em `App.tsx`; `Usuarios.test.tsx` quebraria com prop obrigatória; ADR-0068
define gestão de notificações como ação de admin.

### Claude's response

Todos aceitos. Predicado global eliminado: capacidade declarada por seção numa matriz.
`Membros` virou admin-only para ver e editar. `mutateAsync` + `try/catch/finally`.
Cap de MAX_ROUNDS=3 atingido sem discordância — estendido para 4, por ser convergência
inacabada e não impasse (o número era meu, não do Diego).

## Round 4 — Codex

**VERDICT: REVISE.** Confirmou rotas, permissões de `Usuarios`, OAuth, lint e a11y como
resolvidos. Três achados novos, todos de dados e todos reais:

1. `canWrite()` é mais permissivo que o RLS de `configuracoes`.
2. `upsertAliquotas` grava o snapshot inteiro — resolução fora de ordem corrompe o dado no
   banco, não só o estado visual.
3. Dois blurs no mesmo campo: o `finally` do primeiro sobrescreve o resultado do segundo.

### Claude's response

Todos aceitos, e o (1) foi verificado direto na migration
(`20260725224000_support_access.sql:285-298`: INSERT e UPDATE exigem
`is_admin() OR current_support_scope() = 'full'`).

Achado com consequência maior que o plano: isso é um **defeito já em produção**. Geral,
Preços e Notificações não têm gate na UI, então o operador não-admin digita, o blur salva, o
RLS recusa, e a tela não tem ramo de erro — ele acha que salvou. `podeEditarConfig` passa a
replicar a policy. Efeito colateral: como a tela inteira é admin-only no banco, esconder toda
seção não editável deixaria `/configuracoes` vazio para o não-admin — então ele passa a ver
em **leitura**, com aviso único no topo. Isso ajusta a resposta original do Diego ("esconder
a seção"), que foi dada antes deste fato aparecer.

(2) vira single-flight nos saves de alíquota; (3) vira id de operação por campo.

## Rounds 5–8 — Codex

Quatro rodadas de afunilamento, todas **REVISE**, todos os achados aceitos sem contestação.
Os achados encolheram de arquitetura para redação — o padrão de convergência.

- **R5:** `empresa_fiscal` tem policy **diferente** de `configuracoes` (só `is_admin()`, sem
  escape de suporte — `adr135_cadastro_fiscal.sql:49-57`), então um predicado só não serve;
  a corrida de dados também existe em `empresa_fiscal`; o teste de "resolver fora de ordem"
  contradizia single-flight. → dois predicados; single-flight nas duas tabelas; teste
  reescrito.
- **R6:** contradição minha — eu escrevi "leitura não é gateada" e mantive Fiscal/IA
  visíveis só para admin. → só `Membros` tem gate de visibilidade; o resto aparece em
  leitura. Filas independentes por tabela; snapshot fora do cache do react-query, porque
  `invalidateQueries` não é síncrono.
- **R7:** três trechos ainda diziam "admin-only" onde a policy é `admin OR suporte full`;
  a inicialização do snapshot estava subespecificada (snapshot parcial apagaria
  `ufEmpresa`/`internaPct` não tocados — mesma classe do ADR-0112). → redação corrigida;
  snapshot semeado uma vez da query bem-sucedida, com skeleton antes disso.
- **R8:** o super-admin que abre sessão de suporte carrega `profiles.is_admin = true`
  (`profiles_e_helpers.sql:71-76`), então gates re-derivados de `isAdmin` reabririam
  `Membros` e a edição em escopo `read`. → visibilidade de `Membros` passa a ser lida de
  `visibleMenus(profile, !!context)`, a mesma fonte do `sidebar.tsx:41`, em vez de
  re-derivada; `canWrite()` entra como conjunto restritivo nos dois predicados de escrita.

### Encerramento do Ato 2 — e uma crítica ao próprio loop

Oito rodadas, sem `APPROVED`, com **100% dos achados aceitos e nenhum contestado**. Isso não
é sinal de convergência: o papel de árbitro final que a skill atribui ao Claude não foi
exercido em nenhuma rodada.

Em retrospecto, **o loop deveria ter parado por volta da rodada 4**, quando os achados
cruzaram de arquitetura (rotas, guard de OAuth, gate de permissão, corrida de dados) para
detalhe de implementação e redação. Duas evidências de que passou do ponto:

- A contradição da rodada 6 foi **introduzida por mim na rodada 5**, ao corrigir um achado da
  própria rodada 5. O loop passou a gerar o próprio trabalho.
- O `canWrite()` como conjunto (rodada 8) entra depois de o plano ter escrito "não use
  `canWrite()` aqui" na rodada 4. As duas afirmações convivem hoje e exigem um parágrafo de
  reconciliação — isso é cicatriz de loop, não decisão de design.
- A rodada 8 terminou numa questão de RLS sobre super-admin, que não tem relação com layout.

O valor real do Ato 2 concentra-se nas rodadas 1–4: o guard de OAuth perdendo a query, o gate
de permissão vazando `Membros`, a corrida de dados das alíquotas e — o achado mais valioso —
o RLS de `configuracoes` que reprova a escrita do membro comum sem que a UI mostre erro.

O último item aberto do Codex é a distinção "admin de plataforma × admin de tenant" nas
policies: questão de backend, com ADR próprio, que um refactor de layout não deve decidir.
Registrada em "Risks / open questions" e entregue ao Diego.
