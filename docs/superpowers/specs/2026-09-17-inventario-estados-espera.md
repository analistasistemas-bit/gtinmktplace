# Inventário — janelas com espera de processamento (levantamento, 2026-09-17)

Base para o design de padronização dos efeitos `.track-indeterminate` + `.glow-effect-sombra`.
Levantamento por varredura dos 26 arquivos com `DialogContent`/`AlertDialogContent`/`SheetContent` em `src/`.

## Os dois efeitos

| Efeito | Definição | Semântica |
|---|---|---|
| `.track-indeterminate` | `src/index.css:217` | barra 6px, gradiente `--primary` deslizando, 1.15s loop |
| `.glow-effect-sombra` | `src/components/ui/glow-effect.css:65` | `box-shadow` ciclando `--chart-1/2/3`, 3s loop |

Guards já existentes nos dois: `prefers-reduced-motion` e `forced-colors`.
`glow-effect.css` só entra no bundle via o componente `GlowEffect` — arquivo que usa a classe precisa de `import '@/components/ui/glow-effect.css'` (ver `dialog-criar-kit.tsx:24`).

## Referências canônicas (já corretas hoje)

| Arquivo | Efeito |
|---|---|
| `src/components/estoque/dialog-adicionar-variacao.tsx:278-281` | glow + `aria-busy` |
| `src/components/kit/dialog-criar-kit.tsx:253-256` | glow + `aria-busy` |
| `src/pages/Revisao.tsx:791` | track |
| `src/pages/Viabilidade.tsx:150` | track (fora de modal) |
| `src/components/lote-card.tsx:132` | track (em AlertDialog) |

## GRUPO A — modal fica montado durante a espera (aplicável direto)

| # | Arquivo:linha | Título | Estado pendente | Espera |
|---|---|---|---|---|
| A1 | `estoque/dialog-cadastro-produto.tsx:405` | Cadastrar produto | `ocupado` (l.395) | alta — edge + N uploads |
| A2 | `kit-virtual/DialogCriarKitVirtual.tsx:292` | Criar Kit Virtual | `criarMutation.isPending` | alta — upload + publica ML |
| A3 | `estoque/dialog-entrada.tsx:186` | Dar entrada de mercadoria | `mutation.isPending` | média — propaga estoque aos canais |
| A4 | `estoque/dialog-ajuste.tsx:93` | Ajustar estoque | `mutation.isPending` | média — RPC + sync ML |
| A5 | `estoque/dialog-fiscal-produto.tsx:163` | Dados fiscais | `salvando` (união, usar `!!`) | curta |
| A6 | `estoque/dialog-excluir-produto.tsx:47` | Excluir produto | `mutation.isPending` | curta — DESTRUTIVA |
| A7 | `export/botao-exportar.tsx:125` | Opções de exportação | `gerando` | variável — PDF/Excel |
| A8 | `platform-admin/org-billing.tsx:260` | Confirmar fechamento | `close.isPending` | curta — financeira |
| A9 | `platform-admin/revenue-reconciliation.tsx:72` | Conciliar devolução | `reconcile.isPending` | curta — financeira |
| A10 | `platform-admin/support-request-dialog.tsx:44` | Solicitar acesso | `saving` | curta |
| A11 | `pulse/dialog-adicionar.tsx:38` | Adicionar produto ao radar | `mutation.isPending` | média — consulta ML |
| A12 | `pulse/dialog-reprecificar.tsx:102` | Reprecificar | `confirmar.isPending` | média — N updates |
| A13 | `pages/Revisao.tsx:611` | Preço de atacado no lote | `setAtacadoLote.isPending` | média |
| A14 | `pages/Organizacoes.tsx:708` | Nova empresa | `enviando` | curta |
| A15 | `pages/Usuarios.tsx:249` | Convidar usuário | `enviando` | curta |
| A16 | `pages/Usuarios.tsx:322` | Notificações Telegram | `salvando` (só o Salvar) | curta |
| A17 | `pages/Usuarios.tsx:404` | Editar menus | `salvando` | curta |
| A18 | `pages/SupportRequests.tsx:166` | Aprovar/Rejeitar/Revogar | `saving` | ALTA — RPC + 3 queries de reload |

