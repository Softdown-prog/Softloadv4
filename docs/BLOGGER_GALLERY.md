# Galeria de templates Blogger — presets do compilador

A galeria é declarada em `src/blogger/exampleGallery.json`. Cada exemplo contém
**um conjunto real de entradas** do compilador XML existente:
`siteName` (a partir de `nome`), `nichoTema`, `colorPreset`, `typography`,
`gridLayout` e `sidebarPosition`.

O arquivo **não armazena XML pré-gerado** e não cria um chassis novo. Ao selecionar
um cartão, o editor Angular preenche esses campos; no download, o backend
compila o XML e executa os validadores de sintaxe, estrutura e semântica do Blogger.
As miniaturas EJS são ilustrativas, não screenshots. Não confundir as novas
composições visuais com famílias estruturais inéditas.

## Adicionados nesta rodada (22 → 30)

| Exemplo | Nicho do compilador | Destaque |
| --- | --- | --- |
| Boletim Atual | `noticias-mag-news` | editorial claro em lista, barra à esquerda |
| Oficina de Código | `tecnologia-techwind` | artigos tech escuros, zigue-zague |
| Play Ciano | `gamer-playerone` | games, duas colunas, sem sidebar |
| Tempero de Casa | `culinaria-boutique-gourmet` | receitas em tons terrosos |
| Trilhas & Ideias | `natureza-bulma-vegan` | natureza, duas colunas |
| Ateliê Digital | `portfolio-minimalista` | portfólio em mosaico violeta |
| Produto em Foco | `saas-nexus` | software com estilo claro |
| Roteiro de Estudos | `elearning-academy` | materiais educativos em duas colunas |

## Contrato para adicionar mais um exemplo

1. Criar ID único, nome entre 2–60 caracteres, descrição honesta e categoria
   dentre os filtros atuais (Editorial, Tecnologia, Criativos, Blogs, Negócios).
2. Reutilizar IDs existentes dos catálogos oficiais de nicho, cor e tipografia;
   layout e sidebar devem ser aceitos pelo compilador.
3. Garantir combinação visual diferente das existentes; **não** prometer recursos
   que o chassis do nicho não implementa. A lista de exemplos não substitui
   uma implementação dedicada de documentação, loja ou catálogo.
4. Executar `node --test src/blogger/exampleGallery.test.js`: cada entrada
   **compila XML procedural real**, checado por três validadores e por `Blog1`.
   Rodar também CI TypeScript, Angular, SAC, Docker e Chrome antes do merge.

O SAC atualizado verifica **o aplicativo Angular e seus artefatos de build**;
a validade do XML Blogger continua responsabilidade dos validadores e testes
do compilador. Nenhuma conexão com IA, pagamentos ou banco é necessária para
testar os exemplos.

## Cobertura combinatória do compilador

O workflow `Softload - Qualidade XML Blogger` executa
`npm run test:quality`. Além da prova básica de 16 estruturas, a
matriz determinística de 7 perfis cobre **16 estruturas × 7 combinações =
112 compilações reais**. Cada combinação utiliza cores e fontes dos
catálogos oficiais, exercita as 7 grades, 3 posições de sidebar e
as 6 tipografias. A saída precisa conter `Blog1` e passar pelos três
validadores XML do compilador. A telemetria é desabilitada; não há rede,
banco, IA, cobrança nem download comercial nessa matriz.

Essa matriz não tenta combinar todas as paletas disponíveis (o produto
permite muito mais que 112 combinações) e não é evidência de renderização
visual perfeita de cada uma. O Chrome verifica a aplicação Angular e a
prévia em cenários representativos. A versão atual não cria novos chassis
e não garante layouts dedicados para nichos ainda em fallback.
