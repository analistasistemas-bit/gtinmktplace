# Galeria IA — correções da validação real + redesenho de UX (plano)

**Data:** 11/11/2026 · **Entradas:** `docs/superpowers/specs/2026-11-11-galeria-ux-redesenho.md` (proposta de UX, skill `ui-ux-pro-max-fable5`) e `.superpowers/sdd/2026-11-08-galeria-da-cor/diagnostico-validacao-real.md` (causas-raiz, arquivo:linha). **Não muda regra de negócio** (fatos confirmados, cobrança, trava, saga). Revisão do plano: Fable 5.2. Diff por fase: Grok 4.7 high. Protótipo visual aprovado pelo Diego ANTES da Fase C.

## Decisão do Diego (11/11, após revisão do Fable 5.2)
**Manter como está:** `descricao_fornecedor`, `descricao_ml` e `titulo_ml` continuam fatos citáveis (R1/R5.3 inalterados; `hashFatos` inalterado). Consequência no plano: a ancoragem de spec/etapa/benefício aceita o valor quando ele aparece **literalmente (normalizado: sem acento, caixa, espaços)** dentro do texto do fato citado — nunca por igualdade com o texto inteiro. Na tela, descrições longas ficam **recolhidas** (só leitura até expandir), com confirmação própria.

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

## Ajustes v2 (Fable 5.2: APROVADO COM AJUSTES) — prevalecem sobre o texto acima

1. **A6 sai** (decisão do Diego acima). **A4 passa a ser:** spec/etapa/benefício ancorados por contenção normalizada no fato citado; spec só com valor curto (≤ capacidade da caixa).
2. **Largura também no servidor (B2 do Fable):** mover `linhasNecessarias`, `FATOR_LARGURA` e `layoutMissao` para `_shared/galeria/` (front importa de lá). A poda do `gerarRoteiroIA` descarta texto que não cabe e gera **rótulo curto de spec em código** (tabela por campo, ex.: MATERIAL → "Material"). Missão que ainda tiver erro depois da poda (palavras, termo proibido, sem âncora) nasce **desligada com motivo** — nunca ativa com erro. Invariante testado: para N retornos "sujos" do LLM, zero erro (servidor + largura) em toda missão ativa.
3. **`fatosUsados`** podado aos fatos realmente citados pelos textos que sobraram e **derivado em código** (o operador não edita).
4. **Medidas da embalagem** (`peso_gramas`, `altura_cm`, `largura_cm`, `comprimento_cm`) não podem virar spec (são da caixa, não do produto — R8.1). Ficam só em "Ver todos os dados".
5. **Salvamento:** automático **só em rascunho**; roteiro aprovado tem botão "Editar" explícito (cria a versão nova). Um salvar em voo por vez, comparação por snapshot (sem travar o formulário a cada digitação), respostas fora de ordem descartadas, envio pendente ao trocar de passo/sair. "Continuar" = aprovar: mantém a regra de admin; não-admin vê o roteiro só leitura com aviso.
6. **Página:** guarda própria (módulo `imagem_ia`, admin, MLB inexistente/de outra org → mensagem e volta); `listar`/`montar` devolvem título, miniatura e formato do anúncio para o cabeçalho (muda a edge — anotar); saída com rascunho pendente salva antes (HashRouter não tem `useBlocker`); voltar para Publicados preserva filtros e rolagem (estado na URL ou sessionStorage); migrar os testes de `DialogGaleria` (abertura sequencial, identidade, bloqueio por módulo) para a página — não apagar.
7. **Erros em seção recolhida** abrem a seção sozinhos. **Ciência:** correção mínima no front (não zerar `ciente` ao salvar); a ciência em lote lista os campos (R1.3).
8. **Ordem:** A e o protótipo em paralelo → B como **hook de estado** sem layout (C o consome) → C → D (independente, pode ir antes). **Deploy:** galeria-roteiro, galeria-fatos, galeria-gerar, galeria-imagens, galeria-aprovar, galeria-aplicar. O rascunho v1 da Fita Veludo é recriado na nova validação.
9. **Testes extras:** os da seção (c) da revisão (`.superpowers/sdd/2026-11-08-galeria-da-cor/plano-ux-fable.txt`).

## Execução e revisão
Ordem: A → B → (protótipo + aprovação do Diego) → C → D. Cada fase: TDD, `pnpm preflight`, revisão Grok 4.7 high do diff, rodada de correção. Depois: deploy das edges alteradas (galeria-roteiro, galeria-fatos e quem importar `_shared/galeria/regras.ts`/`roteiro.ts`), nova validação real com o Diego desde o passo 1.
