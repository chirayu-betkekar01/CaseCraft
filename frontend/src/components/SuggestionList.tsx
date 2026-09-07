import { CATEGORY_HUE, type DriverSuggestion } from "../lib/types";

interface Props {
  suggestions: DriverSuggestion[];
  onAccept: (driverId: string) => void;
  onAcceptAll: (driverIds: string[]) => void;
}

/**
 * Ranked recommendations the rep confirms one at a time.
 *
 * Nothing here selects a driver on its own. The quote is the reason the list is
 * trustworthy at all — it is what lets a rep check a recommendation against
 * what was actually said instead of taking it on faith.
 */
export function SuggestionList({ suggestions, onAccept, onAcceptAll }: Props) {
  if (suggestions.length === 0) return null;

  return (
    <div className="suggestions">
      <div className="suggestions__head">
        <span className="suggestions__title">
          {suggestions.length} {suggestions.length === 1 ? "driver" : "drivers"} suggested
        </span>
        <div className="transcript__spacer" />
        {suggestions.length > 1 && (
          <button
            className="btn btn--ghost"
            onClick={() => onAcceptAll(suggestions.map((s) => s.driverId))}
          >
            Accept all
          </button>
        )}
      </div>

      {suggestions.map((suggestion) => (
        <div className="suggestion" key={suggestion.driverId}>
          <span
            className="cat-dot"
            style={{ background: CATEGORY_HUE[suggestion.category] }}
            aria-hidden="true"
          />
          <div className="suggestion__body">
            <div className="suggestion__top">
              <span className="suggestion__name">{suggestion.name}</span>
              <span className={`chip chip--${suggestion.confidence}`}>
                {suggestion.confidence}
              </span>
            </div>
            <div className="suggestion__rationale">{suggestion.rationale}</div>

            {suggestion.quoteVerified ? (
              <blockquote className="evidence">“{suggestion.evidence}”</blockquote>
            ) : (
              // The driver may still apply — it is the quote we will not show,
              // because a quote nobody can find in the call is worse than none.
              <div className="narrative__pending">
                No verbatim quote matched the call. Check this one yourself.
              </div>
            )}
          </div>

          <button className="btn btn--ghost" onClick={() => onAccept(suggestion.driverId)}>
            Accept
          </button>
        </div>
      ))}
    </div>
  );
}
