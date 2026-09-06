import { TestRunSummary } from '../languages/types';

/** The slice of a run the report needs. Kept small so the report stays pure. */
export interface RunInfoLike {
  tests: TestRunSummary;
  language: string;
  finishedAt: Date;
}
