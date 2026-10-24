import { normalizarUsoTokensSolaris, calcularDebitoChatSolaris, calcularDebitoInspecaoSolaris } from '../solaris/http/solarisBilling';
import type { SolarisDebitTokens } from '../solaris/http/solarisBilling';
import type { SolarisTokensSse } from '../solaris/http/solarisHttpProtocol';
const normalizado: SolarisTokensSse = normalizarUsoTokensSolaris({total:3,input:1,output:2});
const debito: SolarisDebitTokens = calcularDebitoChatSolaris('oi','olá',normalizado);
const inspecao: SolarisDebitTokens | null = calcularDebitoInspecaoSolaris({input:3,output:5});
void debito; void inspecao;
