import { salvarProjeto, carregarProjeto, apagarProjeto, apagarProjetosExpirados, _estaExpirado } from '../solaris/tools/projectStorage';
import type { PersistProjectOptions, PersistProjectResult, LoadedProject, ExpiredProjectsResult } from '../solaris/tools/projectStorage';
const opts: PersistProjectOptions = {uid:'u',email:'a@example.com',plano:'free',sessionId:'s',framework:'html5',arquivos:[{caminho:'index.html',conteudo:Buffer.from('ok')}]};
const saved: Promise<PersistProjectResult> = salvarProjeto(opts);
const loaded: Promise<LoadedProject|null> = carregarProjeto('u','s','/tmp/p');
const deleted: Promise<void> = apagarProjeto('u','s');
const cleaned: Promise<ExpiredProjectsResult> = apagarProjetosExpirados({});
const expired: boolean = _estaExpirado(undefined,30);
void saved;void loaded;void deleted;void cleaned;void expired;
