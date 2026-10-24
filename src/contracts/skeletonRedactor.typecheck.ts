import { redigirDadosReais } from '../core/skeletonRedactor';
import type { SkeletonRedactionResult } from '../core/skeletonRedactor';
const result: SkeletonRedactionResult = redigirDadosReais('<html/>');
const findings: string[] = result.achados;
void findings;
