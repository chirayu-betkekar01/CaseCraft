import type { Conflict } from "../lib/conflicts";

/** Double-counting is guidance, never a block: which drivers to present is the
 * rep's judgment call, not the tool's. */
export function ConflictNotice({ conflicts }: { conflicts: Conflict[] }) {
  if (conflicts.length === 0) return null;

  return (
    <div className="stack" style={{ gap: 10 }}>
      {conflicts.map(({ group, drivers }) => (
        <div className="notice notice--warning" key={group.id}>
          <span className="notice__icon" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M8 1.6 15 14H1L8 1.6Z" stroke="currentColor" strokeWidth="1.4"
                    strokeLinejoin="round" />
              <path d="M8 6v3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <circle cx="8" cy="11.6" r="0.85" fill="currentColor" />
            </svg>
          </span>
          <div>
            <div className="notice__title">
              Double-counting · {group.label} — {drivers.map((d) => d.name).join(", ")}
            </div>
            <div className="notice__body">{group.guidance}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
