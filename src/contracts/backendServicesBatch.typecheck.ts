import { createGithubOperations, type GithubRepoProvider, type GithubFetch } from '../services/solarisGithubOperations';
import { createGithubAppService, type GithubOAuthRequest } from '../services/solarisGithubApp';
import { createSolarisGithubAgent, type GithubAgentPrepareInput } from '../services/solarisGithubAgent';
import { gerarChat, gerarChatStream, gerarJson, gerarPeca, type GeminiTokens } from '../services/geminiService';
import { saveSession, saveMemory, loadSession, listSessions } from '../services/chatStorageService';
import type { SentinelWorker, SentinelTestResult } from '../services/sentinelWorker';
import type { AuthGuardHandler, AuthGuardRequest } from '../middlewares/authGuard';
import type { HistoryRequest } from '../routes/dashboard_routes/historico';
import type { Firestore } from 'firebase-admin/firestore';
declare const provider: GithubRepoProvider;
declare const fetchImpl: GithubFetch;
declare const db: Firestore;
declare const prepareInput: GithubAgentPrepareInput;
declare const oauthRequest: GithubOAuthRequest;
declare const sentinel: SentinelWorker;
declare const guard: AuthGuardHandler;
declare const guardRequest: AuthGuardRequest;
declare const historyRequest: HistoryRequest;
const operations = createGithubOperations(provider, { fetchImpl });
async function check() {
    const repository = await operations.execute('u', { action: 'repository_get' });
    const branch: string = repository.defaultBranch;
    // @ts-expect-error A read operation does not return a commit SHA.
    const invalid: string = repository.commit;
    // @ts-expect-error Write input requires explicit confirmation.
    operations.execute('u', { action: 'branch_create', branch: 'solaris/test' });
    // @ts-expect-error This API accepts only the closed set of GitHub operations.
    operations.execute('u', { action: 'delete_repository' });
    const app = createGithubAppService(db, { fetchImpl });
    await app.begin(oauthRequest);
    const agent = createSolarisGithubAgent(db, app, operations);
    await agent.prepare(prepareInput);
    const tokensRef: Partial<GeminiTokens> = {};
    const text: string = await gerarChat([], 'hello', '', { tokensRef });
    for await (const chunk of gerarChatStream([], 'hello', '', { tokensRef })) { const s: string = chunk; void s; }
    const json: unknown = await gerarJson('JSON');
    const piece = await gerarPeca({ pedido: 'hero', tokensCss: { light_mode: { primary: '#123456' }, dark_mode: null } });
    // @ts-expect-error Text request limits are numbers.
    gerarChat([], 'hello', '', { maxOutputTokens: '10' });
    const session = await saveSession('u', 'chat-suporte', 's', { messages: [{ role: 'user', content: 'hello' }] });
    await saveMemory('u', existing => ({ sessionCount: (existing.sessionCount || 0) + 1 }));
    const loaded = await loadSession('u', 'chat-suporte', 's');
    const sessions = await listSessions('u', 'chat-suporte');
    // @ts-expect-error Session content is a string, not a scalar counter.
    saveSession('u', 'chat-suporte', 's', { messages: [{ content: 7 }] });
    const report = await sentinel.runAllTests();
    const test: SentinelTestResult = { status: 'WARN', responseTime: 500 };
    // @ts-expect-error Health tests have a closed set of statuses.
    const invalidTest: SentinelTestResult = { status: 'HEALTHY' };
    void [branch, invalid, text, json, piece, session, loaded, sessions, report, test, invalidTest];
}
void [check, guard, guardRequest, historyRequest];
