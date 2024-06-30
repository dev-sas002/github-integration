import { NgFor, NgIf } from '@angular/common';
import { Component, Input, computed, signal } from '@angular/core';

export interface BarItem {
  label: string;
  value: number;
}

/**
 * A ranked list of magnitudes — languages by repository count, and anything
 * else shaped like it.
 *
 * One measure, so one colour for every bar: shading each bar by its own value
 * would spend the colour channel restating the bar length. Values are labelled
 * at the tip, which is why there are no gridlines.
 */
@Component({
  selector: 'app-bar-list',
  standalone: true,
  imports: [NgFor, NgIf],
  template: `
    <ul class="bars" *ngIf="rows().length; else empty">
      <li *ngFor="let row of rows()">
        <span class="label" [title]="row.label">{{ row.label }}</span>
        <span class="track">
          <span class="fill" [style.width.%]="row.percent"></span>
        </span>
        <span class="value">{{ row.value }}</span>
      </li>
    </ul>

    <ng-template #empty>
      <p class="empty">Nothing to show yet.</p>
    </ng-template>
  `,
  styles: [
    `
      .bars {
        display: grid;
        gap: 10px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      li {
        display: grid;
        grid-template-columns: 96px 1fr 34px;
        align-items: center;
        gap: 12px;
      }

      .label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--text-secondary);
      }

      .track {
        height: 10px;
        border-radius: 999px;
        background: var(--surface-sunken);
        overflow: hidden;
      }

      .fill {
        display: block;
        height: 100%;
        /* Square where it meets the baseline, rounded at the data-end. */
        border-radius: 0 4px 4px 0;
        background: var(--series-1);
        min-width: 3px;
      }

      .value {
        text-align: right;
        font-variant-numeric: tabular-nums;
        color: var(--text-primary);
      }
    `,
  ],
})
export class BarListComponent {
  private readonly data = signal<BarItem[]>([]);

  @Input({ required: true })
  set items(value: BarItem[]) {
    this.data.set(value ?? []);
  }

  protected readonly rows = computed(() => {
    const items = this.data();
    const max = Math.max(1, ...items.map((item) => item.value));

    return items.map((item) => ({ ...item, percent: (item.value / max) * 100 }));
  });
}
