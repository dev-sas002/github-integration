
import { Component, Input, computed, signal } from '@angular/core';

export interface ColumnPoint {
  /** ISO `YYYY-MM-DD`. */
  date: string;
  commits: number;
}

interface Column extends ColumnPoint {
  x: number;
  y: number;
  width: number;
  height: number;
  path: string;
  centre: number;
  isPeak: boolean;
  label: string;
}

const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 180;
const PAD_TOP = 18;
const PAD_BOTTOM = 26;
const PAD_LEFT = 38;
const PAD_RIGHT = 8;
/** Bars never fill their band: the leftover is deliberate air. */
const MAX_BAR_WIDTH = 24;
const BAR_GAP = 2;
const CORNER = 4;

/** Rounds only the data-end; the baseline end stays square. */
const columnPath = (x: number, y: number, width: number, height: number): string => {
  const radius = Math.min(CORNER, width / 2, height);
  const bottom = y + height;

  return [
    `M${x} ${bottom}`,
    `L${x} ${y + radius}`,
    `Q${x} ${y} ${x + radius} ${y}`,
    `L${x + width - radius} ${y}`,
    `Q${x + width} ${y} ${x + width} ${y + radius}`,
    `L${x + width} ${bottom}`,
    'Z',
  ].join(' ');
};

/** Picks a round axis maximum so ticks land on readable numbers. */
const niceCeiling = (value: number): number => {
  if (value <= 4) {
    return Math.max(value, 1);
  }
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / (magnitude / 2)) * (magnitude / 2);
};

/**
 * Commit activity over time.
 *
 * One series, so there is no legend — the card heading names what is plotted —
 * and only the peak is directly labelled; the axis and the hover tooltip carry
 * every other value.
 */
@Component({
    selector: 'app-column-chart',
    imports: [],
    template: `
    <div class="chart" (mouseleave)="hovered.set(null)">
      <svg
        [attr.viewBox]="'0 0 ' + VIEW_WIDTH + ' ' + VIEW_HEIGHT"
        role="img"
        [attr.aria-label]="ariaLabel()"
        >
        <g class="grid">
          @for (tick of ticks(); track tick.y) {
            <g>
              <line [attr.x1]="PAD_LEFT" [attr.x2]="VIEW_WIDTH - PAD_RIGHT" [attr.y1]="tick.y" [attr.y2]="tick.y" />
              <text [attr.x]="PAD_LEFT - 8" [attr.y]="tick.y + 4">{{ tick.label }}</text>
            </g>
          }
        </g>
    
        <g>
          @for (column of columns(); track column.date) {
            <path class="bar" [attr.d]="column.path" />
          }
        </g>
    
        @if (peak(); as top) {
          <g class="peak">
            <text [attr.x]="top.centre" [attr.y]="top.y - 6">{{ top.commits }}</text>
          </g>
        }
    
        <g class="axis">
          @for (column of axisLabels(); track column.date) {
            <text [attr.x]="column.centre" [attr.y]="VIEW_HEIGHT - 8">
              {{ column.label }}
            </text>
          }
        </g>
    
        <g>
          @for (column of columns(); track column.date; let i = $index) {
            <rect
              class="hit"
              [attr.x]="column.x - BAR_GAP"
              [attr.y]="PAD_TOP"
              [attr.width]="column.width + BAR_GAP * 2"
              [attr.height]="VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM"
              (mouseenter)="hovered.set(i)"
              />
          }
        </g>
      </svg>
    
      @if (hoveredColumn(); as column) {
        <div class="tooltip" [style.left.%]="tooltipLeft()">
          <strong>{{ column.commits }}</strong> commit{{ column.commits === 1 ? '' : 's' }}
          <span class="muted">{{ column.label }}</span>
        </div>
      }
    </div>
    `,
    styles: [
        `
      .chart {
        position: relative;
      }

      /* The viewBox scales the whole drawing, so text and bars keep their
         proportions at any container width. */
      svg {
        display: block;
        width: 100%;
        height: auto;
        overflow: visible;
      }

      .bar {
        fill: var(--series-1);
      }

      .grid line {
        stroke: var(--border);
        stroke-width: 1;
        vector-effect: non-scaling-stroke;
      }

      .grid text {
        fill: var(--text-muted);
        font-size: 10px;
        text-anchor: end;
        font-variant-numeric: tabular-nums;
      }

      .axis text {
        fill: var(--text-muted);
        font-size: 10px;
        text-anchor: middle;
      }

      .peak text {
        fill: var(--text-primary);
        font-size: 11px;
        font-weight: 600;
        text-anchor: middle;
      }

      .hit {
        fill: transparent;
        cursor: default;
      }

      .tooltip {
        position: absolute;
        top: -6px;
        transform: translateX(-50%);
        padding: 5px 9px;
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-sm);
        background: var(--surface-card);
        box-shadow: 0 4px 14px rgba(16, 20, 27, 0.1);
        font-size: 12px;
        white-space: nowrap;
        pointer-events: none;
      }

      .tooltip .muted {
        color: var(--text-muted);
        margin-left: 6px;
      }
    `,
    ]
})
export class ColumnChartComponent {
  protected readonly VIEW_WIDTH = VIEW_WIDTH;
  protected readonly VIEW_HEIGHT = VIEW_HEIGHT;
  protected readonly PAD_LEFT = PAD_LEFT;
  protected readonly PAD_RIGHT = PAD_RIGHT;
  protected readonly PAD_TOP = PAD_TOP;
  protected readonly PAD_BOTTOM = PAD_BOTTOM;
  protected readonly BAR_GAP = BAR_GAP;

