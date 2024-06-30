import { HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { SessionService } from '../core/session.service';

/**
 * Attaches the stored Authorization header to outgoing requests.
 *
 * It is the only place the header is set. Services used to add their own as
 * well, which produced `Bearer Bearer <token>` and a 401 on every
 * authenticated call.
 */
@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private readonly session = inject(SessionService);

  intercept(req: HttpRequest<unknown>, next: HttpHandler) {
    const token = this.session.token();

    // The stored value already carries its `Bearer ` prefix; nothing is added.
    return next.handle(token ? req.clone({ headers: req.headers.set('Authorization', token) }) : req);
  }
}
