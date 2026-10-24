# Autor de arte determinístico do Forge 2D

O comando `author-art` cria uma **receita nova** a partir de uma intenção curta,
renderiza o PNG no Forge existente e produz um relatório com as decisões.
Ele usa presets versionados e regras explícitas. Não executa um modelo de IA,
não aprende sozinho com imagens e não aprova a estética. Outro agente pode
operá-lo sem ter que adivinhar caminhos de arquivo ou parâmetros da câmera.

```bash
PYTHONPATH=tools/visitor_forge_2d/src python -m visitor_forge_2d author-art \
  --id park_tree_early_autumn_study \
  --prompt 'árvore folhosa de outono, copa arredondada e densa' \
  --output out/visitor_forge_2d/author
```

Para reproduzir uma especificação sem ambiguidades, use um brief JSON:

```bash
PYTHONPATH=tools/visitor_forge_2d/src python -m visitor_forge_2d author-art \
  --brief tools/visitor_forge_2d/examples/briefs/park_tree_early_autumn.json \
  --output out/visitor_forge_2d/author
```

O `CH_2D_ART_BRIEF_V1` aceita `id` seguro e `subject`. Campos específicos:

| Família | Receita de referência | Controles do autor |
| --- | --- | --- |
| `broadleaf` | outonal, oiti e angico sob `examples/` | `species`: `oiti`/`angico`; `leaf_detail`: `painted`/`defined`; `style`: `rounded`/`umbrella`/`open_branching`; paleta, estação, silhueta, densidade e `seed` |
| `conifer` | `pine_small_v1.json` e variantes | `silhouette`: `rounded`/`wide`/`tall`; `density`; `seed` |
| `flower_bed` | `flower_bed_01.json` | `seed` |
| `sign` | `park_wayfinding_sign.json` | `seed` |
| `custom` | `template`: nome de outro JSON sob `examples/` | `seed`; `recipeUpdates` para parâmetros existentes |

O prompt curto reconhece o tema (árvore folhosa, oiti, angico, pinheiro,
canteiro, placa), copa aberta/fechada, quatro cores nomeadas, outono,
copa arredondada/larga/alta e densidade rala/densa em português ou
inglês. Ele **não interpreta todas as palavras livres**. Use os campos JSON
para decisões precisas. `custom` permite que outro agente versiona uma nova
golden recipe e entregue edições explícitas como:

```json
{
  "contract": "CH_2D_ART_BRIEF_V1",
  "id": "my_tree_study",
  "subject": "custom",
  "template": "park_tree_broadleaf_early_autumn_v1.json",
  "recipeUpdates": {"broadleafStructure": {"masses": 52}}
}
```

`recipeUpdates` rejeita novos campos e protege
`contract`, `id`, `camera`, `rotation`, `canvas`, `anchor` e `finishRecipe`.
Caso a ferramenta não tenha uma primitive para a forma pedida, o agente deve
criar essa primitive e sua receita no módulo correto antes de usá-la.
Água/tiles conectados e construções com fonte Blender continuam em seus
pipelines canônicos; o router não inventa uma receita inadequada.

O resultado fica em `out/.../<id>/`: `authored_recipe.json`, PNG, prancha 1x/2x,
prancha da câmera (quando aplicável), `worker_report.json` e
`art_author_report.json`. Este último registra template, seed, interpretação
e uma crítica **mecânica** (por exemplo, falha de continuidade entre linhas
da copa). `review_ready` significa que o PNG está pronto para um artista
inspecionar no mapa em 1x; `artApproved` e `runtimePromotion` continuam falsos.

## Estudo da árvore outonal

`park_tree_broadleaf_early_autumn_v1.json` usa `broadleafStructure.layout =
"continuous"`. O renderer distribui grupos sobre uma copa única e pinta cada
grupo com luz local, sombra inferior e variação de oliva, amarelo e âmbar.
Isso evita que as quatro faixas da receita `organic_02` sejam fundidas em
prateleiras planas. As receitas antigas continuam usando seu desenho anterior.
A candidata deve ser comparada em 1x e na grade antes de qualquer promoção.

## Oiti e angico como espécies de árvores

O brief com `species: "oiti"` escolhe a receita de oiti; `species: "angico"`
escolhe a de angico. Um `style` incompatível é rejeitado. O nome da espécie
também é reconhecido no prompt curto. Cada receita mantém câmera, anchor,
tronco, copa e seed para árvores individuais em parques ou florestas.

`examples/park_tree_oiti_species_v4.json` preserva uma copa globosa, densa e
sempre verde com folhas simples, elípticas, verdes escuras e brotos mais claros.
`examples/park_tree_angico_species_v4.json` usa galhos grossos e irregulares,
copa mais ampla e pequenos folíolos em pares para sugerir folhas bipinadas no
tamanho do jogo. São escolhas estilizadas apoiadas nas descrições da
[Embrapa para o oiti](https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1140567/1/Especies-Arboreas-Brasileiras-vol-5-Oiti-da-Praia.pdf)
e [angico-branco](https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1140196/1/Especies-Arboreas-Brasileiras-vol-1-Angico-Branco.pdf).
Paletas em `examples/palettes/organic_canopy_v3.json`; `seed` muda as folhas e
parte da silhueta para evitar cópias idênticas na floresta.

```bash
PYTHONPATH=tools/visitor_forge_2d/src python -m visitor_forge_2d author-art \
  --brief tools/visitor_forge_2d/examples/briefs/park_tree_oiti_study_v4.json \
  --output out/visitor_forge_2d/author
```

Use `park_tree_angico_study_v4.json` para a outra espécie. São estudos para
inspeção em 1x, sem promoção automática a `assets/`.

### Folhas com forma definida (v5 opt-in)

`leaf_detail: "defined"` seleciona `park_tree_oiti_leaves_v5.json` ou
`park_tree_angico_leaves_v5.json` conforme a espécie. O oiti desenha pequenas
folhas afiladas em grupos. O angico adiciona pares de folíolos aos volumes da
copa. A base sombreada continua presente para não abrir buracos na escala de
gameplay. `leaf_detail: "painted"` mantém a v4 como padrão. A v5 é candidata
visual, reproduzível por:

```bash
PYTHONPATH=tools/visitor_forge_2d/src python -m visitor_forge_2d author-art \
  --brief tools/visitor_forge_2d/examples/briefs/park_tree_oiti_leaves_study_v5.json \
  --output out/visitor_forge_2d/author
```

Há um brief equivalente para `park_tree_angico_leaves_study_v5.json`.

## Histórico dos perfis anteriores

`examples/park_tree_oiti_groups_v3.json` usa `painted_canopy` com perfil
`domed`: uma silhueta irregular contínua recebe folhas pequenas e sobrepostas.
`examples/park_tree_angico_branches_v3.json` usa `branching`: volumes folhosos
acompanham os galhos em alturas diferentes, com espaços entre os ramos. A cor vem de
`examples/palettes/organic_canopy_v2.json`; o brief pode escolher outra das
quatro paletas sem alterar a geometria nem a câmera. O layout anterior
`crown_groups` permanece disponível para reproduzir as receitas v2. As receitas
v3 também permanecem disponíveis com `painted_canopy`. Para reprodução exata
do v3, use o JSON de receita v3 diretamente no renderer.
O brief `species` usa sempre a versão mais recente da receita correspondente.
