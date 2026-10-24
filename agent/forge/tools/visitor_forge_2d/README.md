# CH Visitor Forge 2D

Para autoria reproduzível de receitas por intenção curta (`author-art`), veja
[`docs/ART_AUTHOR.md`](docs/ART_AUTHOR.md). O estudo da árvore outonal usa
uma copa contínua e passa pelo mesmo renderizador, auditoria e pranchas do
Forge. A revisão de arte em tamanho de jogo ainda é necessária.

Ferramenta dedicada para gerar visitantes 2D estilizados para o City Horizon.

**Para continuar o visitante atual em outro chat:** leia primeiro
[`docs/OPERACAO_VISUAL.md`](docs/OPERACAO_VISUAL.md). Ela identifica as fontes
corretas, o catálogo de teste, os comandos de geração e o gate visual.

**Para desenhar pequenos objetos 2D sem rig de personagem:** use
[`docs/DESENHO_2D.md`](docs/DESENHO_2D.md) e o comando `draw-recipe`.
Para processar receitas com ajudantes de validação, render e auditoria e com
jobs paralelos no GitHub Actions, veja [`docs/WORKERS.md`](docs/WORKERS.md).
Há uma receita versionada de placa de parque em `examples/park_wayfinding_sign.json`.
`examples/park_furniture_palette.json` demonstra três cores reproduzíveis e
`draw-recipe --all-variants` produz o painel conjunto em escala de jogo.

## Objetivo

O Visitor Forge 2D existe para produzir personagens pequenos, legíveis e consistentes para o mapa isométrico do jogo sem depender de um render 3D realista como arte final.

O alvo visual é uma linguagem própria de city builder/tycoon: silhueta clara, cabeça mais legível, braços e pernas com espessura suficiente, mãos e pés simplificados, roupa com massas limpas e detalhes que sobrevivam ao tamanho real de gameplay.

A ferramenta deve priorizar **estilo, legibilidade, consistência e animação curta** em vez de anatomia realista.

## Decisão de pipeline

O MPFB/Blender pode continuar sendo usado como apoio para anatomia, pose, rig e referência, mas **não é a fonte visual final obrigatória** dos sprites do Visitor Forge 2D.

Pipeline atual:

```text
Procedural 2D Art Generator
  -> neutral RGBA body parts
  -> palette tint
  -> 2D joints / pose transforms
  -> layer composer
  -> simplified painted shading
  -> alpha-safe downscale
  -> anchor
  -> PNG RGBA + metadata
```

## Arquitetura

O núcleo foi separado do módulo de personagem para que a ferramenta possa crescer além de visitantes:

```text
tools/visitor_forge_2d/
  README.md
  pyproject.toml
  docs/
    ARCHITECTURE.md
  src/
    visitor_forge_2d/
      core/
      character/
        procedural_art.py
  definitions/
  poses/
  tests/
```

`core/` contém mecanismos genéricos: canvas, layers, joints, transforms, composição, paleta, downscale e export.

`character/` contém as regras específicas de personagem e o gerador visual atual.

A pasta de assets gerados não é tratada como fonte canônica: as peças V1 são determinísticas e podem ser reconstruídas pelo próprio Visitor Forge. Isso evita acumular PNGs duplicados no repositório enquanto o estilo ainda está em gate visual.

## Escopo V1

A V1 deve provar apenas um visitante masculino em SOUTH com três poses:

- `south_idle`
- `south_walk_a`
- `south_walk_b`

O rig 2D usa:

- pelvis / spine / neck / head;
- shoulder / elbow / wrist por braço;
- hip / knee / ankle por perna;
- cabeça, cabelo, tronco, braços, mãos, pernas e sapatos como partes independentes;
- sombra de contato separada e fixa no chão.

Regras:

- composição por camadas 2D;
- SOUTH em leitura leve de 3/4, não frontal chapada;
- caminhada curta e conservadora;
- pouco balanço de braço;
- sem bob vertical artificial;
- anchor dos pés idêntico entre frames;
- PNG RGBA full-color;
- render interno em 512x512 e saída inicial em 128x128;
- downscale Lanczos com alpha premultiplicado quando suportado pelo Pillow;
- transformações de peças articuladas em alpha premultiplicado, evitando que RGB oculto em pixels transparentes contamine as bordas;
- não promover ao runtime antes de aprovação visual.

