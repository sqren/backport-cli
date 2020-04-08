import axios from 'axios';
import { BackportOptions } from '../options/options';
import { commitByShaMock } from '../services/github/v3/mocks/commitByShaMock';
import { getCommitBySha } from './getCommits';

describe('getCommitBySha', () => {
  it('should return a single commit without PR', async () => {
    const axiosSpy = jest
      .spyOn(axios, 'get')
      .mockResolvedValue({ data: { items: [commitByShaMock] } });

    const commit = await getCommitBySha({
      username: 'sqren',
      accessToken: 'myAccessToken',
      repoOwner: 'elastic',
      repoName: 'kibana',
      sha: 'myCommitSha',
      githubApiBaseUrlV3: 'https://api.github.com',
    } as BackportOptions & { sha: string });

    expect(commit).toEqual({
      branch: 'master',
      formattedMessage:
        '[Chrome] Bootstrap Angular into document.body (myCommit)',
      sha: 'myCommitSha',
      pullNumber: undefined,
    });

    expect(axiosSpy).toHaveBeenCalledWith(
      'https://api.github.com/search/commits?q=hash:myCommitSha%20repo:elastic/kibana&per_page=1',
      {
        headers: { Accept: 'application/vnd.github.cloak-preview' },
        auth: { password: 'myAccessToken', username: 'sqren' },
      }
    );
  });

  it('should throw error if sha does not exist', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({ data: { items: [] } });

    await expect(
      getCommitBySha({
        repoOwner: 'elastic',
        repoName: 'kibana',
        sha: 'myCommitSha',
        githubApiBaseUrlV3: 'https://api.github.com',
      } as BackportOptions & { sha: string })
    ).rejects.toThrowError('No commit found on master with sha "myCommitSha"');
  });
});
