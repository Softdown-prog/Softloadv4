# Mangueira para o jogo

Quatro vistas RGBA autoradas para City Horizon, com copa larga e irregular,
folhas lanceoladas pendentes, poucos frutos verdes e tronco curto ramificado.
A vista SOUTH foi criada com a ferramenta de imagem integrada usando a Oiti V6
como referência apenas de acabamento. WEST, NORTH e EAST foram criadas com
SOUTH como referência de identidade, solicitando a rotação da árvore sob a
câmera 45°/30° fixa. Cada vista foi normalizada para fontes 512×640 e separada
em `wood` e `foliage` em `art/sources/mango_tree_v1/`.

A receita `examples/park_tree_mango_01.json` verifica hashes, monta as camadas,
acrescenta sombra de contato e exporta as quatro vistas 256×320. A arte fonte
é a parte não procedural; a remontagem e a pequena variação de paleta são
determinísticas. As quatro vistas são interpretações 2D coerentes da árvore;
não provam um giro físico exato.

- `four_views_1x.png`: quadro na resolução real de gameplay.
- `map_context_south.png`: âncora `[128,311]` sobre a grade 128×64.

Reproduzir com `PYTHONPATH=tools/visitor_forge_2d/src python -m visitor_forge_2d.core.organic_scenery --recipe tools/visitor_forge_2d/examples/park_tree_mango_01.json --output out/visitor_forge_2d/mango_rebuild`.
Os PNGs de `assets/tree/park_tree_mango_01_*.png` devem coincidir byte a byte
com essa exportação antes de qualquer retoque.
