# Galeria da cor — lupa pela caixa do produto (adendo ao plano v23) — v2

**Data:** 11/11/2026 · **Origem:** revisão da Task 12 (Fable 5.2, achado 1) e evidência do Step 5: `recortesDetalhe` recorta a faixa central da referência às cegas; nas cenas reais as lupas mostraram parede e mesa. Desde o fix `bb6e16c4`, a aprovação das missões 3 e 7 (e Moda 5 e 7) está bloqueada por `MISSOES_LUPA_PENDENTE` (`_shared/galeria/regras.ts:63`), front e edge (`lupa_pendente`). Decisão do Diego (recomendado): o recorte sai da **caixa do produto detectada por visão**.

**v2 (revisão do Fable 5.2, REPROVADO na v1):** recusa no `galeria-gerar` antes de cobrar (B1); edge confere o hash das caixas usadas na composição (B2); leitura só da vista `frente`, em paralelo, com prazo global (B3); `falhou` relê, `sem_detalhe` é definitivo (I4); todo quadrado contido na caixa `produto` (I5); Moda 5 ≠ Moda 7, com mínimo próprio (I6); portão de aceite com o Diego antes de liberar (I7); gravação condicional e EXIF (M8).

**Regras que não mudam:** R3.3 — ampliações e macros derivam de recorte da **foto real** (a referência), nunca do gerador. A visão só LOCALIZA; o recorte é feito pelo código sobre os bytes da referência. Custo da visão é da Daludi (sem linha em `platform_image_deliveries`). A leitura não entra em `fatos_hash` (não desatualiza roteiro aprovado).

## Desenho

1. **Leitura por referência `frente`, persistida.** Só a vista `frente` de cada cor (a única que as lupas usam). Uma chamada de visão por referência (mesmo cliente/modelo de `_shared/galeria/etiqueta.ts`; OpenRouter, `maxRetries: 0`, timeout 30 s por chamada), todas as cores **em paralelo**, com **prazo global de 40 s** no `montar` (o que não terminar no prazo fica `falhou` e relê no próximo `montar`). Pede, em coordenadas normalizadas 0–1: `produto` (o produto inteiro) e **até 2** caixas `detalhe` distintas (trama/acabamento/costura/alça), cada uma dentro de `produto`.
   - Estados em `galeria_referencias.detalhes jsonb`: `null` (nunca lido), `{estado:'falhou'}` (erro, timeout, prazo global — **relê**), `{estado:'sem_detalhe'}` (resposta válida mas sem caixas utilizáveis, caixa fora de [0,1], detalhe fora do produto, ou JPEG com EXIF Orientation ≠ 1 — **definitivo** para aquele sha), `{estado:'ok', produto, detalhes:[…], hash}` (`hash` = sha256 do JSON canônico das caixas).
   - Gravação condicional: `update … where id = $1 and (detalhes is null or detalhes->>'estado' = 'falhou')` — dois `montar` concorrentes resultam numa única gravação `ok`/`sem_detalhe`.
   - Disparo: no `montar` do `galeria-fatos`, depois de preparar as referências, só para `frente` com `detalhes` nulo ou `falhou`; falha nunca derruba o `montar`. O `montar` devolve `lupa_ok` por cor.
2. **Geometria (puro, `src/lib/galeria/layouts.ts`).** `recortesLupa(refW, refH, detalhes, missao, moda)` devolve quadrados em px da referência, **todos contidos na caixa `produto`**:
   - lupa = quadrado centrado no centro da caixa `detalhe`, lado = max(w, h) da caixa `detalhe`, deslocado para caber em `produto`; se o lado for maior que o menor lado de `produto` → não cabe;
   - missão 3: 1 lupa (detalhe 1); missão 7: 2 lupas (detalhe 1 e detalhe 2, sem sobreposição — se só houver 1 detalhe ou se sobrepuserem → não cabe);
   - Moda 5: detalhe 1; Moda 7: detalhe 2 (nunca a mesma caixa) — com lado mínimo **600 px** (vira imagem inteira 1200×1200); geral: lado mínimo **300 px**;
   - qualquer "não cabe" → `lupa_ok = false` para aquela missão e cor (nunca recorte de fundo).
   - `lupa_ok` por (cor, missão) = `detalhes.estado = 'ok'` **e** `recortesLupa` cabe.
