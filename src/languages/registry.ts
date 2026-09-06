/**
 * The one place languages are listed. Adding a language is one import and
 * one entry here. Everything above the contract asks this registry and
 * never names a language itself.
 */
import { LanguagePlugin } from './types';
import { pythonPlugin } from './python';
import { typescriptPlugin } from './typescript';

const PLUGINS: LanguagePlugin[] = [typescriptPlugin, pythonPlugin];

export function allPlugins(): LanguagePlugin[] {
  return [...PLUGINS];
}

export function pluginById(id: string): LanguagePlugin | undefined {
  return PLUGINS.find((p) => p.id === id);
}

/** The plugin that measures a given VS Code language id, if any. */
export function pluginForLanguageId(languageId: string): LanguagePlugin | undefined {
  return PLUGINS.find((p) => p.vscodeLanguageIds.includes(languageId));
}

/** The plugin that owns a file extension (with the dot), if any. */
export function pluginForExtension(ext: string): LanguagePlugin | undefined {
  const lower = ext.toLowerCase();
  return PLUGINS.find((p) => p.extensions.includes(lower));
}

export function supportedIds(): string[] {
  return PLUGINS.map((p) => p.id);
}
