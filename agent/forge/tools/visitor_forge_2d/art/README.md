# Peças 2D autoradas

Esta pasta recebe PNGs de origem desenhados para o Visitor Forge. O compositor
procura cada peça aqui antes de usar a versão procedural em `--asset-root`.

Exemplo de caminho: `visitor_male_01/south/torso.png`. Copie a peça correspondente
da pasta gerada, pinte dentro do mesmo canvas e mantenha PNG RGBA com alpha.
O compositor recusa dimensões diferentes, imagem vazia ou ausência do diretório
`--art-root`; um arquivo não encontrado cai na peça procedural.

As peças desta pasta são fontes versionadas, não sprites classificados no jogo.
Revise `idle`, `walk A` e `walk B` no tamanho nativo sobre terreno antes de
promover qualquer biblioteca. Retoques na pasta temporária `out/` não são
fontes persistentes.

`concepts/visitor_male_01_south_master.png` é a fonte de 512 px para o estudo
articulável de `build-concept-rig`. As peças derivadas desse estudo vão para
`out/` e podem ser reconstruídas. Não confunda o master e seus previews com
camadas autoradas em `art/visitor_male_01/south/` ou com arte aprovada no jogo.
Os masters `east`, `north` e `west` fazem parte da mesma identidade; o comando
`review-concept-directions` gera os 12 frames e um manifesto de proveniência.
`concepts/frames_preview/` contém apenas cópias para revisão visual.
`concepts/map_review/` guarda comparações de escala sobre uma captura real do
MapForge; não fixa escala de personagem no runtime.

## Árvore Oiti com arte autorada (estudo V6)

`sources/oiti_layered_v6_study/` contém duas camadas RGBA por direção:
`wood` e `foliage`. A receita `examples/park_tree_oiti_authored_v6_study.json`
confere os SHA-256 de cada peça, recompõe as camadas e reduz 512×640 para
256×320 com alpha premultiplicado. A semente controla somente uma variação
discreta de cor na folhagem; os desenhos não são sintetizados por essa semente.
Isso permite reproduzir o mesmo PNG e retocar separadamente madeira e folhas.

As quatro vistas são arte 2D autorada a partir de uma mesma referência visual;
não são uma rotação geométrica demonstrável de um modelo 3D. O estudo precisa
de revisão de coerência entre vistas e de teste no MapForge antes de qualquer
classificação em `assets/`. `concepts/oiti_authored_v6_study/` inclui as
quatro vistas a 1×, contexto isométrico e comparação com a receita V5.

```bash
PYTHONPATH=tools/visitor_forge_2d/src python -m visitor_forge_2d.core.organic_scenery \
  --recipe tools/visitor_forge_2d/examples/park_tree_oiti_authored_v6_study.json \
  --output out/visitor_forge_2d/oiti_authored_v6
```
