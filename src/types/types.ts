import { AxiosError, AxiosResponse } from 'axios';

/*
 * Github
 */

export interface GithubQuery {
  access_token: string;
  per_page: number;
  author?: string;
}

export interface GithubIssue {
  html_url: string;
  number: number;
}

export interface GithubCommit {
  commit: {
    message: string;
  };
  sha: string;
}

export interface GithubSearch<T> {
  items: T[];
}

export interface GithubPullRequestPayload {
  title: string;
  head: string;
  base: string;
  body?: string;
  maintainer_can_modify?: boolean;
}

// TODO: Make PR to DefinitelyTypes to make AxiosError a generic that takes the error response as T
export interface GithubApiError extends AxiosError {
  response?: AxiosResponse<{
    message: string;
    errors?: Array<{}>;
    documentation_url: string;
  }>;
}

/*
 * PullRequest
 */

export interface PullRequest {
  html_url: string;
  number: number;
}

/*
 * Commit
 */

export interface Commit {
  sha: string;
  message: string;
  pullRequest?: number;
}
