export type Plan = 'trial' | 'basic' | 'pro';

export interface PlanLimits {
  secondsPerPeriod: number;
  videosPerPeriod: number | null;
  /** Legacy compatibility metadata. Runtime duration enforcement uses MAX_PROCESSABLE_VIDEO_SECONDS. */
  maxVideoSeconds: number;
  concurrency: number;
  priority: number;
}

// This is an operational guardrail, not a pricing-plan limit. Paid plans are
// constrained by available processing units rather than a separate video-length cap.
export const MAX_PROCESSABLE_VIDEO_SECONDS = 8 * 60 * 60;

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  trial: {
    secondsPerPeriod: 10 * 60,
    videosPerPeriod: null,
    maxVideoSeconds: 30 * 60,
    concurrency: 1,
    priority: 0
  },
  basic: {
    secondsPerPeriod: 500 * 60,
    videosPerPeriod: null,
    maxVideoSeconds: 30 * 60,
    concurrency: 2,
    priority: 10
  },
  pro: {
    secondsPerPeriod: 2000 * 60,
    videosPerPeriod: null,
    maxVideoSeconds: 120 * 60,
    concurrency: 4,
    priority: 20
  }
};