## Gerador visual procedural V1

`character/procedural_art.py` gera as peças-base diretamente em 2D. Ele não usa malha 3D, fotografia ou textura de roupa realista.

Contrato visual atual:

`CH_VISITOR_FORGE_2D_TYCOON_V1`

O gerador trabalha com máscaras vetoriais/rasterizadas pelo Pillow e aplica iluminação 2D ampla, bordas suaves, pequenos detalhes de rosto/roupa e shading neutro. As peças são criadas em tons neutros e recebem a paleta depois, no compositor.

Isso permite trocar pele, cabelo, camisa, calça e sapatos sem redesenhar a silhueta ou a animação.

## Direção visual

Evitar:

- humano realista miniaturizado;
- textura fotográfica;
- roupa com microdetalhe que desaparece no gameplay;
- dedos individualizados;
- braços/pernas finos demais;
- aparência de boneco feito de cilindros;
- iluminação dramática ou excessivamente 3D;
- passos largos ou movimentos exagerados.

Preferir:

- formas contínuas e levemente caricatas;
- cabeça legível;
- membros com boa leitura;
- mãos/pés simplificados;
- rosto econômico;
- cores limpas e separadas;
- volume 2D amplo e discreto;
- pequena sombra de contato;
- identidade original do City Horizon, inspirada pela legibilidade dos tycoons clássicos sem copiar personagens específicos.

## CLI

Instalação local de desenvolvimento:

```bash
python -m pip install -e tools/visitor_forge_2d
```

Validar contratos/poses:

```bash
ch-visitor-forge-2d validate \
  --definition tools/visitor_forge_2d/definitions/visitor_male_01.south.json \
  --pose tools/visitor_forge_2d/poses/south_idle.json \
  --pose tools/visitor_forge_2d/poses/south_walk_a.json \
  --pose tools/visitor_forge_2d/poses/south_walk_b.json
```

Gerar somente as partes 2D:

```bash
ch-visitor-forge-2d build-assets \
  --asset-root out/visitor_forge_2d/assets
```

Gerar partes + três frames + strips de comparação em uma única chamada:

```bash
ch-visitor-forge-2d prototype \
  --definition tools/visitor_forge_2d/definitions/visitor_male_01.south.json \
  --pose tools/visitor_forge_2d/poses/south_idle.json \
  --pose tools/visitor_forge_2d/poses/south_walk_a.json \
  --pose tools/visitor_forge_2d/poses/south_walk_b.json \
  --asset-root out/visitor_forge_2d/assets \
  --output out/visitor_forge_2d/visitor_male_01
```

O comando `prototype` produz também:

- `visitor_male_01_south_review_strip.png`;
- `visitor_male_01_south_gameplay_strip.png`.
- `visitor_male_01_south_in_world_review.png` (128 px reais sobre fundo neutro ou terreno fornecido);
- `visitor_male_01_south_review_metrics.json` (bounds do corpo, pés, variação de silhueta e anchor).

Esses strips existem para comparar as três poses sem precisar integrar nada ao jogo.
Os nomes dos strips usam `characterId` e direção da definição. O comando rejeita
IDs de pose repetidos antes da exportação, evitando sobrescrever um frame.
O strip ampliado usa a mesma redução com alpha premultiplicado dos PNGs de gameplay.
Para revisar sobre terreno, acrescente `--background CAMINHO/PARA/TERRENO.png`.
O fundo é só visualização e nunca entra no PNG RGBA exportado.

### Comparação com conceito visual SOUTH

Há um estudo visual de `south_idle` em
`art/concepts/visitor_male_01_south_concept.png`, com RGBA 128x128 e pés na
linha do anchor 116. A pose em 3/4, a separação dos braços e os sapatos têm
melhor leitura que a V4 procedural na escala de jogo. Gere a comparação:

