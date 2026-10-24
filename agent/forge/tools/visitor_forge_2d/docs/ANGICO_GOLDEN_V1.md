# Angico — Golden Reference V1

Objetivo: ensinar o Visitor Forge 2D a produzir e variar árvores altas de copa aberta no estilo do angico aprovado visualmente.

## Referência visual

- `assets/tree/park_tree_angico_final_v1.png`

Essa imagem é o alvo visual, não uma saída que o Forge já reproduz pixel a pixel.

## Receita canônica

- `tools/visitor_forge_2d/examples/park_tree_angico_golden_v1.json`
- brief de reprodução: `tools/visitor_forge_2d/examples/briefs/park_tree_angico_golden_01.json`

## Características que devem sobreviver às variações

- tronco alto e limpo, com contato de chão centralizado;
- bifurcação principal visível antes da copa;
- galhos principais abrindo em leque para esquerda e direita;
- copa larga, aérea e assimétrica, sem virar uma bola sólida;
- vários grupos pequenos e médios de folhas distribuídos ao longo dos galhos;
- espaços negativos entre massas de folhagem;
- grupos conectados visualmente por ramos, evitando prateleiras horizontais soltas;
- luz mais clara no topo/frente, interior verde escuro e profundo;
- leitura clara em gameplay 1x na câmera `CH_CAMERA_V1`;
- footprint lógico 1x1; a copa pode ultrapassar visualmente o tile sem alterar ocupação.

## Variações permitidas

A partir da golden recipe, novos briefs podem variar `seed`, largura da copa, densidade de clusters, paleta/estação e assimetria, preservando tronco alto, estrutura ramificada e anchor no chão.

## Regra de promoção

Uma variante só deve entrar no runtime depois de revisão em escala 1x e captura sobre a grade real. O PNG de referência atual permanece registrado como alvo visual enquanto o Forge não atingir reprodução equivalente.
