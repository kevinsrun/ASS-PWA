import {MockAIProvider} from './provider';
import {generateOllamaJSON} from './ollama';
import {getGeminiModel} from '../gemini';
import {SchemaType} from '@google/generative-ai';
import type {TeacherReview, TeacherProvider, CriticReview} from './teacherTypes';
import {TEACHER_TASKS} from './teacherPrompts';

function taskFrom(input:unknown):string{
 return typeof input==='object'&&input!==null&&'task_type' in input&&typeof input.task_type==='string'?input.task_type:'reference_actionable';
}
function recordFrom(input:unknown):Record<string,unknown>{
 return typeof input==='object'&&input!==null?input as Record<string,unknown>:{};
}

export class MockTeacherProvider implements TeacherProvider {
  name = 'mock';
  async reviewExample(input: unknown): Promise<TeacherReview> {
    void input;
    return {verdict: 'NEEDS_REVIEW', rationale: 'Mock teacher review', confidence: 0.5, label: 'REFERENCE'};
  }
  async criticReview(input: unknown, teacherOutput: unknown): Promise<CriticReview> {
    void input;void teacherOutput;
    return {verdict: 'APPROVE', rationale: 'Mock critic approved', confidence: 1.0, critic_flags: []};
  }
  async generateHardCases(task: string, count: number): Promise<unknown[]> {
    return Array(count).fill({input: 'Synthetic hard case', label: 'TASK'});
  }
  async compareOutputs(input: unknown, left: unknown, right: unknown): Promise<TeacherReview> {
    void input;void left;void right;
    return {verdict: 'CONFLICT', rationale: 'Mock disagreement', confidence: 1.0};
  }
  async explainFailure(input: unknown, prediction: unknown, groundTruth: unknown): Promise<string> {
    void input;void prediction;void groundTruth;
    return 'Mock failure explanation';
  }
}

export class OllamaTeacherProvider extends MockTeacherProvider {
  name = 'ollama';
  async reviewExample(input: unknown): Promise<TeacherReview> {
    const task = taskFrom(input);
    const def = TEACHER_TASKS[task] || TEACHER_TASKS.reference_actionable;
    const result = await generateOllamaJSON(`Critique this training example: ${JSON.stringify(input)}`, def.schema as unknown as Record<string,unknown>);
    return { ...(result.value as Record<string,unknown>), verdict: 'NEEDS_REVIEW' } as TeacherReview;
  }
}

export class GeminiTeacherProvider extends MockTeacherProvider {
  name = 'gemini';
  async reviewExample(input: unknown): Promise<TeacherReview> {
    if (process.env.GEMINI_TEACHER_ENABLED !== 'true') throw new Error('Gemini teacher disabled');
    const task = taskFrom(input);
    const def = TEACHER_TASKS[task] || TEACHER_TASKS.reference_actionable;
    const model = getGeminiModel(undefined, def.schema);
    const result = await model.generateContent(`Analyze this example for training: ${JSON.stringify(input)}`);
    const parsed:unknown = JSON.parse(result.response.text().replace(/```json|```/g, '').trim());
    if (!def.validator(parsed)) throw new Error('Gemini output failed schema validation');
    const output=recordFrom(parsed);
    return {verdict: 'APPROVE', rationale: typeof output.rationale==='string'?output.rationale:'Teacher output validated', confidence: typeof output.confidence==='number'?output.confidence:0.8, label: output.label};
  }
  async criticReview(input: unknown, teacherOutput: unknown): Promise<CriticReview> {
    if (process.env.GEMINI_TEACHER_ENABLED !== 'true') throw new Error('Gemini teacher disabled');
    const model = getGeminiModel(undefined, {
      type: SchemaType.OBJECT,
      properties: {
        verdict: {type: SchemaType.STRING, format: 'enum', enum: ['APPROVE', 'REJECT', 'CONFLICT']},
        critic_flags: {type: SchemaType.ARRAY, items: {type: SchemaType.STRING}},
        rationale: {type: SchemaType.STRING}
      },
      required: ['verdict', 'critic_flags', 'rationale']
    });
    const result = await model.generateContent(`Criticize this teacher label: ${JSON.stringify(teacherOutput)} for input: ${JSON.stringify(input)}`);
    const parsed:unknown = JSON.parse(result.response.text().replace(/```json|```/g, '').trim());
    return { ...recordFrom(parsed), confidence: 0.95 } as CriticReview;
  }
  async generateHardCases(task: string, count: number): Promise<unknown[]> {
    if (process.env.GEMINI_TEACHER_ENABLED !== 'true') throw new Error('Gemini teacher disabled');
    const model = getGeminiModel(undefined, {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.OBJECT, properties: { input: {type: SchemaType.STRING}, label: {type: SchemaType.STRING} } }
    });
    const result = await model.generateContent(`Generate ${count} hard adversarial examples for task: ${task}`);
    return JSON.parse(result.response.text().replace(/```json|```/g, '').trim());
  }
}

export function getTeacherProvider(): TeacherProvider {
  const mode = (process.env.TEACHER_PROVIDER || 'mock').toLowerCase();
  if (mode === 'mock') return new MockTeacherProvider();
  if (mode === 'ollama') return new OllamaTeacherProvider();
  if (mode === 'gemini') return new GeminiTeacherProvider();
  throw new Error(`Unsupported teacher provider: ${mode}`);
}

export type {TeacherProvider} from './teacherTypes';

export const offlineTeacherFixture = new MockAIProvider('success', []);
