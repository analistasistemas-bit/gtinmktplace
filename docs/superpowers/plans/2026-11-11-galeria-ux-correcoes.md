# Galeria IA — correções da validação real + redesenho de UX (plano)

**Data:** 11/11/2026 · **Entradas:** `docs/superpowers/specs/2026-11-11-galeria-ux-redesenho.md` (proposta de UX, skill `ui-ux-pro-max-fable5`) e `.superpowers/sdd/2026-11-08-galeria-da-cor/diagnostico-validacao-real.md` (causas-raiz, arquivo:linha). **Não muda regra de negócio** (fatos confirmados, cobrança, trava, saga). Revisão do plano: Fable 5.2. Diff por fase: Grok 4.7 high. Protótipo visual aprovado pelo Diego ANTES da Fase C.

## Decisão tomada (recomendado, registrar no ADR-0201 adendo)
Descrições longas (`descricao_fornecedor`, `descricao_ml`) e `titulo_ml` deixam de ser fatos citáveis por texto de imagem: aparecem só em "Ver todos os dados" (leitura) e não podem ancorar spec, benefício nem etapa. Motivo: a descrição de marketing confirmada inteira valida benefícios inventados e polui a tela (diagnóstico, "outros defeitos").

## Fase A — Roteiro correto no servidor (opus: regra que barra cobrança/aprovação)
1. Mover para `_shared/galeria/regras.ts` a tabela **campos por missão** (quais de título/subtítulo/benefícios/etapas/legendas/specs cada missão mostra) e a **capacidade** (máx. legendas/specs por missão), hoje só em `compor.ts:41-43`/`layouts.ts`. O front importa de lá (`motivosDeTexto` passa a usar a mesma tabela). Teste de paridade.
2. `gerarRoteiroIA` (`roteiro.ts:273-304`): o prompt recebe, por missão, só os campos que ela usa + capacidade + regras (etapa = oração inteira candidata, spec = valor de fato curto); o schema deixa de exigir os 7 campos em toda missão; o código **poda** o retorno: remove campos fora do layout, corta listas na capacidade, descarta spec que não confere e etapa que não é candidata.
3. Missões impossíveis nascem **desligadas** com motivo: lupa travada (`lupaPendente`), "Como usar" sem oração candidata, missão sem fatos suficientes. Recorte (missão 7 e Moda 5/7) não exige cena.
4. Spec (missão 5): âncora só em fato curto; `specConfere` compara valor normalizado do fato (ex.: atributo MATERIAL), nunca descrição/título. Etapas: código calcula orações candidatas e oferece só elas.
5. `validarRoteiro`: missão desligada não gera erro (hoje só "missão repetida" roda nelas — manter só essa). Ciência de "sem etiqueta" persiste no salvar (hoje zera).
6. `fatos.ts`: descrições longas e `titulo_ml` marcadas como não citáveis (decisão acima).
Testes: roteiro gerado (LLM mockado com retorno "sujo" igual ao da Fita Veludo) sai podado e aprovável; missões 3/6/7 nascem desligadas com motivo; spec "100% poliéster" ancorada no MATERIAL confere; descrição não ancora; missão desligada não bloqueia aprovar; ciência sobrevive ao salvar.

## Fase B — Correções de estado do front (sonnet)
1. Salvar: trava o formulário enquanto salva; não sobrescreve rascunho alterado desde o envio; retorno visível ("Salvo" / erro com "Tentar de novo"); salvamento automático com debounce (substitui "Salvar alterações").
2. Remover spec por índice (`passo-roteiro.tsx:166,169`); specs escolhidas de lista de dados confirmados (não digitadas).
3. Trocar de passo não descarta rascunho.
4. Limites de palavras vêm de `regras.ts` (sem cópia no front).
Testes de cada item.

## Fase C — Redesenho de UX (frontend-design-fable5; sonnet implementa, design pela skill)
Conforme a proposta, seções 3.1–3.6: página própria `/#/publicados/:mlItemId/galeria` com indicador de 4 passos (Conferir dados → Escolher imagens → Gerar e aprovar → Aplicar no anúncio); botão "Galeria IA" com texto em Publicados; passo 1 com 3 blocos (divergências, "Confirme para usar nas imagens" com "Confirmar todos", já confirmados recolhido) e rótulos em português (nome legível do atributo, já disponível em `fatos.ts:77-84`); passo 2 com cartões de imagem (esboço do layout, liga/desliga, só os campos da imagem, "Ajustes avançados" recolhido para cena e regras de aparência); erros de uma linha ao lado do campo com `role="alert"`; passos 3 e 4 com grade grande, selos de estado, "Desfazer". Mantém `Select` Radix, tokens e componentes do app. Teste e2e por passo + prints reais (skill `playwright-cli`) a 1440 px e 390 px, e checklist de compliance da skill (contraste, foco, 44 px, sem emoji como ícone, sem scroll horizontal).
**Portão:** antes da Fase C, protótipo visual clicável (HTML estático com os tokens do app, dados da Fita Veludo) publicado como artifact para o Diego aprovar.

## Fase D — Outros defeitos de UI da validação (sonnet)
1. Largura dos diálogos: `Revisao.tsx` modal "Publicar no Mercado Livre" (sem largura → `sm:max-w-sm`), `payment-profile-dialog`, `dialog-reajuste`, `preview-status` (`max-w-*` sem `sm:`). Correção: `sm:max-w-*` adequado em cada um; print antes/depois.
2. Descrição do módulo `imagem_ia` (`src/lib/modulos.ts:62`) cita só o kit → incluir a galeria.
3. Relatório do lote mostrou "2 aguardando" com confirmação já `confirmado` — investigar e corrigir se for a tela.

## Execução e revisão
Ordem: A → B → (protótipo + aprovação do Diego) → C → D. Cada fase: TDD, `pnpm preflight`, revisão Grok 4.7 high do diff, rodada de correção. Depois: deploy das edges alteradas (galeria-roteiro, galeria-fatos e quem importar `_shared/galeria/regras.ts`/`roteiro.ts`), nova validação real com o Diego desde o passo 1.
