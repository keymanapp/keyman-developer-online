import { HttpService, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import * as base64 from 'base-64';
import { execSync } from 'child_process';
import debugModule from 'debug';
import { empty, forkJoin, from, interval, Observable, of } from 'rxjs';
import { catchError, map, switchMap, takeLast, takeWhile } from 'rxjs/operators';

import { AppModule } from '../src/app.module';
import { ConfigService } from '../src/config/config.service';
import { GithubService } from '../src/github/github.service';
import { GitHubPullRequest } from '../src/interfaces/git-hub-pull-request.interface';
import { Project } from '../src/interfaces/project.interface';
import { TransferInfo } from '../src/interfaces/transfer-info';
import { deleteFolderRecursive } from '../src/utils/delete-folder';
import { writeFile } from '../src/utils/file';
import { fileExists, mkdtemp } from '../src/utils/file';
import { describeIf } from '../src/utils/test-utils';

import session = require('supertest-session');
import fs = require('fs');
import path = require('path');
import os = require('os');

const debug = debugModule('kdo:e2e');

import colors = require('colors');
colors.enable();

function canRunTheseTests(): boolean {
  return (
    process.env.TEST_GITHUB_TOKEN != null &&
    process.env.TEST_GITHUB_USER != null
  );
}

describeIf('ProjectsController (e2e)', canRunTheseTests(), () => {
  let app: INestApplication;
  let httpService: HttpService;
  let token: string;
  let user: string;
  let testSession: any;
  let authenticatedSession: any;
  let githubService: GithubService;
  let configService: ConfigService;
  let tmpWorkDir: string;

  function git(command: string, dir: string): string {
    // simple-git queues the git commands. This causes problems when running these unit tests
    // because we run a lot of git commands and depend on the returned output. simple-git
    // sometimes returned too early. I wasn't able to figure out why or how to prevent this.
    // Instead we directly call git for the test setup. If we discover that similar problems
    // happen in production code we might have to replace simple-git with something else.
    return execSync(`git ${command}`, { cwd: dir, stdio: ['pipe', 'pipe', 'ignore'] }).toString();
  }

  function deleteGitHubKeyboardsRepo(): Observable<void> {
    const keyboardsRepo = `https://api.github.com/repos/${user}/${configService.keyboardsRepoName}`;
    return httpService.delete(keyboardsRepo, {
      headers: { Authorization: token },
    }).pipe(
      catchError(err => of({ data: err })),
      // when we try to fork a repo that already exists GitHub creates a repo-1, so we delete
      // that as well
      switchMap(() => httpService.delete(`${keyboardsRepo}-1`, {
        headers: { Authorization: token },
      })),
      catchError(err => of({ data: err })),
      switchMap(() => {
        const keyboardsRepoGone = waitForRepoToNotExist(user, configService.keyboardsRepoName);
        const keyboardsRepo1Gone = waitForRepoToNotExist(user, `${configService.keyboardsRepoName}-1`);
        return forkJoin({ keyboardsRepoGone, keyboardsRepo1Gone });
      }),
      catchError(() => empty()),
      map(() => { return; }),
    );
  }

  function waitForRepoToNotExist(
    owner: string,
    repo: string,
    timeoutSeconds = 300,
  ): Observable<void> {
    return interval(1000).pipe(
      switchMap((x: number) => {
        if (x >= timeoutSeconds) {
          throw new Error(`timeout after ${timeoutSeconds} seconds without seeing repo`);
        }

        return githubService.repoExists(owner, repo);
      }),
      takeWhile(exists => exists),
      takeLast(1),
      map(() => { /* empty */ }),
    );
  }

  function authenticate(): Promise<void> {
    return new Promise((resolve, reject) => {
    testSession
      .get(`/api/auth/user/test/${user}`)
      .set('Authorization', token)
      .expect(200)
      .end((err: any, res: any) => {
          if (err) {
            reject(err);
          } else {
            authenticatedSession = testSession;
            resolve(res);
          }
      });
    });
  }

  function deleteLocalRepos(): void {
    deleteFolderRecursive(path.join(tmpWorkDir, '*'));
  }

  function cleanKeyboardsRepo(): Observable<void> {
    const keyboardsRepo = path.join(
      configService.workDirectory,
      configService.keyboardsRepoName,
    );
    return fileExists(keyboardsRepo).pipe(
      switchMap(exists => {
        if (!exists) {
          return empty();
        }
        return fileExists(path.join(keyboardsRepo, '.git', 'rebase-apply')).pipe(
          switchMap(rebaseApplyExists => {
            if (rebaseApplyExists) {
              git('am --abort', keyboardsRepo);
            }
            git('checkout master', keyboardsRepo);
            git(`branch -D ${user}-test_kdo_khmer_angkor`, keyboardsRepo);
            git('clean -fdx', keyboardsRepo);
            git(`reset --hard ${user}/master`, keyboardsRepo);
            return empty();
          }),
        );
      }),
    );
  }

  function cleanTestBranch(): Observable<void> {
    const keyboardsRepo = path.join(
      configService.workDirectory,
      configService.keyboardsRepoName,
    );
    return fileExists(keyboardsRepo).pipe(
      switchMap(exists => {
        if (!exists) {
          return empty();
        }
        git('checkout master', keyboardsRepo);
        git(`-c "http.extraheader=Authorization: ${token}" push ${user} :${user}-test_kdo_khmer_angkor`, keyboardsRepo);
        git(`fetch -p ${user}`, keyboardsRepo);
        return empty();
      }),
    );
  }

  function closeAllPullRequests(): Observable<void> {
    return githubService.listPullRequests(
      token,
      configService.organizationName,
      configService.keyboardsRepoName,
    ).pipe(
      switchMap(pullRequest => githubService.closePullRequest(
        token,
        configService.organizationName,
        configService.keyboardsRepoName,
        pullRequest.number)),
      map(() => { return; }),
    );
  }

  beforeAll(async () => {
    if (!canRunTheseTests()) {
      return;
    }
    jest.setTimeout(60000 /* 60s */);
    jest.useRealTimers();
    const accessToken = process.env.TEST_GITHUB_TOKEN;
    user = process.env.TEST_GITHUB_USER;

    const tokenString = `${user}:${accessToken}`;
    token = `Basic ${base64.encode(tokenString)}`;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    httpService = moduleFixture.get<HttpService>(HttpService);
    githubService = moduleFixture.get<GithubService>(GithubService);
    configService = moduleFixture.get<ConfigService>(ConfigService);

    const prefix = path.join(os.tmpdir(), 'projectse2e-');
    tmpWorkDir = await mkdtemp(prefix).toPromise();

    jest.spyOn(configService, 'organizationName', 'get')
      .mockImplementation(() => 'keymanapptest');
    jest.spyOn(configService, 'keyboardsRepoName', 'get')
      .mockImplementation(() => 'test_kdo_keyboards');
    jest.spyOn(configService, 'workDirectory', 'get')
      .mockImplementation(() => tmpWorkDir);

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    testSession = session(app.getHttpServer());
    await authenticate();
    await cleanKeyboardsRepo().toPromise();
    await cleanTestBranch().toPromise();
    const delKeyboardsRepo = deleteGitHubKeyboardsRepo().toPromise();
    deleteLocalRepos();
    await delKeyboardsRepo;
  });

  afterAll(async () => {
    if (!canRunTheseTests()) {
      return;
    }
    deleteFolderRecursive(tmpWorkDir);
    await app.close();
  });

  beforeEach(async () => {
    jest.resetModules();
    await authenticate();
  });

  afterEach(done => {
    closeAllPullRequests().pipe(
      catchError(() => empty()),
    ).subscribe(
      next => debug(`afterEach next: ${next}`),
      err => debug(`afterEach error: ${err}`),
      () => done(),
    ).add(
      cleanKeyboardsRepo().pipe(
        catchError(() => empty()),
      ).subscribe()
    ).add(
      cleanTestBranch().pipe(
        catchError(() => empty()),
        switchMap(() => deleteGitHubKeyboardsRepo()),
      ).subscribe()
    );

    deleteLocalRepos();
  });

  describe('create project: /api/projects/:repo (POST)', () => {
    it('clones single-keyboard project and forks and clones keyboards repo', () => {
      // Execute/Verify
      return authenticatedSession
        .post('/api/projects/test_kdo_khmer_angkor')
        .set('Authorization', token)
        .expect(201)
        .then(() => {
          const keyboardsRepo = path.join(
            configService.workDirectory,
            configService.keyboardsRepoName,
          );
          expect(fs.existsSync(keyboardsRepo)).toBe(true);
        });
    });

    it('clones single-keyboard project and clones keyboards repo if keyboards repo exists', async () => {
      // Setup
      await githubService.forkRepo(
        token,
        configService.organizationName,
        configService.keyboardsRepoName,
        user,
      ).toPromise();

      // Execute/Verify
      return authenticatedSession
        .post('/api/projects/test_kdo_khmer_angkor')
        .set('Authorization', token)
        .expect(201)
        .then(() => {
          const keyboardsRepo = path.join(
            configService.workDirectory,
            configService.keyboardsRepoName,
          );
          expect(fs.existsSync(keyboardsRepo)).toBe(true);
        });
    });
  });

  let cloneDir: string;
  let tmpDir: string;

  function addDefaultConfiguration(
    repoDir: string
  ): void {
    git('config user.name "Keyman Developer Online e2e tests"', repoDir);
    git('config user.email kdo@example.com', repoDir);
    git('config init.defaultBranch master', repoDir);
    git('config commit.gpgSign false', repoDir);
    git('config push.gpgSign false', repoDir);
    git('config tag.gpgSign false', repoDir);
    git('config --add remote.origin.fetch +refs/notes/*:refs/notes/*', repoDir);
    git('config branch.autosetupmerge true', repoDir);
    git('config branch.autosetuprebase always', repoDir);
    git('config branch.master.rebase true', repoDir);
    git('config pull.rebase true', repoDir);
    git('config core.whitespace -space-before-tab,-indent-with-no-tab,-tab-in-indent,-trailing-space', repoDir);
  }

  async function cloneLocalKeyboardsRepo(): Promise<string> {
    const kbDir = path.join(tmpDir, configService.keyboardsRepoName);

    // clone keyboards repo
    if (!await fileExists(kbDir).toPromise()) {
      git(`clone https://github.com/${user}/${configService.keyboardsRepoName} ${kbDir}`, tmpDir);
      addDefaultConfiguration(kbDir);
    }
    git('fetch -p origin', kbDir);
    return kbDir;
  }

  async function createOrUpdateProjectOnServer(): Promise<Project> {
    return await authenticatedSession
      .post('/api/projects/test_kdo_khmer_angkor')
      .set('Authorization', token);
  }

  function readLastNote(repoDir: string): { commitSha: string; noteInfo: TransferInfo } {
    git('fetch origin', repoDir);
    const logline = git('log -1 --notes=kdo --format="%H %N"', repoDir);
    const result = /([0-9a-f]+) ([^\n]+)\n/.exec(logline);
    if (result) {
      const noteInfo = JSON.parse(result[2]);
      return { commitSha: result[1], noteInfo };
    }
    return { commitSha: '', noteInfo: new TransferInfo('', '', '') };
  }

  function fetchFromGitHub(repoDir: string): void {
    git('fetch origin', repoDir);
  }

  function getHeadCommit(repoDir: string): string {
    const objHash = git('rev-list -1 --all', repoDir);
    if (objHash) {
      return git('log -1 --format=%H', repoDir).replace(/\n$/, '');
    }
    return '';
  }

  async function updateLocalRepos(): Promise<string> {
    const kbDir = await cloneLocalKeyboardsRepo();
    fetchFromGitHub(kbDir);
    git(`checkout -b ${user}-test_kdo_khmer_angkor origin/${user}-test_kdo_khmer_angkor`, kbDir);
    fetchFromGitHub(cloneDir);
    git('checkout master', cloneDir);
    git('pull origin master', cloneDir);
    return kbDir;
  }

  async function createPullRequest(
    name = 'test_kdo_khmer_angkor',
    prefix?: string,
  ): Promise<{ body: GitHubPullRequest }> {
    return await from(authenticatedSession
      .put('/api/projects/test_kdo_khmer_angkor')
      .set('Authorization', token)
      .send({ name, prefix })
    ).toPromise() as { body: GitHubPullRequest };
  }

  function verifyNotes(
    singleKeyboardRepoDir: string,
    keyboardsRepoDir: string
  ): void {
    const skbrNote = readLastNote(singleKeyboardRepoDir);
    const skbrCommit = getHeadCommit(singleKeyboardRepoDir);
    const kbNote = readLastNote(keyboardsRepoDir);
    const kbCommit = getHeadCommit(keyboardsRepoDir);
    expect(skbrNote.commitSha).toEqual(skbrCommit);
    expect(skbrNote.noteInfo.msg).toEqual(`KDO exported to ${kbNote.commitSha}`);
    expect(kbNote.commitSha).toEqual(kbCommit);
    expect(kbNote.noteInfo.msg).toEqual(`KDO imported from ${skbrNote.commitSha}`);
  }

  describe('create PR: /api/projects/:repo (PUT)', () => {
    beforeEach(async () => {
      jest.setTimeout(300000 /* 5m */);
      const prefix = path.join(tmpWorkDir, 'localRepos-');
      tmpDir = await mkdtemp(prefix).toPromise();
      cloneDir = path.join(tmpDir, 'test_kdo_khmer_angkor');

      // clone single keyboard repo
      git(`clone https://github.com/${user}/test_kdo_khmer_angkor ${cloneDir}`, tmpDir);
      addDefaultConfiguration(cloneDir);
      git('fetch -p origin', cloneDir);

      // reset to backup branch and amend HEAD commit to remove git notes which might be there
      // from previous test run
      git('checkout master', cloneDir);
      git('reset --hard origin/backup', cloneDir);
      const log = git('log -1 --format="%s %b"', cloneDir);
      git(`commit --amend -m "${log}"`, cloneDir);

      // force push skr
      git(`-c "http.extraheader=Authorization: ${token}" push --force origin master`, cloneDir);
    });

    it('can create PR from new commits on single-keyboard repo', async () => {
      // Setup
      debug('Setup of test "can create PR from new commits on single-keyboard repo"'.black.bgYellow);
      await createOrUpdateProjectOnServer();

      // Execute
      debug('Executing test "can create PR from new commits on single-keyboard repo"'.yellow.bgBlack);
      return authenticatedSession
        .put('/api/projects/test_kdo_khmer_angkor')
        .set('Authorization', token)
        .send({ name: 'test_kdo_khmer_angkor' })
        // Verify
        .expect(201)
        .then(async (response: { body: GitHubPullRequest }) => {
          expect(response.body.number).toBeGreaterThan(0);
          expect(response.body.action).toEqual('created');

          const kbDir = await updateLocalRepos();
          verifyNotes(cloneDir, kbDir);
        });
    });

    it('can create PR from new commits with different name and prefix', async () => {
      // Setup
      debug('Setup of test "can create PR from new commits with different name and prefix"'.black.bgYellow);
      await createOrUpdateProjectOnServer();

      // Execute
      debug('Executing test "can create PR from new commits with different name and prefix"'.yellow.bgBlack);
      return authenticatedSession
        .put('/api/projects/test_kdo_khmer_angkor')
        .set('Authorization', token)
        .send({ name: 'foobar', prefix: 'foo'})
        // Verify
        .expect(201)
        .then(async (response: { body: GitHubPullRequest }) => {
          expect(response.body.number).toBeGreaterThan(0);
          expect(response.body.action).toEqual('created');
          const ghDetailsResponse = await httpService.get('https://api.github.com/repos/' +
            `${configService.organizationName}/${configService.keyboardsRepoName}/pulls/` +
            `${response.body.number}`, {
            headers: { Authorization: token },
          }).toPromise();
          expect(ghDetailsResponse.data.title).toEqual('[foobar] Add foobar keyboard');

          const kbDir = await updateLocalRepos();
          verifyNotes(cloneDir, kbDir);
          const exists = await fileExists(
            path.join(kbDir, 'release', 'foo', 'foobar', 'khmer_angkor.kpj')
          ).toPromise();
          expect(exists).toBe(true);
        });
    });

    it('can not update a PR if there are no new commits on single-keyboard repo', async () => {
      // Setup
      debug('Setup of test "can not update a PR if there are no new commits on single-keyboard repo"'.black.bgYellow);
      await createOrUpdateProjectOnServer();

      await createPullRequest();

      // Execute
      debug('Executing test "can not update a PR if there are no new commits on single-keyboard repo"'.yellow.bgBlack);
      return authenticatedSession
        .put('/api/projects/test_kdo_khmer_angkor')
        .set('Authorization', token)
        .send({ name: 'test_kdo_khmer_angkor' })
        // Verify
        .expect(304)
    });

    it('can update a PR with new commits on single-keyboard repo', async () => {
      // Setup
      debug('Setup of test "can update a PR with new commits on single-keyboard repo"'.black.bgYellow);
      await createOrUpdateProjectOnServer();

      const resp = await createPullRequest();
      const prNumber = resp.body.number;
      const initialSkrNote = readLastNote(cloneDir);

      const newFile = path.join(cloneDir, 'NewFile.txt');
      await writeFile(newFile, 'This is just a file for testing').toPromise();
      git(`add ${newFile}`, cloneDir);
      git('commit -m "A new commit with a new file"', cloneDir);
      git(`-c "http.extraheader=Authorization: ${token}" push origin`, cloneDir);
      await createOrUpdateProjectOnServer();

      // Execute
      debug('Executing test "can update a PR with new commits on single-keyboard repo"'.yellow.bgBlack);
      return authenticatedSession
        .put('/api/projects/test_kdo_khmer_angkor')
        .set('Authorization', token)
        .send({ name: 'test_kdo_khmer_angkor' })
        // Verify
        .expect(201)
        .then(async (response: { body: GitHubPullRequest }) => {
          expect(response.body.number).toEqual(prNumber);
          expect(response.body.action).toEqual('existing');

          const kbDir = await updateLocalRepos();
          verifyNotes(cloneDir, kbDir);
          const newSkrNote = readLastNote(cloneDir);
          expect(newSkrNote.noteInfo.msg).not.toEqual(initialSkrNote.noteInfo.msg);
          expect(newSkrNote.noteInfo.keyboardName).toEqual(initialSkrNote.noteInfo.keyboardName);
          expect(newSkrNote.noteInfo.prefix).toEqual(initialSkrNote.noteInfo.prefix);
        });
    });

    it('can update a PR with new commits with different name and prefix', async () => {
      // Setup
      debug('Setup of test "can update a PR with different name and prefix"'.black.bgYellow);
      await createOrUpdateProjectOnServer();

      const resp = await createPullRequest('foobar', 'foo');
      const prNumber = resp.body.number;
      const initialSkrNote = readLastNote(cloneDir);

      const newFile = path.join(cloneDir, 'NewFile.txt');
      await writeFile(newFile, 'This is just a file for testing').toPromise();
      git(`add ${newFile}`, cloneDir);
      git('commit -m "A new commit with a new file"', cloneDir);
      git(`-c "http.extraheader=Authorization: ${token}" push origin`, cloneDir);
      await createOrUpdateProjectOnServer();

      // Execute
      debug('Executing test "can update a PR with different name and prefix"'.yellow.bgBlack);
      return authenticatedSession
        .put('/api/projects/test_kdo_khmer_angkor')
        .set('Authorization', token)
        .send({ name: 'foobar', prefix: 'foo' })
        // Verify
        .expect(201)
        .then(async (response: { body: GitHubPullRequest }) => {
          expect(response.body.number).toEqual(prNumber);
          expect(response.body.action).toEqual('existing');

          const ghDetailsResponse = await httpService.get('https://api.github.com/repos/' +
            `${configService.organizationName}/${configService.keyboardsRepoName}/pulls/` +
            `${response.body.number}`, {
            headers: { Authorization: token },
          }).toPromise();
          expect(ghDetailsResponse.data.title).toEqual('[foobar] Add foobar keyboard');

          const kbDir = await updateLocalRepos();
          verifyNotes(cloneDir, kbDir);
          const newSkrNote = readLastNote(cloneDir);
          expect(newSkrNote.noteInfo.msg).not.toEqual(initialSkrNote.noteInfo.msg);
          expect(newSkrNote.noteInfo.keyboardName).toEqual(initialSkrNote.noteInfo.keyboardName);
          expect(newSkrNote.noteInfo.prefix).toEqual(initialSkrNote.noteInfo.prefix);
          const exists = await fileExists(
            path.join(kbDir, 'release', 'foo', 'foobar', 'NewFile.txt')
          ).toPromise();
          expect(exists).toBe(true);
        });
    });

    it('can not update a PR if it got force-pushed', async () => {
      // Setup
      debug('Setup of test "can not update a PR if it got force-pushed"'.black.bgYellow);
      await createOrUpdateProjectOnServer();

      await createPullRequest();

      git('commit --amend -m "Amended commit"', cloneDir);
      git(`-c "http.extraheader=Authorization: ${token}" push --force origin master`, cloneDir);
      await createOrUpdateProjectOnServer();

      // Execute
      debug('Executing test "can not update a PR if it got force-pushed"'.yellow.bgBlack);
      return authenticatedSession
        .put('/api/projects/test_kdo_khmer_angkor')
        .set('Authorization', token)
        .send({ name: 'test_kdo_khmer_angkor' })
        // Verify
        .expect(412);
    });

    it('can not update a PR if keyboards repo branch changed', async () => {
      // Setup
      debug('Setup of test "can not update a PR if keyboards repo branch changed"'.black.bgYellow);
      await createOrUpdateProjectOnServer();
      await createPullRequest();

      const kbDir = await cloneLocalKeyboardsRepo();
      const newFile = path.join(kbDir, 'NewFile.txt');
      await writeFile(newFile, 'This is just a file for testing').toPromise();
      git(`checkout -b ${user}-test_kdo_khmer_angkor origin/${user}-test_kdo_khmer_angkor`, kbDir);
      git(`add ${newFile}`, kbDir);
      git('commit -m "A new commit with a new file"', kbDir);
      git(`-c "http.extraheader=Authorization: ${token}" push origin`, kbDir);
      await createOrUpdateProjectOnServer();

      // Execute
      debug('Executing test "can not update a PR if keyboards repo branch changed"'.yellow.bgBlack);
      return authenticatedSession
        .put('/api/projects/test_kdo_khmer_angkor')
        .set('Authorization', token)
        .send({ name: 'test_kdo_khmer_angkor' })
        // Verify
        .expect(409);
    });
  });

  describe('get PR: /api/projects/:repo (GET)', () => {

    beforeEach(async () => {
      jest.setTimeout(300000 /* 5m */);
      const prefix = path.join(tmpWorkDir, 'localRepos-');
      tmpDir = await mkdtemp(prefix).toPromise();
      cloneDir = path.join(tmpDir, 'test_kdo_khmer_angkor');

      // clone single keyboard repo
      git(`clone https://github.com/${user}/test_kdo_khmer_angkor ${cloneDir}`, tmpDir);
      addDefaultConfiguration(cloneDir);
      git('fetch -p origin', cloneDir);

      // reset to backup branch and amend HEAD commit to remove git notes which might be there
      // from previous test run
      git('checkout master', cloneDir);
      git('reset --hard origin/backup', cloneDir);
      const log = git('log -1 --format="%s %b"', cloneDir);
      git(`commit --amend -m "${log}"`, cloneDir);

      // force push skr
      git(`-c "http.extraheader=Authorization: ${token}" push --force origin master`, cloneDir);
    });

    it('gets PR data from regular PR', async () => {
      // Setup
      debug('Setup of test "gets PR data from regular PR"'.black.bgYellow);
      await createOrUpdateProjectOnServer();

      const resp = await createPullRequest();
      const prNumber = resp.body.number;

      // Execute
      debug('Executing test "gets PR data from regular PR"'.yellow.bgBlack);
      return authenticatedSession
        .get('/api/projects/test_kdo_khmer_angkor')
        .set('Authorization', token)
        // Verify
        .expect(200)
        .then((response: { body: GitHubPullRequest }) => {
          expect(response.body.number).toEqual(prNumber);
          expect(response.body.action).toEqual('existing');
        });
    });

  });
});
