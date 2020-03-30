import del from 'del';
import { BackportOptions } from '../options/options';
import { HandledError } from './HandledError';
import { stat } from './fs-promisified';
import { getRepoOwnerPath, getRepoPath } from './env';
import { execAsCallback, exec } from './child-process-promisified';
import { CommitSelected } from './github/Commit';
import uniq from 'lodash.uniq';
import { logger } from './logger';
import { resolve as pathResolve } from 'path';

async function folderExists(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch (e) {
    if (e.code === 'ENOENT') {
      return false;
    }

    throw e;
  }
}

export function repoExists(options: BackportOptions): Promise<boolean> {
  return folderExists(getRepoPath(options));
}

export function deleteRepo(options: BackportOptions) {
  const repoPath = getRepoPath(options);
  return del(repoPath);
}

export function getRemoteUrl(
  { repoName, accessToken, gitHostname }: BackportOptions,
  repoOwner: string
) {
  return `https://${accessToken}@${gitHostname}/${repoOwner}/${repoName}.git`;
}

export function cloneRepo(
  options: BackportOptions,
  callback: (progress: string) => void
) {
  return new Promise((resolve, reject) => {
    const cb = (error: any) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const execProcess = execAsCallback(
      `git clone ${getRemoteUrl(options, options.repoOwner)} --progress`,
      { cwd: getRepoOwnerPath(options), maxBuffer: 100 * 1024 * 1024 },
      cb
    );

    if (execProcess.stderr) {
      execProcess.stderr.on('data', (data) => {
        const regex = /^Receiving objects:\s+(\d+)%/;
        const [, progress]: RegExpMatchArray =
          data.toString().match(regex) || [];
        if (progress) {
          callback(progress);
        }
      });
    }
  });
}

export async function deleteRemote(
  options: BackportOptions,
  remoteName: string
) {
  try {
    await exec(`git remote rm ${remoteName}`, { cwd: getRepoPath(options) });
  } catch (e) {
    const isExecError = e.code === 128;
    // re-throw if error is not an exec related error
    if (!isExecError) {
      throw e;
    }
  }
}

export async function addRemote(options: BackportOptions, remoteName: string) {
  try {
    await exec(
      `git remote add ${remoteName} ${getRemoteUrl(options, remoteName)}`,
      { cwd: getRepoPath(options) }
    );
  } catch (e) {
    // note: swallowing error
    return;
  }
}

export function cherrypick(options: BackportOptions, commit: CommitSelected) {
  return exec(
    `git fetch ${options.repoOwner} ${commit.branch}:${commit.branch} --force && git cherry-pick ${commit.sha}`,
    { cwd: getRepoPath(options) }
  );
}

export async function cherrypickContinue(options: BackportOptions) {
  // -c core.editor=true is like "--no-edit": it avoids opening the default editor for editing the commit message
  try {
    await exec(`git -c core.editor=true cherry-pick --continue`, {
      cwd: getRepoPath(options),
    });
  } catch (e) {
    const isCherrypickError = e.code === 128;
    if (isCherrypickError) {
      logger.info(
        `Cherry pick continue failed. Probably because the cherry pick operation was manually completed. ${JSON.stringify(
          e
        )}`
      );
      return;
    }
    throw e;
  }
}

export async function getFilesWithConflicts(options: BackportOptions) {
  const repoPath = getRepoPath(options);
  try {
    await exec(`git --no-pager diff --check`, { cwd: repoPath });

    return [];
  } catch (e) {
    const isConflictError = e.code === 2;
    if (isConflictError) {
      const files = (e.stdout as string)
        .split('\n')
        .filter((line: string) => !!line.trim())
        .map((line: string) => {
          const posSeparator = line.indexOf(':');
          const filename = line.slice(0, posSeparator).trim();
          return ` - ${pathResolve(repoPath, filename)}`;
        });

      return uniq(files);
    }

    // rethrow error since it's unrelated
    throw e;
  }
}

export function setCommitAuthor(options: BackportOptions, username: string) {
  return exec(
    `git commit --amend --no-edit --author "${username} <${username}@users.noreply.github.com>"`,
    { cwd: getRepoPath(options) }
  );
}

export async function getUnstagedFiles(options: BackportOptions) {
  const repoPath = getRepoPath(options);
  const { stdout } = await exec(`git add --update --dry-run`, {
    cwd: repoPath,
  });

  return stdout
    .split('\n')
    .map((line) => {
      const res = /\w+ '(.*)'/.exec(line) || [];
      return res[1];
    })
    .filter((line) => !!line)
    .map((file) => ` - ${pathResolve(repoPath, file)}`);
}

export async function addUnstagedFiles(options: BackportOptions) {
  return exec(`git add --update`, { cwd: getRepoPath(options) });
}

export async function createFeatureBranch(
  options: BackportOptions,
  baseBranch: string,
  featureBranch: string
) {
  try {
    return await exec(
      `git reset --hard && git clean -d --force && git fetch ${options.repoOwner} ${baseBranch} && git checkout -B ${featureBranch} ${options.repoOwner}/${baseBranch} --no-track`,
      { cwd: getRepoPath(options) }
    );
  } catch (e) {
    const isBranchInvalid =
      e.stderr?.toLowerCase().includes(`couldn't find remote ref`) ||
      e.stderr?.toLowerCase().includes(`Invalid refspec`);

    if (isBranchInvalid) {
      throw new HandledError(
        `The branch "${baseBranch}" is invalid or doesn't exist`
      );
    }
    throw e;
  }
}

export function deleteFeatureBranch(
  options: BackportOptions,
  featureBranch: string
) {
  return exec(
    `git checkout ${options.sourceBranch} && git branch -D ${featureBranch}`,
    { cwd: getRepoPath(options) }
  );
}

export function getRemoteName(options: BackportOptions) {
  return options.fork ? options.username : options.repoOwner;
}

export function pushFeatureBranch(
  options: BackportOptions,
  featureBranch: string
) {
  const remoteName = getRemoteName(options);
  return exec(
    `git push ${remoteName} ${featureBranch}:${featureBranch} --force`,
    { cwd: getRepoPath(options) }
  );
}
