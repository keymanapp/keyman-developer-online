import { Injectable } from '@nestjs/common';

import { Observable, of } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';

import { ConfigService } from '../config/config.service';
import { GitService } from '../git/git.service';
import { fileExists, readdir } from '../utils/file';

import fs = require('fs');
import path = require('path');
import debugModule = require('debug');
const debug = debugModule('kdo:backendProject');

@Injectable()
export class BackendProjectService {
  constructor(private config: ConfigService, private gitService: GitService) {}

  public getProjectRepo(userName: string, projectName: string): string {
    return path.join(this.config.workDirectory, userName, projectName);
  }

  public cloneOrUpdateProject(
    remoteRepo: string,
    localRepo: string,
    localBranch: string,
    remoteName: string,
    remoteBranch: string = localBranch,
  ): Observable<string> {
    return fileExists(localRepo).pipe(
      switchMap(exists => {
        if (exists) {
          debug(`localRepo '${localRepo}' exists, updating local repo`);
          return this.updateLocalRepo(localRepo, localBranch, remoteName, remoteRepo, remoteBranch);
        } else {
          debug(`localRepo '${localRepo}' does not exist, cloning ${remoteRepo} as ${remoteName}`);
          debug(`branch ${ remoteBranch } (local branch: ${ localBranch })`);
          return this.cloneRepoAndCheckoutBranch(localRepo, localBranch, remoteName, remoteRepo, remoteBranch);
        }
      }),
      tap(() => debug('cloneOrUpdateProject finished')),
    );
  }

  private cloneRepoAndCheckoutBranch(
    localRepo: string,
    localBranch: string,
    remoteName: string,
    remoteRepo: string,
    remoteBranch: string,
  ): Observable<string> {
    return this.gitService.clone(remoteRepo, localRepo, false, remoteName).pipe(
      switchMap(() => this.checkoutBranch(localRepo, localBranch, `${remoteName}/${remoteBranch}`)),
    );
  }

  private updateLocalRepo(
    localRepo: string,
    localBranch: string,
    remoteName: string,
    remoteRepo: string,
    remoteBranch: string,
  ): Observable<string> {
    debug(`checking if ${localRepo} has remote ${remoteName}`);
    return this.gitService.hasRemote(localRepo, remoteName).pipe(
      switchMap(hasRemote => {
        if (!hasRemote) {
          debug(`nope - add remote ${remoteName} and fetch branch ${remoteBranch} of ${localRepo} from ${remoteRepo}`);
          // add remote and fetch repo
          return this.addRemoteAndFetchRepo(localRepo, remoteRepo, remoteName, remoteBranch);
        }
        debug(`yep - we have remote ${remoteName}; fetching ${localRepo} and pulling branch ${localBranch} from ${remoteName}`);
        return this.gitService.fetch(localRepo, remoteName).pipe(
          switchMap(() => this.gitService.pull(localRepo, remoteName, localBranch)),
          catchError(err => {
            // this can happen when running e2e tests where things get partially reset between
            // tests
            if (err.message.indexOf(`couldn't find remote ref ${localBranch}`) >= 0) {
              return this.gitService.fetch(localRepo, remoteName, remoteBranch);
            }
            throw err;
          }),
          map(() => { return; }),
        );
      }),
      switchMap(() => this.checkoutBranchIfItDoesNotExist(localRepo, localBranch, remoteName, remoteBranch)),
      switchMap(() => this.gitService.pull(localRepo, remoteName, remoteBranch)),
      map(() => localRepo),
    );
  }

  private addRemoteAndFetchRepo(
    localRepo: string,
    remoteRepo: string,
    remoteName: string,
    remoteBranch: string,
  ): Observable<void> {
    return this.gitService.addRemote(localRepo, remoteName, remoteRepo).pipe(
      switchMap(() => this.gitService.fetch(localRepo, remoteName, remoteBranch)),
      map(() => { return; }),
    );
  }

  private checkoutBranchIfItDoesNotExist(
    localRepo: string,
    localBranch: string,
    remoteName: string,
    remoteBranch: string,
  ): Observable<void> {
    return this.gitService.isBranch(localRepo, localBranch).pipe(
      switchMap(branchExists => {
        if (!branchExists) {
          return this.checkoutBranch(localRepo, localBranch, `${remoteName}/${remoteBranch}`);
        }
        return of(localRepo);
      }),
      map(() => { return; }),
    );
  }

  private checkoutBranch(
    localRepo: string,
    localBranch: string,
    remoteBranch?: string,
  ): Observable<string> {
    if (remoteBranch) {
      return this.gitService.checkoutBranch(localRepo, localBranch, remoteBranch).pipe(
        map(() => localRepo),
      );
    }
    return this.gitService.checkoutBranch(localRepo, localBranch).pipe(
      map(() => localRepo),
    );
  }

  public get branchName(): string {
    return 'master';
  }

  public get localKeyboardsRepo(): string {
    return path.join(this.config.workDirectory, this.config.keyboardsRepoName);
  }

  public getKeyboardId(repoName: string, localRepo: string): string {
    const files = fs.readdirSync(localRepo).filter(fn => fn.endsWith('.keyboard_info'));
    if (files?.length) {
      const keyboardInfoFile = path.join(localRepo, files[0]);
      if (fs.existsSync(keyboardInfoFile)) {
        const fileContent = fs.readFileSync(keyboardInfoFile);
        const data = JSON.parse(fileContent.toString());
        if (data.id) {
          return data.id;
        }
      }
    }

    return repoName;
  }

  public isSingleKeyboardRepo(localRepo: string): Observable<boolean> {
    return readdir(localRepo).pipe(
      map(files => {
        const newFiles: string[] = [];
        for (const f of files) {
          const fn = f.toString();
          if (fn.endsWith('.keyboard_info')) {
            newFiles.push(f.toString());
          }
        }
        return newFiles;
      }),
      map(files => files?.length > 0),
    );
  }
}
