import http from 'node:http';
import mongoose from 'mongoose';
import { createApp } from './app';
import appConfig from './config/appConfig';
import logger from './lib/logger';

/**
 * Process entry point: connect, listen, and shut down cleanly.
 *
 * Kept apart from `app.ts` so importing the application never starts a server
 * — the test suite depends on that, and so does anything that wants to mount
 * the app inside another process.
 */
const start = async (): Promise<void> => {
  try {
    await mongoose.connect(appConfig.dbUrl);
    logger.info('database connected');
  } catch (error) {
    // Without the database every route fails, so exit instead of leaving a
    // half-started process that never listens.
    logger.error('database connection failed', { message: (error as Error).message });
    process.exit(1);
  }

  if (appConfig.demoMode) {
    logger.warn(
      'DEMO_MODE is on: /api/demo/session hands out the seeded account token. Never enable this outside a demo.',
    );
  }

  const server = http.createServer(createApp());

  server.listen(appConfig.serverPort, () => {
    logger.info('server listening', {
      port: appConfig.serverPort,
      githubConfigured: appConfig.githubConfigured,
      ai: appConfig.aiEnabled ? 'enabled' : 'heuristics-only',
    });
  });

  const shutdown = (signal: string): void => {
    logger.info('shutting down', { signal });
    server.close(() => {
      mongoose.connection.close(false).finally(() => process.exit(0));
    });
    // Do not let a stuck connection hold the container open forever.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

void start();
