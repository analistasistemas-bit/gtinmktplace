# Galeria da cor — regras do roteiro e da geração (rascunho v2)

- **Status:** rascunho v2, após revisão de Codex e Grok (08/11); decisões de negócio em ADR-0201 (citadas como
  §n); termos em `CONTEXT.md` ("Imagens do anúncio por IA")
- **Data:** 2026-11-08
- **Fontes combinadas:** [A1] especificação do agente 1 (ChatGPT); [A2] manual do agente 2 (ChatGPT);
  [OP] prática real do agente que hoje aplica as galerias em produção; [REV] revisão Codex/Grok.
  A1 e A2 declararam que suas regras são propostas, sem histórico executado; só [OP] tem prática medida.

## 0. Entrada

R0.1 A entrada é um **anúncio publicado** do PubliAI (§4): dados da família (planilha, `titulo_ml`,
`descricao_ml`, `atributos_ml`, marca, medidas por variação) + o item lido ao vivo no ML (fotos, variações,
categoria e limite de fotos da categoria). Sem URL livre e sem anúncio de terceiro.

R0.2 [OP] Anúncio de catálogo fica fora. Uma família por execução. Cor sem foto real não chama o provedor e não
gera cobrança [REV].

## 1. Ficha Verdade (o que as imagens podem afirmar)

R1.1 [A1][A2] Antes do roteiro, o sistema monta a Ficha Verdade: cada campo com valor, fonte, estado e evidência.

R1.2 [REV] **Só o cadastro afirma.** Um valor só é `CONFIRMADO` se o código encontrar o trecho literal nos dados
da família (campo e trecho guardados como evidência). Foto e etiqueta nunca são fonte de afirmação.

R1.3 Conferência com a etiqueta (visão), por campo, em um de quatro resultados [REV]:
- `consistente` — a etiqueta legível mostra o mesmo valor → segue.
- `divergente` — a etiqueta legível mostra outro valor → **trava a galeria** (§3): a tela mostra o recorte da
  etiqueta e o valor lido como sugestão. "Manter cadastro" destrava. "Corrigir cadastro" grava **só na família**,
  sem tocar no anúncio do ML; levar a correção ao anúncio é o fluxo normal de atualização, por um admin.
- `inconclusiva` / `indisponivel` — etiqueta ilegível ou ausente → o fato pode ser usado (é do cadastro), mas o
  roteiro mostra "não conferido na etiqueta" e o operador marca ciência antes de gerar.
- Fato que só existe na etiqueta → não vira texto; a tela oferece incluí-lo no cadastro (revisão humana).

R1.4 `AUSENTE` nunca é preenchido com valor típico da categoria [A1]. `INFERIDO` não vira texto nem cena que
sugira capacidade (resistência, aplicação, rendimento) [REV].

R1.5 [REV] Galeria compartilhada por vários tamanhos da mesma cor usa só fatos válidos para **todas** as variações
atendidas.

R1.6 Lição real: os três agentes de origem afirmaram poliéster na Renda Búfalo; a etiqueta fotografada diz
"100% Poliamida". A conferência precisa de recorte visível ao operador.

## 2. Análise estratégica (dentro do roteiro, sem cobrança)

R2.1 [A2] Persona, contexto de uso, até 7 dúvidas e 5 objeções; cada objeção aponta a imagem que a responde e o
fato `CONFIRMADO` que a sustenta. Objeção sem fato não vira imagem 3.

R2.2 [A2] Proposta única de valor em uma frase, só com fato `CONFIRMADO`.

R2.3 [A1] Direção de arte por categoria (paleta, luz, cenário); categorias diferentes nunca recebem a mesma.

## 3. Contrato de Identidade (em todo prompt)

R3.1 [A1][A2] Protege forma, proporções, cor da variante, embalagem, rótulo, logotipo, textura/trama, quantidade,
componentes e escala; repetido integralmente em cada prompt [A2].

R3.2 [A2] Só vistas sustentadas pelas fotos de referência; nada de traseira, lateral ou interior inventados.

R3.3 [REV] Ampliações e macros (imagem 7, detalhes da 3) **derivam de recorte da foto real**; o modelo não
fabrica trama ou acabamento em close.

R3.4 [A1][OP] Contrato específico por produto (ex.: renda: sem flores ou arabescos; não vira cetim ou gorgurão).

## 4. Proibidos

R4.1 [A1][A2] Lista por prompt = globais + categoria + não confirmados + variações não vendidas + itens que não
acompanham + alterações de identidade + regras do canal. Lista fechada e versionada em código [REV].

R4.2 Globais [A2]: preço, desconto, frete, urgência/estoque, autoridade, prova social, garantias,
selos/certificados/QR inventados, logotipo de terceiro, kit ou acessório não incluído.

R4.3 [A1][A2] "Premium" só como direção de arte, nunca como texto na imagem.

R4.4 Por categoria [A1][A2]: cosméticos, vestuário, tecidos/aviamentos/fitas, eletrônicos (listas dos agentes).

## 5. As sete missões

R5.1 [A1][A2] 1 Capa · 2 Contexto de uso · 3 Quebra de objeção · 4 Benefícios · 5 Especificações · 6 Como usar ·
7 Detalhes. O operador escolhe quais gerar (§1); a ordem das fotos segue a numeração.

R5.2 Capa [A1][A2][OP]: produto isolado, fundo branco #FFFFFF, proporção real, sombra discreta, **nenhum texto
de marketing acrescentado**; a impressão da embalagem real é preservada (em uso real nunca causou pausa).

