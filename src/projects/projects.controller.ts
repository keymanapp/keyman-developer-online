/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import {
  BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpException, Param, Post, Put,
  Session
} from '@nestjs/common';
import {
  ApiBadRequestResponse, ApiBasicAuth, ApiBody, ApiHeader, ApiOAuth2, ApiOperation, ApiParam,
  ApiQuery, ApiResponse, ApiTags, ApiUnauthorizedResponse, getSchemaPath
} from '@nestjs/swagger';

import { Observable, of } from 'rxjs';
import { catchError, filter, last, map, switchMap, tap, toArray } from 'rxjs/operators';

import { BackendProjectService } from '../backend-project/backend-project.service';
import { ConfigService } from '../config/config.service';
import { GitService } from '../git/git.service';
import { GithubService } from '../github/github.service';
import { GitHubPullRequest } from '../interfaces/git-hub-pull-request.interface';
import { Project } from '../interfaces/project.interface';
import { PullRequestService } from '../pull-request/pull-request.service';

import path = require('path');
import debugModule = require('debug');
const debug = debugModule('kdo:projects');

const prTitle = '[${repo}] Add ${repo} keyboard';
const prDescription = 'Merge the single keyboard repo ${repo} into the keyboards repo. Courtesy of Keyman Developer Online.';

@Controller('projects')
@ApiTags('project related')
@ApiOAuth2(['repo'], 'Default')
@ApiBasicAuth('Tests')
export class ProjectsController {
  constructor(
    private readonly githubService: GithubService,
    private readonly backendService: BackendProjectService,
    private readonly configService: ConfigService,
    private readonly pullRequestService: PullRequestService,
    private readonly gitService: GitService,
  ) {}

  public get gitHubUrl(): string {
    return 'https://github.com';
  }

  @Get('all')
  @ApiOperation({
    summary: 'Get repos of the user',
    description: 'Gets all GitHub repos of the user.',
  })
  @ApiHeader({
    // This header is required, however it's taken care of by the security schemas.
    // Setting `required: false` here allows to try the API through the Swagger UI
    // without explicitly filling in the authorization token.
    name: 'authorization',
    required: false,
  })
  @ApiQuery({
    name: 'page',
    description: 'Which page of repos to get',
    schema: {
      type: 'integer',
      default: 1,
    },
    required: false,
  })
  @ApiQuery({
    name: 'pageSize',
    description: 'How many repos to get per page',
    schema: {
      type: 'integer',
      default: 100,
    },
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'OK',
    schema: {
      type: 'array',
      items: {
        $ref: getSchemaPath(Project),
      },
      example: [{ name: 'Hello-World', repoUrl: '' }, { name: 'My-Keyboard', repoUrl: '' }],
    },
  })
  @ApiUnauthorizedResponse({ description: 'Not authenticated' })
  public getRepos(
    @Session() session: any,
    @Headers('authorization') token: string,
    page = 1,
    pageSize = 100,
  ): Observable<Project[]> {
    return this.githubService.getRepos(token, page, pageSize).pipe(
      filter(project => project.owner.login === session.login),
      map(project => ({ name: project.name })),
      toArray(),
    );
  }

  @Post(':repo')
  @ApiOperation({
    summary: 'Create a project',
    description: `Create a project based on the specified repo, i.e. the backend will clone the
      (single keyboard) GitHub repo on the server. If the project already exists it will be
      updated.`,
  })
  @ApiHeader({
    // This header is required, however it's taken care of by the security schemas.
    // Setting `required: false` here allows to try the API through the Swagger UI
    // without explicitly filling in the authorization token.
    name: 'authorization',
    required: false,
  })
  @ApiParam({
    name: 'repo',
    type: 'string',
    description: 'The name of the single-keyboard GitHub repo',
  })
  @ApiResponse({ status: 201, description: 'Created', type: Project })
  @ApiBadRequestResponse({ description: 'Repo is not a single-keyboard repo' })
  @ApiUnauthorizedResponse({ description: 'Not authenticated' })
  @HttpCode(201)
  public createRepo(
    @Session() session: any,
    @Headers('authorization') token: string,
    @Param('repo') repo: string,
  ): Observable<Project> {
    const localSkRepo = this.backendService.getProjectRepo(session.login, repo);
    const remoteSkRepo = `${this.gitHubUrl}/${session.login}/${repo}.git`;

    debug(`In createRepo: login: ${session.login}, repo: ${repo}, localRepo: ${localSkRepo}, \\`);
    debug(`    remoteRepo: ${ remoteSkRepo }, branch: ${ this.backendService.branchName }`);

    return this.forkCloneAndUpdateProject(
      token, session.login, this.configService.keyboardsRepoName, repo, 'master',
    ).pipe(
      tap(project => debug(`forkCloneAndUpdateProject(keyboards) created in ${project}`)),
      switchMap(() => this.backendService.cloneOrUpdateProject(
        remoteSkRepo, localSkRepo, this.backendService.branchName, session.login,
      )),
      tap(project => debug(`cloneOrUpdateProject(singleProj) created in ${project}`)),
      switchMap(() => this.backendService.isSingleKeyboardRepo(localSkRepo)),
      switchMap(isSkRepo => {
        if (!isSkRepo) {
          debug(`${repo} is not a single-keyboard repo`);
          throw new BadRequestException(`${repo} is not a single-keyboard repo`);
        }
        return this.githubService.pullRequestExists(
          token,
          this.configService.organizationName,
          this.configService.keyboardsRepoName,
          `${session.login}:${session.login}-${repo}`,
        ).pipe(
          catchError(() => of(false)),
          switchMap(prExists => {
            if (prExists) {
              return this.pullRequestService.readLastNote(localSkRepo).pipe(
                map(note => ({
                  name: note.noteInfo.keyboardName,
                  repoUrl: remoteSkRepo,
                  prefix: note.noteInfo.prefix,
                })),
              );
            }
            const keyboardId = this.backendService.getKeyboardId(repo, localSkRepo);
            return of({
              name: keyboardId,
              repoUrl: remoteSkRepo,
              prefix: this.pullRequestService.getPrefix(keyboardId, null),
            } as Project);
          }),
        );
      }),
    );
  }

