/** Declarações mínimas para Buffer no runtime Node usado por web-fetch. */
declare const Buffer: {
  byteLength(text: string, encoding: "utf8"): number;
  from(text: string, encoding: "utf8" | "hex"): {
    length: number;
    subarray(start: number, end: number): { toString(encoding: "utf8"): string };
  };
};
