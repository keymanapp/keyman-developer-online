import { Injectable } from '@nestjs/common';

import { debug } from 'debug';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, map, mapTo, mergeMap, switchMap, takeLast, tap } from 'rxjs/operators';
import simpleGit, { CommitResult, FetchResult, Options, PullResult, SimpleGit } from 'simple-git';
import { BranchSummary, LogResult } from 'simple-git/typings/response';

import { fileExists, mkdir } from '../utils/file';

import path = require('path');
import debugModule = require('debug');
const trace = debugModule('kdo:git');

const gitKdoUserName = 'Keyman Developer Online';
const gitKdoEmail = 'kdo@example.com';

@Injectable()
export class GitService {
  private git: SimpleGit;

  constructor() {
    this.git = simpleGit();

    // To enable debug output, set the environment variable DEBUG=debug (or DEBUG=*)
    if (debugModule.enabled('debug')) {
      // see https://github.com/steveukx/git-js/blob/HEAD/docs/DEBUG-LOGGING-GUIDE.md
      debug.enable('simple-git,simple-git:*');
    }
  }

  private addDefaultConfig(): Observable<void> {
    // Set default values
    return from(this.git.addConfig('user.name', gitKdoUserName)).pipe(
      switchMap(() => from(this.git.addConfig('user.email', gitKdoEmail))),
      switchMap(() => from(this.git.addConfig('init.defaultBranch', 'master'))),
      switchMap(() => from(this.git.addConfig('commit.gpgSign', 'false'))),
      switchMap(() => from(this.git.addConfig('push.gpgSign', 'false'))),
      switchMap(() => from(this.git.addConfig('tag.gpgSign', 'false'))),
    ).pipe( // this might look strange, but seems a pipe can have at most 10 parameters
      switchMap(() => from(this.git.addConfig('core.whitespace',
        '-space-before-tab,-indent-with-no-tab,-tab-in-indent,-trailing-space'))),
      switchMap(() => from(this.git.addConfig('branch.autosetupmerge', 'true'))),
      switchMap(() => from(this.git.addConfig('branch.autosetuprebase', 'always'))),
      switchMap(() => from(this.git.addConfig('branch.master.rebase', 'true'))),
      switchMap(() => from(this.git.addConfig('pull.rebase', 'true'))),
      map(() => { return; }),
    );
  }

  public createRepo(
    repoPath: string,
    bare = false,
  ): Observable<string> {
    return mkdir(repoPath).pipe(
      switchMap(() => from(this.git.cwd(repoPath))),
      switchMap(() => from(this.git.init(bare))),
      switchMap(() => this.addDefaultConfig()),
      mapTo(repoPath),
    );
  }

  public addFile(repoDir: string, filename: string): Observable<void> {
    return from(this.git.cwd(repoDir)).pipe(
      switchMap(() => from(this.git.add(filename))),
      map(() => { return; })
    );
  }

  public commit(
    repoDir: string,
    message: string,
    options?: Options,
  ): Observable<CommitResult> {
    return from(this.git.cwd(repoDir)).pipe(
      switchMap(() => from(this.git.commit(message, null, options))),
    );
  }

  public clone(
    remoteUrl: string,
    localPath: string,
    bare = false,
    remoteName?: string,
  ): Observable<string> {
    if (!path.isAbsolute(localPath)) {
      return throwError(new Error('relative path'));
    }

    const options: string[] = [];
    if (bare) {
      options.push('--bare');
    }
    if (remoteName) {
      options.push(`--origin=${remoteName}`);
    } else {
      remoteName = 'origin';
    }

    const notesRef = `remote.${remoteName}.fetch`;

    trace(`clone remoteUrl: ${remoteUrl}, localPath: ${localPath}, options: ${options}`);
    const parentDir = path.dirname(localPath);
    return mkdir(parentDir, { recursive: true }).pipe(
      switchMap(() => from(this.git.cwd(parentDir))),
      switchMap(() => from(this.git.clone(remoteUrl, localPath, options))),
      switchMap(() => from(this.git.cwd(localPath))),
      switchMap(() => this.addDefaultConfig()),
      switchMap(() => from(this.git.raw(['config', '--add', notesRef, '+refs/notes/*:refs/notes/*']))),
      switchMap(() => from(this.git.fetch(remoteName))),
      mapTo(localPath),
    );
  }

