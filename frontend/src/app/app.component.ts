import { Component, inject } from '@angular/core';
import { NgIf } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SessionService } from './core/session.service';

/**
 * Application shell: the persistent chrome around the routed views.
 *
 * It owns no data of its own — the connected account comes from
 * `SessionService`, which is also what the views read — so navigating never
 * re-asks the backend who is signed in.
 */
@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgIf],
})
export class AppComponent {
  readonly session = inject(SessionService);
}
