import { z } from "zod";

export const evidenceMethodSchema = z.enum(["tested", "ran", "inspected", "stated"]);

export const USER_SOURCE = "user";

const calloutSchema = z.object({ title: z.string(), details: z.string().optional() });

const responseDetailSchema = z.object({
  question: z.string(),
  answer: z.string(),
  body: z.string(),
});

const questionSchema = z.object({ prompt: z.string(), options: z.array(z.string()).optional() });

export const supportSchema = z.object({
  source: z.string(),
  quote: z.string(),
  method: evidenceMethodSchema,
  why: z.string().optional(),
});

const evidenceSchema = z.object({
  claim: z.string(),
  support: z.array(supportSchema),
  gap: z.string().optional(),
});

export type Evidence = z.infer<typeof evidenceSchema>;
export type Support = z.infer<typeof supportSchema>;

export const presentationSchema = z.object({
  response: z.string(),
  responseDetails: z.array(responseDetailSchema),
  callouts: z.array(calloutSchema),
  questions: z.array(questionSchema),
  evidence: z.array(evidenceSchema),
  journey: z.string().optional(),
});

export type Presentation = z.infer<typeof presentationSchema>;
export type PresentationDraft = Omit<Presentation, "response"> & { response?: string };
