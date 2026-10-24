# Visitor Forge 2D — guia de execução para outro chat

Leia `AGENTS.md` e o `README.md` da raiz antes de editar. A tarefa é trabalhar
com o visitante `visitor_male_01` existente, sem reinventar sua aparência nem
substituir uma direção aprovada para corrigir outra. Os sprites do jogo são 2D;
o Visitor Forge usa peças RGBA e poses e produz PNGs, sem render 3D obrigatório.

## Escolha a fonte certa

| Finalidade | Fonte canônica hoje |
| --- | --- |
| Aparência frontal SOUTH aprovada | `art/concepts/south_front_candidate_v1/south_front_master.png` (512×512) |
| Poses SOUTH frontal | `art/concepts/south_front_candidate_v1/poses/south_walk_{a,b}.json` |
| Aparência EAST/NORTH/WEST | `art/concepts/visitor_male_01_{east,north,west}_master.png` |
| Passos EAST/NORTH/WEST | `art/concepts/directional_gait_candidate_v1/recipe.json` |
| Catálogo de teste com quatro direções | `runtime_preview/visitor_male_01_south_front_candidate.json` |

O teste F8 ganhou mais duas opções depois desse catálogo: **sexta**, Full Pose
EAST (`runtime_preview/visitor_male_01_full_pose_east_candidate.json`); **sétima**,
Structural Gait V2 (`runtime_preview/visitor_male_01_structural_gait_v2_candidate.json`).
O par EAST de poses completas é agora a aparência inicial do teste F7 quando
disponível. As demais direções da sexta opção ainda usam o estudo V1. A sétima
troca EAST/NORTH/WEST pelo V2, mas conserva os braços quase imóveis; não é uma
aprovação visual. Veja `art/concepts/walk_map_comparison_v1/` para o painel e
GIF comparativos a 56 px sobre a captura do MapForge.

Os arquivos em `art/concepts/frames_preview/` e o catálogo
`runtime_preview/visitor_male_01.json` são a prévia **anterior**. Não baseie
uma nova caminhada SOUTH neles. Não chame um master de 512 px de frame final;
os frames são PNGs RGBA 128×128. `out/` é reconstruível e não guarda retoques
duráveis. Os frames candidatos versionados ficam em
`art/concepts/south_front_candidate_v1/` e
`art/concepts/directional_gait_candidate_v1/`, fora de `assets/`.

## Reproduzir e conferir

Execute a partir da raiz do repositório. Pode usar o módulo sem instalar o
pacote usando `PYTHONPATH=tools/visitor_forge_2d/src python -m visitor_forge_2d`.
Nos exemplos abaixo, `ch-visitor-forge-2d` é esse mesmo programa após
`python -m pip install -e tools/visitor_forge_2d`.

1. Para a caminhada EAST/NORTH/WEST, rode `render-directional-gait` com o
   `--recipe` acima, `--tool-root tools/visitor_forge_2d` e saída em
   `out/visitor_forge_2d/directional_gait_review`. Confira os seis PNGs e
   `four_direction_gait_56px.png`. A receita altera apenas a parte inferior
   dos masters existentes; retoques de arte devem ser feitos na fonte, não
   diretamente nos PNGs de `out/`.
2. Para alterar SOUTH, use `build-concept-rig` com o master frontal e
   `--direction south`, seguido de `prototype` com a definição gerada e as
   poses `poses/concept/south_idle.json` e
   `art/concepts/south_front_candidate_v1/poses/south_walk_a.json` e
   `south_walk_b.json`. Veja o comando completo no README da pasta
   `art/concepts/south_front_candidate_v1/`. A cabeça/roupa devem continuar
   reconhecíveis nos três frames; confira juntas que revelam área escondida.
3. Depois de versionar qualquer mudança nos candidatos e atualizar o catálogo
   de teste, rode:

```bash
PYTHONPATH=tools/visitor_forge_2d/src python -m visitor_forge_2d audit-preview \
  --manifest tools/visitor_forge_2d/runtime_preview/visitor_male_01_south_front_candidate.json \
  --repo-root .
```

O comando retorna JSON e sai com código 1 para arquivos ausentes, PNG que não
seja RGBA 128×128, corpo vazio, pés afastados da linha 115 ou frames
visualmente idênticos entre idle/A/B. A diferença de silhueta é diagnóstica:
passo curto pode variar pouco, e aprovação visual não pode ser deduzida desse
número. Esse comando não gera frames nem promove assets.

## Gate visual e teste no jogo

Examine idle/A/B das quatro direções em tamanho nativo, também com corpo a
56 px sobre mapa real. Confira identidade, frente SOUTH sem leitura sudeste,
silhuetas distintas, alternância de pés, braços discretos, contato com o chão,
juntas sem frestas e transparência sem halo. Pés no canvas 128×128 devem
encostar na linha 115 com anchor comum `[64, 116]`; cada pose de caminhada
dura 220 ms. Os passos são intencionalmente curtos, mas podem deslizar no mapa.

Para teste na engine: compile `city_builder` com
`-DCH_VISITOR_FORGE_PREVIEW=ON`. F7 começa no Full Pose EAST quando está
embalado; selecione a quinta aparência com F8 para comparar o estudo V1;
marque origem/destino em ruas com F3/F4 e mova com F6. Para SOUTH lógico, use
rota ao longo de +Y; na projeção isométrica essa rota aparece inclinada na
tela. F7 testa uma rota +X e altera velocidade. Confira as quatro direções
andando e a transição com idle na velocidade real. Uma auditoria verde ou
captura estática não equivale a esse teste.

Não copie os candidatos para `assets/` nem declare animação pronta antes de
inspeção visual e teste no jogo. Se o resultado falhar, corrija somente a
direção/pose com defeito e regenere o painel; mantenha os outros masters.
Ao terminar, informe caminhos exatos, PNGs examinados, o que passou no teste
na engine, o que ficou pendente e se houve promoção ao runtime.
