import axios from 'axios';
import appConfig from '../config/appConfig';

/**
 * Exchanges the short-lived GitHub OAuth `code` for an access token.
 * This helper normalises the response into a `Bearer` token string and
 * surfaces clear errors so API handlers can return meaningful messages.
 */
export const getGitHubOAuthToken = async (code: string, redirectUri: string): Promise<string> => {
  let response;

  try {
    response = await axios.post(
      appConfig.githubApiUrl,
      {
        client_id: appConfig.githubClientId,
        client_secret: appConfig.githubClientSecret,
        code,
        redirect_uri: redirectUri,
      },
      {
        headers: {
          Accept: 'application/json',
        },
        // Without a timeout a hung GitHub connection would keep the
        // request (and its socket) open indefinitely.
        timeout: appConfig.githubRequestTimeoutMs,
      },
    );
  } catch (error) {
    // Wrapping the original error makes it easier for callers to
    // distinguish OAuth failures from generic server issues.
    throw new Error(
      `Failed to exchange GitHub OAuth code for access token: ${(error as Error).message}`,
      { cause: error },
    );
  }

  const data = response.data;

  // GitHub answers a bad/expired code with HTTP 200 and an error payload,
  // so a successful status alone is not enough to trust the response.
  if (data?.error) {
    throw new Error(
      `Failed to exchange GitHub OAuth code for access token: ${
        data.error_description || data.error
      }`,
    );
  }

  if (!data?.access_token) {
    // Explicit guard helps when GitHub responds with an unexpected payload
    // so we fail fast instead of silently returning an undefined token.
    throw new Error('GitHub OAuth response did not include an access token');
  }

  return `Bearer ${data.access_token}`;
};
