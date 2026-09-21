export type TeacherVerdict = 'APPROVE' | 'REJECT' | 'NEEDS_REVIEW' | 'CONFLICT';

export interface TeacherReview {
  verdict: TeacherVerdict;
  rationale: string;
  confidence: number;
  label?: unknown;
  metadata?: Record<string, unknown>;
}

export interface TeacherProvider {
  name: string;
  reviewExample(input: unknown): Promise<TeacherReview>;
  criticReview(input: unknown, teacherOutput: unknown): Promise<CriticReview>;
  generateHardCases(task: string, count: number): Promise<unknown[]>;
  compareOutputs(input: unknown, left: unknown, right: unknown): Promise<TeacherReview>;
  explainFailure(input: unknown, prediction: unknown, groundTruth: unknown): Promise<string>;
}

export interface CriticReview extends TeacherReview {
  critic_flags: string[];
  suggested_correction?: unknown;
}

export interface HardExample {
  id: string;
  user_id: string;
  task_type: string;
  source_type: string;
  source_id: string;
  input_text: string;
  local_prediction: unknown;
  local_confidence: number;
  teacher_prediction?: unknown;
  teacher_confidence?: number;
  difficulty_score: number;
  teacher_priority: number;
  status: 'pending_teacher' | 'teacher_reviewed' | 'needs_user_review' | 'approved_for_training' | 'rejected' | 'held_out_eval';
  created_at: string;
}

export interface DifficultyScore {
  score: number;
  breakdown: Record<string, number>;
}

export interface TeacherDecision {
  escalate: boolean;
  priority: number;
  expectedLearningValue: number;
  reasons: string[];
}

export type TeacherEscalationReason = 
  | 'USER_CORRECTION' 
  | 'LOCAL_UNCERTAIN' 
  | 'LOCAL_MALFORMED' 
  | 'DETERMINISTIC_DISAGREEMENT' 
  | 'RARE_CLASS' 
  | 'CRITICAL_TASK';

export interface GoldenEvalCandidate {
  input: unknown;
  expected: unknown;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  source: 'real' | 'synthetic';
}

export interface DisagreementRecord {
  input_hash: string;
  local: unknown;
  gemini: unknown;
  validator: unknown;
  user: unknown;
  resolved_label: unknown;
}

export interface AdversarialGenerationRequest {
  target_task: string;
  failure_mode: string;
  example_context: unknown;
  count: number;
}

export interface CampaignMetrics {
  gemini_requests: number;
  gemini_tokens: number;
  examples_reviewed: number;
  examples_approved: number;
  synthetic_generated: number;
  local_resolution_rate: number;
  cloud_escalation_rate: number;
}

export interface TeacherCampaignRun {
  run_id: string;
  mode: 'conservative' | 'balanced' | 'aggressive';
  started_at: string;
  metrics: CampaignMetrics;
}
