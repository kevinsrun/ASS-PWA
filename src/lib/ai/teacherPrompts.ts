import {SchemaType, type Schema} from '@google/generative-ai';

export interface TaskDefinition {
  systemPrompt: string;
  schema: Schema;
  validator: (output: unknown) => boolean;
}

function labelIs(output:unknown,allowed:string[]):boolean{
 return typeof output==='object'&&output!==null&&'label' in output&&typeof output.label==='string'&&allowed.includes(output.label);
}

export const TEACHER_TASKS: Record<string, TaskDefinition> = {
  reference_actionable: {
    systemPrompt: 'You are a specialized classifier. Determine if the text is a general reference/informational notice or an actionable request/task. Return structured JSON.',
    schema: {
      type: SchemaType.OBJECT,
      properties: {
        label: {type: SchemaType.STRING, format: 'enum', enum: ['REFERENCE', 'ACTIONABLE']},
        confidence: {type: SchemaType.NUMBER},
        rationale: {type: SchemaType.STRING}
      },
      required: ['label', 'confidence', 'rationale']
    },
    validator: out => labelIs(out,['REFERENCE', 'ACTIONABLE'])
  },
  task_event_deadline: {
    systemPrompt: 'Analyze the text for tasks, calendar events, or deadlines. Extract a precise ISO date/time if present. Return structured JSON.',
    schema: {
      type: SchemaType.OBJECT,
      properties: {
        label: {type: SchemaType.STRING, format: 'enum', enum: ['TASK', 'EVENT', 'DEADLINE']},
        confidence: {type: SchemaType.NUMBER},
        deadline: {
          type: SchemaType.OBJECT,
          properties: {
            present: {type: SchemaType.BOOLEAN},
            value: {type: SchemaType.STRING},
            evidence: {type: SchemaType.STRING}
          },
          required: ['present']
        },
        rationale: {type: SchemaType.STRING}
      },
      required: ['label', 'confidence', 'rationale']
    },
    validator: out => labelIs(out,['TASK', 'EVENT', 'DEADLINE'])
  },
  response_required: {
    systemPrompt: 'Determine if the sender expects a response or if a reply is socially/professionally required. Return structured JSON.',
    schema: {
      type: SchemaType.OBJECT,
      properties: {
        label: {type: SchemaType.STRING, format: 'enum', enum: ['RESPONSE_NEEDED', 'NO_RESPONSE']},
        confidence: {type: SchemaType.NUMBER},
        rationale: {type: SchemaType.STRING}
      },
      required: ['label', 'confidence', 'rationale']
    },
    validator: out => labelIs(out,['RESPONSE_NEEDED', 'NO_RESPONSE'])
  },
  required_optional: {
    systemPrompt: 'Determine if the described event/task is mandatory (Required) or optional (Optional). Return structured JSON.',
    schema: {
      type: SchemaType.OBJECT,
      properties: {
        label: {type: SchemaType.STRING, format: 'enum', enum: ['REQUIRED', 'OPTIONAL', 'UNKNOWN']},
        confidence: {type: SchemaType.NUMBER},
        rationale: {type: SchemaType.STRING}
      },
      required: ['label', 'confidence', 'rationale']
    },
    validator: out => labelIs(out,['REQUIRED', 'OPTIONAL', 'UNKNOWN'])
  },
  deadline_extraction: {
    systemPrompt: 'Extract the absolute deadline from the text. If multiple, pick the most critical. Return structured JSON.',
    schema: {
      type: SchemaType.OBJECT,
      properties: {
        deadline: {
          type: SchemaType.OBJECT,
          properties: {
            present: {type: SchemaType.BOOLEAN},
            value: {type: SchemaType.STRING},
            evidence: {type: SchemaType.STRING}
          },
          required: ['present']
        },
        confidence: {type: SchemaType.NUMBER},
        rationale: {type: SchemaType.STRING}
      },
      required: ['deadline', 'confidence', 'rationale']
    },
    validator: out => typeof out==='object'&&out!==null&&'deadline' in out
  }
};
