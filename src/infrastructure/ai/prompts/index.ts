/**
 * The single prompt registry. Upgrading a family = add `v2.ts` and switch the
 * import here; call sites do not change.
 */
export * as drillGenerator from './drill-generator/v1'
export * as confusionExplainer from './confusion-explainer/v1'
export * as compositionReviewer from './composition-reviewer/v1'
export * as lessonQA from './lesson-qa/v1'
export * as planAdvisor from './plan-advisor/v1'
export * as improvReviewer from './improv-reviewer/v1'
export * as guitarCoach from './guitar-coach/v1'
export * as mixReviewer from './mix-reviewer/v1'
