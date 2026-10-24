import { criarHandlerChatSolaris } from '../solaris/http/solarisChatHandler';
import { criarHandlerUploadSolaris } from '../solaris/http/solarisUploadHandler';
import type { SolarisChatHandlerDependencies, SolarisHttpRequest, SolarisHttpResponse } from '../solaris/http/solarisChatHandler';
import type { SolarisUploadHandlerDependencies } from '../solaris/http/solarisUploadHandler';
// Compile-only boundary: handlers expect typed request and response, and are injectable.
declare const chatDeps: SolarisChatHandlerDependencies;
declare const uploadDeps: SolarisUploadHandlerDependencies;
const chat: (req: SolarisHttpRequest, res: SolarisHttpResponse) => Promise<void> = criarHandlerChatSolaris(chatDeps);
const upload: (req: SolarisHttpRequest, res: SolarisHttpResponse) => void = criarHandlerUploadSolaris(uploadDeps);
void chat; void upload;
