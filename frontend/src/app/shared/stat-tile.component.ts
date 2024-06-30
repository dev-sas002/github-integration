import { Component, Input } from '@angular/core';

/**
 * A single number with its label.
 *
 * When the story is one figure, the figure is the chart — a one-bar bar chart
 * would say the same thing with more ink.
 */
@Component({
  selector: 'app-stat-tile',
  imports: [],
  template: `
    <div class="tile" [class.accent]="accent">
      <span class="label">{{ label }}</span>
      <span class="value">{{ display }}</span>
      @if (note) {
        <span class="note">{{ note }}</span>
      }
    </div>
  `,
  styles: [
    `
      .tile {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 16px 18px;
        background: var(--surface-card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        box-shadow: var(--shadow-card);
        height: 100%;
        box-sizing: border-box;
      }

      .label {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--text-muted);
      }

      .value {
        font-size: 28px;
        font-weight: 600;
        letter-spacing: -0.02em;
        line-height: 1.2;
      }

      .note {
        font-size: 12px;
        color: var(--text-secondary);
      }

      .tile.accent .value {
        color: var(--status-critical);
      }
    `,
  ],
})
export class StatTileComponent {
  @Input({ required: true }) label = '';

  @Input({ required: true }) value: number | null = null;

  @Input() note: string | null = null;

  /** Draws attention to a figure that means "something needs doing". */
  @Input() accent = false;

  /** Compacts large counts; a standalone figure uses proportional digits. */
  protected get display(): string {
    const value = this.value ?? 0;
    return value >= 10000 ? `${(value / 1000).toFixed(1)}K` : value.toLocaleString();
  }
}