  public export(
    repoDir: string,
    commit: string,
    rangeOption: string | null = null,
  ): Observable<[string, string[]]> {
    const args: string[] = [];
    let commitSha: string;
    args.push('format-patch');
    if (rangeOption) {
      args.push(rangeOption);
    }
    args.push(commit);
    return from(this.git.cwd(repoDir)).pipe(
      switchMap(() => from(this.git.log({ '-1': null }))),
      tap((result: LogResult) => commitSha = result.latest.hash),
      switchMap(() => from(this.git.raw(args))),
      map(patchNames => {
        const result: string[] = [];
        for (const patch of patchNames.trim().split('\n')) {
          result.push(path.join(repoDir, patch.trim()));
        }
        return result;
      }),
      map(patchNames => [commitSha, patchNames]),
    );
  }

  public import(
    repoDir: string,
    patchFile: string,
  ): Observable<void> {
    return from(this.git.cwd(repoDir)).pipe(
      map(() => patchFile),
      tap(file => trace(`importing ${file}`)),
      mergeMap(file => from(this.git.raw(['am', '--ignore-whitespace', file]))),
      map(() => { /* void */ }),
      takeLast(1),
    );
  }

  public log(
    repoDir: string,
    options?: unknown,
  ): Observable<LogResult> {
    if (options) {
      return from(this.git.cwd(repoDir)).pipe(
        switchMap(() => from(this.git.log(options))),
      );
    }
    return from(this.git.cwd(repoDir)).pipe(
      switchMap(() => from(this.git.log())),
    );
  }

  public checkoutBranch(
    repoDir: string,
    name: string,
    trackingBranch?: string,
  ): Observable<void> {
    return from(this.git.cwd(repoDir)).pipe(
      switchMap(() => this.isBranch(repoDir, name)),
      switchMap(branchExists => {
        if (branchExists) {
          return from(this.git.checkout(name)).pipe(map(() => { return; }));
        } else {
          if (trackingBranch) {
            return from(this.git.checkoutBranch(name, trackingBranch));
          } else {
            return from(this.git.checkoutLocalBranch(name));
          }
        }
      }),
    );
  }

  public getBranches(repoDir: string): Observable<BranchSummary> {
    return from(this.git.cwd(repoDir)).pipe(switchMap(() => from(this.git.branchLocal())));
  }

  public isBranch(repoDir: string, name: string): Observable<boolean> {
    return from(this.git.cwd(repoDir)).pipe(
      switchMap(() => from(this.git.branchLocal())),
      map(branchSummary => branchSummary.all.findIndex(value => value === name) !== -1),
    );
  }

  public currentBranch(repoDir: string): Observable<string> {
    return from(this.git.cwd(repoDir)).pipe(
      switchMap(() => from(this.git.branchLocal())),
      map(branchSummary => branchSummary.current),
    );
  }

  public push(
    repoDir: string,
    remote: string,
    branch: string,
    token: string,
  ): Observable<void> {
    if (token.startsWith('Basic')) {
      // Used in e2e tests
    return from(this.git.cwd(repoDir)).pipe(
      switchMap(() => from(this.git.raw([
        '-c',
        `http.extraheader=Authorization: ${token}`,
        'push',
        remote,
        branch,
      ]))),
        catchError(() => { trace('got error in push'); return of(0); }),
        tap(() => trace('push finished')),
        map(() => {
          return;
        }),
      );
    }
    return from(this.git.cwd(repoDir)).pipe(
      switchMap(() => from(this.git.raw(['config', `remote.${remote}.url`]))),
      switchMap(urlString => {
        if (urlString.startsWith('http')) {
          const url = new URL(urlString);
          return of(`${url.protocol}//x-access-token:${token.replace('token ', '')}@${url.host}${url.pathname}`);
        } else {
          return of(remote);
        }
      }),
      switchMap(remoteUrl => from(this.git.push(remoteUrl, branch))),
      catchError(() => { trace('got error in push'); return of(0); }),
      tap(() => trace('push finished')),
      map(() => {
        return;
      }),
    );
  }

