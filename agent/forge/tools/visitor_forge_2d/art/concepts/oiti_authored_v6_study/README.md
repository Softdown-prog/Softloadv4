# Oiti V6 — estudo com camadas autoradas

Origem: quatro imagens geradas com a ferramenta de imagem integrada, usando a imagem
fornecida pelo usuário como referência de acabamento para folhas, galhos e
profundidade. SOUTH foi solicitado como uma árvore original Oiti-like inteira,
isolada em RGBA transparente, no estilo de jogo Tycoon 2D. WEST, NORTH e EAST
foram solicitadas separadamente com SOUTH como referência de identidade, giro
de 90°/180°/270° do objeto e iluminação na tela. Os resultados foram reduzidos
para fontes de 512×640, divididos em `wood` e `foliage` por cor e exportados
pelo Forge com downsample alpha-safe para 256×320.

A direção é uma interpretação artística; não comprova geometria, oclusão ou
luz fisicamente consistente nas quatro rotações. O candidato tem `artApproved`
e `runtimePromotion` falsos. Não copiar para `assets/` antes de aprovação
visual em gameplay e verificação no MapForge.

- `four_views_1x.png`: vista conjunta na resolução do jogo.
- `v5_v6_comparison_1x.png`: comparação direta com o Oiti procedural V5.
- `map_context_south.png`: escala e âncora no grid de referência 128×64.

Recriação: executar a receita `examples/park_tree_oiti_authored_v6_study.json`
com `organic_scenery.export`. Cada camada tem hash de entrada na receita. Alterar
um PNG exige deliberadamente atualizar o hash antes de um novo export.