3. **Garantias no servidor.**
   - `galeria-gerar` recusa (409 `lupa_indisponivel`, sem pedido, sem custo) missão com lupa que use gerador (geral 3) para cor com `lupa_ok = false` — usando o mesmo `recortesLupa` (módulo puro importado na edge, como `corte.ts`). Missões só de recorte (geral 7, Moda 5/7) não passam pelo gerador; a tela já as mostra indisponíveis com motivo.
   - `galeria-aprovar` exige, para missão com lupa, `lupa_hash` no corpo igual a `detalhes.hash` da referência vigente da cor (ausente ou divergente → 409 `lupa_desatualizada`), e `lupa_ok` verdadeiro (senão 409 `lupa_indisponivel`). Bundle antigo (sem `lupa_hash`) não aprova.
4. **Composição.** `listar` devolve `detalhes` (com `hash`) e `lupa_ok` por (cor, missão); `comporImagemFinal` recebe as caixas, usa `recortesLupa` e envia `lupa_hash` ao aprovar; sem caixas válidas lança (nunca recorta às cegas).
5. **Portão de liberação (I7).** `MISSOES_LUPA_PENDENTE` **continua** até o Diego aprovar uma amostra real: script descartável lê (só GET, sem escrita) **10 referências reais** da AVIL de produtos variados (incluindo pequenos e Moda), roda a leitura e gera uma página local com cada referência, as caixas desenhadas e as lupas compostas. Critério proposto: o Diego aprova se ≥ 9 de 10 lupas mostram o produto (as `sem_detalhe` contam como acerto: missão fica indisponível, não erra). Aprovado → esvaziar a constante (commit próprio). Reprovado → constante fica e a feature sai sem lupas. Medição dentro da Task 16, junto da validação real.

## Arquivos

- Migration nova (`supabase migration new galeria_referencia_detalhes`): coluna `detalhes jsonb` em `galeria_referencias`; validada só com `python3 scripts/teste-sql-desfeito.py`.
- `supabase/functions/_shared/galeria/detalhes.ts` (novo): `lerDetalhesPorVisao`, `garantirDetalhes(admin, orgId, refsFrente, prazoMs)`.
- `supabase/functions/galeria-fatos/index.ts`, `galeria-gerar/index.ts`, `galeria-imagens/index.ts`, `galeria-aprovar/index.ts`.
- `src/lib/galeria/layouts.ts` (`recortesLupa` substitui `recortesDetalhe`), `src/lib/galeria/compor.ts`, `src/components/galeria/passo-gerar.tsx`, `cartao-imagem.tsx`, `passo-roteiro.tsx` (missão sem lupa desabilitada com motivo).

## Testes (falham antes, passam depois; sem rede)

1. Resposta válida → `ok` com `hash`; segundo `montar` não chama a visão.
2. Ilegível / caixa fora de [0,1] / detalhe fora de produto / EXIF ≠ 1 → `sem_detalhe`, não relê; timeout/erro/prazo global → `falhou`, relê no próximo `montar`.
3. 5 cores em paralelo com uma em timeout: `montar` responde em ≤ 40 s + folga; as outras gravam `ok`.
4. Só a vista `frente` é lida.
5. Dois `montar` concorrentes → uma única gravação final.
6. `fatos_hash` igual antes e depois da leitura.
7. `recortesLupa`: quadrado contido em `produto` com caixa alongada (alça 0,05×0,4) → não cabe; detalhe central → cabe e centrado; missão 7 com 1 detalhe → não cabe; dois detalhes sobrepostos → não cabe; Moda 5 ≠ Moda 7; mínimo 300 (geral) e 600 (Moda).
8. `galeria-gerar` geral 3 com cor `lupa_ok=false` → 409 `lupa_indisponivel`, zero linhas em `galeria_pedidos`/`galeria_imagens`, nenhuma chamada a provedor.
9. `galeria-aprovar`: sem `lupa_hash` → 409 `lupa_desatualizada`; hash divergente → 409; `detalhes` nulo → 409 `lupa_indisponivel`; hash certo + `lupa_ok` → aprova (com `MISSOES_LUPA_PENDENTE` esvaziada no teste).
10. Front: missão com `lupa_ok=false` desabilitada com motivo no roteiro e no cartão; `compor` sem caixas lança.
11. Nenhuma linha em `platform_image_deliveries` pela leitura.

