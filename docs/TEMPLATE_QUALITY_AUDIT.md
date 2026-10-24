# Auditoria do compilador Blogger — fidelidade antes de estética

Data: 21/10/2026. Base investigada: main, antes das correções.

## Por que os templates pareciam ruins mesmo com nota alta?

1. `src/core/diagnostico/score.js` só desconta erros/avisos
   estruturais (15 por erro, 4 por aviso). Isso NÃO compara o XML gerado
   aos layouts autorais da pasta `exemplos/`.
2. `scripts/diagnostico-sweep.js` compila os nichos, mas só bloqueia
   erros declarados como `nivel === erro`; não mede fidelidade ao exemplo.
   Também usa `colorPreset=tech-blue` e `gridLayout=revista` para todos,
   anulando parte das escolhas de nicho ao auditar.
3. `src/core/compilerEngine/dossieLoader.js` antes aceitava JSON de
   dossiê corrompido como `null` e caía no gerador legado: um erro
   de dados podia trocar a identidade do tema sem interromper o pedido.
   **Corrigido:** a ausência é fallback legítimo; corrupção é erro.
4. A comparação ingênua de IDs acusava como “perda” renomeações
   documentadas (`main-feed -> main`, etc.). **Corrigido** com aliases
   explícitos de seções; seções sem equivalente continuam sinalizadas.

## Primeira medição (antes de reconhecer aliases)

Comando: `node scripts/audit-template-fidelity.js`.
Execução: https://github.com/Softdown-prog/softload-engine-v3/actions/runs/39622367437

| Nicho | Diagnóstico XML | Fidelidade estrutural inicial | Observação |
|---|---:|---:|---|
| viral-magazine | 100 | 100 | As seções autorais estavam presentes |
| tecnologia-techwind | 100 | 98 | Comparar componentes extras |
| appstore-bulma-mobile | 100 | 90 | `header-menu` tornou-se `main-nav` |
| pop-retro-pixel | 100 | 70 | `header-top` virou `header-logo`; `main-feed` virou `main` |
| biolink-social | 100 | 34 | Três nomes de seções mudaram; `footer-copyright` não tem equivalência 1:1 |
| aquarela | 100 | 100 | O exemplo autoral NÃO inclui Bootstrap 5; o bloqueio inicial foi falso positivo |

**Essas notas não são notas visuais.** A primeira rodada confundia
mudança de ID com remoção, e não deve ser apresentada como pontuação
final de qualidade. O relatório atual registra `renamedSections`
separadamente. Um XML pode ter todas as seções e ainda parecer ruim.

## Onde está a evidência original das renomeações?

- `src/rag/templates/template_pop-retro-pixel.xml`: comentário da
  migração do esqueleto e seção `main` com classe `main-feed`.
- `src/rag/templates/template_biolink-social.xml`: componentes de perfil
  (`header-logo`), lista de links (`main`), botão WhatsApp
  (`whatsapp-float`), rodapé e postagens.
- `src/rag/templates/template_aquarela.xml`: o XML e o exemplo original
  não carregam Bootstrap, então não impor o framework por engano.
- `src/core/compilerEngine/nichoBlocks.js`: peças protegidas por nicho
  e variantes; `carregarNichoDossie` distingue motor autoral do legado.

## Nova proteção

- `npm run test:quality`: testa as assinaturas e compila todos os nichos.
- Falhas bloqueantes: erro XML, ausência de Bootstrap quando estava no
  original, ou fidelidade estrutural abaixo de 75/100 após aliases
  explicitamente documentados. **75 é um gate inicial de regressão, não
  uma certificação comercial de design.**
- Abaixo de 85/100: relatórios marcam o nicho para inspeção humana,
  mesmo que o build continue.
- `node scripts/visual/compareTemplates.js`: produz HTML de comparação
  lado a lado e screenshots de desktop/mobile entre a referência e o
  XML gerado, usando o mesmo preview simulado da Softload.
- `/.github/workflows/template-quality.yml`: armazena resultados no
  artifact `blogger-template-fidelity`.

## Limitações e critérios de aceitação reais

A prévia `bloggerPreviewRenderer` não interpreta todos os `b:if`,
`b:loop`, configurações dos widgets nativos e posts do Blogger. Portanto,
screenshot e métrica de prévia NÃO provam fidelidade num blog real.
A validação final deve incluir teste de upload no Blogger e revisão
humana desktop/mobile. Não alterar CSS/estrutura de tema aprovado
meramente para ganhar pontos de uma heurística.

Os próximos candidatos à revisão visual são `biolink-social`,
`pop-retro-pixel`, `viral-magazine`, depois os demais exemplos.
Investigar perda de widget real, CSS sem DOM, hero duplicado,
feeds dinâmicos, conteúdo hardcoded e responsividade; corrigir apenas
causas reproduzidas, não reescrever o motor de uma vez.

## 21/10/2026 — regressão mobile reproduzida e corrigida

Na prévia real Chromium com viewport 390px, o nicho `pop-retro-pixel`
tinha `scrollWidth=412px` tanto no exemplo como no gerado.
Ao investigar o HTML gerado, `#player-email.pixel-input` usava
`width:100%;padding:12px 15px;border:4px` sem garantir
`box-sizing:border-box`. Num teste local isolado sem CDN, a largura
total desceu de 396px para 390px após aplicar `border-box`, sem cortar
elementos. O CSS foi corrigido somente no esqueleto gerado; a referência
autoral preserva o problema original para comparações históricas.
O test `nichoDossie.pop-retro-pixel.test.js` confere a regra no XML final.

Referência visual da primeira rodada:
https://github.com/Softdown-prog/softload-engine-v3/actions/runs/39624648281

Outros achados da renderização simulada:
- `biolink-social` original 137 elementos visíveis contra 51 gerados
  e altura mobile 2994px contra 844px: revisar densidade e conteúdo
  antes de mudar o desenho. Parte da diferença era conteúdo de
  demonstração e links do autor, intencionalmente não copiados.
- `viral-magazine` manteve densidade semelhante no preview, mas o
  renderizador não prova feeds/widgets reais do Blogger.
- `pop-retro-pixel` teve conteúdo de demonstração promocional removido
  por decisão anterior. Não reintroduzir vídeos de terceiros para
  simplesmente igualar screenshots.
