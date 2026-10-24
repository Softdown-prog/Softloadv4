# Tree Visual Reference V1

Este documento transforma referencias visuais aprovadas em regras reutilizaveis do Visitor Forge 2D. O objetivo nao e copiar pixels; e extrair geometria, estrutura, ritmo visual, cor e iluminacao para receitas originais do projeto.

## O que extrair das referencias

Para cada arvore de referencia, o worker deve separar cinco camadas:

1. **Silhueta macro** — proporcao largura/altura, topo, base da copa e assimetria.
2. **Malha estrutural 2D** — tronco, bifurcacoes primarias, ramos secundarios e direcao de crescimento.
3. **Massas de folhagem** — grupos grandes, subgrupos medios e detalhe pequeno.
4. **Paleta e luz** — interior, meio tom, frente/topo iluminado e madeira.
5. **Espaco negativo** — quanto ceu deve aparecer entre galhos e massas.

## Familias canonicas atuais

### dense_round_broadleaf
Referencia para Oiti e arvores urbanas densas. Copa larga/arredondada, muitos clusters pequenos sobrepostos, interior frio escuro e highlights amarelo-esverdeados. O tronco e os ramos aparecem parcialmente, mas a folhagem domina.

### drooping_lanceolate_tropical
Referencia para mangueira e familias tropicais de folha longa. A copa e formada por rosetas pendentes, folhas lanceoladas, volumes arredondados e sombras profundas entre camadas.

### red_mapple_open_branching
Referencia para Red Mapple. Copa vertical arredondada, madeira claramente legivel, espacos negativos medios e muitos pequenos grupos de folhas escarlates. Highlights quentes no topo/frente e sombras vinho no interior.

Os parametros estruturados ficam em `examples/reference_profiles/tree_visual_profiles_v1.json`.

## Pinceis associados

- `leaf_cluster_broadleaf`: massa media irregular de broadleaf.
- `leaf_cluster_maple`: pequenas folhas lobadas para maple.
- `leaf_cluster_lanceolate`: folhas longas pontudas dentro de uma mascara de copa.
- `leaf_rosette_droop`: rosetas radiais pendentes para copas tropicais.
- `branch_tapered`: ramo Bezier afunilado.
- `bark_highlight_strokes`: veios claros acompanhando a curvatura da madeira.
- `interior_occlusion_patch`: sombra de contato entre massas.
- `edge_breakup_stamp`: quebra de contorno externo.
- `silhouette_gap_cutter`: recortes de espaco negativo.

## Regra de composicao

Nenhum renderer de arvore de producao deve depender de um unico blob de copa. A construcao minima e:

`estrutura de galhos -> macro massas -> subgrupos -> microfolhas -> oclusao -> highlights -> acabamento 1x`

A leitura final deve sobreviver ao gameplay 1x antes de qualquer promocao para runtime.

## Uso pelo Art Author

O Art Author pode escolher um `visualProfile` e combinar:

- perfil de silhueta;
- grammar de galhos;
- brush de folha;
- paleta;
- densidade;
- espaco negativo;
- camera/anchor/footprint do contrato CH.

A referencia visual e usada para orientar proporcoes e linguagem artistica, nunca para copiar diretamente a imagem de origem.
