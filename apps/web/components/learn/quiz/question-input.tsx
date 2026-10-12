"use client";

import { MatchingInput, OrderingInput } from "./dnd-inputs";
import { ChoiceInput, CodeInput, FillBlankInput, type InputProps, LongAnswerInput, ShortAnswerInput, TrueFalseInput } from "./inputs";
import { DecisionTreeInput, FileUploadInput, PracticalInput, SimulationInput } from "./special-inputs";

/** Input control for every question type. */
export function QuestionInput(props: InputProps) {
  switch (props.question.question_type) {
    case "multiple_choice":
    case "multiple_select":
      return <ChoiceInput {...props} />;
    case "true_false":
      return <TrueFalseInput {...props} />;
    case "short_answer":
      return <ShortAnswerInput {...props} />;
    case "long_answer":
      return <LongAnswerInput {...props} />;
    case "matching":
      return <MatchingInput {...props} />;
    case "ordering":
      return <OrderingInput {...props} />;
    case "fill_blank":
      return <FillBlankInput {...props} />;
    case "code":
      return <CodeInput {...props} />;
    case "file_upload":
      return <FileUploadInput {...props} />;
    case "scenario":
    case "practical_task":
      return <PracticalInput {...props} />;
    case "decision_tree":
      return <DecisionTreeInput {...props} />;
    case "simulation":
      return <SimulationInput {...props} />;
    default:
      return <LongAnswerInput {...props} />;
  }
}

/** Whether a saved response counts as answered (for the navigator and submit check). */
export function isAnswered(type: string, r: Record<string, unknown> | undefined): boolean {
  if (!r) return false;
  switch (type) {
    case "multiple_choice":
      return r.choice_id !== undefined && r.choice_id !== null;
    case "multiple_select":
      return Array.isArray(r.choice_ids) && r.choice_ids.length > 0;
    case "true_false":
      return typeof r.value === "boolean";
    case "matching":
      return !!r.pairs && Object.keys(r.pairs as object).length > 0;
    case "ordering":
      return Array.isArray(r.order) && r.order.length > 0;
    case "fill_blank":
      return !!r.blanks && Object.values(r.blanks as Record<string, string>).some((v) => String(v ?? "").trim());
    case "code":
      return typeof r.code === "string" && !!r.code.trim();
    case "decision_tree":
      return Array.isArray(r.path) && r.path.length > 0;
    case "file_upload":
      return Array.isArray(r.file_ids) && r.file_ids.length > 0;
    case "simulation":
      return typeof r.session_id === "string";
    default:
      return typeof r.text === "string" && !!r.text.trim();
  }
}
