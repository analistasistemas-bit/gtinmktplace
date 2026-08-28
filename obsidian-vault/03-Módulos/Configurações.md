---
tags: [modulo, configuracoes]
atualizado: 2026-08-28
---

# Configurações

Rota `/configuracoes/*` (`src/pages/Configuracoes.tsx`). Ver [[Banco de Dados]] (tabela
`configuracoes`), [[Integrações]].

## Estrutura da tela (desde 2026-08-28)

Era uma coluna única com 10 cards de peso visual igual, onde o bloco fiscal ocupava ~60% da
altura. Virou uma tela com **sub-navegação por seção, cada uma com rota própria**: `geral`,
`precos`, `fiscal`, `notificacoes`, `ia`, `membros`. Registro declarativo em
`src/components/configuracoes/secoes.tsx` — sub-nav, roteamento e gate leem do mesmo array.
Coluna sticky no desktop; abaixo de `lg` vira um `Select`. Cada opção é uma `SettingsRow`:
rótulo e descrição à esquerda, controle à direita, divisor entre linhas.

- **Guard de OAuth do ML**: a edge devolve o callback em `/configuracoes` (URL fixa), mas quem
  confirma a conexão é `/canais`. O guard vive no componente de página, **antes de qualquer
  hook da tela**, e preserva `searchParams` — sem a query, `Canais.tsx` não chama
  `confirmarConexaoML` e a conexão morre sem erro visível.
- **[[Usuários]] virou a seção "Membros e acessos"**; `/usuarios` redireciona. `Canais` fica no
  menu lateral (é operação, e cresce com o E5/Shopee, ADR-0077).
- **Estratégia de preço saiu**: era UI morta (`RadioGroup` sem `value`/`onValueChange`/hook). O
  enum real é `familias.estrategia_preco` (`proprio|competitivo|manual`), **por família**,
  decidido pelo motor — nunca foi configuração de organização, e "condicional" nem existe no
  enum. O ADR-0008 segue valendo: descreve a política que o motor aplica sozinho.

## Quem pode editar

A tela escreve em **duas tabelas com policies diferentes**, então há dois predicados
(`src/components/configuracoes/permissoes.ts`). **Leitura não é gateada** — o `SELECT` das duas
é liberado a qualquer membro da org, de propósito: quem precifica precisa ver a alíquota e o
desconto vigentes.

| Predicado | Tabela | Regra RLS replicada |
|---|---|---|
| `podeEditarConfig` | `configuracoes` | `is_admin() OR current_support_scope() = 'full'` |
| `podeEditarEmpresa` | `empresa_fiscal` | `is_admin()` apenas, sem escape de suporte |

Isso **corrigiu um defeito que estava em produção**: Geral, Preços e Notificações não tinham
gate nenhum na UI, mas a escrita em `configuracoes` sempre exigiu admin. O membro comum
digitava, o RLS recusava, e a tela não tinha ramo de erro — ele achava que tinha salvo.

Aberto, fora do escopo daquela entrega: `is_admin()` não distingue admin de plataforma de admin
de tenant, então numa sessão de suporte o banco trata o super-admin como admin da org visitada.

## Gravação

`upsertAliquotas` grava as quatro chaves de uma vez, e `useSalvarEmpresaFiscal` é uma mutation
compartilhada por ~20 campos. Daí `useFilaDeSalvamento`
(`src/components/configuracoes/settings-row.tsx`): **fila single-flight por tabela** (uma
requisição em voo por vez, a fila sobrevive a falha), estado `Salvando…/✓ Salvo/erro` **por
linha** com `aria-live` — não há botão Salvar, então sem isso o leitor de tela nunca sabe que
gravou. O payload sai de um **snapshot semeado uma vez do dado carregado**, não do cache do
react-query (`invalidateQueries` não é síncrono, e snapshot parcial apagaria
`uf_empresa`/`aliquota_interna_pct` que o operador não tocou).

Exceção: **Telegram mantém o botão "Salvar configurações" explícito** — token de bot não deve
ser gravado a cada blur, e `config-telegram.test.tsx` trava esse contrato.

**Escopo por ORGANIZAÇÃO desde o E7** (ADR-0027, migration `20260705174455_e7_config_org.sql`)
— era por usuário antes disso. Toda leitura/escrita filtra por `org_id` (`fetchX`/`upsertX` em
`src/lib/queries.ts`); `user_id` continua gravado no upsert como auditoria (quem editou por
último), não como chave de escopo. Uma organização = uma linha em `configuracoes`.

## O que configura

- **Empresa** (ADR-0135, módulo pago `fiscal`) — cadastro fiscal da organização
  (`empresa_fiscal`), visível para toda org PJ mas só obrigatório com o módulo ligado. Ver [[Fiscal]].
