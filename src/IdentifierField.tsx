import { useRef, useState } from "react";

export type RegistrationResult = boolean | "duplicate";

export function useIdentifierSuggestion(onSuggest: () => Promise<string>) {
  const input = useRef<HTMLInputElement>(null);
  const lastSuggestion = useRef("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function suggest(replaceDuplicate = false) {
    setPending(true);
    setMessage("");
    try {
      const candidate = await onSuggest();
      if (!input.current) return;
      input.current.value = candidate;
      lastSuggestion.current = candidate;
      if (replaceDuplicate)
        setMessage(
          "使用済みのため別の候補を入力しました。確認して再度登録してください。",
        );
      else setMessage(`候補の ${candidate} を入力しました。`);
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "番号を提案できませんでした。";
      setMessage(
        replaceDuplicate ? `入力した番号は使用済みです。 ${detail}` : detail,
      );
    } finally {
      setPending(false);
    }
  }

  async function handleDuplicate() {
    if (
      lastSuggestion.current &&
      input.current?.value === lastSuggestion.current
    )
      await suggest(true);
    else setMessage("この番号は使用済みです。別の番号を入力してください。");
  }

  function clear() {
    lastSuggestion.current = "";
    setMessage("");
  }

  return { input, pending, message, suggest, handleDuplicate, clear };
}

export default function IdentifierField({
  kind,
  busy,
  suggestion,
}: {
  kind: "user" | "property";
  busy: boolean;
  suggestion: ReturnType<typeof useIdentifierSuggestion>;
}) {
  const user = kind === "user";
  const name = user ? "login_id" : "property_number";
  return (
    <div className="identifier-field">
      <label htmlFor={name}>{user ? "ログインID" : "物件番号"}</label>
      <div className="identifier-controls">
        <input
          ref={suggestion.input}
          id={name}
          name={name}
          maxLength={user ? 32 : 64}
          pattern={user ? "[A-Za-z0-9][A-Za-z0-9_\\-]{0,31}" : undefined}
          autoCapitalize="none"
          spellCheck={false}
          autoComplete="off"
          readOnly={suggestion.pending}
          onChange={suggestion.clear}
          aria-describedby={`${name}-status`}
          required
        />
        <button
          type="button"
          disabled={busy || suggestion.pending}
          onClick={() => void suggestion.suggest()}
        >
          {suggestion.pending ? "確認中…" : "番号を提案"}
        </button>
      </div>
      <small id={`${name}-status`} role="status">
        {suggestion.message}
      </small>
    </div>
  );
}