  protected readonly hovered = signal<number | null>(null);

  private readonly data = signal<ColumnPoint[]>([]);

  @Input({ required: true })
  set points(value: ColumnPoint[]) {
    this.data.set(value ?? []);
    this.hovered.set(null);
  }

  protected readonly maximum = computed(() =>
    niceCeiling(Math.max(1, ...this.data().map((point) => point.commits))),
  );

  protected readonly columns = computed<Column[]>(() => {
    const points = this.data();
    if (points.length === 0) {
      return [];
    }

    const plotWidth = VIEW_WIDTH - PAD_LEFT - PAD_RIGHT;
    const plotHeight = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM;
    const band = plotWidth / points.length;
    const width = Math.max(2, Math.min(MAX_BAR_WIDTH, band - BAR_GAP));
    const peak = Math.max(...points.map((point) => point.commits));
    const max = this.maximum();

    return points.map((point, index) => {
      const height = point.commits === 0 ? 0 : Math.max(2, (point.commits / max) * plotHeight);
      const x = PAD_LEFT + band * index + (band - width) / 2;
      const y = PAD_TOP + plotHeight - height;

      return {
        ...point,
        x,
        y,
        width,
        height,
        path: height === 0 ? '' : columnPath(x, y, width, height),
        centre: x + width / 2,
        isPeak: point.commits === peak && peak > 0,
        label: new Date(`${point.date}T00:00:00Z`).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        }),
      };
    });
  });

  protected readonly peak = computed(() => this.columns().find((column) => column.isPeak) ?? null);

  protected readonly ticks = computed(() => {
    const max = this.maximum();
    const plotHeight = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM;

    return [0, 0.5, 1].map((fraction) => ({
      label: String(Math.round(max * fraction)),
      y: PAD_TOP + plotHeight - plotHeight * fraction,
    }));
  });

  /** Roughly six dates along the axis, however many columns there are. */
  protected readonly axisLabels = computed(() => {
    const columns = this.columns();
    const step = Math.max(1, Math.ceil(columns.length / 6));
    return columns.filter((_, index) => index % step === 0);
  });

  protected readonly hoveredColumn = computed(() => {
    const index = this.hovered();
    return index === null ? null : (this.columns()[index] ?? null);
  });

  protected readonly tooltipLeft = computed(() => {
    const column = this.hoveredColumn();
    return column ? (column.centre / VIEW_WIDTH) * 100 : 0;
  });

  protected readonly ariaLabel = computed(() => {
    const points = this.data();
    const total = points.reduce((sum, point) => sum + point.commits, 0);
    return `Commit activity: ${total} commits across ${points.length} days`;
  });
}
