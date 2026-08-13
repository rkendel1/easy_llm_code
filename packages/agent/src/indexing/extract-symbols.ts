import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import ts from "typescript";
import type { ProjectEdge, ProjectFile, ProjectSymbol, SymbolKind } from "../memory/types.js";

interface ExtractionResult {
  symbols: ProjectSymbol[];
  edges: ProjectEdge[];
}

const TS_JS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const sourceKind = (filePath: string): ts.ScriptKind => {
  const ext = extname(filePath);
  if (ext === ".ts") return ts.ScriptKind.TS;
  if (ext === ".tsx") return ts.ScriptKind.TSX;
  if (ext === ".jsx") return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
};

const makeSymbol = (file: ProjectFile, name: string, kind: SymbolKind, pos: number): ProjectSymbol => ({
  id: `symbol:${file.path}:${kind}:${name}:${pos}`,
  fileId: file.id,
  name,
  kind
});

const tryResolveImportFileId = (fromPath: string, moduleSpecifier: string, fileIdsByPath: Map<string, string>): string | null => {
  if (!moduleSpecifier.startsWith(".")) {
    return `pkg:${moduleSpecifier}`;
  }
  const basePath = normalize(join(dirname(fromPath), moduleSpecifier)).replace(/\\/g, "/");
  const baseExtension = extname(basePath), sourceStem = TS_JS_EXTENSIONS.has(baseExtension) ? basePath.slice(0, -baseExtension.length) : basePath;
  const candidates = [
    basePath,
    `${sourceStem}.ts`,
    `${sourceStem}.tsx`,
    `${sourceStem}.js`,
    `${sourceStem}.jsx`,
    `${sourceStem}.mjs`,
    `${sourceStem}.cjs`,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
    `${basePath}/index.ts`,
    `${basePath}/index.js`
  ];
  for (const candidate of candidates) {
    const id = fileIdsByPath.get(candidate);
    if (id) {
      return id;
    }
  }
  return null;
};

export const createTestEdges = (files: ProjectFile[]): ProjectEdge[] => {
  const byBasename = new Map<string, ProjectFile>();
  for (const file of files) {
    const simple = file.path.split("/").pop() ?? file.path;
    if (!simple.includes(".test.")) {
      byBasename.set(simple.replace(/\.[^.]+$/, ""), file);
    }
  }

  const edges: ProjectEdge[] = [];
  for (const file of files) {
    const simple = file.path.split("/").pop() ?? file.path;
    if (!simple.includes(".test.")) {
      continue;
    }
    const withoutTest = simple.replace(/\.test\.[^.]+$/, "");
    const target = byBasename.get(withoutTest);
    if (!target) {
      continue;
    }
    edges.push({
      id: `edge:test:${file.id}->${target.id}`,
      from: file.id,
      to: target.id,
      relation: "TESTS",
      confidence: 0.95,
      source: "filesystem"
    });
  }
  return edges;
};

export const extractSymbolsAndRelationships = async (
  root: string,
  files: ProjectFile[]
): Promise<ExtractionResult> => {
  const symbols: ProjectSymbol[] = [];
  const edges: ProjectEdge[] = [];
  const fileIdsByPath = new Map(files.map((file) => [normalize(file.path).replace(/\\/g, "/"), file.id]));

  for (const file of files) {
    if (!file.language || !["typescript", "javascript"].includes(file.language)) {
      continue;
    }
    const ext = extname(file.path);
    if (!TS_JS_EXTENSIONS.has(ext)) {
      continue;
    }

    const sourcePath = join(root, file.path);
    const sourceText = await readFile(sourcePath, "utf8");
    const sourceFile = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.ESNext, true, sourceKind(file.path));

    const exportSymbol = (symbol: ProjectSymbol): void => {
      const hasExportModifier = (node: ts.Node): boolean =>
        ts.canHaveModifiers(node)
          ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false)
          : false;

      const node = nodeByPos.get(symbol.id);
      if (node && hasExportModifier(node)) {
        edges.push({
          id: `edge:exports:${file.id}->${symbol.id}`,
          from: file.id,
          to: symbol.id,
          relation: "EXPORTS",
          confidence: 1,
          source: "ast"
        });
      }
    };

    const nodeByPos = new Map<string, ts.Node>();

    const collect = (name: string | undefined, kind: SymbolKind, node: ts.Node): void => {
      if (!name) return;
      const symbol = makeSymbol(file, name, kind, node.getStart(sourceFile));
      symbols.push(symbol);
      nodeByPos.set(symbol.id, node);
      edges.push({
        id: `edge:contains:${file.id}->${symbol.id}`,
        from: file.id,
        to: symbol.id,
        relation: "CONTAINS",
        confidence: 1,
        source: "ast"
      });
    };

    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node)) {
        collect(node.name?.text, "function", node);
      } else if (ts.isClassDeclaration(node)) {
        collect(node.name?.text, "class", node);
      } else if (ts.isMethodDeclaration(node)) {
        collect(node.name?.getText(sourceFile), "method", node);
      } else if (ts.isInterfaceDeclaration(node)) {
        collect(node.name.text, "interface", node);
      } else if (ts.isTypeAliasDeclaration(node)) {
        collect(node.name.text, "type", node);
      } else if (ts.isEnumDeclaration(node)) {
        collect(node.name.text, "enum", node);
      } else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
            collect(decl.name.text, isConst ? "constant" : "variable", decl);
          }
        }
      } else if (ts.isImportDeclaration(node)) {
        const moduleName = node.moduleSpecifier.getText(sourceFile).replace(/^['"]|['"]$/g, "");
        const target = tryResolveImportFileId(file.path, moduleName, fileIdsByPath);
        if (target) {
          edges.push({
            id: `edge:imports:${file.id}->${target}:${node.getStart(sourceFile)}`,
            from: file.id,
            to: target,
            relation: "IMPORTS",
            confidence: 0.95,
            source: "ast"
          });
        }
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        const moduleName = node.moduleSpecifier.getText(sourceFile).replace(/^['"]|['"]$/g, "");
        const target = tryResolveImportFileId(file.path, moduleName, fileIdsByPath);
        if (target) {
          edges.push({
            id: `edge:exports:${file.id}->${target}:${node.getStart(sourceFile)}`,
            from: file.id,
            to: target,
            relation: "EXPORTS",
            confidence: 0.9,
            source: "ast"
          });
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    for (const symbol of symbols.filter((item) => item.fileId === file.id)) {
      exportSymbol(symbol);
    }
  }

  edges.push(...createTestEdges(files));

  return {
    symbols,
    edges
  };
};
