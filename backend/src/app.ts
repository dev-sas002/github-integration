import cors, { CorsOptions } from 'cors';
import express, { Application } from 'express';
import mongoose from 'mongoose';

import appConfig from './config/appConfig';
import { listProviders } from './domain/registry';
import { errorHandler, notFoundHandler } from './http/middleware/errorHandler';
import catalogRoutes from './routes/catalog.router';
import demoRoutes from './routes/demo.router';
import githubRoutes from './routes/github.router';
import insightsRoutes from './routes/insights.router';
import syncRoutes from './routes/sync.router';

// Registers every SourceProvider exactly once, before any route can resolve one.
import './providers';

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // A missing Origin means a same-origin or non-browser caller (curl, the
    // OAuth redirect); those are not subject to CORS in the first place.
    if (!origin || appConfig.corsOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
};

/**
 * Builds the Express application.
 *
 * A factory with no side effects: it opens no sockets and no database
 * connection, which is what lets the test suite mount it directly and what
 * keeps `src/index.ts` as the only file that knows about process lifecycle.
 */
export const createApp = (): Application => {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(cors(corsOptions));

  app.get('/', (_req, res) => res.json({ service: 'github-integration', status: 'ok' }));

  // Used by the container healthcheck: reports liveness plus whether the
  // database is actually reachable, because "the process is up" is not the
  // same question as "the service works".
  app.get('/health', (_req, res) => {
    const dbReady = mongoose.connection.readyState === 1;

    res.status(dbReady ? 200 : 503).json({
      status: dbReady ? 'ok' : 'degraded',
      database: dbReady ? 'connected' : 'disconnected',
      providers: listProviders().map((provider) => ({
        id: provider.id,
        configured: provider.isConfigured(),
      })),
      ai: appConfig.aiEnabled ? 'enabled' : 'heuristics-only',
    });
  });

  app.use('/api/github', githubRoutes);
  app.use('/api/sync', syncRoutes);
  app.use('/api/catalog', catalogRoutes);
  app.use('/api/insights', insightsRoutes);
  app.use('/api/demo', demoRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export default createApp();
