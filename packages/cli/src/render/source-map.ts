/**
 * Best-effort route→file mapping (PRD E1.4 FR-1): for a page URL, candidates
 * are the route path EXACT, `path.*`, and `path/index.*` over the documented
 * extension set — resolved against the files matched by the user's glob.
 * EXACTLY ONE candidate wins; zero or many → undefined (the result stays
 * URL-only, never guessed — P-Honest).
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const EXTENSIONS = ['.astro', '.html', '.md', '.mdx'] as const;

/** Tiny glob→RegExp translator supporting the documented subset: `**`, `*`, literal. */
export const globToRegExp = (glob: string): RegExp => {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i]!;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // `**` — any path segments (also swallow a following `/`)
        re += '.*';
        i += 2;
        if (glob[i] === '/') i += 1;
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else {
      re += ch.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
};

const walkFiles = (root: string): string[] => {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) visit(p);
      else out.push(p);
    }
  };
  visit(root);
  return out;
};

export type RouteFileMap = (url: string) => string | undefined;

/**
 * Builds the mapper: `glob` is relative to `root` (default cwd). Returns a
 * function mapping a page URL to a repo-relative file path when EXACTLY ONE
 * candidate exists.
 */
export const buildRouteFileMap = (glob: string, root = process.cwd()): RouteFileMap => {
  const re = globToRegExp(glob.startsWith('/') ? glob.slice(1) : glob);
  const files = walkFiles(root).map((p) => relative(root, p).split('\\').join('/'));
  // Route paths are route-relative while files are glob-relative — candidates
  // match on the file's path SUFFIX; the glob still scopes eligibility.
  const matchSuffix = (f: string, suffix: string): boolean => re.test(f) && (f === suffix || f.endsWith(`/${suffix}`));
  const candidatesFor = (routePath: string): string[] => {
    const path = routePath.replace(/^\/+/, '').replace(/\/+$/, '');
    if (path === '') {
      // the site root maps to index files
      return files.filter((f) => EXTENSIONS.some((e) => matchSuffix(f, `index${e}`)));
    }
    const exact = files.filter((f) => matchSuffix(f, path));
    const suffixed = files.filter((f) => EXTENSIONS.some((e) => matchSuffix(f, `${path}${e}`)));
    const indexed = files.filter((f) => EXTENSIONS.some((e) => matchSuffix(f, `${path}/index${e}`)));
    return [...new Set([...exact, ...suffixed, ...indexed])];
  };
  return (url: string): string | undefined => {
    try {
      const routePath = new URL(url).pathname;
      const candidates = candidatesFor(routePath);
      return candidates.length === 1 ? candidates[0] : undefined;
    } catch {
      return undefined;
    }
  };
};
