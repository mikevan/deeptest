/**
 * Guesses the workspace's main language by counting source files. The
 * result pre-fills the configuration screen; the user always has the last
 * word. Language ids match VS Code's, so the active editor's languageId can
 * be compared against them directly.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { supportedIds } from '../languages/registry';

const EXTENSIONS: Record<string, string> = {
  '.py': 'python',
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.vue': 'typescript',
  '.svelte': 'typescript',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.c': 'c',
  '.h': 'c',
  '.ino': 'cpp',
  '.java': 'java',
  '.cs': 'csharp',
  '.go': 'go',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.php': 'php',
  '.kt': 'kotlin',
  '.swift': 'swift',
};

const SKIP = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'env', 'site-packages', '.tox', 'build', 'dist', 'out', '.deeptest', 'target', 'bin', 'obj', '.pio', '.pioarduino']);

export const SUPPORTED_LANGUAGES: string[] = supportedIds();

export interface LanguageGuess {
  language: string;
  files: number;
}

export function countLanguages(root: string, maxDepth = 6): LanguageGuess[] {
  const counts = new Map<string, number>();
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name) && !entry.name.startsWith('.')) {
          walk(path.join(dir, entry.name), depth + 1);
        }
      } else if (entry.isFile()) {
        const lang = EXTENSIONS[path.extname(entry.name).toLowerCase()];
        if (lang) {
          counts.set(lang, (counts.get(lang) ?? 0) + 1);
        }
      }
    }
  };
  walk(root, 0);
  return Array.from(counts.entries())
    .map(([language, files]) => ({ language, files }))
    .sort((a, b) => b.files - a.files || a.language.localeCompare(b.language));
}

/**
 * Best guess, preferring the active editor's language when it is one the
 * workspace actually contains.
 */
export function guessLanguage(root: string, activeLanguageId?: string): LanguageGuess | undefined {
  const guesses = countLanguages(root);
  if (activeLanguageId) {
    const active = guesses.find((g) => g.language === activeLanguageId);
    if (active) {
      return active;
    }
  }
  return guesses[0];
}
