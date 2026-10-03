import { tool, type StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  evidenceMethodSchema,
  supportSchema,
  USER_SOURCE,
  type PresentationDraft,
  type Support,
} from "./presentation";

export type SourceText = (source: string) => string | undefined;

const bodySchema = z.object({ body: z.string().describe("Markdown.") });

const squash = (text: string) => text.replaceAll(/\s+/g, " ").trim();

const supportArgsSchema = supportSchema.extend({
  source: z
    .string()
    .describe(`A worker tool call id, or "${USER_SOURCE}" for the user's messages.`),
  quote: z.string().describe("Copied verbatim from that source's output. Rejected if not found."),
  method: evidenceMethodSchema.describe(
    `tested: a test exercised it. ran: a command's output confirms it. inspected: read code or output. stated: the user said it (source "${USER_SOURCE}").`
  ),
  why: z.string().optional().describe("One line, only if the quote → claim link is not obvious."),
});

function supportErrors(support: Support, sourceText: SourceText): string[] {
  const text = sourceText(support.source);
  if (text === undefined)
    return [`Unknown source '${support.source}'. Use a worker tool call id or "${USER_SOURCE}".`];
  if ((support.method === "stated") !== (support.source === USER_SOURCE))
    return [`Method 'stated' goes with source "${USER_SOURCE}", and only with it.`];
  const quote = squash(support.quote);
  if (!quote) return [`Empty quote for source '${support.source}'.`];
  return squash(text).includes(quote)
    ? []
    : [`Quote not found verbatim in '${support.source}': ${JSON.stringify(support.quote)}`];
}

const optionsSchema = z
  .array(z.string())
  .optional()
  .describe("Distinct answers. Omit for yes/no; not answering means no.");

export function createPresentationTools(
  draft: PresentationDraft,
  finish: () => void,
  sourceText: SourceText
): StructuredTool[] {
  const response = tool(
    async ({ body }) => {
      draft.response = body;
      return { status: "added" };
    },
    {
      name: "response",
      description:
        "The answer to the user's latest message. Match its length and detail to how specific the user's message is: a broad or vague request gets at most one short paragraph; only a request that names specifics gets specifics. Never restate the request. Never narrate the work. Call exactly once.",
      schema: bodySchema,
    }
  );

  const responseDetail = tool(
    async (args) => {
      draft.responseDetails.push(args);
      return { status: "added" };
    },
    {
      name: "response_detail",
      description:
        "A question the user is likely to ask about the response, answered. Call once per question.",
      schema: z.object({
        question: z.string().describe("The question the user would ask."),
        answer: z.string().describe("One line answering the question."),
        body: z.string().describe("Markdown expanding the answer."),
      }),
    }
  );

  const question = tool(
    async (args) => {
      draft.questions.push(args);
      return { status: "added" };
    },
    {
      name: "question",
      description:
        "A decision the user must make before work can continue. Omit options for a yes/no question.",
      schema: z.object({ prompt: z.string(), options: optionsSchema }),
    }
  );

  const callout = tool(
    async (args) => {
      draft.callouts.push(args);
      return { status: "added" };
    },
    {
      name: "callout",
      description:
        "A caveat beside the answer: an assumption made, a risk, or work cut from scope. Never the answer or a summary of it.",
      schema: z.object({
        title: z.string().describe("One line stating the caveat."),
        details: z.string().optional().describe("Markdown expanding the title."),
      }),
    }
  );

  const evidence = tool(
    async (args) => {
      const errors = args.support.flatMap((support) => supportErrors(support, sourceText));
      if (errors.length > 0) return `Error: nothing added.\n${errors.join("\n")}`;
      draft.evidence.push(args);
      return { status: "added" };
    },
    {
      name: "evidence",
      description:
        "One claim from the response and the exact quotes that prove it, so the user can check it. A claim with no support is shown to the user as assumed.",
      schema: z.object({
        claim: z.string().describe("The assertion, worded as in the response."),
        support: z.array(supportArgsSchema).describe("Empty if the claim was not verified."),
        gap: z.string().optional().describe("What the support does not cover."),
      }),
    }
  );

  const journey = tool(
    async ({ body }) => {
      draft.journey = body;
      return { status: "added" };
    },
    {
      name: "journey",
      description: "The path the agent took: pivots, dead ends, why this approach. At most once.",
      schema: bodySchema,
    }
  );

  const done = tool(
    async () => {
      if (draft.response === undefined) return "Error: call response first.";
      finish();
      return { status: "finished" };
    },
    {
      name: "finish",
      description: "Call last; ends the presentation.",
      schema: z.object({}),
    }
  );

  return [response, responseDetail, question, callout, evidence, journey, done];
}
