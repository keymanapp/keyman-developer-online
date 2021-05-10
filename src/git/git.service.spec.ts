import { Test, TestingModule } from '@nestjs/testing';

import { forkJoin, from, Observable } from 'rxjs';
import { map, switchMap, tap } from 'rxjs/operators';
import simpleGit, { CommitResult, SimpleGit } from 'simple-git';

import { deleteFolderRecursive } from '../utils/delete-folder';
import { appendFile, fileExists, mkdir, mkdtemp } from '../utils/file';
import { GitService } from './git.service';

import os = require('os');
import path = require('path');

describe('GitService', () => {
  let sut: GitService;
  let tmpDir: string;
  let module: TestingModule;
  let git: SimpleGit;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [GitService],
    }).compile();

    const prefix = path.join(os.tmpdir(), 'gitrepotest-');
    tmpDir = await mkdtemp(prefix).toPromise();
    sut = module.get<GitService>(GitService);
    git = simpleGit();
    jest.setTimeout(10000/* 10s */);
  });

  afterEach(() => {
    deleteFolderRecursive(tmpDir);
  });

  function createInitialCommit(
    service: GitService,
    repoDir: string,
    msg = 'my commit message',
  ): Observable<CommitResult> {
    const filePath1 = path.join(repoDir, 'somefile1.txt');
    const filePath2 = path.join(repoDir, 'somefile2.txt');
    return forkJoin([
      appendFile(filePath1, 'some text'),
      appendFile(filePath2, 'other text'),
    ]).pipe(
      switchMap(() =>
        forkJoin([
          service.addFile(repoDir, filePath1),
          service.addFile(repoDir, filePath2),
        ]),
      ),
      switchMap(() => service.commit(repoDir, msg)),
    );
  }

  function addCommit(
    service: GitService,
    repoDir: string,
    file: string,
    textToAppend: string,
    commitMessage: string): Observable<CommitResult> {
    return appendFile(file, textToAppend).pipe(
      switchMap(() => service.addFile(repoDir, file)),
      switchMap(() => service.commit(repoDir, commitMessage)),
    );
  }

  it('should be defined', () => {
    expect(sut).toBeDefined();
  });

  describe('createRepo', () => {
    it('Can create git repo', async () => {
      expect.assertions(2);
      const expectedRepoDir = path.join(tmpDir, 'mytest');
      const dir = await sut.createRepo(expectedRepoDir).toPromise();
      expect(dir).toEqual(expectedRepoDir);
      expect(await fileExists(path.join(expectedRepoDir, '.git')).toPromise()).toBeTruthy();
    });

    it('can add files and commit', async () => {
      expect.assertions(2);

      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      const commitResult = await createInitialCommit(sut, repoDir).toPromise();

      expect(commitResult.branch).toEqual('master');
      expect(commitResult.commit).toBeTruthy();
    });
  });

  describe('log', () => {
    it('can determine latest commit', async () => {
      // Setup
      expect.assertions(2);
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      await createInitialCommit(sut, repoDir).toPromise();
      const secondCommit = await addCommit(sut, repoDir, path.join(repoDir, 'somefile1.txt'), 'Additional text', 'second commit').toPromise();

      // Execute
      const log = await sut.log(repoDir, { '-1': null }).toPromise();

      // Verify
      const expected = new RegExp(`^${secondCommit.commit}.+`);
      expect(log.latest.hash).toMatch(expected);
      expect(log.total).toEqual(1);
    });

    it('gets all commits', async () => {
      // Setup
      expect.assertions(1);
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      await createInitialCommit(sut, repoDir).toPromise();
      await addCommit(sut, repoDir, path.join(repoDir, 'somefile1.txt'), 'Additional text', 'second commit').toPromise();

      // Execute
      const log = await sut.log(repoDir).toPromise();

      // Verify
      expect(log.total).toEqual(2);
    });
  });

  describe('clone', () => {
    it('fails clone if relative path', async () => {
      expect.assertions(1);

      // Setup
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      await createInitialCommit(sut, repoDir).toPromise();

      // Execute/Verify
      await expect(sut.clone(repoDir, 'clonedRepo').toPromise())
        .rejects.toEqual(new Error('relative path'));
    });

    it('can clone the repo with correct path if localname contains full path', async () => {
      expect.assertions(4);

      // Setup
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      await createInitialCommit(sut, repoDir).toPromise();

      // Execute
      const cloneDir = await sut
        .clone(repoDir, path.join(tmpDir, 'clonedRepo'))
        .toPromise();

      // Verify
      expect(cloneDir).toEqual(path.join(tmpDir, 'clonedRepo'));
      expect(await fileExists(path.join(cloneDir, '.git')).toPromise()).toBeTruthy();
      expect(await fileExists(path.join(cloneDir, 'somefile1.txt')).toPromise()).toBeTruthy();
      expect(await fileExists(path.join(cloneDir, 'somefile2.txt')).toPromise()).toBeTruthy();
    });

    it('sets expected remote when cloning', async () => {
      // Setup
      expect.assertions(3);
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      await createInitialCommit(sut, repoDir).toPromise();

      // Execute
      const cloneDir = await sut
        .clone(repoDir, path.join(tmpDir, 'clonedRepo'), false, 'foo')
        .toPromise();

      // Verify
      expect(cloneDir).toEqual(path.join(tmpDir, 'clonedRepo'));
      expect(await fileExists(path.join(cloneDir, '.git')).toPromise()).toBeTruthy();
      await git.cwd(cloneDir);
      const remotes = await git.getRemotes(false);
      expect(remotes[0].name).toEqual('foo');
    });
  });

  describe('export and import', () => {
    it('can export and import patch', async () => {
      expect.assertions(5);

      // Setup 1+2
      let repoDir: string;
      let secondRepoDir: string;
      const promise = sut.createRepo(path.join(tmpDir, 'mytest')).pipe(
        tap(dir => repoDir = dir),
        switchMap(() => createInitialCommit(sut, repoDir)),
        switchMap(() => sut.clone(repoDir, path.join(tmpDir, 'secondRepo'))),
        tap(dir => secondRepoDir = dir),
        switchMap(() => addCommit(
          sut,
          repoDir,
          path.join(repoDir, 'somefile1.txt'),
          'Additional text',
          'second commit',
        )),
        switchMap(() => sut.log(secondRepoDir)),
      ).toPromise();
      let log = await promise;
      expect(log.total).toEqual(1);

      // Execute 1
      const [commit, patches] = await sut.export(repoDir, 'HEAD', '-1').toPromise();

      // Verify 1
      log = await sut.log(repoDir).toPromise();
      expect(commit).toEqual(log.latest.hash);
      expect(patches.length).toEqual(1);
      expect(patches[0]).toEqual(path.join(repoDir, '0001-second-commit.patch'));

      // Execute 2
      await sut.import(secondRepoDir, patches[0]).toPromise();

      // Verify 2
      log = await sut.log(secondRepoDir).toPromise();
      expect(log.total).toEqual(2);
    });

    it('can export and import multiple patches', async () => {
      // Setup 1
      expect.assertions(4);
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      await createInitialCommit(sut, repoDir).toPromise();
      await addCommit(sut, repoDir, path.join(repoDir, 'somefile1.txt'), 'Additional text', 'second commit').toPromise();

      // Execute 1
      const [, patches] = await sut.export(repoDir, 'HEAD', '--root').toPromise();

      // Verify 1
      expect(patches.length).toEqual(2);
      expect(patches[0]).toEqual(path.join(repoDir, '0001-my-commit-message.patch'));
      expect(patches[1]).toEqual(path.join(repoDir, '0002-second-commit.patch'));

      // Setup 2
      const secondRepoDir = await sut.createRepo(path.join(tmpDir, 'secondRepo')).toPromise();

      // Execute 2
      await sut.import(secondRepoDir, patches[0]).toPromise();
      await sut.import(secondRepoDir, patches[1]).toPromise();

      // Verify 2
      const log = await sut.log(secondRepoDir).toPromise();
      expect(log.total).toEqual(2);
    });

    it('can export a range of commits', async () => {
      // Setup
      expect.assertions(3);
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      await createInitialCommit(sut, repoDir).toPromise();
      await addCommit(
        sut,
        repoDir,
        path.join(repoDir, 'somefile1.txt'),
        'Additional text',
        'second commit',
      ).toPromise();
      await addCommit(
        sut,
        repoDir,
        path.join(repoDir, 'somefile1.txt'),
        'Some more text',
        'third commit',
      ).toPromise();

      // Execute
      const [, patches] = await sut.export(repoDir, 'HEAD^^..HEAD').toPromise();

      // Verify
      expect(patches.length).toEqual(2);
      expect(patches[0]).toEqual(
        path.join(repoDir, '0001-second-commit.patch'),
      );
      expect(patches[1]).toEqual(
        path.join(repoDir, '0002-third-commit.patch'),
      );
    });

    it('can import patches', async () => {
      expect.assertions(1);

      // Setup
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      await createInitialCommit(sut, repoDir).toPromise();
      await addCommit(
        sut,
        repoDir,
        path.join(repoDir, 'somefile1.txt'),
        'Additional text',
        'second commit',
      ).toPromise();
      const [, patches] = await sut.export(repoDir, 'HEAD', '--root').toPromise();
      const secondRepoDir = await sut.createRepo(path.join(tmpDir, 'secondRepo')).toPromise();

      // Execute
      await sut.import(secondRepoDir, patches[0]).toPromise();
      await sut.import(secondRepoDir, patches[1]).toPromise();

      // Verify
      const log = await sut.log(secondRepoDir).toPromise();
      expect(log.total).toEqual(2);
    });

  });

  describe('checkoutBranch', () => {
    it('can create new branch', async () => {
      expect.assertions(5);

      // Setup
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      await createInitialCommit(sut, repoDir).toPromise();

      // Execute
      await sut.checkoutBranch(repoDir, 'test').toPromise();
      await addCommit(
        sut,
        repoDir,
        path.join(repoDir, 'somefile1.txt'),
        'Additional text',
        'commit on test branch',
      ).toPromise();

      // Verify
      const branchSummary = await sut.getBranches(repoDir).toPromise();
      expect(branchSummary.all).toContain('test');
      expect(branchSummary.current).toEqual('test');
      expect(branchSummary.branches.test.label).toContain('commit on test branch');
      expect(branchSummary.branches.master.label).toContain('my commit message');
      expect(branchSummary.branches.test.commit).not.toEqual(branchSummary.branches.master.commit);
    });

    it('can checkout existing branch with different local name', async () => {
      expect.assertions(6);

      // Setup
      const upstreamRepoDir = await sut.createRepo(path.join(tmpDir, 'upstreamRepo'), true).toPromise();
      const repoDir = await sut
        .clone(upstreamRepoDir, path.join(tmpDir, 'mytest'))
        .toPromise();
      await createInitialCommit(sut, repoDir).toPromise();
      await sut.push(repoDir, 'origin', 'master', 'tokenvalue').toPromise();

      // Execute
      await sut.checkoutBranch(repoDir, 'test', 'origin/master').toPromise();

      // Verify
      await sut.checkoutBranch(repoDir, 'master').toPromise();
      await addCommit(
        sut,
        repoDir,
        path.join(repoDir, 'somefile1.txt'),
        'Additional text',
        'commit on master branch',
      ).toPromise();
      await sut.push(repoDir, 'origin', 'master', 'tokenvalue').toPromise();
      await sut.checkoutBranch(repoDir, 'test').toPromise();
      await sut.pull(repoDir).toPromise();

      const branchSummary = await sut.getBranches(repoDir).toPromise();
      expect(branchSummary.all).toContain('test');
      expect(branchSummary.all).toContain('master');
      expect(branchSummary.current).toEqual('test');
      expect(branchSummary.branches.test.label).toEqual('commit on master branch');
      expect(branchSummary.branches.test.label).toEqual('commit on master branch');
      expect(branchSummary.branches.test.commit).toEqual(branchSummary.branches.master.commit);
    });

    it('trying to create an existing branch does not fail', async () => {
      expect.assertions(5);

      // Setup
      let repoDir: string;
      await sut.createRepo(path.join(tmpDir, 'mytest')).pipe(
        map(dir => (repoDir = dir)),
        switchMap(() => createInitialCommit(sut, repoDir)),
        switchMap(() => sut.checkoutBranch(repoDir, 'test')),
        switchMap(() => addCommit(
          sut,
          repoDir,
          path.join(repoDir, 'somefile1.txt'),
          'Additional text',
          'commit on test branch',
        )),
      ).toPromise();

      // Execute
      await sut.checkoutBranch(repoDir, 'test').toPromise();

      // Verify
      const branchSummary = await sut.getBranches(repoDir).toPromise();
      expect(branchSummary.all).toContain('test');
      expect(branchSummary.current).toEqual('test');
      expect(branchSummary.branches.test.label).toContain('commit on test branch');
      expect(branchSummary.branches.master.label).toContain('my commit message');
      expect(branchSummary.branches.test.commit).not.toEqual(
        branchSummary.branches.master.commit,
      );
    });

    it('can get current branch', async () => {
      expect.assertions(2);

      // Setup
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      await createInitialCommit(sut, repoDir).toPromise();
      await sut.checkoutBranch(repoDir, 'test').toPromise();

      // Execute/Verify
      expect(await sut.currentBranch(repoDir).toPromise()).toEqual('test');
      await sut.checkoutBranch(repoDir, 'master').toPromise();
      expect(await sut.currentBranch(repoDir).toPromise()).toEqual('master');
    });
  });

  describe('isBranch', () => {
    it('can check that branch exists', async () => {
      expect.assertions(1);

      // Setup
      let repoDir;
      await sut.createRepo(path.join(tmpDir, 'mytest')).pipe(
        tap(dir => { repoDir = dir; }),
        switchMap(() => createInitialCommit(sut, repoDir)),
        switchMap(() => sut.checkoutBranch(repoDir, 'test')),
      ).toPromise();

      // Execute
      const isBranch = await sut.isBranch(repoDir, 'test').toPromise();

      // Verify
      expect(isBranch).toBeTruthy();
    });
  });

  describe('push', () => {
    it('can push', async () => {
      expect.assertions(1);

      // Setup
      const bareRepoDir = await sut.createRepo(path.join(tmpDir, 'bareRepo'), true).toPromise();
      const clonedDir = await sut
        .clone(bareRepoDir, path.join(tmpDir, 'clonedRepo'))
        .toPromise();
      await createInitialCommit(sut, clonedDir).toPromise();
      const commit = await addCommit(
        sut,
        clonedDir,
        path.join(clonedDir, 'somefile1.txt'),
        'Additional text',
        'commit on test branch',
      ).toPromise();

      // Execute
      await sut.push(clonedDir, 'origin', 'master', 'tokenvalue').toPromise();

      // Verify
      const log = await sut.log(bareRepoDir).toPromise();
      const expected = new RegExp(`^${commit.commit}.+`);
      expect(log.latest.hash).toMatch(expected);
    });
  });

  describe('pull', () => {
    it('can pull', async () => {
      expect.assertions(1);

      // Setup
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      await createInitialCommit(sut, repoDir).toPromise();
      const clonedDir = await sut
        .clone(repoDir, path.join(tmpDir, 'clonedRepo'))
        .toPromise();
      const commit = await addCommit(
        sut,
        repoDir,
        path.join(repoDir, 'somefile1.txt'),
        'Additional text',
        'commit on test branch',
      ).toPromise();

      // Execute (pull from mytest to clonedRepo)
      await sut.pull(clonedDir, 'origin', 'master').toPromise();

      // Verify
      const log = await sut.log(clonedDir).toPromise();
      const expected = new RegExp(`^${commit.commit}.+`);
      expect(log.latest.hash).toMatch(expected);
    });

    it('can pull from default', async () => {
      expect.assertions(1);

      // Setup
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      await createInitialCommit(sut, repoDir).toPromise();
      const clonedDir = await sut
        .clone(repoDir, path.join(tmpDir, 'clonedRepo'))
        .toPromise();
      const commit = await addCommit(
        sut,
        repoDir,
        path.join(repoDir, 'somefile1.txt'),
        'Additional text',
        'commit on test branch',
      ).toPromise();

      // Execute (pull from mytest to clonedRepo)
      await sut.pull(clonedDir).toPromise();

      // Verify
      const log = await sut.log(clonedDir).toPromise();
      const expected = new RegExp(`^${commit.commit}.+`);
      expect(log.latest.hash).toMatch(expected);
    });
  });

  describe('fetch', () => {
    it('can fetch from remote', async () => {
      // Setup
      expect.assertions(1);
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      await createInitialCommit(sut, repoDir).toPromise();
      const clonedDir = await sut
        .clone(repoDir, path.join(tmpDir, 'clonedRepo'), false, 'upstream')
        .toPromise();
      const commit = await addCommit(
        sut,
        repoDir,
        path.join(repoDir, 'somefile1.txt'),
        'Additional text',
        'commit on test branch',
      ).toPromise();

      // Execute
      await sut.fetch(clonedDir, 'upstream', 'master').toPromise();

      // Verify
      await sut.checkoutBranch(clonedDir, 'foo', 'upstream/master').toPromise();
      const log = await sut.log(clonedDir).toPromise();
      const expected = new RegExp(`^${commit.commit}.+`);
      expect(log.latest.hash).toMatch(expected);
    });
  });

  describe('isGitRepo', () => {
    it('isGitRepo returns false for normal directory', async () => {
      expect.assertions(1);

      // Setup
      const repoPath = path.join(tmpDir, 'normalDir');
      await mkdir(repoPath).toPromise();

      // Execute
      const isRepo = await sut.isGitRepo(repoPath).toPromise();

      // Verify
      expect(isRepo).toEqual(false);
    });

    it('isGitRepo returns false for non-existing directory', async () => {
      expect.assertions(1);

      // Setup
      const repoPath = path.join(tmpDir, 'non-existing');

      // Execute
      const isRepo = await sut.isGitRepo(repoPath).toPromise();

      // Verify
      expect(isRepo).toEqual(false);
    });

    it('isGitRepo returns true for git directory', async () => {
      expect.assertions(1);

      // Setup
      const repoPath = path.join(tmpDir, 'normalDir');
      await sut.createRepo(repoPath).toPromise();

      // Execute
      const isRepo = await sut.isGitRepo(repoPath).toPromise();

      // Verify
      expect(isRepo).toEqual(true);
    });
  });

  describe('hasRemote', () => {

    it('returns false if remote is not set', async () => {
      // Setup
      expect.assertions(1);
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      await createInitialCommit(sut, repoDir).toPromise();
      const cloneDir = await sut
        .clone(repoDir, path.join(tmpDir, 'clonedRepo'), false, 'foo')
        .toPromise();

      // Execute
      const hasBar = await sut.hasRemote(cloneDir, 'bar').toPromise();

      // Verify
      expect(hasBar).toBe(false);
    });

    it('returns true if remote is set', async () => {
      // Setup
      expect.assertions(1);
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      await createInitialCommit(sut, repoDir).toPromise();
      const cloneDir = await sut
        .clone(repoDir, path.join(tmpDir, 'clonedRepo'), false, 'foo')
        .toPromise();

      // Execute
      const hasFoo = await sut.hasRemote(cloneDir, 'foo').toPromise();

      // Verify
      expect(hasFoo).toBe(true);
    });
  });

  describe('addRemote', () => {
    it('can add a new remote', async () => {
      // Setup
      expect.assertions(2);
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      await createInitialCommit(sut, repoDir).toPromise();
      const cloneDir = await sut
        .clone(repoDir, path.join(tmpDir, 'clonedRepo'))
        .toPromise();

      // Execute
      await sut.addRemote(cloneDir, 'jdoe', 'https://url.to/remote/repo.git').toPromise();

      // Verify
      expect(await sut.hasRemote(cloneDir, 'origin').toPromise()).toBe(true);
      expect(await sut.hasRemote(cloneDir, 'jdoe').toPromise()).toBe(true);
    });
  });

  describe('createNote', () => {
    it('can create a note', async () => {
      // Setup
      expect.assertions(2);
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      await createInitialCommit(sut, repoDir).toPromise();

      // Execute
      await sut.createNote(repoDir, 'HEAD', 'Imported from deadbeef').toPromise();

      // Verify
      const notes = await from(git.cwd(repoDir)).pipe(
        switchMap(() => from(git.raw(['notes', '--ref=kdo', 'list']))),
      ).toPromise();
      expect(notes).not.toBeNull();
      const message = await from(git.cwd(repoDir)).pipe(
        switchMap(() => from(git.raw(['notes', '--ref=kdo', 'show', notes.split(new RegExp(/ |\r|\n/))[1]]))),
      ).toPromise();
      expect(message).toMatch(/Imported from deadbeef/);
    });

    it('does fail if we create same note twice', async () => {
      // Setup
      expect.assertions(1);
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      await createInitialCommit(sut, repoDir).toPromise();
      await sut.createNote(repoDir, 'HEAD', 'Imported from deadbeef').toPromise();

      // Execute/Verify
      try {
        await sut.createNote(repoDir, 'HEAD', 'Second note').toPromise();
      } catch (e) {
        expect(e.message).toMatch(/error: Cannot add notes. Found existing notes for object [0-9a-f]+. Use '-f' to overwrite existing notes/);
      }
    });
  });

  describe('readLastNote', () => {
    it('returns empty if no notes', async () => {
      // Setup
      expect.assertions(2);
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      await createInitialCommit(sut, repoDir).toPromise();

      // Execute
      const noteInfo = await sut.readLastNote(repoDir).toPromise();

      // Verify
      expect(noteInfo.commitSha).toBe('');
      expect(noteInfo.message).toBe('');
    });

    it('returns empty if no commits in repo', async () => {
      // Setup
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();

      // Execute
      const noteInfo = await sut.readLastNote(repoDir).toPromise();

      // Verify
      expect(noteInfo.commitSha).toBe('');
      expect(noteInfo.message).toBe('');
    });

    it('returns note of HEAD', async () => {
      // Setup
      expect.assertions(2);
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      const commit = await createInitialCommit(sut, repoDir).toPromise();
      await sut.createNote(repoDir, 'HEAD', 'Imported from deadbeef').toPromise();

      // Execute
      const noteInfo = await sut.readLastNote(repoDir).toPromise();

      // Verify
      expect(noteInfo.commitSha).toMatch(/[0-9a-f]+$/.exec(commit.commit)[0]);
      expect(noteInfo.message).toBe('Imported from deadbeef');
    });

    it('returns latest note of several', async () => {
      // Setup
      expect.assertions(2);
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      await createInitialCommit(sut, repoDir).toPromise();
      await sut.createNote(repoDir, 'HEAD', 'Imported from deadbeef').toPromise();
      const commit = await addCommit(sut, repoDir, path.join(repoDir, 'somefile1.txt'), 'Additional text', 'second commit').toPromise();
      await sut.createNote(repoDir, 'HEAD', 'Other import').toPromise();

      // Execute
      const noteInfo = await sut.readLastNote(repoDir).toPromise();

      // Verify
      expect(noteInfo.commitSha).toMatch(/[0-9a-f]+$/.exec(commit.commit)[0]);
      expect(noteInfo.message).toBe('Other import');
    });

    it('returns latest note if not HEAD', async () => {
      // Setup
      expect.assertions(2);
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      await createInitialCommit(sut, repoDir).toPromise();
      await sut.createNote(repoDir, 'HEAD', 'Imported from deadbeef').toPromise();
      const commit = await addCommit(sut, repoDir, path.join(repoDir, 'somefile1.txt'), 'Additional text', 'second commit').toPromise();
      await sut.createNote(repoDir, 'HEAD', 'Other import').toPromise();
      await addCommit(sut, repoDir, path.join(repoDir, 'somefile2.txt'), 'Additional text', 'third commit').toPromise();

      // Execute
      const noteInfo = await sut.readLastNote(repoDir).toPromise();

      // Verify
      expect(noteInfo.commitSha).toMatch(/[0-9a-f]+$/.exec(commit.commit)[0]);
      expect(noteInfo.message).toBe('Other import');
    });
  });

  describe('hasCommits', () => {
    it('returns true if there are commits', async () => {
      // Setup
      expect.assertions(1);
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      await createInitialCommit(sut, repoDir).toPromise();

      // Execute/Verify
      expect(await sut.hasCommits(repoDir).toPromise()).toBe(true);
    });

    it('returns false if there are no commits', async () => {
      // Setup
      expect.assertions(1);
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();

      // Execute/Verify
      expect(await sut.hasCommits(repoDir).toPromise()).toBe(false);
    });
  });

  describe('getHeadCommit', () => {
    it('returns commit sha of HEAD', async () => {
      // Setup
      expect.assertions(1);
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();
      const commitInfo = await createInitialCommit(sut, repoDir).toPromise();
      const expectedCommit = commitInfo.commit;

      // Execute
      const head = await sut.getHeadCommit(repoDir).toPromise();

      // Verify
      expect(head).toMatch(new RegExp(`^${expectedCommit}.+`));
    });

    it('does not fail on empty repo', async () => {
      // Setup
      expect.assertions(1);
      const repoDir = await sut.createRepo(path.join(tmpDir, 'mytest')).toPromise();

      // Execute
      const head = await sut.getHeadCommit(repoDir).toPromise();

      // Verify
      expect(head).toBe('');
    });
  });
});
