import { extrairZipViaSandbox } from '../solaris/tools/archiveExtractClient';
import type { ArchiveExtractionLimits, ArchiveExtractionResult, ArchiveFile } from '../solaris/tools/archiveExtractClient';
const opts: ArchiveExtractionLimits = {maxFiles: 20,timeoutMs: 5000};
const result: Promise<ArchiveExtractionResult> = extrairZipViaSandbox(Buffer.from('zip'),opts);
const file: ArchiveFile = {caminho:'app.py',conteudo:'print(1)',binario:false};
void result;void file;