R5.3 [REV] **Só tetos, nunca pisos:** até 3 benefícios (≤6 palavras), até 6 especificações, 3–4 etapas. Missão
sem fato elegível não é oferecida. "Como usar" só usa passos já escritos nos dados da família; sem eles, vira guia
de escolha ou conteúdo da embalagem com fatos confirmados, ou não é oferecida [A1][A2].

R5.4 [A1][A2] Bloco técnico ao fim de cada prompt (photorealistic, studio lighting… no watermark).

## 6. Texto na imagem

R6.1 Limites [A2]: headline ≤5 palavras; subheadline ≤10; benefício ≤6; etapa ≤7; legenda ≤5; contados em código.

R6.2 [A1][A2] Normalização NFC; acento e cedilha preservados.

R6.3 **EM ABERTO (pergunta ao Diego):** quem escreve o texto de marketing — o modelo ou o sistema (ver §10).

## 7. Cores

R7.1 [A1][A2][OP] Uma galeria por cor; referência = foto real daquela cor; nome comercial oficial ("Rosa Bebê").
Nunca presumir uma cor pela foto de outra.

R7.2 [A1] Capa sem o nome da cor como texto; nas internas, só quando relevante.

R7.3 [A1][A2][OP] Multicolor: preservar a distribuição real; referência adicional que mostre todas as cores; sem
ela, não gerar. Não apresentar variantes como kit.

## 8. Validação, tentativas e cobrança

R8.1 Defeitos [A2 graus + A1 lista]:
- Crítico: produto, cor, marca, modelo ou quantidade errados; acessório inventado; texto de marketing na capa.
- Alto: logotipo/rótulo distorcido, fato errado, medida ou material falsos, trama inventada.
- Médio: texto ilegível, composição confusa, produto pequeno.
- Leve: sombra, espaçamento, alinhamento (aprovável com ressalva).
Erro factual ou de identidade nunca é aprovado com ressalva [A2].

R8.2 [REV] **Teto total:** a geração inicial + até 2 novas gerações por missão e cor, qualquer que seja o defeito.
Nenhuma nova geração automática escondida: cada uma é um clique com o preço na tela. Depois do teto, só
alternativas sem custo de imagem (recorte da foto real, ajuste de composição).

R8.3 [REV] Cobrança (§6): uma linha faturável por **chave única de geração**; repetir o pedido (timeout, recarga
da página) nunca cobra de novo. "Exibida" = arquivo válido gravado e entregue à tela pela primeira vez. Sem
arquivo, imagem em branco ou falha do provedor: não exibe, não cobra. Roteiro, leitura da etiqueta, verificação
por visão, recorte e texto composto não entram em `image_unit_cents`. Orçamento confirmado antes de gerar.

R8.4 [A1][A2] Rastreabilidade por imagem: versão do roteiro e da Ficha Verdade, referência, prompt, tentativa,
defeitos, decisão e quem aprovou. Mudança em fato, referência ou roteiro marca as imagens ainda não aplicadas como
desatualizadas [REV].

R8.5 **EM ABERTO (pergunta ao Diego):** verificação automática por visão antes de exibir (ver §10).

## 9. Arquivo final e aplicação no ML

R9.1 [OP] O gerador não respeita dimensão: pedir 3:4 e recortar ao centro para 1200×1540 (nunca esticar); capa
com preenchimento branco quando o corte comeria o produto. **Corte acima de 15% bloqueia** e oferece
preenchimento [REV]. JPG 300 KB–1 MB. Critérios do arquivo final verificados depois do recorte e do texto.

R9.2 [OP] Upload `POST /pictures` multipart (campo `file`); a foto só é usada com `variations` e URL real na
resposta.

R9.3 Aplicar (só admin, §8) [REV][OP]:
1. GET do item imediatamente antes; se as fotos mudaram desde a preparação, para e mostra a diferença.
2. Limite da categoria conferido sobre a união das fotos desse GET; sem capa aprovada, a 1ª foto atual fica.
3. Item com variações: PUT com todas as variações (o ML apaga as omitidas) e `pictures` = união dos
   `picture_ids`; mexe **só em fotos**: nunca reenvia preço, estoque ou status (confirmar em teste real se a
   variação aceita só `id` + `picture_ids`; o agente [OP] envia `available_quantity`).
4. User Products: um PUT por item; a tela lista os MLB afetados na confirmação; falha no meio desfaz os itens já
   trocados; resultado registrado por item.
5. GET de conferência: cada variação com os `picture_ids` esperados, na ordem, e as demais cores intactas; URL real
   e `active` não bastam.
6. Reverter usa as fotos guardadas e também detecta mudança posterior antes de sobrescrever.

## 10. Pontos em aberto (perguntas ao Diego)

1. **Texto de marketing:** Codex e Grok recomendam que o modelo gere a cena **sem** texto de marketing e o sistema
   componha headline, benefícios, especificações e legendas já contados e confirmados; a impressão da embalagem
   fica na foto. Hoje [OP] deixa o modelo escrever e corrige depois.
2. **Verificação por visão antes de exibir:** Codex — triagem que esconde a reprovada (não cobra) e pede revisão
   humana nas incertas; Grok — só marca problemas de identidade, sem esconder nem gerar de novo, e tudo que é
   exibido cobra.
3. Medição Nano Banana × modelos Higgsfield com estas regras.
4. Limites de fotos por categoria lidos com token válido do app.

## 11. Testes obrigatórios antes de liberar [REV]

Renda Búfalo (divergência poliéster × poliamida); anúncio de catálogo; cor sem foto; PUT de User Products que falha
na metade; não admin tentando aplicar; pedido repetido (cobrança única); fotos alteradas entre preparar e aplicar;
reversão após mudança posterior.