```bash
ch-visitor-forge-2d prototype \
  --definition tools/visitor_forge_2d/definitions/visitor_male_01.south.json \
  --pose tools/visitor_forge_2d/poses/south_idle.json \
  --pose tools/visitor_forge_2d/poses/south_walk_a.json \
  --pose tools/visitor_forge_2d/poses/south_walk_b.json \
  --asset-root out/visitor_forge_2d/assets \
  --concept tools/visitor_forge_2d/art/concepts/visitor_male_01_south_concept.png \
  --output out/visitor_forge_2d/review
```

O arquivo `visitor_male_01_south_concept_comparison.png` mostra à esquerda o
`south_idle` procedural e à direita o conceito, ambos no canvas real de 128 px.
Uma captura inicial sobre o fundo neutro está versionada em
`art/concepts/visitor_male_01_south_comparison.png`.
O resumo inclui caminho, SHA-256 e bounds do conceito. É possível acrescentar
`--background` para comparar sobre um terreno do jogo. O PNG do conceito é um
alvo artístico estático, não uma fonte de peças para `--art-root`, nem um frame
de caminhada. Para levá-lo à animação, redesenhar cabeça, cabelo, torso,
braços e pernas em camadas articuláveis, com rig próprio e revisão de `idle`,
`walk A` e `walk B` em 128 px antes da integração ao runtime.

### Estudo articulável do mesmo personagem

`art/concepts/visitor_male_01_south_master.png` é o master RGBA de 512 px do
conceito acima. O módulo `character/concept_rig.py` o separa de modo
determinístico em 15 partes coloridas e uma sombra independente. A partição
reconstrói exatamente o master antes de qualquer pose; a definição gerada
registra o SHA-256 do master, e os frames exportados registram os hashes das
partes. Nenhuma chamada a geração de imagem é feita para animar o personagem.

```bash
ch-visitor-forge-2d build-concept-rig \
  --master tools/visitor_forge_2d/art/concepts/visitor_male_01_south_master.png \
  --asset-root out/visitor_forge_2d/concept_parts \
  --definition-output out/visitor_forge_2d/concept_rig.json

ch-visitor-forge-2d prototype \
  --definition out/visitor_forge_2d/concept_rig.json \
  --pose tools/visitor_forge_2d/poses/concept/south_idle.json \
  --pose tools/visitor_forge_2d/poses/concept/south_walk_a.json \
  --pose tools/visitor_forge_2d/poses/concept/south_walk_b.json \
  --asset-root out/visitor_forge_2d/concept_parts \
  --concept tools/visitor_forge_2d/art/concepts/visitor_male_01_south_concept.png \
  --output out/visitor_forge_2d/concept_rig_review
```

É possível acrescentar `--background CAMINHO/PARA/TERRENO.png`. A captura
inicial dos três frames em terreno está em
`art/concepts/visitor_male_01_south_rig_preview.png`. Os três pés ficam na
linha 115 do canvas de 128 px; o anchor da definição é [64, 116]. O movimento
é curto e conserva rosto, cor e roupa. As peças geradas ficam em `out/`; edite
o master ou crie uma biblioteca autorada própria para refinamentos duráveis.

**Limite do estudo:** o recorte de uma imagem chapada não contém a anatomia
escondida atrás de roupas e membros. Ele pode criar frestas ao aumentar o
movimento. As vistas e passos curtos ainda pedem retoque artístico das juntas
e teste no mapa, junto a construções, antes de qualquer promoção ao runtime.

### Quatro direções do mesmo visitante

Os quatro masters RGBA de 512 px em `art/concepts/visitor_male_01_*_master.png`
definem SOUTH, EAST, NORTH e WEST do `visitor_male_01`. O SOUTH anterior foi
preservado; EAST e WEST são desenhos laterais próprios com a luz fixa, não
espelhos do SOUTH. Todas as vistas usam o mesmo canvas, anchor, personagem,
paleta visual e passos curtos. As vistas novas foram desenhadas a partir do
personagem canônico, mas são estudos de arte: sem uma fonte 3D não há como
recuperar automaticamente as superfícies ocultas com precisão garantida.

