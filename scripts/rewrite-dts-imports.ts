export {};

function rewriteImports(dtsContents: string): string {
  return dtsContents.replaceAll(
    /(from\s+['"])(\.[^'"]+?)\.ts(['"])/g,
    (_match, fromPrefix: string, specifier: string, fromSuffix: string) =>
      `${fromPrefix}${specifier}.js${fromSuffix}`,
  );
}

async function main() {
  const glob = new Bun.Glob('dist/**/*.d.ts');

  for await (const filePath of glob.scan({ cwd: process.cwd(), absolute: true })) {
    const original = await Bun.file(filePath).text();
    const rewritten = rewriteImports(original);
    if (rewritten !== original) {
      await Bun.write(filePath, rewritten);
    }
  }
}

await main();
