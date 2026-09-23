/**
 * Which JavaScript framework a project uses, and how its tests are run,
 * read from package.json and the config files beside it. Detection only:
 * nothing here runs anything. The plugin uses the answer to say the right
 * sentence on the setup screen, to refuse advice that would harm the
 * project ("Install Vitest" into a Karma project), and, from 1.0.4, to
 * pick the driver.
 *
 * Angular is the special case. Its tests run through the Angular CLI's
 * unit-test builder (`ng test`), never through the vitest or karma
 * binaries directly, and angular.json says which runner sits under the
 * builder. Both the Vitest and the Karma flavours go through that one
 * builder ("runner": "karma" in angular.json for the latter).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export type FrameworkName = 'React' | 'Vue' | 'Svelte' | 'Angular';

export interface Framework {
  name: FrameworkName;
  /** Major version from package.json, when it can be read ("3" for vue ^3.5.0). */
  major?: string;
  /** The config file that confirmed it, workspace-relative, when one exists. */
  configFile?: string;
  /** Angular only: the runner under the ng test builder, from angular.json. */
  angularRunner?: 'vitest' | 'karma';
  /** Angular only: the unit-test builder DeepTest drives, or the older devkit Karma builder it does not. */
  angularBuilder?: 'unit-test' | 'legacy-karma';
}

const CONFIG_FILES: Record<FrameworkName, string[]> = {
  React: ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'next.config.js', 'next.config.mjs', 'next.config.ts'],
  Vue: ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'nuxt.config.ts', 'nuxt.config.js', 'vue.config.js'],
  Svelte: ['svelte.config.js', 'svelte.config.ts', 'svelte.config.mjs', 'vite.config.ts', 'vite.config.js', 'vite.config.mjs'],
  Angular: ['angular.json'],
};

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function majorOf(range: unknown): string | undefined {
  return typeof range === 'string' ? /(\d+)/.exec(range)?.[1] : undefined;
}

/** The runner under Angular's unit-test builder, or undefined when angular.json does not use that builder. */
export function detectAngularRunner(workspaceRoot: string): 'vitest' | 'karma' | undefined {
  const angular = readJson(path.join(workspaceRoot, 'angular.json'));
  const projects = angular?.projects as Record<string, { architect?: Record<string, { builder?: string; options?: { runner?: string } }> }> | undefined;
  for (const project of Object.values(projects ?? {})) {
    const test = project.architect?.test;
    if (!test) {
      continue;
    }
    if (test.builder === '@angular/build:unit-test') {
      return test.options?.runner === 'karma' ? 'karma' : 'vitest';
    }
    if (test.builder === '@angular-devkit/build-angular:karma') {
      return 'karma';
    }
  }
  return undefined;
}

/** Which test builder angular.json names, or undefined when it names neither. */
export function detectAngularBuilder(workspaceRoot: string): 'unit-test' | 'legacy-karma' | undefined {
  const angular = readJson(path.join(workspaceRoot, 'angular.json'));
  const projects = angular?.projects as Record<string, { architect?: Record<string, { builder?: string }> }> | undefined;
  for (const project of Object.values(projects ?? {})) {
    const builder = project.architect?.test?.builder;
    if (builder === '@angular/build:unit-test') {
      return 'unit-test';
    }
    if (builder === '@angular-devkit/build-angular:karma') {
      return 'legacy-karma';
    }
  }
  return undefined;
}

/** The framework, from dependencies first and config files second; undefined for a plain project. */
export function detectFramework(workspaceRoot: string): Framework | undefined {
  const pkg = readJson(path.join(workspaceRoot, 'package.json'));
  const deps = { ...(pkg?.dependencies as Record<string, string> | undefined), ...(pkg?.devDependencies as Record<string, string> | undefined) };
  const found = (name: FrameworkName, major: string | undefined): Framework => {
    const configFile = CONFIG_FILES[name].find((f) => fs.existsSync(path.join(workspaceRoot, f)));
    const framework: Framework = { name, major, configFile };
    if (name === 'Angular') {
      framework.angularRunner = detectAngularRunner(workspaceRoot);
      framework.angularBuilder = detectAngularBuilder(workspaceRoot);
    }
    return framework;
  };
  if (deps['@angular/core']) {
    return found('Angular', majorOf(deps['@angular/core']));
  }
  if (deps.svelte) {
    return found('Svelte', majorOf(deps.svelte));
  }
  if (deps.vue) {
    return found('Vue', majorOf(deps.vue));
  }
  if (deps.react) {
    return found('React', majorOf(deps.react));
  }
  return undefined;
}

