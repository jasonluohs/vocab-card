import type { TextPart } from '../../lib/textTokens';

interface TokenizedTextViewProps {
  parts: TextPart[];
  selected: Set<number>;
  onToggle: (index: number) => void;
}

/** Clickable tokenized text shared by the paste and photo flows (PRD §4.3). */
export default function TokenizedTextView({
  parts,
  selected,
  onToggle,
}: TokenizedTextViewProps) {
  return (
    <div className="paste-source">
      {parts.map((part, index) =>
        part.kind === 'token' ? (
          <span
            key={index}
            className={`token ${selected.has(index) ? 'token-selected' : ''}`}
            onClick={() => onToggle(index)}
          >
            {part.text}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </div>
  );
}