## Execução

- Implementador **opus** (migration + edges que barram cobrança e aprovação). Revisão do diff: Grok 4.7 high. Portão do item 5 com o Diego na Task 16.
- Ordem: depois da Task 15 e antes da parte de código da Task 16.

## Ajustes v3 (Fable 5.2: APROVADO COM AJUSTES na v2) — prevalecem sobre o texto acima

1. **Gerar recusa missão travada.** `galeria-gerar` recusa (409 `lupa_pendente`, zero linhas, sem custo) toda missão em `lupaPendente(missao, moda)` enquanto a constante não for esvaziada, além do `lupa_indisponivel` por cor. Ramo "portão reprovado" = a constante fica e a missão continua recusada no gerar, na tela e no aprovar (nunca cobrada).
2. **Dimensões gravadas.** A leitura grava `ref_w` e `ref_h` (do mesmo download que confere o EXIF) em `detalhes` e os inclui no `hash`. Gerar, aprovar e `listar` nunca baixam a referência para calcular a lupa.
3. **Mínimo expande, não rejeita.** Lado = max(lado da caixa `detalhe`, mínimo) — mínimo 300 px (geral) e 600 px (Moda) — expandido em volta do centro do detalhe e deslocado para caber em `produto`; só "não cabe" se o mínimo for maior que o menor lado de `produto`. Portão (item 5): o Diego aprova se **≥ 7 de 10** referências tiverem lupa disponível **e nenhuma** lupa disponível mostrar fundo (parede, mesa, mão); `sem_detalhe` não conta como acerto.
4. **Módulo em `_shared`.** `recortesLupa` mora em `supabase/functions/_shared/galeria/lupa.ts` (puro); o front importa de lá (como `corte.ts` em `compor.ts`). Teste de paridade front × edge para as mesmas caixas e dimensões.
5. **`falhou` com intervalo.** `detalhes` grava `tentado_em`; `falhou` só relê depois de 5 min. Prazo global da leitura no `montar` continua 40 s.
6. **Versão da leitura.** `detalhes.versao` = modelo de visão (`MODELO_VISION`) + versão do prompt (constante). Versão diferente da atual relê `ok` e `sem_detalhe`; trocar a versão exige novo portão com o Diego (registrar no doc de procedimento da Task 16).
7. **Recortes sem lupa não reservam.** `galeria-gerar` filtra/recusa também `plano.recortes` (geral 7, Moda 5/7) com `lupa_ok = false` ou em `lupaPendente` — nenhuma linha.
8. **Corrida no `montar`.** A resposta devolve `lupa_ok` relido do banco depois da gravação condicional.
9. **Testes adicionais:** gerar com missão em `MISSOES_LUPA_PENDENTE` e `lupa_ok=true` → 409, zero linhas; gerar com `detalhes` nulo/`falhou` → recusa retentável (`lupa_lendo`), distinta de `sem_detalhe` (`lupa_indisponivel`); caixa de 120 px expande ao mínimo dentro de `produto`; recorte com `lupa_ok=false` não reserva linha; `montar` repetido com `falhou` recente não chama a visão; troca de `versao` relê; paridade front × edge; a constante é injetada por parâmetro (`lupaPendente(missao, moda, travas = MISSOES_LUPA_PENDENTE)`) para os testes do ramo liberado.