/** "Vue 3 with Vitest." / "Angular 22, tests through ng test with Karma." / "React 19." */
export function frameworkSentence(framework: Framework, runner: string | undefined): string {
  const name = framework.major ? `${framework.name} ${framework.major}` : framework.name;
  if (framework.name === 'Angular') {
    return framework.angularRunner
      ? `${name}, tests through ng test with ${framework.angularRunner === 'karma' ? 'Karma' : 'Vitest'}.`
      : `${name}.`;
  }
  return runner ? `${name} with ${runner === 'jest' ? 'Jest' : 'Vitest'}.` : `${name}.`;
}

/**
 * The Vitest config the builder would load for `ng test`: the test
 * target's `runnerConfig` when it names a file, or the default
 * vitest-base.config.* beside angular.json when it is true or absent and
 * one exists. Undefined when the builder would run with no external
 * config, which is the common case.
 */
export function detectAngularRunnerConfig(workspaceRoot: string): string | undefined {
  const angular = readJson(path.join(workspaceRoot, 'angular.json'));
  const projects = angular?.projects as Record<string, { architect?: Record<string, { builder?: string; options?: { runnerConfig?: string | boolean } }> }> | undefined;
  let setting: string | boolean | undefined;
  for (const project of Object.values(projects ?? {})) {
    const test = project.architect?.test;
    if (test?.builder === '@angular/build:unit-test') {
      setting = test.options?.runnerConfig;
      break;
    }
  }
  if (typeof setting === 'string') {
    return fs.existsSync(path.join(workspaceRoot, setting)) ? setting : undefined;
  }
  if (setting === false) {
    return undefined;
  }
  return ['vitest-base.config.ts', 'vitest-base.config.mts', 'vitest-base.config.js', 'vitest-base.config.mjs'].find((f) => fs.existsSync(path.join(workspaceRoot, f)));
}

/**
 * The Karma config the builder would load for `ng test` with Karma: the
 * test target's `runnerConfig` when it names a file, or karma.conf.js in
 * the project root when it is true and one exists. The builder applies its
 * built-in defaults only when no file is given, so the generated config
 * has to know which case it is in.
 */
export function detectAngularKarmaConfig(workspaceRoot: string): string | undefined {
  const angular = readJson(path.join(workspaceRoot, 'angular.json'));
  const projects = angular?.projects as Record<string, { root?: string; architect?: Record<string, { builder?: string; options?: { runnerConfig?: string | boolean; karmaConfig?: string } }> }> | undefined;
  for (const project of Object.values(projects ?? {})) {
    const test = project.architect?.test;
    if (!test) {
      continue;
    }
    if (test.builder === '@angular/build:unit-test') {
      const setting = test.options?.runnerConfig;
      if (typeof setting === 'string') {
        return fs.existsSync(path.join(workspaceRoot, setting)) ? setting : undefined;
      }
      if (setting === true) {
        const candidate = path.join(project.root ?? '', 'karma.conf.js').split(path.sep).join('/');
        return fs.existsSync(path.join(workspaceRoot, candidate)) ? candidate : undefined;
      }
      return undefined;
    }
    if (test.builder === '@angular-devkit/build-angular:karma') {
      const setting = test.options?.karmaConfig;
      return typeof setting === 'string' && fs.existsSync(path.join(workspaceRoot, setting)) ? setting : undefined;
    }
  }
  return undefined;
}


/**
 * The Angular project using the unit-test builder, and the tsconfig that
 * builder type-checks tests under.
 *
 * It lives in Witness from 1.0.19, because UntangleIt's recorded runs point
 * the same builder at the same kind of shadow tree and need the same answer.
 * Re-exported here so this module stays the one place the drivers ask about
 * Angular.
 */
export { detectAngularTestTarget } from '@projectrevivesolutions/witness';
export type { AngularTestTarget } from '@projectrevivesolutions/witness';
