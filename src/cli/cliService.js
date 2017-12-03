const ora = require('ora');
const prompts = require('../lib/prompts');
const github = require('../lib/github');
const constants = require('../lib/constants');
const { getRepoPath } = require('../lib/env');
const chalk = require('chalk');

const {
  resetAndPullMaster,
  cherrypick,
  createAndCheckoutBranch,
  push,
  repoExists,
  setupRepo,
  isIndexDirty
} = require('../lib/git');

function doBackportVersions({
  owner,
  repoName,
  commits,
  versions,
  username,
  labels
}) {
  return sequentially(versions, version => {
    return withPullRequest(owner, repoName, commits)
      .then(commitsWithPullRequest => {
        return doBackportVersion({
          owner,
          repoName,
          commits: commitsWithPullRequest,
          version,
          username,
          labels
        });
      })
      .then(res => console.log(`View pull request: ${res.data.html_url}\n`))
      .catch(handleErrors);
  });
}

function doBackportVersion({
  owner,
  repoName,
  commits,
  version,
  username,
  labels = []
}) {
  const backportBranchName = getBackportBranchName(version, commits);
  const refValues = commits.map(commit => getReferenceLong(commit)).join(', ');
  console.log(`Backporting ${refValues} to ${version}`);

  return withSpinner(
    resetAndPullMaster(owner, repoName).then(() =>
      createAndCheckoutBranch(owner, repoName, version, backportBranchName)
    ),
    'Pulling latest changes'
  )
    .then(() =>
      sequentially(commits, commit =>
        cherrypickAndConfirm(owner, repoName, commit.sha)
      )
    )
    .then(() =>
      withSpinner(
        push(owner, repoName, username, backportBranchName),
        `Pushing branch ${username}:${backportBranchName}`
      )
    )
    .then(() => {
      const payload = getPullRequestPayload(version, commits, username);
      return withSpinner(
        github.createPullRequest(owner, repoName, payload).then(res => {
          if (labels.length > 0) {
            return github
              .addLabels(owner, repoName, res.data.number, labels)
              .then(() => res);
          }
          return res;
        }),
        'Creating pull request'
      );
    });
}

// Add pull request info to commit if it exists
function withPullRequest(owner, repoName, commits) {
  return Promise.all(
    commits.map(commit => {
      return github
        .getPullRequestByCommit(owner, repoName, commit.sha)
        .then(pullRequest => Object.assign({}, commit, { pullRequest }));
    })
  );
}

function parseUpstream(upstream) {
  const [owner, repoName] = upstream.split('/');
  return { owner, repoName };
}

function maybeSetupRepo(owner, repoName, username) {
  return repoExists(owner, repoName).then(exists => {
    if (!exists) {
      return withSpinner(
        setupRepo(owner, repoName, username),
        'Cloning repository (may take a few minutes the first time)'
      );
    }
  });
}

function getCommitBySha({ owner, repoName, sha }) {
  const spinner = ora().start();
  return github
    .getCommit(owner, repoName, sha)
    .catch(e => {
      spinner.stop();
      throw e;
    })
    .then(commit => {
      spinner.stopAndPersist({
        symbol: chalk.green('?'),
        text: `${chalk.bold('Select commit')} ${chalk.cyan(commit.message)}`
      });
      return [commit];
    });
}

function promptCommits({ owner, repoName, author, multipleCommits }) {
  const spinner = ora('Loading commits...').start();
  return github
    .getCommits(owner, repoName, author)
    .catch(e => {
      spinner.fail();
      throw e;
    })
    .then(commits => {
      spinner.stop();
      return prompts.listCommits(commits, multipleCommits);
    });
}

function promptVersions(versions, multipleChoice = false) {
  return prompts.listVersions(versions, multipleChoice);
}

function handleErrors(e) {
  switch (e.code) {
    // Handled exceptions
    case constants.GITHUB_ERROR:
      break;

    // Unhandled exceptions
    default:
      console.error(e);
  }
}

function sequentially(items, handler) {
  return items.reduce(
    (p, item) => p.then(() => handler(item)),
    Promise.resolve()
  );
}

function getBackportBranchName(version, commits) {
  const refValues = commits
    .map(commit => getReferenceShort(commit))
    .join('_')
    .slice(0, 200);
  return `backport/${version}/${refValues}`;
}

function getReference(commit, { short }) {
  if (commit.pullRequest) {
    return short ? `pr-${commit.pullRequest}` : `#${commit.pullRequest}`;
  }

  const shortCommit = commit.sha.slice(0, 7);
  return short ? `commit-${shortCommit}` : `${shortCommit}`;
}

function getReferenceLong(commit) {
  return getReference(commit, { short: false });
}

function getReferenceShort(commit) {
  return getReference(commit, { short: true });
}

function isCherrypickConflict(e) {
  return e.cmd.includes('git cherry-pick');
}

function cherrypickAndConfirm(owner, repoName, sha) {
  return withSpinner(
    cherrypick(owner, repoName, sha),
    'Cherry-picking commit',
    `Cherry-picking failed. Please resolve conflicts in: ${getRepoPath(
      owner,
      repoName
    )}`
  ).catch(e => {
    if (!isCherrypickConflict(e)) {
      throw e;
    }

    return confirmResolvedRecursive(owner, repoName);
  });
}

function confirmResolvedRecursive(owner, repoName) {
  return prompts
    .confirmConflictResolved()
    .then(() => isIndexDirty(owner, repoName))
    .then(
      isDirty => (isDirty ? confirmResolvedRecursive(owner, repoName) : null)
    );
}

function getPullRequestPayload(version, commits, username) {
  const backportBranchName = getBackportBranchName(version, commits);
  const commitRefs = commits
    .map(commit => {
      const ref = getReferenceLong(commit);
      return ` - ${commit.message.replace(`(${ref})`, '')} (${ref})`;
    })
    .join('\n');

  const commitMessages = commits
    .map(commit => commit.message)
    .join(' | ')
    .slice(0, 200);

  return {
    title: `[${version}] ${commitMessages}`,
    body: `Backports the following commits to ${version}:\n${commitRefs}`,
    head: `${username}:${backportBranchName}`,
    base: `${version}`
  };
}

function withSpinner(promise, text, errorText) {
  const spinner = ora(text).start();
  return promise
    .then(res => {
      spinner.succeed();
      return res;
    })
    .catch(e => {
      if (errorText) {
        spinner.text = errorText;
      }
      spinner.fail();
      throw e;
    });
}

module.exports = {
  doBackportVersion,
  doBackportVersions,
  getCommitBySha,
  getReferenceLong,
  handleErrors,
  maybeSetupRepo,
  parseUpstream,
  promptCommits,
  promptVersions,
  withPullRequest
};
