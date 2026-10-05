import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { PromptAnswer, UserPrompt, UserPromptValue } from "@/types";
import { kbdClass, useKeyGuard } from "./promptKeys";

function answerText(answer: PromptAnswer | undefined): string {
  if (answer === undefined) return "Not answered";
  return answer === true ? "Confirmed" : `Changed to: ${String(answer)}`;
}

export function AssumptionsPrompt({
  prompt,
  onRespond,
}: {
  prompt: Extract<UserPrompt, { kind: "assumptions" }>;
  onRespond: (value: UserPromptValue) => void;
}) {
  const { questions } = prompt;
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, PromptAnswer>>({});
  const [changes, setChanges] = useState<Record<string, string>>({});
  useEffect(() => {
    ref.current?.focus();
  }, [index]);

  const isSubmitTab = index === questions.length;
  const question = questions[index];
  const isComplete = questions.every((q) => answers[q.id] !== undefined);

  const answer = (value: PromptAnswer) => {
    const next = { ...answers, [question.id]: value };
    if (questions.length === 1) {
      onRespond(next);
      return;
    }
    setAnswers(next);
    setIndex(index + 1);
  };

  const submit = () => {
    if (isComplete) onRespond(answers);
  };

  const submitChange = () => {
    const value = (changes[question.id] ?? "").trim();
    if (value) answer(value);
  };

  const tabCount = questions.length === 1 ? 1 : questions.length + 1;
  const isGuarded = useKeyGuard();
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isGuarded(e) || e.target !== e.currentTarget) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      setIndex((index + step + tabCount) % tabCount);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (isSubmitTab) submit();
      else answer(true);
      return;
    }
    if (isSubmitTab || !/^[1-9]$/.test(e.key)) return;
    const option = question.options[Number(e.key) - 1];
    if (option === undefined) return;
    e.preventDefault();
    answer(option);
  };

  const onChangeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    submitChange();
  };

  return (
    <div
      ref={ref}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-1.5 px-1.5 py-1 text-xs focus:outline-none"
    >
      {tabCount > 1 && (
        <div className="flex flex-wrap items-center gap-1 select-none">
          {questions.map((q, i) => (
            <button
              key={q.id}
              type="button"
              onClick={() => setIndex(i)}
              className={`flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 transition-colors ${
                i === index ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              {answers[q.id] === undefined ? (
                <span className="border-muted-foreground/60 size-3 rounded-sm border" />
              ) : (
                <Check className="size-3 text-emerald-600" />
              )}
              <span className="max-w-24 truncate" title={q.topic}>
                {q.topic}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setIndex(questions.length)}
            className={`cursor-pointer rounded px-2 py-0.5 transition-colors ${
              isSubmitTab ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            Submit
          </button>
          <span className="text-muted-foreground text-2xs ml-auto flex gap-1">
            <kbd className={kbdClass}>←→</kbd>
          </span>
        </div>
      )}

      {isSubmitTab ? (
        <>
          <ul className="flex flex-col gap-1">
            {questions.map((q) => (
              <li key={q.id}>
                <div className="text-foreground">{q.label}</div>
                <div className="text-muted-foreground">{answerText(answers[q.id])}</div>
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={submit}
              disabled={!isComplete}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white shadow-xs transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span>Submit</span>
              <kbd className={kbdClass}>↵</kbd>
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="text-foreground text-sm font-medium select-none">{question.label}</div>
          {question.options.length > 0 && (
            <div className="flex flex-col">
              {question.options.map((option, i) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => answer(option)}
                  className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-left transition-colors ${
                    answers[question.id] === option
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  <span className="text-2xs font-mono opacity-60">{i + 1}</span>
                  <span>{option}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <input
              value={changes[question.id] ?? ""}
              onChange={(e) => setChanges({ ...changes, [question.id]: e.target.value })}
              onKeyDown={onChangeKeyDown}
              placeholder="Change to…"
              className="text-foreground placeholder:text-muted-foreground/60 border-border/60 flex-1 rounded border bg-transparent px-2 py-1 text-xs focus:outline-none"
            />
            <button
              type="button"
              onClick={submitChange}
              disabled={!(changes[question.id] ?? "").trim()}
              className="border-border/60 bg-muted/60 text-muted-foreground hover:bg-muted flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              Change
            </button>
            <button
              type="button"
              onClick={() => answer(true)}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white shadow-xs transition-colors hover:bg-emerald-500"
            >
              <span>Confirm</span>
              <kbd className={kbdClass}>↵</kbd>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
