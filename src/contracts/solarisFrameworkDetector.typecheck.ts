import { detectarFramework, FRAMEWORKS_VALIDOS, FRAMEWORKS_DETECTAVEIS } from '../solaris/tools/frameworkDetector';
import type { FrameworkFile, FrameworkDetectionResult, FrameworkCandidate } from '../solaris/tools/frameworkDetector';
const files: FrameworkFile[] = [{ caminho: 'manage.py', conteudo: 'import django' }];
const result: FrameworkDetectionResult = detectarFramework(files);
const candidates: FrameworkCandidate[] = result.candidatos;
const accepted: readonly string[] = FRAMEWORKS_VALIDOS;
const detectable: string[] = FRAMEWORKS_DETECTAVEIS;
void candidates; void accepted; void detectable;
