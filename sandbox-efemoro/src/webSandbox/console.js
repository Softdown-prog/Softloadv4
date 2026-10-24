// Captura de eventos de console da página sob teste.

const MAX_EVENTS = 100;

/**
 * Anexa listeners de console à página, acumulando erros e avisos
 * (limitados a MAX_EVENTS cada, para não crescer sem limite numa
 * página que loga em excesso).
 * @param {import('playwright').Page} page
 * @param {object} result - Objeto de resultado a ser preenchido.
 */
function attachConsoleListeners(page, result) {
  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "error" && result.console.errors.length < MAX_EVENTS) {
      result.console.errors.push({
        text: msg.text(),
        location: msg.location(),
      });
    } else if (type === "warning" && result.console.warnings.length < MAX_EVENTS) {
      result.console.warnings.push({
        text: msg.text(),
        location: msg.location(),
      });
    }
  });

  page.on("pageerror", (error) => {
    if (result.console.errors.length < MAX_EVENTS) {
      result.console.errors.push({
        text: `Page Error: ${error.message}`,
        stack: error.stack,
      });
    }
  });
}

export { attachConsoleListeners, MAX_EVENTS };