Um comando recompõe 16 camadas por direção (15 do corpo e sombra), gera
`idle`, `walk A`, `walk B` e entrega o painel de 12 frames, as métricas e os
hashes de origem:

```bash
ch-visitor-forge-2d review-concept-directions \
  --tool-root tools/visitor_forge_2d \
  --asset-root out/visitor_forge_2d/directional_assets \
  --output out/visitor_forge_2d/directional_review
```

`--background CAMINHO/PARA/TERRENO.png` acrescenta somente o terreno no
preview. O painel tem as linhas SOUTH, EAST, NORTH e WEST, e as colunas
`idle`, `walk A`, `walk B`. A captura inicial está em
`art/concepts/visitor_male_01_directional_walk_preview.png`; PNGs individuais
de revisão estão em `art/concepts/frames_preview/`. A execução atual mantém
o último pixel opaco do corpo na linha 115 em todos os 12 frames, com anchor
[64, 116]. Cada JSON de frame guarda direção e hash das partes; o manifesto
`visitor_male_01_directional_review.json` guarda hash do master por direção e
`artApproved: false`.

Os PNGs versionados são **prévia**, não catálogo de sprites do runtime. Antes
de classificar esse conjunto, verificar as vistas no mapa, retocar as juntas
visíveis durante a caminhada e confirmar que EAST/WEST têm leitura direcional
distinta perto dos elementos da cidade.

#### Revisão de orientação SOUTH pendente

O master SOUTH atual apresenta rosto e tronco em 3/4 voltados para a direita.
Como `south_walk_a` e `south_walk_b` reutilizam esse master, os dois frames
também parecem caminhar para sudeste. Ajustar apenas os ângulos das juntas não
muda essa orientação. Tentativas de gerar um novo master frontal alteraram o
rosto, as proporções e o acabamento; não substituíram os PNGs versionados.

Um estudo posterior está em `art/concepts/south_front_candidate_v1/`: traz
master frontal, `idle/walk A/walk B` e comparações no tamanho real e a 56 px.
Ele pode ser escolhido separadamente no teste F8 quando o build habilita
`CH_VISITOR_FORGE_PREVIEW=ON`. A aparência frontal foi aprovada; as novas
poses próprias alternam pé de apoio e balanço dos braços, preservando a linha
115 dos pés. O teste da caminhada em movimento no motor ainda está pendente:
o candidato não substitui o SOUTH atual até observar o contato e calibrar a
velocidade no jogo.

As outras três direções da mesma opção F8 agora usam o estudo
`art/concepts/directional_gait_candidate_v1/`. Ele exporta dois passos por
direção, deforma suavemente os masters originais só abaixo da cintura e mantém
o idle e o anchor existentes. O comando `render-directional-gait` e a receita
JSON estão documentados nessa pasta, junto ao painel das quatro direções em
escala de jogo. EAST/NORTH/WEST também aguardam teste caminhando no motor.

Um novo desenho SOUTH precisa manter o mesmo personagem, paleta, textura e
silhueta na escala de jogo; rosto e peito devem ler como frente, sem apontar
para EAST. Ao corrigir SOUTH, revisar juntos `idle`, `walk_a` e `walk_b` para
evitar um salto de orientação ao parar. Manter 128×128, o anchor [64, 116],
os pés no mesmo chão e o passo curto. EAST, NORTH e WEST não fazem parte dessa
correção. Conferir a aparência com corpo de 56 px e depois em movimento na
engine antes de substituir a prévia existente.

Na câmera isométrica padrão, o deslocamento lógico SOUTH (y+) projeta um
passo de tile para a esquerda e para baixo na tela: (-64, +32) em zoom 1.
Essa trajetória é propriedade do mapa; corrigir a orientação visual do
personagem não a transforma em uma linha vertical na tela.

### Escala no mapa real

Uma captura do MapForge com a loja de sorvete mostrou que o corpo de 97 px
ocupado pelo sprite dentro do PNG de 128x128 fica grande diante da porta.
`review-map-scale` sobrepõe o **mesmo frame e mesmo ponto dos pés** a duas cópias
da captura: tamanho de origem à esquerda e altura candidata à direita. O
comando não muda os PNGs fonte, o JSON dos frames nem o runtime.

