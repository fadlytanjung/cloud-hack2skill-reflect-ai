import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the build against depending on files that are not in the build context.
 *
 * `gcloud builds submit` derives its upload filter from `.gitignore` when no
 * `.gcloudignore` exists, and the Dockerfile copies only what that upload
 * contains. So a static import of a gitignored file resolves on the laptop that
 * has the file and fails everywhere else:
 *
 *   Could not resolve "../../firebase-applet-config.json"
 *   from "src/lib/firebaseConfig.ts"
 *
 * That is exactly how a Cloud Build broke, and the file in question was
 * gitignored because it had leaked an API key.
 */
const ROOT = process.cwd();

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

/** Relative specifiers from static imports and re-exports. */
function relativeSpecifiers(code: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /(?:^|\n)\s*import\s+[^;]*?from\s+["'](\.[^"']+)["']/g,
    /(?:^|\n)\s*import\s+["'](\.[^"']+)["']/g,
    /(?:^|\n)\s*export\s+[^;]*?from\s+["'](\.[^"']+)["']/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) specs.push(m[1]);
  }
  return specs;
}

function isGitIgnored(path: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", path], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Resolves a specifier the way the bundler would, trying the usual extensions. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.json`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const c of candidates) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

const files = sourceFiles(join(ROOT, "src"));

describe("build integrity", () => {
  it("finds source files to check", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("no source file statically imports a gitignored file", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const code = readFileSync(file, "utf8");
      for (const spec of relativeSpecifiers(code)) {
        const target = resolveSpecifier(file, spec);
        if (!target) continue;
        if (isGitIgnored(target)) {
          offenders.push(`${relative(ROOT, file)} imports gitignored ${relative(ROOT, target)}`);
        }
      }
    }

    // A gitignored file is absent from the Cloud Build upload, so the bundle
    // cannot be produced anywhere but the machine that happens to have it.
    expect(offenders).toEqual([]);
  });

  it("every relative import actually resolves", () => {
    const broken: string[] = [];
    for (const file of files) {
      const code = readFileSync(file, "utf8");
      for (const spec of relativeSpecifiers(code)) {
        if (resolveSpecifier(file, spec) === null) {
          broken.push(`${relative(ROOT, file)} → ${spec}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});

describe("Dockerfile build context", () => {
  const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");

  /** COPY sources in the runner stages, ignoring --from=<stage> copies. */
  function copySources(): string[] {
    const out: string[] = [];
    for (const line of dockerfile.split("\n")) {
      const m = /^\s*COPY\s+(?!--from=)(.+)$/.exec(line);
      if (!m) continue;
      const parts = m[1].trim().split(/\s+/);
      // The last token is the destination.
      out.push(...parts.slice(0, -1));
    }
    return out;
  }

  it("every COPY source exists and is in the build context", () => {
    const offenders: string[] = [];
    for (const src of copySources()) {
      if (src === ".") continue;
      // A wildcard COPY that matches nothing is a hard error in Docker's
      // builder ("no source files were specified"), so an optional-looking
      // `foo*` is not optional at all.
      const literal = src.replace(/\*$/, "");
      let exists = false;
      try {
        exists = statSync(join(ROOT, literal)).isFile();
      } catch {
        exists = false;
      }
      if (!exists) {
        offenders.push(`COPY ${src} — no such file`);
      } else if (isGitIgnored(join(ROOT, literal))) {
        // gcloud builds submit derives its upload filter from .gitignore.
        offenders.push(`COPY ${src} — gitignored, so absent from the build context`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not copy the applet config into the image", () => {
    expect(dockerfile).not.toMatch(/^\s*COPY\s+firebase-applet-config/m);
  });
});

describe("firebaseConfig resolution", () => {
  const source = readFileSync(join(ROOT, "src/lib/firebaseConfig.ts"), "utf8");

  it("does not import the applet config file", () => {
    // It is gitignored, and it is the file that leaked an API key.
    expect(source).not.toMatch(/from\s+["'][^"']*firebase-applet-config\.json["']/);
  });

  it("prefers the runtime config the server injects", () => {
    // Production has no .env at build time, so import.meta.env is empty there;
    // window.__FIREBASE_CONFIG__ is what actually carries the config.
    expect(source).toContain("__FIREBASE_CONFIG__");
    const runtimeAt = source.indexOf("runtimeConfig.apiKey");
    const envAt = source.indexOf("VITE_FIREBASE_API_KEY");
    expect(runtimeAt).toBeGreaterThan(-1);
    expect(runtimeAt).toBeLessThan(envAt);
  });

  it("still falls back to Vite env vars for local development", () => {
    expect(source).toContain("import.meta.env.VITE_FIREBASE_API_KEY");
  });
});
