import path from "node:path";
import fs from "node:fs";
import os from "node:os";

// Default dentro de os.tmpdir() -- achado real revisando isolamento de
// filesystem: o default antigo (relativo ao próprio módulo, dentro de
// `/app`) era o ÚNICO write deste serviço fora de os.tmpdir(); todo o
// resto (extração de ZIP/RAR/7z/TAR, ver archive/) já grava só em
// diretórios temporários efêmeros. Isso importa de verdade pra rodar
// com filesystem raiz READ-ONLY (`securityContext.readOnlyRootFilesystem`
// no Cloud Run, ou `docker run --read-only`) -- diferente de
// cgroups/RLIMIT_AS/iptables (que precisariam de privilégio DENTRO do
// container, indisponível no Cloud Run/gVisor, ver README), isso é
// puramente uma decisão de ONDE escrever, que a própria aplicação
// controla; consolidar em os.tmpdir() significa que só UM caminho
// (`/tmp`) precisa ser montado como writable (emptyDir volume), não
// dois. Continua sobrescrevível via SANDBOX_ARTIFACTS_DIR pra quem
// quiser um destino persistente/diferente.
const SCREENSHOT_DIR =
  process.env.SANDBOX_ARTIFACTS_DIR ||
  path.join(os.tmpdir(), "sandbox-efemero-screenshots");

/**
 * Captura screenshot da página atual.
 * @param {import('playwright').Page} page
 * @param {string} browserType
 * @param {string} device
 * @returns {Promise<{path: string|null, error: string|null}>}
 */
async function captureScreenshot(page, browserType, device) {
  try {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const filename = `${Date.now()}_${process.hrtime.bigint()}_${browserType}_${device}.png`;
    const filePath = path.join(SCREENSHOT_DIR, filename);
    await page.screenshot({ path: filePath, fullPage: true });
    return { path: filePath, error: null };
  } catch (error) {
    // Antes, uma falha aqui só ia pro console.error e o resultado
    // final não deixava rastro do motivo (screenshotPath: null, sem
    // explicação). Agora o chamador (runner.js) registra isso em
    // result.errors, consistente com o resto do módulo.
    return { path: null, error: error.message };
  }
}

export { captureScreenshot, SCREENSHOT_DIR };
