import { registerProvider } from '../domain/registry';
import GitHubProvider from './github/githubProvider';

/**
 * Provider registration happens exactly once, here.
 *
 * Adding a source is a two-line change in this file plus one class that
 * implements `SourceProvider`; nothing else in the codebase learns its name.
 */
registerProvider(new GitHubProvider());

export { GitHubProvider };