- **Conexão Mercado Livre** — **não** se configura mais aqui: mora em `/canais` (ADR-0077). A
  seção Geral só tem o atalho. Status via `useMlConnection` (lê `ml_credentials`); conectar/
  desconectar via `iniciarConexaoML`/`desconectarML` (`src/lib/ml-oauth.ts`). Ver [[Segurança]].
- **Desconto de marketing** — `desconto_pct` por org (`useDescontoPct`, `useSalvarDescontoPct`).
- **Telegram** — `ConfigTelegram` (componente): ativa/configura alertas
  (`useTelegramConfig`, `useSalvarTelegramConfig`, `useEnviarTesteTelegram`,
  `useVerificarModeradosAgora`). Token nunca retornado pela API — só `tem_token boolean`.
- **Alíquota de imposto por origem** — `aliquota_nacional_pct` (default 8%) e
  `aliquota_importado_pct` (default 16%), por org, sem override por família.
  Descontada do líquido e somada ao gross-up do preço sugerido em todas as telas (ADR-0055),
  **exceto** o "Líquido" em Financeiro › Detalhe do líquido, que nunca desconta imposto — bate
  1:1 com o Mercado Pago (ADR-0066). O Markup dessa tela continua líquido de imposto normalmente.
  A org precisa **confirmar** as alíquotas (`aliquotas_confirmadas_em`) — sem confirmação o
  imposto falha **LOUD** em vez de aplicar 8/16 em silêncio, e a tela mostra banner + botão
  "Confirmar alíquotas" (ADR-0086).
- **Venda dentro do estado (alíquota interna)** — `uf_empresa` + `aliquota_interna_pct`
  (ADR-0112, migration `20260812004735`), nullable e **sem default**; edição restrita a admin.
  Quando a UF de entrega do pedido (`ml_vendas.uf`) é igual à `uf_empresa`, essa alíquota
  **sobrepõe a origem** — vale para nacional e para importado. Nulos = parâmetro desligado =
  regra da ADR-0055 inalterada.
  - **Trava LOUD de meia-configuração:** salvar exige os dois campos preenchidos ou os dois
    vazios; UF sem percentual (ou o contrário) é recusado na UI e no `salvarAliquotas`.
  - **Escopo: só apuração pós-venda.** Preço sugerido, gross-up (`_shared/preco/sugerir.ts`),
    `etiquetaParaMinimo` e o "Você recebe por venda" continuam na alíquota por origem — o anúncio
    tem preço único para o país e a UF do comprador só existe depois do pedido.
  - Imposto e markup não são persistidos (são derivados na leitura), então ligar o parâmetro
    **recalcula todo o histórico exibido** sem backfill.
  - **Em produção (2026-08-11):** org **Avil** com `uf_empresa = PE` e `aliquota_interna_pct = 1`
    (72 pedidos entregues em PE no histórico); org DSA segue sem o parâmetro.
- **Desconto sobre concorrência** — `desconto_concorrencia_pct` (default 5%), por org
  (`useDescontoConcorrenciaPct`, `useSalvarDescontoConcorrenciaPct`). Aplicado em
  `sugerirPrecoVenda` quando há concorrente: `preço = menor_concorrente × (1 − pct/100)`
  (ADR-0059, antes fixo em 5% no ADR-0020).
- **Re-âncora no maior vendedor MercadoLíder** — `reancora_lider_ativa` (default false, por
  org, `useReancoraLiderAtiva`, `useSalvarReancoraLiderAtiva`). Quando ligado, se o preço
  competitivo der prejuízo real, `sugerirPrecoVenda` re-ancora no preço do concorrente
  MercadoLíder com mais vendas em vez do menor preço global (ADR-0065).
- **Mostrar lucro no Dashboard** — `mostrar_lucro_dashboard` (default false, por org,
  `useMostrarLucroDashboard`, `useSalvarMostrarLucroDashboard`). Liga a linha "lucro R$ X" no
  card "Líquido no faturamento" do Dashboard (oculta por padrão).

## Tabela `configuracoes`

`org_id` (FK `organizations`, `NOT NULL`, **único** — 1 linha por org), `user_id` (legado,
auditoria de quem editou), `desconto_pct`, `telegram_ativo`, `telegram_chat_id`,
`telegram_bot_token` (sensível), `aliquota_nacional_pct`, `aliquota_importado_pct`,
`aliquotas_confirmadas_em`, `uf_empresa`, `aliquota_interna_pct`, `desconto_concorrencia_pct`,
`reancora_lider_ativa`, `mostrar_lucro_dashboard`. Não há mais coluna de token do Mercado Pago —
a conta MP é lida com o token da conexão `mercado_livre` (ADR-0093).

`uf_empresa`/`aliquota_interna_pct` têm CHECK de coerência (os dois ou nenhum), formato de UF e
faixa 0–100. Por serem nullable, a migration do ADR-0112 **não desconfirma** nenhuma org.