  public fetch(
    repoDir: string,
    remote: string,
    remoteBranch?: string,
  ): Observable<FetchResult> {
    return from(this.git.cwd(repoDir)).pipe(
      tap(() => trace(`${repoDir}: git fetch ${remote} ${remoteBranch}`)),
      switchMap(() => from(this.git.fetch(remote, remoteBranch))),
    );
  }

  public pull(
    repoDir: string,
    remote?: string,
    branch?: string,
  ): Observable<PullResult> {
    if (remote) {
      return from(this.git.cwd(repoDir)).pipe(
        tap(() => trace(`${repoDir}: git pull ${remote} ${branch}`)),
        switchMap(() => from(this.git.pull(remote, branch))),
      );
    }
    return from(this.git.cwd(repoDir)).pipe(
      switchMap(() => from(this.git.pull())),
    );
  }

  public isGitRepo(repoDir: string): Observable<boolean> {
    return fileExists(repoDir).pipe(
      switchMap(exists => {
        if (!exists) {
          return of(false);
        }
        return from(this.git.cwd(repoDir)).pipe(
          switchMap(() => from(this.git.checkIsRepo())),
        );
      }),
    );
  }

  public hasRemote(
    repoDir: string,
    remoteName: string,
  ): Observable<boolean> {
    return from(this.git.cwd(repoDir)).pipe(
      switchMap(() => from(this.git.getRemotes(false))),
      map(remotes => {
        for (const remote of remotes) {
          if (remote.name === remoteName) {
            return true;
          }
        }
        return false;
      }),
    );
  }

  public addRemote(
    repoDir: string,
    remoteName: string,
    remoteRepo: string,
  ): Observable<void> {
    return from(this.git.cwd(repoDir)).pipe(
      switchMap(() => from(this.git.addRemote(remoteName, remoteRepo))),
      map(() => { return; })
    );
  }

  public createNote(
    repoDir: string,
    commitSha: string,
    message: string,
  ): Observable<void> {
    return from(this.git.cwd(repoDir)).pipe(
      switchMap(() => from(this.git.raw(['notes', '--ref=kdo', 'add', commitSha, '-m', message]))),
      catchError((err: string) => throwError(new Error(err))),
      map(() => { return; }),
    );
  }

  public readLastNote(
    repoDir: string,
  ): Observable<{ commitSha: string; message: string }> {
    return this.hasCommits(repoDir).pipe(
      switchMap(hasCommits => {
        if (!hasCommits) {
          return of({ commitSha: '', message: '' });
        }
        return this.log(repoDir, ['--notes=kdo', '--pretty=format: \'%H %N\'']).pipe(
          map(list => list.latest),
          map(logLine => logLine.hash),
          map(s => {
            const result = /'([0-9a-f]+) ([^\n]+)\n'/.exec(s);
            if (result) {
              return { commitSha: result[1], message: result[2] };
            } else {
              return { commitSha: '', message: '' };
            }
          }),
        );
      }),
    );
  }

  public reset(
    repoDir: string,
    commitSha: string,
  ): Observable<void> {
    return from(this.git.cwd(repoDir)).pipe(
      switchMap(() => from(this.git.raw(['reset', '--hard', commitSha]))),
      catchError((err: string) => throwError(new Error(err))),
      map(() => { return; }),
    );
  }

  public hasCommits(repoDir: string): Observable<boolean> {
    return from(this.git.cwd(repoDir)).pipe(
      switchMap(() => from(this.git.raw(['rev-list', '-n', '1', '--all']))),
      map(output => (typeof output != 'undefined' && output) ? true : false),
    );
  }

  public getHeadCommit(repoDir: string): Observable<string> {
    return from(this.git.cwd(repoDir)).pipe(
      switchMap(() => from(this.git.raw(['rev-list', '-n', '1', '--all']))),
      switchMap(hasCommits => {
        if (hasCommits) {
          return from(this.log(repoDir, { '-1': null })).pipe(
            map((result: LogResult) => result.latest.hash),
          );
        }
        return of('');
      }),
    );
  }
}
