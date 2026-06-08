import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(appDir, "src");
const bootEntries = [
  "src/main/index.ts",
  "src/main/app.ts",
  "src/main/window.ts",
  "src/main/preload.ts",
].map((relativePath) => path.join(appDir, relativePath));

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(appDir, relativePath), "utf8");
}

function toRelative(filePath: string): string {
  return path.relative(appDir, filePath).split(path.sep).join("/");
}

function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const importClause = node.importClause;
  if (!importClause) {
    return false;
  }
  if (importClause.isTypeOnly) {
    return true;
  }
  if (importClause.name) {
    return false;
  }
  const bindings = importClause.namedBindings;
  return (
    bindings != null &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
}

function resolveLocalImport(importer: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const basePath = path.resolve(path.dirname(importer), specifier);
  const candidates = specifier.endsWith(".js")
    ? [basePath.replace(/\.js$/, ".ts"), basePath.replace(/\.js$/, ".tsx")]
    : [
        `${basePath}.ts`,
        `${basePath}.tsx`,
        path.join(basePath, "index.ts"),
      ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function staticValueImports(filePath: string): string[] {
  const source = fs.readFileSync(filePath, "utf8");
  const ast = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.ES2023,
    true,
    ts.ScriptKind.TS,
  );
  const imports: string[] = [];

  for (const statement of ast.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      !isTypeOnlyImport(statement)
    ) {
      const resolved = resolveLocalImport(
        filePath,
        statement.moduleSpecifier.text,
      );
      if (resolved) {
        imports.push(resolved);
      }
    }
  }

  return imports;
}

function isDesignSystemRuntimeModule(filePath: string): boolean {
  const relativePath = toRelative(filePath);
  return (
    relativePath === "src/main/agent-dashboard-design-system-runtime.ts" ||
    relativePath === "src/main/agent-monitor-listener.ts" ||
    relativePath.startsWith("src/main/collectors/") ||
    relativePath.startsWith("src/main/database/")
  );
}

test("boot files do not statically import design-system dashboard runtime modules", () => {
  assert.deepEqual(
    collectDesignSystemRuntimeImportViolations(bootEntries),
    [],
  );
});

