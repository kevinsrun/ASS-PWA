import type {PipelineExample, Prediction} from '@/lib/ai/improvementPipeline';
import type {DifficultyScore, TeacherDecision} from '@/lib/ai/teacherTypes';

export const DIFFICULTY_WEIGHTS = {
  LOCAL_INCORRECT: 3,
  FALSE_CALENDAR_EVENT: 3,
  HALLUCINATED_DEADLINE: 3,
  DESTRUCTIVE_TOOL_MISTAKE: 3,
  LOW_CONFIDENCE: 2,
  MALFORMED_OUTPUT: 2,
  REQUIRED_OPTIONAL_DISAGREEMENT: 2,
  USER_CORRECTION: 2,
  TOOL_ROUTING_FAILURE: 2,
  VALIDATOR_DISAGREEMENT: 2,
  RARE_CLASS: 1,
  MULTIPLE_DATES: 1,
  TIMEZONE_AMBIGUITY: 1,
  LONG_CONTEXT: 1,
  REPEATED_FAILURE: 1
} as const;

export function calculateDifficulty(
  example: PipelineExample, 
  prediction: Prediction, 
  validatorResult: boolean,
  userCorrectionPresent: boolean
): DifficultyScore {
  const breakdown: Record<string, number> = {};
  let score = 0;

  // 1. Correctness & Criticality
  if (prediction.output === undefined || prediction.malformed) {
    score += DIFFICULTY_WEIGHTS.MALFORMED_OUTPUT;
    breakdown.MALFORMED_OUTPUT = DIFFICULTY_WEIGHTS.MALFORMED_OUTPUT;
  } else {
    // Check for critical a-priori failures (simplified for now)
    // In a real scenario, we'd compare against ground truth if available
  }

  if (!validatorResult) {
    score += DIFFICULTY_WEIGHTS.VALIDATOR_DISAGREEMENT;
    breakdown.VALIDATOR_DISAGREEMENT = DIFFICULTY_WEIGHTS.VALIDATOR_DISAGREEMENT;
  }

  if (userCorrectionPresent) {
    score += DIFFICULTY_WEIGHTS.USER_CORRECTION;
    breakdown.USER_CORRECTION = DIFFICULTY_WEIGHTS.USER_CORRECTION;
  }

  if (prediction.confidence !== undefined && prediction.confidence < 0.60) {
    score += DIFFICULTY_WEIGHTS.LOW_CONFIDENCE;
    breakdown.LOW_CONFIDENCE = DIFFICULTY_WEIGHTS.LOW_CONFIDENCE;
  }

  // Contextual signals
  if (example.input_text.length > 10000) {
    score += DIFFICULTY_WEIGHTS.LONG_CONTEXT;
    breakdown.LONG_CONTEXT = DIFFICULTY_WEIGHTS.LONG_CONTEXT;
  }

  return { score, breakdown };
}

export function shouldEscalateToTeacher(
  example: PipelineExample,
  prediction: Prediction,
  difficulty: DifficultyScore
): TeacherDecision {
  const reasons: string[] = [];
  let priority = 0;
  let learningValue = 0;

  if (difficulty.score > 5) {
    reasons.push('HIGH_DIFFICULTY');
    priority += 50;
    learningValue += 0.4;
  }

  if (prediction.malformed) {
    reasons.push('LOCAL_MALFORMED');
    priority += 30;
    learningValue += 0.3;
  }

  if (prediction.confidence !== undefined && prediction.confidence < 0.7) {
    reasons.push('LOCAL_UNCERTAIN');
    priority += 20;
    learningValue += 0.2;
  }

  const escalate = reasons.length > 0 || difficulty.score > 3;

  return {
    escalate,
    priority: Math.min(100, priority),
    expectedLearningValue: Math.min(1, learningValue),
    reasons
  };
}
