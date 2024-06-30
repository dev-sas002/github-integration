import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

// appConfig carries the router, HttpClient and the auth interceptor. The
// browser bootstrap previously declared its own provider list, which left
// the app without a Router even though components inject one.
bootstrapApplication(AppComponent, appConfig)
  .catch(err => console.error(err));