test("design-system import graph guard rejects value imports used only as types", () => {
  const fixtureDir = fs.mkdtempSync(
    path.join(tmpdir(), "agent-dashboard-boundary-"),
  );
  const runtimeSpecifier = toImportSpecifier(
    fixtureDir,
    path.join(appDir, "src/main/agent-dashboard-design-system-runtime.js"),
  );
  const valueImportFixture = path.join(fixtureDir, "value-import.ts");
  const typeImportFixture = path.join(fixtureDir, "type-import.ts");

  try {
    fs.writeFileSync(
      valueImportFixture,
      [
        `import { AgentDashboardDesignSystemRuntime } from "${runtimeSpecifier}";`,
        "type Runtime = AgentDashboardDesignSystemRuntime;",
        "export type { Runtime };",
      ].join("\n"),
    );
    fs.writeFileSync(
      typeImportFixture,
      [
        `import type { AgentDashboardDesignSystemRuntime } from "${runtimeSpecifier}";`,
        "type Runtime = AgentDashboardDesignSystemRuntime;",
        "export type { Runtime };",
      ].join("\n"),
    );

    assert.deepEqual(
      collectDesignSystemRuntimeImportViolations(
        [typeImportFixture],
        [fixtureDir, srcDir],
      ),
      [],
    );
    assert.deepEqual(
      collectDesignSystemRuntimeImportViolations(
        [valueImportFixture],
        [fixtureDir, srcDir],
      ),
      [
        `${toRelative(valueImportFixture)} -> src/main/agent-dashboard-design-system-runtime.ts`,
      ],
    );
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

function collectDesignSystemRuntimeImportViolations(
  entries: string[],
  allowedRoots = [srcDir],
): string[] {
  const visited = new Set<string>();
  const queue = [...entries];
  const violations: string[] = [];

  while (queue.length > 0) {
    const filePath = queue.shift()!;
    if (visited.has(filePath) || !isInsideAnyRoot(filePath, allowedRoots)) {
      continue;
    }
    visited.add(filePath);

    for (const imported of staticValueImports(filePath)) {
      if (isDesignSystemRuntimeModule(imported)) {
        violations.push(`${toRelative(filePath)} -> ${toRelative(imported)}`);
        continue;
      }
      queue.push(imported);
    }
  }

  return violations;
}

function isInsideAnyRoot(filePath: string, roots: string[]): boolean {
  return roots.some((root) => {
    const relative = path.relative(root, filePath);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}

function toImportSpecifier(fromDir: string, targetJsPath: string): string {
  let specifier = path.relative(fromDir, targetJsPath).split(path.sep).join("/");
  if (!specifier.startsWith(".")) {
    specifier = `./${specifier}`;
  }
  return specifier;
}

test("PGlite dashboard side effects stay behind the Agent Dashboard runtime boundary", () => {
  const appSource = readSource("src/main/app.ts");
  const indexSource = readSource("src/main/index.ts");
  const preloadSource = readSource("src/main/preload.ts");
  const preloadCommonSource = readSource("src/main/preload-common.ts");
  const preloadDesignSystemSource = readSource("src/main/preload-design-system.ts");
  const windowSource = readSource("src/main/window.ts");

  assert.doesNotMatch(appSource, /ipcMain\.handle\("desktop:db:/);
  assert.match(
    appSource,
    /await import\(\s*"\.\/agent-dashboard-design-system-runtime\.js"\s*\)/,
  );
  assert.match(
    indexSource,
    /protocol\.registerSchemesAsPrivileged\(\[/,
  );
  assert.doesNotMatch(indexSource, /shouldRegisterDesignSystemScheme/);
  assert.doesNotMatch(preloadSource, /desktop:db:/);
  assert.doesNotMatch(preloadCommonSource, /desktop:db:/);
  assert.match(preloadSource, /exposeDesktopApi\(\)/);
  assert.match(preloadDesignSystemSource, /desktop:db:get-sessions/);
  assert.match(preloadDesignSystemSource, /desktop:db:changed/);
  assert.match(preloadDesignSystemSource, /desktop:db:get-core-features/);
  assert.match(preloadDesignSystemSource, /desktop:db:get-pull-requests/);
  assert.match(designSystemRuntimeSource(), /"agent-dashboard-ingest"/);
  assert.doesNotMatch(
    designSystemRuntimeSource(),
    /stateDir:[\s\S]*"agent-monitor"/,
  );
  assert.match(
    windowSource,
    /--closedloop-agent-dashboard-design-system/,
  );
  assert.match(windowSource, /preload-design-system\.js/);
  assert.match(windowSource, /DESIGN_RENDERER_URL/);
  assert.match(windowSource, /loadURL\(DESIGN_RENDERER_URL\)/);
  assert.doesNotMatch(windowSource, /agentDashboardMode/);
  assert.doesNotMatch(windowSource, /resolveLegacyRendererPath/);
  assert.doesNotMatch(windowSource, /loadFile\(rendererPath\)/);
  assert.match(designSystemRuntimeSource(), /ipcMain\.removeHandler\(channel\)/);
  const designSystemSource = designSystemRuntimeSource();
  const handlerRegistrationIndex = designSystemSource.indexOf(
    "registerIpcHandlers();",
  );
  const databaseReadyIndex = designSystemSource.indexOf(
    "const agentDatabase = await agentDatabasePromise;",
  );
  assert.ok(handlerRegistrationIndex >= 0);
  assert.ok(databaseReadyIndex >= 0);
  assert.ok(
    handlerRegistrationIndex < databaseReadyIndex,
    "design-system DB IPC handlers must be registered before awaiting PGlite startup",
  );
  assert.doesNotMatch(
    designSystemSource,
    /SELECT DISTINCT cwd[\s\S]*ORDER BY started_at/,
    "recent-projects query must stay valid for Postgres/PGlite",
  );
  assert.match(
    designSystemSource,
    /GROUP BY cwd[\s\S]*ORDER BY MAX\(started_at\) DESC NULLS LAST/,
  );
  assert.match(
    designSystemSource,
    /emit: \(sessionId\?: string\) => \{[\s\S]*agentDatabase\.sessions\.invalidateHistoricalDetails\(\);[\s\S]*desktop:db:changed/,
    "collector imports must invalidate historical details before notifying the renderer",
  );
  assert.match(
    appSource,
    /stopAgentCapture\(\{ closeDesignSystem: true \}\)/,
  );
  assert.doesNotMatch(appSource, /AgentMonitorSidecar/);
  assert.doesNotMatch(appSource, /reloadForAgentDashboardMode/);
});

function designSystemRuntimeSource(): string {
  return readSource("src/main/agent-dashboard-design-system-runtime.ts");
}

test("design-system BrowserWindow protocol and navigation guards are fail-closed", () => {
  const windowSource = readSource("src/main/window.ts");

  assert.match(windowSource, /request\.method !== "GET"/);
  assert.match(windowSource, /url\.hostname !== "renderer"/);
  assert.match(windowSource, /decodeURIComponent\(url\.pathname\)/);
  assert.match(windowSource, /startsWith\("\/design-system\/"\)/);
  assert.match(windowSource, /startsWith\("\/assets\/"\)/);
  assert.match(windowSource, /pathParts\.includes\("\.\."\)/);
  assert.match(windowSource, /APP_PROTOCOL_EXTENSIONS\.has\(ext\)/);
  assert.match(windowSource, /realpathSync\(assetRoot\)/);
  assert.match(windowSource, /statSync\(realFile\)\.isFile\(\)/);
  assert.match(windowSource, /isPathInside\(realFile, realRoot\)/);
  assert.match(windowSource, /new URL\(url\)\.href === this\.allowedRendererUrl/);
  assert.match(windowSource, /parsed\.protocol === "https:"/);
  assert.match(windowSource, /EXTERNAL_LINK_HOSTS\.has\(parsed\.hostname\)/);
  assert.doesNotMatch(windowSource, /parsed\.protocol === "file:"/);
  assert.doesNotMatch(
    windowSource,
    /parsed\.protocol === "app:" && parsed\.hostname === "renderer"/,
  );
  assert.doesNotMatch(
    windowSource,
    /parsed\.protocol === "http:" \|\| parsed\.protocol === "https:"/,
  );
});
