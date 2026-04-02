import { EventEmitter } from 'node:events';
import { MemoryStore } from './store/store.js';
import { RetainPipeline } from './pipelines/retain.js';
import { RecallPipeline } from './pipelines/recall.js';
import { ReflectPipeline } from './pipelines/reflect.js';
import type { EmbeddingProvider, LLMProvider } from './providers/types.js';
import type {
  EngramConfig,
  EngramEvents,
  EngramStats,
  BankConfig,
  RetainInput,
  RetainDirectInput,
  RetainResult,
  RecallInput,
  RecallResult,
  ReflectInput,
  ReflectResult,
  ForgetInput,
  ForgetResult,
} from './types.js';

const DEFAULT_CONFIG: Required<EngramConfig> = {
  dbPath: ':memory:',
  defaultBankId: 'default',
  defaultBankName: 'Default',
  reflectThreshold: 20,
  reflectInterval: 24 * 60 * 60 * 1000,
  autoReflect: true,
  skipEvidenceEvaluation: false,
  reflectMaxClusters: 0,
};

export class Engram extends EventEmitter<EngramEvents> {
  private store: MemoryStore;
  private retainPipeline: RetainPipeline;
  private recallPipeline: RecallPipeline;
  private reflectPipeline: ReflectPipeline;
  private config: Required<EngramConfig>;

  constructor(
    config: EngramConfig,
    embedding: EmbeddingProvider,
    llm: LLMProvider,
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.store = new MemoryStore(this.config.dbPath, embedding.dimensions);

    // Ensure default bank exists
    this.store.ensureBank(
      this.config.defaultBankId,
      this.config.defaultBankName,
    );

    this.retainPipeline = new RetainPipeline(this.store, embedding, llm, {
      skipEvidenceEvaluation: this.config.skipEvidenceEvaluation,
    });
    this.recallPipeline = new RecallPipeline(this.store, embedding);
    this.reflectPipeline = new ReflectPipeline(
      this.store,
      embedding,
      llm,
      this.config.reflectThreshold,
      this.config.reflectInterval,
      this.config.reflectMaxClusters,
    );
  }

  async retain(input: RetainInput): Promise<RetainResult> {
    const resolvedInput = {
      ...input,
      bankId: input.bankId ?? this.config.defaultBankId,
    };

    this.emit('retain:start', resolvedInput);

    try {
      // Opportunistic prune of expired facts
      const expiredIds = this.store.getExpiredFactIds(resolvedInput.bankId);
      if (expiredIds.length > 0) {
        this.store.deleteFactsBatch(expiredIds);
      }

      const result = await this.retainPipeline.execute(resolvedInput);
      this.emit('retain:complete', result);

      // Check auto-reflect
      if (this.config.autoReflect) {
        const check = this.reflectPipeline.shouldTrigger(
          resolvedInput.bankId,
        );
        if (check.should) {
          this.emit('reflect:trigger', resolvedInput.bankId, check.reason);
          // Fire-and-forget
          this.reflect({ bankId: resolvedInput.bankId }).catch(() => {});
        }
      }

      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('retain:error', error);
      throw error;
    }
  }

  async retainDirect(input: RetainDirectInput): Promise<RetainResult> {
    const resolvedInput = {
      ...input,
      bankId: input.bankId ?? this.config.defaultBankId,
    };

    this.emit('retain-direct:start', resolvedInput);

    try {
      // Opportunistic prune of expired facts
      const expiredIds = this.store.getExpiredFactIds(resolvedInput.bankId);
      if (expiredIds.length > 0) {
        this.store.deleteFactsBatch(expiredIds);
      }

      const result = await this.retainPipeline.executeDirect(resolvedInput);
      this.emit('retain-direct:complete', result);

      // Check auto-reflect
      if (this.config.autoReflect) {
        const check = this.reflectPipeline.shouldTrigger(
          resolvedInput.bankId,
        );
        if (check.should) {
          this.emit('reflect:trigger', resolvedInput.bankId, check.reason);
          this.reflect({ bankId: resolvedInput.bankId }).catch(() => {});
        }
      }

      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('retain-direct:error', error);
      throw error;
    }
  }

  async recall(input: RecallInput): Promise<RecallResult> {
    const resolvedInput = {
      ...input,
      bankId: input.bankId ?? this.config.defaultBankId,
    };

    this.emit('recall:start', resolvedInput);

    try {
      const result = await this.recallPipeline.execute(resolvedInput);
      this.emit('recall:complete', result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('recall:error', error);
      throw error;
    }
  }

  async reflect(input: ReflectInput = {}): Promise<ReflectResult> {
    const resolvedInput = {
      ...input,
      bankId: input.bankId ?? this.config.defaultBankId,
    };

    this.emit('reflect:start', resolvedInput);

    try {
      const result = await this.reflectPipeline.execute(resolvedInput);
      this.emit('reflect:complete', result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('reflect:error', error);
      throw error;
    }
  }

  forget(input: ForgetInput): ForgetResult {
    const bankId = input.bankId ?? this.config.defaultBankId;
    this.emit('forget:start', input);

    let factIds: string[] = [];

    if (input.factId) {
      factIds = [input.factId];
    } else if (input.before) {
      factIds = this.store.getFactIdsBefore(input.before, bankId);
    } else if (input.olderThan) {
      const cutoff = new Date(Date.now() - input.olderThan);
      factIds = this.store.getFactIdsBefore(cutoff, bankId);
    }

    const factsRemoved = factIds.length > 0
      ? this.store.deleteFactsBatch(factIds)
      : 0;

    const result: ForgetResult = { factsRemoved, observationsAffected: 0 };
    this.emit('forget:complete', result);
    return result;
  }

  pruneExpired(bankId?: string): number {
    const resolvedBankId = bankId ?? this.config.defaultBankId;
    const expiredIds = this.store.getExpiredFactIds(resolvedBankId);
    if (expiredIds.length === 0) return 0;
    return this.store.deleteFactsBatch(expiredIds);
  }

  createBank(
    id: string,
    name: string,
    description?: string,
  ): BankConfig {
    return this.store.createBank(id, name, description);
  }

  getBank(id: string): BankConfig | undefined {
    return this.store.getBank(id);
  }

  listBanks(): BankConfig[] {
    return this.store.listBanks();
  }

  getStats(): EngramStats {
    return this.store.getStats();
  }

  getStore(): MemoryStore {
    return this.store;
  }

  close(): void {
    this.store.close();
  }
}
