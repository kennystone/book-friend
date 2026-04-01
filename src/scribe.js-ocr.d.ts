declare module "scribe.js-ocr" {
  const scribe: {
    extractText(files: string[]): Promise<string>;
    terminate(): Promise<void>;
  };
  export default scribe;
}
