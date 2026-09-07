import { isCurrency, money, unitSuffix } from "../lib/format";
import type { GlobalProposal } from "../lib/types";

interface Props {
  proposals: GlobalProposal[];
  onApply: (key: string, value: number) => void;
  onDismiss: (key: string) => void;
}

const show = (value: number, unit: string): string =>
  isCurrency(unit) ? money(value) : value.toLocaleString("en-US");

/**
 * Numbers the customer stated on the call, offered as replacements for the
 * library placeholders.
 *
 * Rendered as a before-and-after on purpose: seeing 5,000 next to 40,000 is
 * what catches a misheard figure, and it is a better check than any bound the
 * server could enforce. Nothing applies until the rep clicks.
 */
export function GlobalProposalList({ proposals, onApply, onDismiss }: Props) {
  if (proposals.length === 0) return null;

  return (
    <div className="suggestions">
      <div className="suggestions__head">
        <span className="suggestions__title">
          {proposals.length} {proposals.length === 1 ? "figure" : "figures"} from the call
        </span>
      </div>

      {proposals.map((proposal) => {
        const suffix = unitSuffix(proposal.unit);
        return (
          <div className="proposal" key={proposal.key}>
            <div className="suggestion__body">
              <div className="suggestion__name">{proposal.label}</div>
              <div className="proposal__delta">
                <span className="proposal__from">
                  {show(proposal.currentDefault, proposal.unit)}
                </span>
                <span aria-hidden="true">→</span>
                <span className="proposal__to">{show(proposal.value, proposal.unit)}</span>
                {suffix && <span className="proposal__unit">{suffix}</span>}
              </div>
              <blockquote className="evidence">“{proposal.evidence}”</blockquote>
            </div>

            <button
              className="btn btn--ghost"
              onClick={() => onApply(proposal.key, proposal.value)}
            >
              Apply
            </button>
            <button className="btn btn--ghost" onClick={() => onDismiss(proposal.key)}>
              Dismiss
            </button>
          </div>
        );
      })}
    </div>
  );
}
