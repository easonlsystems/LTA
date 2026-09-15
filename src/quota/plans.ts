export type Plan = 'trial' | 'basic' | 'pro';

// Text-only posts/pages use one equivalent content minute. This keeps the existing
// minute-based plans meaningful without pretending the page has a media duration.
export const TEXT_LINK_EQUIVALENT_SECONDS = 60;

export interface PlanLimits {
  secondsPerPeriod: number;
  videosPerPeriod: number | null;
  maxVideoSeconds: number;
  concurrency: number;
  priority: number;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  trial: {
    secondsPerPeriod: 10 * 60,
    videosPerPeriod: 3,
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