## GRUPO B — modal DESMONTA antes da operação terminar (exige mudar comportamento)

`AlertDialog` não controlado: `AlertDialogAction` do Radix fecha ao clicar. O estado de pendência é por linha da tabela, não do diálogo. Aplicar o efeito no diálogo seria código morto.

| # | Arquivo:linha | Título | Estado (por linha) |
|---|---|---|---|
| B1 | `pages/Publicados.tsx:400` | Migrar para preço por variação? | `migrando` |
| B2 | `pages/Publicados.tsx:449` | Pausar anúncio? | `pausando` |
| B3 | `pages/Publicados.tsx:496` | Corrigir e republicar? | `republicando` |
| B4 | `pages/Publicados.tsx:527` | Remover do sistema? | `removendo` |
| B5 | `pages/Publicados.tsx:661` | Remover publicação incompleta? | `removendo` |
| B6 | `pages/Publicados.tsx:753` | Refazer kit? | `refazendoKit` |
| B7 | `pages/DetalheFinanceiro.tsx:680` | Registrar/Desfazer saque | fecha no clique (l.585-591) |

## GRUPO C — sem estado de pendência nenhum hoje (exige criar o tracking antes)

| # | Arquivo:linha | O quê |
|---|---|---|
| C1 | `components/familia-expanded.tsx:671/716/755` | 3 AlertDialogs de remover foto — `async` sem `isPending`, sem desabilitar botão |

## GRUPO D — botões de espera FORA de modal (escopo a decidir)

| # | Arquivo:linha | Botão | Estado | Indicador hoje |
|---|---|---|---|---|
| D1 | `pages/Revisao.tsx:373` | Reenviar N com erro | `reprocessarLote.isPending` | ícone `animate-spin` |
| D2 | `pages/Publicados.tsx:1178` | Atualizar | `fetchingStatus \|\| fetchingMetricas` | só texto |
| D3 | `pages/DetalheFinanceiro.tsx:522` | Atualizar | `isFetching` | ícone `animate-spin` |
| D4 | `pages/DetalheFinanceiro.tsx:585/589` | Registrar/Desfazer saque | `mutation*.isPending` | só `disabled` |
| D5 | `pages/Organizacoes.tsx:322/455` | Entrar na operação | nenhum | nenhum |
| D6 | `pages/Organizacoes.tsx:458` | Cancelar solicitação | `cancellingRequestId` | só texto |
| D7 | `components/familia-expanded.tsx:824` | Regenerar descrição (IA) | `regenerar.isPending` | — |
| D8 | `components/kit/dialog-criar-kit.tsx:345` | Reenviar | `reenviarMutation` | ícone `animate-spin` |
| D9 | `components/variacao-card.tsx:73` | Troca de foto | `trocaStatus` | `StatusInline` |

## FORA DE ESCOPO (sem espera real)

- `app-shell.tsx:36` — menu mobile (navegação)
- `install-prompt-banner.tsx:127` — dialog instrucional iOS (estático)
- `variacao-card.tsx:274` — foto ampliada (visualização)
- `pulse/dialog-detalhe.tsx:389` — carregamento de abertura, já usa `Skeleton`
- `dialog-cadastro-produto.tsx:769` — AlertDialog de confirmação síncrona
- `familia-expanded.tsx:867` — AlertDialog de confirmação de preço (branch local)

## Restrição do contrato de motion

`docs/motion/contrato-motion-v5.md`:
- §9: "Nunca um padrão universal de carregamento." Ações <1s → spinner no botão, não barra.
- §9 regra 6: proibido progresso falso (percentual simulado, etapa por `setTimeout`).
- §10: ações destrutivas "nunca lúdicas — sem bounce, overshoot, comemoração". Afeta A6, B4, B5.
