// Configurações de dispositivos/viewport conhecidos, usados como base
// para o contexto do navegador (viewport, user-agent, locale, timezone).

const DEVICES = {
  desktop: {
    viewport: { width: 1366, height: 768 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "America/New_York",
  },
  "android-mobile": {
    viewport: { width: 360, height: 800 },
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    locale: "en-US",
    timezoneId: "America/Sao_Paulo",
  },
  iphone: {
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
  },
  tablet: {
    viewport: { width: 768, height: 1024 },
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    locale: "en-US",
    timezoneId: "America/Chicago",
  },
  "mobile-landscape": {
    viewport: { width: 800, height: 360 },
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    locale: "en-US",
    timezoneId: "America/Sao_Paulo",
  },
};

const DEFAULT_DEVICE = "desktop";

// Limites de viewport: sem isso, um override malicioso/malformado
// (ex: { width: 999999999, height: 999999999 }) combinado com
// screenshot fullPage poderia gerar um buffer gigante em memória --
// achado real da revisão do documento original (sandbox.md), que não
// tinha nenhum limite.
const MIN_DIMENSION = 200;
const MAX_DIMENSION = 3840; // 4K -- generoso o bastante para qualquer device real testado

function isValidDimension(value) {
  return (
    Number.isInteger(value) && value >= MIN_DIMENSION && value <= MAX_DIMENSION
  );
}

/**
 * Valida e normaliza um override de viewport vindo de fora.
 * Lança erro em vez de silenciosamente aceitar valores inválidos --
 * o documento original aceitava qualquer coisa (`overrideViewport.width || viewport.width`),
 * o que deixava passar strings, negativos, zero, etc.
 */
function validateViewportOverride(overrideViewport) {
  if (overrideViewport === null || overrideViewport === undefined) {
    return null;
  }
  if (typeof overrideViewport !== "object" || Array.isArray(overrideViewport)) {
    throw new Error("viewport deve ser um objeto {width, height}");
  }
  const { width, height } = overrideViewport;
  if (width !== undefined && !isValidDimension(width)) {
    throw new Error(
      `viewport.width inválido: deve ser um inteiro entre ${MIN_DIMENSION} e ${MAX_DIMENSION}`,
    );
  }
  if (height !== undefined && !isValidDimension(height)) {
    throw new Error(
      `viewport.height inválido: deve ser um inteiro entre ${MIN_DIMENSION} e ${MAX_DIMENSION}`,
    );
  }
  return { width, height };
}

function getDeviceConfig(deviceName, overrideViewport) {
  const device = DEVICES[deviceName] || DEVICES[DEFAULT_DEVICE];
  const validatedOverride = validateViewportOverride(overrideViewport);

  let viewport = device.viewport;
  if (validatedOverride) {
    viewport = {
      width: validatedOverride.width || viewport.width,
      height: validatedOverride.height || viewport.height,
    };
  }

  return {
    ...device,
    viewport,
  };
}

export { getDeviceConfig, DEVICES, DEFAULT_DEVICE, MIN_DIMENSION, MAX_DIMENSION };