  private forkCloneAndUpdateProject(
    token: string,
    gitHubUser: string,
    repoName: string,
    branchName: string,
    remoteBranch: string,
  ): Observable<string> {
    return this.githubService
      .forkRepo(token, this.configService.organizationName, repoName, gitHubUser)
      .pipe(
        switchMap(() => {
          const remoteKeyboardsRepo = `${this.gitHubUrl}/${gitHubUser}/${this.configService.keyboardsRepoName}.git`;
          const localKeyboardsRepo = this.backendService.localKeyboardsRepo;
          return this.backendService.cloneOrUpdateProject(
            remoteKeyboardsRepo,
            localKeyboardsRepo,
            `${gitHubUser}-${branchName}`,
            gitHubUser,
            remoteBranch,
          );
        }),
      );
  }

  @Put(':repo')
  @ApiOperation({
    summary: 'Creates or updates a pull request',
    description: 'Creates or updates a pull request based on the specified repo',
  })
  @ApiHeader({
    // This header is required, however it's taken care of by the security schemas.
    // Setting `required: false` here allows to try the API through the Swagger UI
    // without explicitly filling in the authorization token.
    name: 'authorization',
    required: false,
  })
  @ApiParam({
    name: 'repo',
    type: 'string',
    description: 'The name of the single-keyboard GitHub repo',
  })
  @ApiBody({
    description: 'The project information',
    type: Project,
  })
  @ApiResponse({
    status: 201,
    description: 'Created',
    type: GitHubPullRequest,
    schema: {
      allOf: [{ $ref: getSchemaPath(GitHubPullRequest)}],
      example: {
        'number': 42,
        url: 'https://github.com/octocat/Hello-World/pull/42',
        state: 'open',
        action: 'created',
      }
    }
  })
  @ApiResponse({ status: 304, description: 'No new changes on the single-keyboard repo' })
  @ApiResponse({ status: 400, description: 'Missing project data in request body'})
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 409,
    description: 'Keyboards repo has new changes in the single-keyboard directory. This is not allowed.'
  })
  @ApiResponse({
    status: 412,
    description: 'Non-linear history in single-keyboard repo. Force-push is not allowed.',
  })
  @HttpCode(201)
  public createPullRequest(
    @Session() session: any,
    @Headers('authorization') token: string,
    @Param('repo') repo: string,
    @Body() project: Project,
  ): Observable<GitHubPullRequest> {
    if (!project || !project.name) {
      throw new HttpException('Missing project data in request body', 400);
    }
    const head = `${session.login}:${session.login}-${repo}`;
    const singleKbRepoPath = path.join(
      this.configService.workDirectory,
      session.login,
      repo);
    debug(`createPullRequest for ${repo}`);
    return this.pullRequestService
      .transferChanges(singleKbRepoPath, this.backendService.localKeyboardsRepo, project)
      .pipe(
        last(),
        tap(() => debug(`pushing changes in ${this.backendService.localKeyboardsRepo}`)),
        switchMap(() =>
          this.gitService.push(
            this.backendService.localKeyboardsRepo,
            session.login,
            `${session.login}-${repo}`,
            token,
          ),
        ),
        tap(() => debug(`pushing KDO notes in ${this.backendService.localKeyboardsRepo}`)),
        switchMap(() =>
          this.gitService.push(
            this.backendService.localKeyboardsRepo,
            session.login,
            'refs/notes/kdo',
            token,
          ),
        ),
        tap(() => debug(`pushing KDO notes in ${singleKbRepoPath}`)),
        switchMap(() =>
          this.gitService.push(
            singleKbRepoPath,
            session.login,
            'refs/notes/kdo',
            token,
          ),
        ),
        tap(() => debug('create PR on keyboards repo')),
        switchMap(() =>
          this.pullRequestService.createPullRequestOnKeyboardsRepo(
            token,
            head,
            prTitle.replace(/\${repo}/g, project.name),
            prDescription.replace(/\${repo}/g, project.name),
          ),
        ),
      );
  }

  @Get(':repo')
  @ApiOperation({
    summary: 'Gets an existing pull request',
    description: `Gets an existing pull request based on the specified single keyboards repo,
      or '404' if there is no open PR for that single keyboard repo.`,
  })
  @ApiHeader({
    // This header is required, however it's taken care of by the security schemas.
    // Setting `required: false` here allows to try the API through the Swagger UI
    // without explicitly filling in the authorization token.
    name: 'authorization',
    required: false,
  })
  @ApiParam({
    name: 'repo',
    type: 'string',
    description: 'The name of the single-keyboard GitHub repo',
  })
  @ApiResponse({
    status: 200,
    description: 'OK. Returns information about the existing pull request.',
    type: GitHubPullRequest,
    schema: {
      allOf: [{ $ref: getSchemaPath(GitHubPullRequest) }],
      example: {
        'number': 42,
        url: 'https://github.com/octocat/Hello-World/pull/42',
        state: 'open',
        action: 'existing',
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'No open pull request for the single-keyboard repo' })
  public getPullRequest(
    @Session() session: any,
    @Headers('authorization') token: string,
    @Param() params,
  ): Observable<GitHubPullRequest> {
    const head = `${session.login}:${session.login}-${params.repo}`;
    return this.pullRequestService.getPullRequestOnKeyboardsRepo(token, head);
  }
}
