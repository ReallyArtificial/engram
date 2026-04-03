#!/usr/bin/env node
import * as p from '@clack/prompts';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { detectEnvironment, maskKey } from '../src/cli/detect.js';
import { testConnection } from '../src/cli/test-connection.js';
import type { ProviderConfig } from '../src/providers/defaults.js';

function isCancel(value: unknown): value is symbol {
  return p.isCancel(value);
}

async function main() {
  p.intro('engram v0.1.0');

  // ── Step 1: Detect environment ──────────────────────────────────────
  const detectSpinner = p.spinner();
  detectSpinner.start('Detecting your environment...');

  const env = await detectEnvironment();

  detectSpinner.stop('Environment detected');

  // Display detection results
  const detectionLines: string[] = [];

  if (env.openaiKey) {
    detectionLines.push(`\x1b[32m+\x1b[0m OpenAI API key found`);
  } else {
    detectionLines.push(`\x1b[2m-\x1b[0m OpenAI API key not set`);
  }

  if (env.ollamaRunning) {
    const modelNames = env.ollamaModels.map((m) => m.name).join(', ');
    detectionLines.push(
      `\x1b[32m+\x1b[0m Ollama running${modelNames ? ` (${modelNames})` : ''}`,
    );
  } else {
    detectionLines.push(`\x1b[2m-\x1b[0m Ollama not detected`);
  }

  if (env.anthropicKey) {
    detectionLines.push(`\x1b[32m+\x1b[0m Anthropic API key found`);
  } else {
    detectionLines.push(`\x1b[2m-\x1b[0m Anthropic API key not set`);
  }

  if (env.claudeCliVersion) {
    detectionLines.push(
      `\x1b[32m+\x1b[0m Claude Code CLI (${env.claudeCliVersion})`,
    );
  } else {
    detectionLines.push(`\x1b[2m-\x1b[0m Claude Code CLI not found`);
  }

  if (env.existingRegistration) {
    detectionLines.push(`\x1b[33m!\x1b[0m engram already registered with Claude Code`);
  }

  if (env.existingDbPath) {
    detectionLines.push(`\x1b[32m+\x1b[0m Existing database at ${env.existingDbPath}`);
  }

  p.note(detectionLines.join('\n'), 'Detection results');

  // ── Handle existing registration ────────────────────────────────────
  if (env.existingRegistration) {
    const reconfigure = await p.confirm({
      message: 'engram is already registered. Reconfigure?',
      initialValue: false,
    });
    if (isCancel(reconfigure)) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }
    if (!reconfigure) {
      p.outro('engram is already configured. No changes made.');
      process.exit(0);
    }
  }

  // ── Step 2: Choose provider ─────────────────────────────────────────
  const providerOptions: {
    value: string;
    label: string;
    hint?: string;
  }[] = [];

  if (env.openaiKey) {
    providerOptions.push({
      value: 'openai',
      label: 'OpenAI',
      hint: 'gpt-4o-mini + text-embedding-3-small (key detected)',
    });
  } else {
    providerOptions.push({
      value: 'openai',
      label: 'OpenAI',
      hint: 'gpt-4o-mini + text-embedding-3-small',
    });
  }

  providerOptions.push({
    value: 'anthropic',
    label: 'Anthropic',
    hint: 'Claude for LLM, OpenAI for embeddings',
  });

  if (env.ollamaRunning) {
    providerOptions.push({
      value: 'ollama',
      label: 'Ollama',
      hint: 'Fully local, no API key needed',
    });
  } else {
    providerOptions.push({
      value: 'ollama',
      label: 'Ollama',
      hint: 'Fully local (not detected — run `ollama serve`)',
    });
  }

  const provider = await p.select({
    message: 'Which AI provider should engram use?',
    options: providerOptions,
  });

  if (isCancel(provider)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  // ── Step 3: API key handling ────────────────────────────────────────
  const envVars: Record<string, string> = {};
  const providerConfig: ProviderConfig = {
    provider: provider as 'openai' | 'anthropic' | 'ollama',
  };

  if (provider === 'openai' || provider === 'anthropic') {
    // OpenAI key needed for both (embeddings)
    let openaiKey = env.openaiKey;
    if (openaiKey) {
      const useExisting = await p.confirm({
        message: `Use OpenAI key from environment? (${maskKey(openaiKey)})`,
        initialValue: true,
      });
      if (isCancel(useExisting)) {
        p.cancel('Setup cancelled.');
        process.exit(0);
      }
      if (!useExisting) {
        openaiKey = null;
      }
    }

    if (!openaiKey) {
      const keyInput = await p.text({
        message: 'Enter your OpenAI API key:',
        placeholder: 'sk-...',
        validate: (val) => {
          if (!val.trim()) return 'API key is required';
          return undefined;
        },
      });
      if (isCancel(keyInput)) {
        p.cancel('Setup cancelled.');
        process.exit(0);
      }
      openaiKey = keyInput;
    }

    envVars['OPENAI_API_KEY'] = openaiKey;
    process.env.OPENAI_API_KEY = openaiKey;
  }

  if (provider === 'anthropic') {
    let anthropicKey = env.anthropicKey;
    if (anthropicKey) {
      const useExisting = await p.confirm({
        message: `Use Anthropic key from environment? (${maskKey(anthropicKey)})`,
        initialValue: true,
      });
      if (isCancel(useExisting)) {
        p.cancel('Setup cancelled.');
        process.exit(0);
      }
      if (!useExisting) {
        anthropicKey = null;
      }
    }

    if (!anthropicKey) {
      const keyInput = await p.text({
        message: 'Enter your Anthropic API key:',
        placeholder: 'sk-ant-...',
        validate: (val) => {
          if (!val.trim()) return 'API key is required';
          return undefined;
        },
      });
      if (isCancel(keyInput)) {
        p.cancel('Setup cancelled.');
        process.exit(0);
      }
      anthropicKey = keyInput;
    }

    envVars['ANTHROPIC_API_KEY'] = anthropicKey;
    process.env.ANTHROPIC_API_KEY = anthropicKey;
  }

  // ── Step 4: Database path ───────────────────────────────────────────
  const defaultDbPath =
    env.existingDbPath ?? join(homedir(), '.engram', 'memory.sqlite');

  const dbPath = await p.text({
    message: 'Database path',
    initialValue: defaultDbPath,
    placeholder: defaultDbPath,
  });

  if (isCancel(dbPath)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  // ── Step 5: Advanced settings ───────────────────────────────────────
  let embeddingModel: string | undefined;
  let languageModel: string | undefined;
  let autoReflect = true;
  let skipEvidenceEval = false;

  const showAdvanced = await p.confirm({
    message: 'Configure advanced settings?',
    initialValue: false,
  });

  if (isCancel(showAdvanced)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  if (showAdvanced) {
    const embModelDefaults: Record<string, string> = {
      openai: 'text-embedding-3-small',
      anthropic: 'text-embedding-3-small',
      ollama: 'nomic-embed-text',
    };

    const langModelDefaults: Record<string, string> = {
      openai: 'gpt-4o-mini',
      anthropic: 'claude-sonnet-4-5-20250929',
      ollama: 'llama3.2',
    };

    const embInput = await p.text({
      message: 'Embedding model',
      initialValue: embModelDefaults[provider as string],
    });
    if (isCancel(embInput)) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }
    embeddingModel = embInput;

    const langInput = await p.text({
      message: 'Language model',
      initialValue: langModelDefaults[provider as string],
    });
    if (isCancel(langInput)) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }
    languageModel = langInput;

    const reflectInput = await p.confirm({
      message: 'Enable auto-reflect? (synthesizes observations after ingestion)',
      initialValue: true,
    });
    if (isCancel(reflectInput)) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }
    autoReflect = reflectInput;

    const evidenceInput = await p.confirm({
      message: 'Skip evidence evaluation? (faster, less accurate confidence)',
      initialValue: false,
    });
    if (isCancel(evidenceInput)) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }
    skipEvidenceEval = evidenceInput;
  }

  providerConfig.embeddingModel = embeddingModel;
  providerConfig.languageModel = languageModel;

  // ── Step 6: Test connection ─────────────────────────────────────────
  const shouldTest = await p.confirm({
    message: 'Test connection before registering?',
    initialValue: true,
  });

  if (isCancel(shouldTest)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  if (shouldTest) {
    const testSpinner = p.spinner();
    testSpinner.start('Testing connection...');

    const testResult = await testConnection(providerConfig);

    if (testResult.embedding.ok && testResult.llm.ok) {
      testSpinner.stop('Connection successful');
      p.note(
        [
          `\x1b[32m+\x1b[0m Embedding model responded (${testResult.embedding.latencyMs}ms)`,
          `\x1b[32m+\x1b[0m Language model responded (${testResult.llm.latencyMs}ms)`,
        ].join('\n'),
        'Test results',
      );
    } else {
      testSpinner.stop('Connection test had issues');
      const lines: string[] = [];
      if (testResult.embedding.ok) {
        lines.push(
          `\x1b[32m+\x1b[0m Embedding model responded (${testResult.embedding.latencyMs}ms)`,
        );
      } else {
        lines.push(
          `\x1b[31mx\x1b[0m Embedding model failed: ${testResult.embedding.error}`,
        );
      }
      if (testResult.llm.ok) {
        lines.push(
          `\x1b[32m+\x1b[0m Language model responded (${testResult.llm.latencyMs}ms)`,
        );
      } else {
        lines.push(
          `\x1b[31mx\x1b[0m Language model failed: ${testResult.llm.error}`,
        );
      }
      p.note(lines.join('\n'), 'Test results');

      const continueAnyway = await p.confirm({
        message: 'Continue with registration anyway?',
        initialValue: false,
      });
      if (isCancel(continueAnyway)) {
        p.cancel('Setup cancelled.');
        process.exit(0);
      }
      if (!continueAnyway) {
        p.cancel('Setup cancelled. Fix the connection issues and try again.');
        process.exit(1);
      }
    }
  }

  // ── Step 7: Register with Claude Code ───────────────────────────────
  if (!env.claudeCliVersion) {
    const mcpCmd = buildManualCommand(
      provider as string,
      dbPath,
      envVars,
      embeddingModel,
      languageModel,
      autoReflect,
      skipEvidenceEval,
      'user',
    );
    p.note(
      [
        'Claude Code CLI was not detected.',
        'Install it from: https://docs.anthropic.com/en/docs/claude-code',
        '',
        'Then register engram manually:',
        '',
        mcpCmd,
      ].join('\n'),
      'Manual registration',
    );
    p.outro('engram setup complete (manual registration needed).');
    process.exit(0);
  }

  const registerScope = await p.select({
    message: 'Register engram with Claude Code?',
    options: [
      {
        value: 'user',
        label: 'Yes, for all projects (user scope)',
        hint: 'Recommended',
      },
      {
        value: 'project',
        label: 'Yes, for this project only',
      },
      {
        value: 'skip',
        label: "No, I'll configure manually",
      },
    ],
  });

  if (isCancel(registerScope)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  if (registerScope === 'skip') {
    const mcpCmd = buildManualCommand(
      provider as string,
      dbPath,
      envVars,
      embeddingModel,
      languageModel,
      autoReflect,
      skipEvidenceEval,
      'user',
    );
    p.note(
      ['Register manually when ready:', '', mcpCmd].join('\n'),
      'Manual registration',
    );
    p.outro('engram setup complete.');
    process.exit(0);
  }

  // Remove existing registration if reconfiguring
  if (env.existingRegistration) {
    try {
      execSync('claude mcp remove engram', {
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      // Ignore — may not exist
    }
  }

  const registerSpinner = p.spinner();
  registerSpinner.start('Registering with Claude Code...');

  try {
    const cmd = buildClaudeCommand(
      provider as string,
      dbPath,
      envVars,
      embeddingModel,
      languageModel,
      autoReflect,
      skipEvidenceEval,
      registerScope as string,
    );

    execSync(cmd, {
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    registerSpinner.stop(
      `engram registered (${registerScope === 'user' ? 'user' : 'project'} scope)`,
    );
  } catch (err) {
    registerSpinner.stop('Registration failed');
    const msg = err instanceof Error ? err.message : String(err);
    p.log.error(`Failed to register: ${msg}`);

    const mcpCmd = buildManualCommand(
      provider as string,
      dbPath,
      envVars,
      embeddingModel,
      languageModel,
      autoReflect,
      skipEvidenceEval,
      registerScope as string,
    );
    p.note(
      ['Try registering manually:', '', mcpCmd].join('\n'),
      'Fallback',
    );
  }

  // ── Done ────────────────────────────────────────────────────────────
  p.note(
    [
      'Start a new Claude Code session and try:',
      '',
      '  "Remember that I prefer TypeScript with strict mode"',
      '  "What do you remember about my preferences?"',
    ].join('\n'),
    'Next steps',
  );

  p.outro('engram is ready!');
}

// ── Helpers ───────────────────────────────────────────────────────────

function buildEnvFlags(
  provider: string,
  dbPath: string,
  apiKeys: Record<string, string>,
  embeddingModel?: string,
  languageModel?: string,
  autoReflect?: boolean,
  skipEvidenceEval?: boolean,
): string[] {
  const flags: string[] = [];

  flags.push(`-e ENGRAM_PROVIDER=${provider}`);
  flags.push(`-e ENGRAM_DB_PATH=${dbPath}`);

  for (const [key, val] of Object.entries(apiKeys)) {
    flags.push(`-e ${key}=${val}`);
  }

  if (embeddingModel) {
    flags.push(`-e ENGRAM_EMBEDDING_MODEL=${embeddingModel}`);
  }
  if (languageModel) {
    flags.push(`-e ENGRAM_LANGUAGE_MODEL=${languageModel}`);
  }
  if (autoReflect === false) {
    flags.push(`-e ENGRAM_AUTO_REFLECT=false`);
  }
  if (skipEvidenceEval === true) {
    flags.push(`-e ENGRAM_SKIP_EVIDENCE_EVAL=true`);
  }

  return flags;
}

function buildClaudeCommand(
  provider: string,
  dbPath: string,
  apiKeys: Record<string, string>,
  embeddingModel?: string,
  languageModel?: string,
  autoReflect?: boolean,
  skipEvidenceEval?: boolean,
  scope?: string,
): string {
  const envFlags = buildEnvFlags(
    provider,
    dbPath,
    apiKeys,
    embeddingModel,
    languageModel,
    autoReflect,
    skipEvidenceEval,
  );

  const scopeFlag = scope === 'project' ? '-s project' : '-s user';

  return [
    'claude mcp add engram',
    scopeFlag,
    ...envFlags,
    '-- npx engram-mcp',
  ].join(' ');
}

function buildManualCommand(
  provider: string,
  dbPath: string,
  apiKeys: Record<string, string>,
  embeddingModel?: string,
  languageModel?: string,
  autoReflect?: boolean,
  skipEvidenceEval?: boolean,
  scope?: string,
): string {
  const envFlags = buildEnvFlags(
    provider,
    dbPath,
    apiKeys,
    embeddingModel,
    languageModel,
    autoReflect,
    skipEvidenceEval,
  );

  const scopeFlag = scope === 'project' ? '-s project' : '-s user';

  return [
    'claude mcp add engram',
    scopeFlag,
    ...envFlags,
    '-- npx engram-mcp',
  ].join(' \\\n  ');
}

main().catch((err) => {
  p.cancel('An unexpected error occurred.');
  console.error(err);
  process.exit(1);
});
