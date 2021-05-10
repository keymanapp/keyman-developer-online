import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { GitHubPullRequest } from '../model/git-hub-pull-request';
import { Project } from '../model/project';
import { ErrorHelper } from '../utils/error-helper';
import { UserService } from './user.service';

@Injectable({
  providedIn: 'root'
})
export class SingleProjectService {

  constructor(
    private readonly http: HttpClient,
    private readonly userService: UserService,
    private readonly errorHelper: ErrorHelper
  ) { }

  public cloneProject(name: string): Observable<Project|null> {
    return this.http.post<Project>(`${environment.apiUrl}/projects/${name}`, null, {
      headers: { Authorization: `token ${this.userService.accessToken}` },
    }).pipe(
      // we let caller deal with errors
      map(obj => new Project(obj.name, true, name, obj.prefix, obj.repoUrl)),
    );
  }

  public createPullRequest(
    repoName: string,
    prefix: string,
    keyboardId: string,
  ): Observable<GitHubPullRequest | null> {
    // eslint-disable-next-line id-blacklist
    return this.http.put<{ number; url: string; action: string }>(
      `${environment.apiUrl}/projects/${repoName}`,
      { name: keyboardId, prefix },
      { headers: { Authorization: `token ${this.userService.accessToken}` } },
    ).pipe(
      // we let caller deal with errors
      // eslint-disable-next-line id-blacklist
      map((pullRequest: { number; url: string; action: string }) => new GitHubPullRequest(repoName, pullRequest.number, pullRequest.url, pullRequest.action)),
    );
  }

  public getPullRequest(repoName: string): Observable<GitHubPullRequest | null> {
    // eslint-disable-next-line id-blacklist
    return this.http.get<{ number, url: string, action: string }>(`${environment.apiUrl}/projects/${repoName}`, {
      headers: { Authorization: `token ${this.userService.accessToken}` },
    }).pipe(
      catchError(error => {
        if (error.status === 404) {
          // eslint-disable-next-line id-blacklist
          return of({ number: 0, url: '', action: 'notfound'});
        }
        this.errorHelper.handleError(`GET projects/${repoName} REST API`, null);
      }),
      map(pullRequest => new GitHubPullRequest(repoName, pullRequest.number, pullRequest.url, pullRequest.action)),
    );
  }
}
