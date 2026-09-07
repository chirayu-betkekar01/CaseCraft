import { CATEGORY_HUE, type Driver } from "../lib/types";

interface Props {
  driver: Driver;
  selected: boolean;
  onToggle: (id: string) => void;
}

export function DriverTile({ driver, selected, onToggle }: Props) {
  return (
    <button
      type="button"
      className="tile"
      aria-pressed={selected}
      style={{ ["--tile-hue" as string]: CATEGORY_HUE[driver.category] }}
      onClick={() => onToggle(driver.id)}
      title={driver.shortDescription}
    >
      <span className="tile__top">
        <span className="tile__name">{driver.name}</span>
        <span className="tile__check" aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M1.5 5.2 3.9 7.5 8.5 2.6"
              stroke="#fff"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </span>
      <span className="tile__summary">{driver.shortDescription}</span>
    </button>
  );
}
