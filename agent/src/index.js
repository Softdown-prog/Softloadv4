import { Agent } from "./agent.js";
import { createApp } from "./server.js";
import { createLogger } from "./utils/logger.js";

// Logger nomeado especificamente para este módulo, facilita filtrar
// logs vindos do worker agent em meio a outros serviços/módulos.
const logger = createLogger("worker-agent");

/**
 * Ponto de entrada principal do processo.
 * Instancia o Agent, sobe o servidor HTTP (server.js) que expõe
 * POST /run pra ele, e mantém o processo vivo enquanto o servidor
 * estiver ouvindo.
 *
 * Antes desta versão, este arquivo instanciava o Agent e ficava só
 * fazendo polling de `agent.running` (Agent.wait()) — sem nenhum
 * jeito de uma task de fora chegar até `agent.execute()`. O Worker
 * subia, ficava "pronto" nos logs, e nunca processava nada: não
 * havia rota HTTP nenhuma neste processo (confirmado via grep por
 * app.listen()/express() em todo agent/src/ antes desta mudança).
 */
async function main() {
  const agent = new Agent({ role: process.env.AGENT_ROLE || "solaris-chat" });

  logger.info("Solaris Worker Agent iniciando");

  // Inicializa o agent (prepara o workspace, monta as capabilities).
  await agent.start();

  logger.info("Solaris Worker Agent pronto");

  const app = createApp(agent);
  const port = process.env.PORT || 8080;

  const server = app.listen(port, () => {
    logger.info(`Worker Agent ouvindo na porta ${port}`);
  });

  // Cloud Run envia SIGTERM antes de reciclar/encerrar uma instância.
  // Sem handler, uma requisição POST /run em andamento (pode levar
  // vários segundos — ex: shell.execute rodando uma suíte de testes)
  // seria derrubada abruptamente no meio do trabalho.
  function shutdown(signal) {
    logger.info(`${signal} recebido, encerrando Worker Agent...`);
    server.close(async () => {
      await agent.stop();
      logger.info("Worker Agent encerrado.");
      process.exit(0);
    });
    // Se close() não resolver a tempo (requisição pendurada), força saída.
    setTimeout(() => process.exit(1), 10000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// Executa main() e trata qualquer erro não capturado dentro dela
// (incluindo rejeições de Promise, já que main() é async).
main().catch((error) => {
  logger.error("Falha fatal no Worker Agent", {
    error: error.message,
    stack: error.stack,
  });

  // Encerra o processo com código de erro (1), sinalizando falha.
  // Importante no Cloud Run: um exit code != 0 pode disparar
  // reinício/reagendamento do container dependendo da configuração.
  process.exit(1);
});