```bash
ch-visitor-forge-2d review-map-scale \
  --frame tools/visitor_forge_2d/art/concepts/frames_preview/south_idle.png \
  --capture out/visitor_forge_2d/map_context/mapforge_ice_cream_inactive_vs_active.png \
  --crop 260 310 640 690 --foot 450 604 \
  --display-height 56 \
  --output out/visitor_forge_2d/map_context/south_scale_review.png
```

A captura usada veio do [workflow MapForge Ice Cream Comparison, run
35934307091](https://github.com/Softdown-prog/City-horizon-/actions/runs/35934307091),
artefato `MapForge-Ice-Cream-Inactive-vs-Active`, ID `10781869942`.
O arquivo PNG extraído tem SHA-256 no JSON de revisão. A comparação
versionada fica em `art/concepts/map_review/south_97_vs_56.png`; outro painel
mostra as quatro direções com corpo de 56 px sobre o mesmo ponto da loja.
Uma segunda comparação `art/concepts/map_review/ferris_97_vs_56.png` usa a
[captura da roda-gigante do MapForge, run 35932996026](https://github.com/Softdown-prog/City-horizon-/actions/runs/35932996026),
artefato `MapForge2-Deterministic-Asset-Capture` (ID `10782236410`). A escala
menor também fica mais plausível diante dessa atração; é uma checagem visual,
não um contrato de tamanho para toda construção.

**56 px é uma hipótese de exibição**, cerca de 0,577 vez a altura do corpo
original, para essa captura e esse enquadramento. Ela aproxima a figura da
altura visual da porta e ainda permite ler as quatro direções. Confirmar a
escala na engine com calçadas, perspectiva/oclusão e outros edifícios antes
de fixar o tamanho de exibição ou promover qualquer sprite.

### Prévia em movimento na engine

Para montar a versão de teste, configure o build com
`-DCH_VISITOR_FORGE_PREVIEW=ON` e compile o target `city_builder` normalmente.
O build copia a definição e os 12 PNGs de prévia para junto do executável,
onde `SDL_GetBasePath()` procura os recursos. A opção começa desligada; um
build normal não embala esses arquivos. Depois de editar um frame, execute
novamente o build de `city_builder` para atualizar a cópia mesmo sem mudança
no C++. Por exemplo:

```bash
cmake -S . -B build -DCH_VISITOR_FORGE_PREVIEW=ON
cmake --build build --target city_builder --config Release
```

O catálogo de prévia em `runtime_preview/visitor_male_01.json` referencia os
12 PNGs de `art/concepts/frames_preview/`, sem copiar ou classificar esses
sprites em `assets/`. A engine carrega esse catálogo adicionalmente às
animações aprovadas. O visitante só aparece ao selecioná-lo no teste de
pedestres com **F8** (quarto visual, após as três opções existentes). Use
**F7** em um mapa com seis tiles de rua em linha na direção +X para fazê-lo
caminhar na borda da calçada. Pressione F7 de novo para comparar velocidades
de 0,50, 0,65 e 0,80 tile/s; F8 volta ao visual inicial depois do candidato.
Para rever NORTH, SOUTH e WEST, marque início e fim em ruas com F3 e F4,
respectivamente, e inicie o percurso com F6; a direção vem da rota existente.
Na quinta opção F8, o SOUTH frontal e os novos passos EAST/NORTH/WEST ficam
reunidos no mesmo visitante de revisão; F8 define 0,30 tile/s para esse
visitante, enquanto F7 muda o valor conforme os presets de teste.

O frame é 128×128, a altura ocupada pelo corpo é 97 px, e a escala da
prévia é `56/97` em zoom 1. O pivô dos pés fica em `[64,116]` em todas as
poses; o ciclo alterna `walk A/B` a cada 220 ms. As outras opções F7/F8
conservam escala, pivô e cadência anteriores. Conferir na engine as quatro
direções, o contato com o chão durante o passo, oclusão junto a construções
e textura no zoom real. Essa ligação de depuração não aprova a arte nem muda
o personagem usado normalmente pelo jogo.

### Refinamento manual sem perda de trabalho

Cada biblioteca gerada registra os hashes em `generated_parts.json`. Uma nova execução
atualiza peças ainda iguais às geradas e **preserva PNGs desconhecidos ou editados**.
Assim, é possível começar com o desenho procedural e pintar uma peça específica sem
que o próximo `prototype` a substitua. `--overwrite-parts` força a reconstrução de
todas as peças; use somente quando quiser descartar esses refinamentos.
Em bibliotecas antigas sem manifesto, os PNGs existentes são preservados por segurança.
Essa proteção cobre novas execuções no mesmo diretório. Se a pasta estiver sob `out/`,
uma limpeza dessa pasta ainda apagará os retoques: arte aprovada precisará de uma
biblioteca de fontes versionada, fora dos artefatos temporários.

Para iniciar essa biblioteca, use `--art-root` em `prototype` ou `render`:

```bash
ch-visitor-forge-2d prototype \
  --definition tools/visitor_forge_2d/definitions/visitor_male_01.south.json \
  --pose tools/visitor_forge_2d/poses/south_idle.json \
  --pose tools/visitor_forge_2d/poses/south_walk_a.json \
  --pose tools/visitor_forge_2d/poses/south_walk_b.json \
  --asset-root out/visitor_forge_2d/assets \
  --art-root tools/visitor_forge_2d/art \
  --background CAMINHO/PARA/TERRENO.png \
  --output out/visitor_forge_2d/visitor_male_01
```

Uma peça pintada pode ser guardada, por exemplo, em
`art/visitor_male_01/south/torso.png`, com o mesmo caminho relativo da peça
gerada. A arte versionada tem prioridade sem alterar a cópia gerada em `out/`.
Ela precisa ser RGBA, ter as mesmas dimensões e alpha visível. O resumo do
comando registra `authoredLayers` para deixar claro quais camadas foram
substituídas. Cada JSON exportado registra `sourceParts` com origem, caminho
relativo e SHA-256 da peça efetivamente usada. Uma peça invalidada causa erro em vez de cair silenciosamente
na versão procedural. Não incluir um `art-root` na receita de produção até a
arte correspondente passar pela revisão visual em tamanho real.



## Pixel art nativa

O Forge agora possui um primeiro gerador de personagem em pixel art que trabalha
diretamente no canvas final, sem supersampling e sem anti-aliasing. O contrato é
`A7_FORGE_2D_PIXEL_CHARACTER_V1`.

Ele gera quatro direções (`south/east/north/west`), uma pose `idle` e quatro
frames de caminhada por direção. Cada frame usa a mesma paleta, canvas e anchor.
As animações de caminhada são empacotadas automaticamente com
`A7_FORGE_2D_ANIMATION_V1`, produzindo spritesheet, manifesto e GIF de revisão.

Exemplo:

```bash
a7-forge-2d render-pixel-character \
  --recipe tools/visitor_forge_2d/examples/pixel_character_adventurer_01.json \
  --output out/pixel_character_adventurer_01
```

A saída inicial é deliberadamente um piloto estrutural. Ela valida a arquitetura
de grid, identidade, direções, poses e export. Qualidade comercial continua sendo
um gate artístico separado; melhorar silhueta, clusters, roupa, equipamento,
ataque, dano e morte não exige trocar o contrato de animação.

## Animação 2D genérica

A animação permanece dentro do A7 Forge 2D. O Blender não participa deste
fluxo. O movimento pode ser produzido por poses de um rig 2D, por deformação
controlada, por frames pixel art desenhados pelo próprio gerador ou por outro
worker 2D. Depois que os frames existem, o contrato
`A7_FORGE_2D_ANIMATION_V1` valida e empacota a sequência.

O empacotador exige PNG RGBA, mesmo canvas em todos os frames e, quando
informado, um anchor único. Para pixel art o spritesheet copia os pixels sem
qualquer resampling. O GIF é apenas preview; o runtime deve usar os PNGs ou o
spritesheet + manifesto.

Exemplo de receita:

```json
{
  "contract": "A7_FORGE_2D_ANIMATION_V1",
  "id": "hero_walk_south",
  "pixelArt": true,
  "loop": true,
  "frameDurationMs": 140,
  "anchor": [16, 31],
  "frames": [
    {"id": "walk_0", "path": "frames/walk_0.png"},
    {"id": "walk_1", "path": "frames/walk_1.png"},
    {"id": "walk_2", "path": "frames/walk_2.png"},
    {"id": "walk_3", "path": "frames/walk_3.png"}
  ]
}
```

Empacotar:

```bash
a7-forge-2d pack-animation \
  --recipe caminho/animation.json \
  --output out/hero_walk_south
```

A saída contém:

- `*_spritesheet.png` com layout row-major e sem reamostragem;
- `*.animation.json` com retângulo, duração e SHA-256 de cada frame;
- `*_preview.gif` para revisão rápida;
- `runtimePromotion: false` por padrão, porque empacotar não equivale a
  aprovar visualmente a animação.

Para personagens, o repositório já possui o princípio necessário:
`idle / walk A / walk B`, rig em camadas, identity lock e gait controlado. Um
modo pixel art futuro pode produzir mais poses no mesmo contrato sem criar um
segundo sistema de animação.

## Metadata de saída

Cada frame exportado inclui PNG e JSON com, no mínimo:

- `characterId`;
- `direction`;
- `pose`;
- `canvasSize`;
- `workingCanvasSize`;
- `anchor`;
- `frameDurationMs`;
- `transparent`;
- `colorMode`;
- `downscaleFilter`;
- `forgeContractVersion`.
- `sourceParts` (proveniência da arte procedural e autorada quando exportada pelo CLI).

A engine continua consumindo apenas PNG RGBA + metadata; ela não deve depender de como o personagem foi produzido.

## Gate de qualidade

Antes de aprovar EAST/WEST/NORTH ou novos visitantes para uso no jogo, o
conjunto deve ser validado em três níveis:

1. visual grande para inspecionar forma e juntas;
2. visual em 128x128/tamanho real de gameplay;
3. comparação dentro do mapa sobre calçada/rua e próximo a construções.

Se o personagem só ficar bom ampliado, a V1 ainda não está aprovada.
As medidas do relatório são diagnósticas: anchor e amplitude coerentes não certificam
silhueta, roupa, perspectiva ou qualidade de arte.

## Próximos passos artísticos

O gerador procedural V4 continua aquém do desenho de referência. O estudo do
mesmo personagem nas quatro direções fornece uma base melhor de silhueta,
roupa e rosto. Retocar as articulações descobertas pelo movimento, comparar
em tamanho real no mapa e então transformar os masters em bibliotecas de peças
autoradas. O procedural pode controlar rig, paleta e variações pequenas; novas
roupas e silhuetas exigirão desenhos próprios.

## Integração futura

O Sprite Workshop existente pode ser usado depois para validar alpha, halo, bounds, anchor e animação.

O núcleo genérico também poderá ser reaproveitado por funcionários, vendedores, mascotes, pequenos animais, placas animadas e outros assets 2D em camadas.

## Status

**Estado atual:** núcleo procedural V0.1 e estudo do mesmo visitante em quatro
direções, com três frames por direção e comparação em escala real. Ainda é um
gate artístico; nada foi promovido ao runtime.

**Próxima tarefa:** testar a escala candidata e os 12 frames na engine, sobre
calçadas e perto de edifícios de tamanhos diferentes; retocar as juntas que
apresentarem frestas. Congelar o estilo V1 somente após essa revisão visual.

## Acabamento localizado guiado por máscara

O Scene Composer V4 aceita `sampling: "mask"` em `finishRegions`, concentrando
os oito pincéis de acabamento na região desenhada. O passe preserva o alfa
original e permite desativar qualquer estilo com zero marcas. O modo de
distribuição antigo continua disponível e é o padrão. Veja
[integração, exemplo e limites](docs/A7_LOCALIZED_FINISH.md).
