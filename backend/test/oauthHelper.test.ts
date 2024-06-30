import { describe, it, expect, beforeEach, vi } from 'vitest';
import axios from 'axios';
import { getGitHubOAuthToken } from '../src/helpers/oauthHelper';
import appConfig from '../src/config/appConfig';

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    isAxiosError: (error: any) => Boolean(error && error.isAxiosError),
  },
}));

const mockedAxios = axios as unknown as { post: ReturnType<typeof vi.fn> };

const REDIRECT_URI = 'http://localhost:3000/api/github/callback';

describe('getGitHubOAuthToken', () => {
  beforeEach(() => {
    mockedAxios.post.mockReset();
  });

  it('posts the exchange to the configured token endpoint with the app credentials', async () => {
    mockedAxios.post.mockResolvedValue({ data: { access_token: 'gho_abc123' } });

    await getGitHubOAuthToken('the-code', REDIRECT_URI);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const [url, body, config] = mockedAxios.post.mock.calls[0];

    expect(url).toBe(appConfig.githubApiUrl);
    expect(body).toEqual({
      client_id: appConfig.githubClientId,
      client_secret: appConfig.githubClientSecret,
      code: 'the-code',
      redirect_uri: REDIRECT_URI,
    });
    expect(config.headers.Accept).toBe('application/json');
  });

  it('applies a request timeout so a hung GitHub call cannot leak a socket', async () => {
    mockedAxios.post.mockResolvedValue({ data: { access_token: 'gho_abc123' } });

    await getGitHubOAuthToken('the-code', REDIRECT_URI);

    const [, , config] = mockedAxios.post.mock.calls[0];
    expect(config.timeout).toBe(appConfig.githubRequestTimeoutMs);
    expect(config.timeout).toBeGreaterThan(0);
  });

  it('returns the token as a Bearer header value', async () => {
    mockedAxios.post.mockResolvedValue({ data: { access_token: 'gho_abc123' } });

    await expect(getGitHubOAuthToken('the-code', REDIRECT_URI)).resolves.toBe('Bearer gho_abc123');
  });

  it("throws on GitHub's HTTP 200 error payload instead of returning undefined", async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        error: 'bad_verification_code',
        error_description: 'The code passed is incorrect or expired.',
      },
    });

    await expect(getGitHubOAuthToken('stale', REDIRECT_URI)).rejects.toThrow(
      /The code passed is incorrect or expired/,
    );
  });

  it('falls back to the error code when no description is supplied', async () => {
    mockedAxios.post.mockResolvedValue({ data: { error: 'incorrect_client_credentials' } });

    await expect(getGitHubOAuthToken('x', REDIRECT_URI)).rejects.toThrow(
      /incorrect_client_credentials/,
    );
  });

  it('throws when the response carries no access token at all', async () => {
    mockedAxios.post.mockResolvedValue({ data: {} });

    await expect(getGitHubOAuthToken('x', REDIRECT_URI)).rejects.toThrow(
      /did not include an access token/,
    );
  });

  it('throws when the response body is missing entirely', async () => {
    mockedAxios.post.mockResolvedValue({ data: undefined });

    await expect(getGitHubOAuthToken('x', REDIRECT_URI)).rejects.toThrow(
      /did not include an access token/,
    );
  });

  it('wraps transport failures with context', async () => {
    mockedAxios.post.mockRejectedValue(new Error('timeout of 10000ms exceeded'));

    await expect(getGitHubOAuthToken('x', REDIRECT_URI)).rejects.toThrow(
      /Failed to exchange GitHub OAuth code for access token: timeout of 10000ms exceeded/,
    );
  });

  it('does not double-wrap the "no access token" guard as a transport error', async () => {
    mockedAxios.post.mockResolvedValue({ data: {} });

    await expect(getGitHubOAuthToken('x', REDIRECT_URI)).rejects.toThrow(
      /^GitHub OAuth response did not include an access token$/,
    );
  });
});
